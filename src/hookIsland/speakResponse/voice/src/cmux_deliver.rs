//! Deliver refined prompts into cmux (new workspace or focused/resume surface).

use crate::config::VoicePreferences;
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone)]
pub struct DeliveryResult {
    pub summary: String,
    pub text: String,
}

/// Deliver refined (or raw) text according to bag delivery prefs.
pub fn deliver_text(text: &str, prefs: &VoicePreferences) -> Result<DeliveryResult, String> {
    let clean = text.trim();
    if clean.is_empty() {
        return Ok(DeliveryResult {
            summary: "empty".into(),
            text: String::new(),
        });
    }
    match prefs.prompt_refinement_delivery.as_str() {
        "cmux-new" => deliver_cmux_new(
            clean,
            &prefs.prompt_refinement_cmux_command,
            prefs.prompt_refinement_cmux_auto_submit,
        ),
        "cmux-resume" => {
            deliver_cmux_resume(clean, prefs.prompt_refinement_cmux_auto_submit)
        }
        _ => {
            // caret path is handled by the caller via type_text / dictation projection
            Err("caret delivery is handled by the typing path".into())
        }
    }
}

pub fn is_cmux_delivery(delivery: &str) -> bool {
    matches!(delivery, "cmux-new" | "cmux-resume")
}

fn deliver_cmux_new(
    text: &str,
    command_template: &str,
    auto_submit: bool,
) -> Result<DeliveryResult, String> {
    ensure_cmux()?;
    let cwd = resolve_cwd();
    let name = short_title(text);
    let prompt_file = write_prompt_file(text)?;

    if !command_template.trim().is_empty() {
        let command = expand_template(command_template, text, &prompt_file, &cwd)?;
        let output = cmux_cmd()
            .args([
                "workspace",
                "create",
                "--name",
                &name,
                "--cwd",
                &cwd,
                "--focus",
                "true",
                "--command",
                &command,
                "--json",
            ])
            .output()
            .map_err(|e| format!("cmux workspace create: {e}"))?;
        if !output.status.success() {
            return Err(format_cmux_err("workspace create", &output));
        }
        let meta = parse_json_stdout(&output.stdout);
        let summary = format!(
            "cmux-new run workspace={} command={}",
            meta_ref(&meta, "workspace_ref", "workspace_id"),
            truncate(&command, 80)
        );
        return Ok(DeliveryResult {
            summary,
            text: text.to_string(),
        });
    }

    // Paste-only: new focused workspace, inject text, optional Enter.
    let output = cmux_cmd()
        .args([
            "workspace",
            "create",
            "--name",
            &name,
            "--cwd",
            &cwd,
            "--focus",
            "true",
            "--json",
        ])
        .output()
        .map_err(|e| format!("cmux workspace create: {e}"))?;
    if !output.status.success() {
        return Err(format_cmux_err("workspace create", &output));
    }
    let meta = parse_json_stdout(&output.stdout);
    let surface = meta_string(&meta, "surface_id")
        .or_else(|| meta_string(&meta, "surface_ref"))
        .ok_or_else(|| "cmux workspace create returned no surface id".to_string())?;
    let workspace = meta_string(&meta, "workspace_id")
        .or_else(|| meta_string(&meta, "workspace_ref"))
        .unwrap_or_default();

    // Brief settle so the new PTY is ready for input.
    std::thread::sleep(std::time::Duration::from_millis(350));
    send_text_to_surface(&surface, text, auto_submit)?;

    let summary = format!(
        "cmux-new paste workspace={} surface={} auto_submit={}",
        if workspace.is_empty() {
            "?"
        } else {
            workspace.as_str()
        },
        surface,
        auto_submit
    );
    Ok(DeliveryResult {
        summary,
        text: text.to_string(),
    })
}

