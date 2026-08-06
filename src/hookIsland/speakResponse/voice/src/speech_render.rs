//! Markdown → spoken prose (pragmatic port of voice.py render_speech).

use regex::Regex;

fn sentence(text: &str) -> String {
    let clean = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if clean.is_empty() || clean.ends_with(['.', '!', '?', ':', ';']) {
        clean
    } else {
        format!("{clean}.")
    }
}

fn inline_speech(text: &str) -> String {
    let mut clean = text.to_string();
    let image = Regex::new(r"!\[([^\]]*)\]\(([^)]+)\)").unwrap();
    clean = image
        .replace_all(&clean, |caps: &regex::Captures| {
            let alt = caps.get(1).map(|m| m.as_str()).unwrap_or("").trim();
            let alt = if alt.is_empty() { "image" } else { alt };
            let source = caps.get(2).map(|m| m.as_str()).unwrap_or("").trim();
            format!("Image: {alt}. Source {source}")
        })
        .into_owned();
    let link = Regex::new(r"\[([^\]]+)\]\(([^)]+)\)").unwrap();
    clean = link
        .replace_all(&clean, |caps: &regex::Captures| {
            let label = caps.get(1).map(|m| m.as_str()).unwrap_or("").trim();
            let address = caps.get(2).map(|m| m.as_str()).unwrap_or("").trim();
            format!("{label}, link {address}")
        })
        .into_owned();
    let auto = Regex::new(r"<(https?://[^>]+)>").unwrap();
    clean = auto
        .replace_all(&clean, |caps: &regex::Captures| {
            format!("link {}", caps.get(1).map(|m| m.as_str()).unwrap_or(""))
        })
        .into_owned();
    let code = Regex::new(r"`([^`]*)`").unwrap();
    clean = code.replace_all(&clean, "$1").into_owned();
    let tags = Regex::new(r"<[^>]+>").unwrap();
    clean = tags.replace_all(&clean, " ").into_owned();
    // Strip unescaped emphasis markers without look-behind (regex crate).
    let mut stripped = String::with_capacity(clean.len());
    let chars: Vec<char> = clean.chars().collect();
    let mut index = 0usize;
    while index < chars.len() {
        let ch = chars[index];
        if matches!(ch, '*' | '_' | '~') && (index == 0 || chars[index - 1] != '\\') {
            index += 1;
            continue;
        }
        stripped.push(ch);
        index += 1;
    }
    stripped.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn code_speech(text: &str) -> String {
    let mut clean = text.trim().to_string();
    let replacements = [
        ("===", " strictly equals "),
        ("!==", " does not strictly equal "),
        ("=>", " arrow "),
        ("==", " equals "),
        ("!=", " does not equal "),
        (">=", " greater than or equal to "),
        ("<=", " less than or equal to "),
        ("&&", " and "),
        ("||", " or "),
        ("=", " equals "),
        (";", " semicolon "),
        ("{", " open brace "),
        ("}", " close brace "),
        ("[", " open bracket "),
        ("]", " close bracket "),
    ];
    for (symbol, spoken) in replacements {
        clean = clean.replace(symbol, spoken);
    }
    sentence(&clean)
}

fn language_name(token: &str) -> String {
    match token.to_ascii_lowercase().as_str() {
        "bash" => "Bash".into(),
        "css" => "CSS".into(),
        "html" => "HTML".into(),
        "js" | "javascript" => "JavaScript".into(),
        "json" => "JSON".into(),
        "jsx" => "JSX".into(),
        "md" | "markdown" => "Markdown".into(),
        "py" | "python" => "Python".into(),
        "sh" => "Shell".into(),
        "sql" => "SQL".into(),
        "ts" | "typescript" => "TypeScript".into(),
        "tsx" => "TSX".into(),
        "yaml" | "yml" => "YAML".into(),
        "" => "code".into(),
        other => other.to_string(),
    }
}

/// Render Markdown into a speech document (newline-separated sentences).
pub fn render_speech(markdown: &str) -> String {
    let lines: Vec<String> = markdown
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .lines()
        .map(str::to_string)
        .collect();

    let mut spoken: Vec<String> = Vec::new();
    let mut index = 0usize;
    let mut in_code = false;
    let fence = Regex::new(r"^\s*```\s*([^\s`]*)").unwrap();
    let heading = Regex::new(r"^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$").unwrap();
    let unordered = Regex::new(r"^\s*[-+*]\s+(.+)$").unwrap();
    let ordered = Regex::new(r"^\s*([0-9]+)[.)]\s+(.+)$").unwrap();
    let quote = Regex::new(r"^\s*>\s?(.*)$").unwrap();
    let hr = Regex::new(r"^\s*(?:[-*_]\s*){3,}$").unwrap();

    while index < lines.len() {
        let line = &lines[index];
        let stripped = line.trim();
        if let Some(caps) = fence.captures(line) {
            if in_code {
                spoken.push("End code block.".into());
                in_code = false;
            } else {
                let lang = language_name(caps.get(1).map(|m| m.as_str()).unwrap_or(""));
                spoken.push(sentence(&format!("Code block, {lang}")));
                in_code = true;
            }
            index += 1;
            continue;
        }
        if in_code {
            if stripped.is_empty() {
                spoken.push("Blank line.".into());
            } else {
                spoken.push(code_speech(line));
            }
            index += 1;
            continue;
        }
        if stripped.is_empty() || hr.is_match(line) {
            index += 1;
            continue;
        }
        if let Some(caps) = heading.captures(line) {
            spoken.push(sentence(&inline_speech(caps.get(1).unwrap().as_str())));
            index += 1;
            continue;
        }
        if let Some(caps) = unordered.captures(line) {
            spoken.push(sentence(&inline_speech(caps.get(1).unwrap().as_str())));
            index += 1;
            continue;
        }
        if let Some(caps) = ordered.captures(line) {
            let n = caps.get(1).unwrap().as_str();
            let body = inline_speech(caps.get(2).unwrap().as_str());
            spoken.push(sentence(&format!("{n}. {body}")));
            index += 1;
            continue;
        }
        if let Some(caps) = quote.captures(line) {
            spoken.push(sentence(&format!(
                "Quote. {}",
                inline_speech(caps.get(1).unwrap().as_str())
            )));
            index += 1;
            continue;
        }
        let clean = sentence(&inline_speech(line));
        if !clean.is_empty() {
            spoken.push(clean);
        }
        index += 1;
    }
    if in_code {
        spoken.push("End code block.".into());
    }
    spoken.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_heading_and_paragraph() {
        let out = render_speech("# Hello\n\nWorld **bold**");
        assert!(out.contains("Hello."));
        assert!(out.contains("World bold."));
    }

    #[test]
    fn renders_code_fence() {
        let out = render_speech("```ts\nconst x = 1;\n```");
        assert!(out.contains("Code block, TypeScript."));
        assert!(out.contains("End code block."));
    }
}
