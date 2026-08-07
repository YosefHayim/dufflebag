//! Route-aware prompt refinement via `prompt_refinement.py` (multi-provider).

use crate::config::VoicePreferences;
use std::path::{Path, PathBuf};
use std::process::Command;

pub fn prompt_refinement_script() -> Result<PathBuf, String> {
    let candidates = [
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("prompt_refinement.py"))),
        Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../prompt_refinement.py")),
    ];
    candidates
        .into_iter()
        .flatten()
        .find(|p| p.is_file())
        .ok_or_else(|| "prompt_refinement.py not found beside worker".to_string())
}

/// Refine with bag prefs (backend + model + reasoning effort).
pub fn refine_with_prefs(text: &str, prefs: &VoicePreferences) -> Result<String, String> {
    refine_prompt(
        text,
        &prefs.prompt_refinement_backend,
        &prefs.prompt_refinement_model,
        &prefs.prompt_refinement_reasoning_effort,
    )
}

pub fn refine_prompt(
    text: &str,
    backend: &str,
    model: &str,
    reasoning_effort: &str,
) -> Result<String, String> {
    let script = prompt_refinement_script()?;
    run_prompt_refinement_module(&script, text, backend, model, reasoning_effort)
}

fn run_prompt_refinement_module(
    script: &Path,
    text: &str,
    backend: &str,
    model: &str,
    reasoning_effort: &str,
) -> Result<String, String> {
    let backend = if backend.is_empty() { "codex" } else { backend };
    let model = if model.is_empty() {
        "gpt-5.3-codex-spark"
    } else {
        model
    };
    // prompt_refinement.py rotates models when the preferred id is missing / not
    // allowed for the signed-in Codex account (see CODEX_MODEL_FALLBACKS).
    // local/auto may need apple-fm via uv; other providers use plain python.
    let use_uv_apple = matches!(backend, "local" | "auto");
    let script_str = script
        .to_str()
        .ok_or_else(|| "prompt_refinement path not utf-8".to_string())?;
    let mut args: Vec<String> = vec![
        script_str.to_string(),
        "--backend".into(),
        backend.to_string(),
        "--model".into(),
        model.to_string(),
        "--text".into(),
        text.to_string(),
    ];
    if !reasoning_effort.is_empty() {
        args.push("--reasoning-effort".into());
        args.push(reasoning_effort.to_string());
    }

    let output = if use_uv_apple {
        let mut cmd = Command::new("uv");
        cmd.args(["run", "--with", "apple-fm-sdk==0.2.1", "python"]);
        for a in &args {
            cmd.arg(a);
        }
        cmd.output()
            .map_err(|e| format!("spawn refinement (uv): {e}"))?
    } else {
        let python = if Command::new("python3")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            "python3"
        } else {
            "python"
        };
        let mut cmd = Command::new(python);
        for a in &args {
            cmd.arg(a);
        }
        cmd.output()
            .map_err(|e| format!("spawn refinement: {e}"))?
    };
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let out = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(if !err.is_empty() {
            err
        } else if !out.is_empty() {
            out
        } else {
            "prompt refinement failed".into()
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_script_in_source_tree() {
        let path = prompt_refinement_script();
        assert!(path.is_ok(), "{path:?}");
        assert!(path.unwrap().is_file());
    }
}