fn deliver_cmux_resume(text: &str, auto_submit: bool) -> Result<DeliveryResult, String> {
    ensure_cmux()?;
    let focus = cmux_identify()?;
    let surface = focus
        .get("surface_id")
        .or_else(|| focus.get("surface_ref"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "cmux identify: no focused surface".to_string())?
        .to_string();
    let workspace = focus
        .get("workspace_ref")
        .or_else(|| focus.get("workspace_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("?")
        .to_string();

    // Prefer resume binding when present (session-aware surface).
    let resume = surface_resume_get(&surface).ok();
    let resume_kind = resume
        .as_ref()
        .and_then(|v| v.pointer("/resume_binding/kind"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let resume_checkpoint = resume
        .as_ref()
        .and_then(|v| v.pointer("/resume_binding/checkpoint_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    send_text_to_surface(&surface, text, auto_submit)?;

    let summary = if resume_kind.is_empty() {
        format!(
            "cmux-resume surface={} workspace={} auto_submit={}",
            surface, workspace, auto_submit
        )
    } else {
        format!(
            "cmux-resume surface={} workspace={} agent={} session={} auto_submit={}",
            surface, workspace, resume_kind, resume_checkpoint, auto_submit
        )
    };
    Ok(DeliveryResult {
        summary,
        text: text.to_string(),
    })
}

fn send_text_to_surface(surface: &str, text: &str, auto_submit: bool) -> Result<(), String> {
    // surface.send_text types into the PTY / agent input.
    let params = serde_json::json!({
        "surface_id": surface,
        "text": text,
    });
    // Also try surface_ref form when surface looks like surface:N
    let params = if surface.starts_with("surface:") {
        serde_json::json!({ "surface_ref": surface, "text": text })
    } else if surface.contains('-') {
        serde_json::json!({ "surface_id": surface, "text": text })
    } else {
        params
    };
    rpc("surface.send_text", &params)?;
    if auto_submit {
        let key_params = if surface.starts_with("surface:") {
            serde_json::json!({ "surface_ref": surface, "key": "enter" })
        } else {
            serde_json::json!({ "surface_id": surface, "key": "enter" })
        };
        // Best-effort: some cmux builds want "return" / "Enter"
        if rpc("surface.send_key", &key_params).is_err() {
            let alt = if surface.starts_with("surface:") {
                serde_json::json!({ "surface_ref": surface, "key": "return" })
            } else {
                serde_json::json!({ "surface_id": surface, "key": "return" })
            };
            let _ = rpc("surface.send_key", &alt);
        }
    }
    Ok(())
}

fn surface_resume_get(surface: &str) -> Result<Value, String> {
    let params = if surface.starts_with("surface:") {
        serde_json::json!({ "surface_ref": surface })
    } else {
        serde_json::json!({ "surface_id": surface })
    };
    rpc("surface.resume.get", &params)
}

fn cmux_identify() -> Result<Value, String> {
    let output = cmux_cmd()
        .args(["identify", "--json", "--id-format", "both"])
        .output()
        .map_err(|e| format!("cmux identify: {e}"))?;
    if !output.status.success() {
        return Err(format_cmux_err("identify", &output));
    }
    let value = parse_json_stdout(&output.stdout);
    if let Some(focused) = value.get("focused").cloned() {
        return Ok(focused);
    }
    if let Some(caller) = value.get("caller").cloned() {
        return Ok(caller);
    }
    Ok(value)
}

fn rpc(method: &str, params: &Value) -> Result<Value, String> {
    let params_text = serde_json::to_string(params).map_err(|e| e.to_string())?;
    let output = cmux_cmd()
        .args(["rpc", method, &params_text])
        .output()
        .map_err(|e| format!("cmux rpc {method}: {e}"))?;
    if !output.status.success() {
        return Err(format_cmux_err(&format!("rpc {method}"), &output));
    }
    Ok(parse_json_stdout(&output.stdout))
}

fn cmux_cmd() -> Command {
    let mut cmd = Command::new(cmux_bin());
    cmd.env("CMUX_QUIET", "1");
    cmd
}

fn cmux_bin() -> PathBuf {
    if let Ok(path) = which("cmux") {
        return path;
    }
    let candidates = [
        "/Applications/cmux.app/Contents/Resources/bin/cmux",
        "/usr/local/bin/cmux",
        "/opt/homebrew/bin/cmux",
    ];
    for candidate in candidates {
        let path = PathBuf::from(candidate);
        if path.is_file() {
            return path;
        }
    }
    PathBuf::from("cmux")
}

fn which(name: &str) -> Result<PathBuf, ()> {
    let output = Command::new("which").arg(name).output().map_err(|_| ())?;
    if !output.status.success() {
        return Err(());
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        Err(())
    } else {
        Ok(PathBuf::from(path))
    }
}

fn ensure_cmux() -> Result<(), String> {
    let bin = cmux_bin();
    if bin.as_os_str() == "cmux" {
        // hope PATH works
        return Ok(());
    }
    if !bin.is_file() {
        return Err("cmux CLI not found (install cmux or add it to PATH)".into());
    }
    Ok(())
}

fn resolve_cwd() -> String {
    // Prefer focused cmux workspace cwd when available.
    if let Ok(output) = cmux_cmd()
        .args(["workspace", "list", "--json"])
        .output()
    {
        if output.status.success() {
            if let Ok(value) = serde_json::from_slice::<Value>(&output.stdout) {
                if let Some(dir) = value
                    .get("workspaces")
                    .and_then(|w| w.as_array())
                    .and_then(|arr| {
                        arr.iter().find_map(|ws| {
                            // Prefer the workspace that matches focused identify.
                            ws.get("current_directory").and_then(|d| d.as_str())
                        })
                    })
                {
                    // Better: match focused workspace_id
                    if let Ok(focus) = cmux_identify() {
                        let focus_id = focus
                            .get("workspace_id")
                            .or_else(|| focus.get("workspace_ref"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        if let Some(workspaces) = value.get("workspaces").and_then(|w| w.as_array())
                        {
                            for ws in workspaces {
                                let id = ws
                                    .get("id")
                                    .or_else(|| ws.get("workspace_id"))
                                    .or_else(|| ws.get("ref"))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                if !focus_id.is_empty()
                                    && (id == focus_id
                                        || id.ends_with(focus_id)
                                        || focus_id.ends_with(id))
                                {
                                    if let Some(cd) =
                                        ws.get("current_directory").and_then(|d| d.as_str())
                                    {
                                        if !cd.is_empty() {
                                            return cd.to_string();
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if !dir.is_empty() {
                        return dir.to_string();
                    }
                }
            }
        }
    }
    std::env::current_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| std::env::var("HOME").unwrap_or_else(|_| "/".into()))
}

fn write_prompt_file(text: &str) -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("dufflebag-refine");
    fs::create_dir_all(&dir).map_err(|e| format!("temp dir: {e}"))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = dir.join(format!("prompt-{stamp}.txt"));
    let mut file = fs::File::create(&path).map_err(|e| format!("write prompt file: {e}"))?;
    file.write_all(text.as_bytes())
        .map_err(|e| format!("write prompt file: {e}"))?;
    file.write_all(b"\n").ok();
    Ok(path)
}

fn expand_template(
    template: &str,
    prompt: &str,
    prompt_file: &Path,
    cwd: &str,
) -> Result<String, String> {
    let file = prompt_file
        .to_str()
        .ok_or_else(|| "prompt file path not utf-8".to_string())?;
    let escaped = shell_single_quote(prompt);
    Ok(template
        .replace("{{prompt_file}}", file)
        .replace("{{prompt}}", &escaped)
        .replace("{{cwd}}", cwd))
}

fn shell_single_quote(text: &str) -> String {
    // Safe for embedding in single-quoted shell strings: ' -> '\'' 
    format!("'{}'", text.replace('\'', "'\\''"))
}

fn short_title(text: &str) -> String {
    let one_line = text.lines().next().unwrap_or(text).trim();
    let clipped: String = one_line.chars().take(40).collect();
    if clipped.is_empty() {
        "refine".into()
    } else {
        format!("refine: {clipped}")
    }
}

fn parse_json_stdout(stdout: &[u8]) -> Value {
    let text = String::from_utf8_lossy(stdout);
    // Prefer last JSON object in output (cmux may print notices).
    if let Ok(value) = serde_json::from_str::<Value>(text.trim()) {
        return value;
    }
    for line in text.lines().rev() {
        let line = line.trim();
        if line.starts_with('{') {
            if let Ok(value) = serde_json::from_str::<Value>(line) {
                return value;
            }
        }
    }
    Value::Null
}

fn meta_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

fn meta_ref(value: &Value, ref_key: &str, id_key: &str) -> String {
    meta_string(value, ref_key)
        .or_else(|| meta_string(value, id_key))
        .unwrap_or_else(|| "?".into())
}

fn format_cmux_err(label: &str, output: &std::process::Output) -> String {
    let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let out = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !err.is_empty() {
        format!("cmux {label}: {err}")
    } else if !out.is_empty() {
        format!("cmux {label}: {out}")
    } else {
        format!("cmux {label} failed")
    }
}

fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        text.to_string()
    } else {
        let clipped: String = text.chars().take(max.saturating_sub(1)).collect();
        format!("{clipped}…")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_quotes_apostrophes() {
        assert_eq!(shell_single_quote("it's"), "'it'\\''s'");
    }

    #[test]
    fn expands_prompt_file_placeholder() {
        let path = PathBuf::from("/tmp/p.txt");
        let out = expand_template(
            r#"codex --yolo -- "$(cat {{prompt_file}})""#,
            "hi",
            &path,
            "/cwd",
        )
        .unwrap();
        assert!(out.contains("/tmp/p.txt"));
        assert!(!out.contains("{{prompt_file}}"));
    }

    #[test]
    fn cmux_delivery_helpers() {
        assert!(is_cmux_delivery("cmux-new"));
        assert!(is_cmux_delivery("cmux-resume"));
        assert!(!is_cmux_delivery("caret"));
    }
}
