//! Spoken-command formatting and stable-prefix streaming for live dictation.

use std::collections::HashMap;

pub const DICTATION_LIVE_TAIL_WORDS: usize = 4;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormatState {
    pub at_line_start: bool,
    pub capitalize_next: bool,
    pub has_output: bool,
    pub needs_space: bool,
    pub numbered_next: i32,
}

impl Default for FormatState {
    fn default() -> Self {
        Self {
            at_line_start: true,
            capitalize_next: true,
            has_output: false,
            needs_space: false,
            numbered_next: 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Projection {
    pub consumed: usize,
    pub state: FormatState,
    pub text: String,
}

type Command = (&'static str, &'static str);

const DICTATION_COMMANDS: &[(&[&str], Command)] = &[
    (&["exclamation", "mark"], ("punctuation", "!")),
    (&["exclamation", "point"], ("punctuation", "!")),
    (&["next", "bullet", "point"], ("bullet", "")),
    (&["new", "bullet", "point"], ("bullet", "")),
    (&["numbered", "list"], ("numbered_list", "")),
    (&["new", "paragraph"], ("new_paragraph", "")),
    (&["question", "mark"], ("punctuation", "?")),
    (&["bullet", "list"], ("bullet", "")),
    (&["bullet", "point"], ("bullet", "")),
    (&["next", "bullet"], ("bullet", "")),
    (&["new", "bullet"], ("bullet", "")),
    (&["next", "item"], ("next_item", "")),
    (&["next", "line"], ("new_line", "")),
    (&["full", "stop"], ("punctuation", ".")),
    (&["new", "line"], ("new_line", "")),
    (&["semicolon"], ("punctuation", ";")),
    (&["newline"], ("new_line", "")),
    (&["period"], ("punctuation", ".")),
    (&["comma"], ("punctuation", ",")),
    (&["colon"], ("punctuation", ":")),
    (&["bullet"], ("bullet", "")),
    (&["dot"], ("punctuation", ".")),
];

pub fn stable_words(hypotheses: &[String]) -> Vec<String> {
    if hypotheses.len() < 3 {
        return Vec::new();
    }
    let word_sets: Vec<Vec<&str>> = hypotheses[hypotheses.len().saturating_sub(3)..]
        .iter()
        .map(|h| h.split_whitespace().collect())
        .collect();
    let common = word_sets.iter().map(|w| w.len()).min().unwrap_or(0);
    let mut stable = Vec::new();
    for index in 0..common {
        let values: Vec<&str> = word_sets.iter().map(|w| w[index]).collect();
        if values.iter().any(|v| *v != values[0]) {
            break;
        }
        stable.push(values[0].to_string());
    }
    stable
}

pub fn remaining_text(typed_words: &[String], completed_text: &str) -> String {
    let completed_words: Vec<&str> = completed_text.split_whitespace().collect();
    let typed_count = typed_words.len().min(completed_words.len());
    completed_words[typed_count..].join(" ")
}

pub fn canonical_dictation_word(word: &str) -> String {
    word.trim_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase()
}

fn replacement_phrases(replacements: &HashMap<String, String>) -> Vec<(Vec<String>, String)> {
    let mut phrases = Vec::new();
    for (heard, written) in replacements {
        let phrase: Vec<String> = heard
            .split_whitespace()
            .map(canonical_dictation_word)
            .filter(|w| !w.is_empty())
            .collect();
        let written = written.trim();
        if !phrase.is_empty() && !written.is_empty() {
            phrases.push((phrase, written.to_string()));
        }
    }
    phrases.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
    phrases
}

fn matching_phrase<'a, T: Clone>(
    canonical_words: &[String],
    index: usize,
    phrases: &'a [(Vec<String>, T)],
) -> Option<(&'a [String], T)> {
    for (phrase, value) in phrases {
        let end = index + phrase.len();
        if end <= canonical_words.len() && &canonical_words[index..end] == phrase.as_slice() {
            return Some((phrase.as_slice(), value.clone()));
        }
    }
    None
}

fn capitalize_dictation_text(text: &str) -> String {
    let mut chars = text.chars();
    let mut out = String::new();
    let mut pending = String::new();
    let mut found = false;
    for ch in chars.by_ref() {
        if !found && ch.is_ascii_alphabetic() {
            if ch.is_ascii_lowercase() {
                out.push_str(&pending);
                out.push(ch.to_ascii_uppercase());
            } else {
                out.push_str(&pending);
                out.push(ch);
            }
            found = true;
            break;
        }
        if ch.is_ascii_alphabetic() {
            out.push_str(&pending);
            out.push(ch);
            found = true;
            break;
        }
        pending.push(ch);
    }
    if !found {
        return text.to_string();
    }
    out.extend(chars);
    out
}

fn append_dictation_text(parts: &mut Vec<String>, state: &mut FormatState, text: &str) {
    let rendered = if state.capitalize_next {
        capitalize_dictation_text(text)
    } else {
        text.to_string()
    };
    if state.needs_space {
        parts.push(" ".into());
    }
    parts.push(rendered.clone());
    state.at_line_start = false;
    state.capitalize_next = rendered
        .chars()
        .rev()
        .find(|c| !matches!(c, '"' | '\''))
        .is_some_and(|c| matches!(c, '.' | '!' | '?'));
    state.has_output = true;
    state.needs_space = true;
}

fn append_dictation_command(parts: &mut Vec<String>, state: &mut FormatState, command: Command) {
    let (action, value) = command;
    if action == "punctuation" {
        parts.push(value.into());
        state.at_line_start = false;
        state.capitalize_next = matches!(value, "." | "!" | "?");
        state.has_output = true;
        state.needs_space = true;
        return;
    }
    if action == "new_line" || action == "new_paragraph" {
        parts.push(if action == "new_paragraph" {
            "\n\n".into()
        } else {
            "\n".into()
        });
        state.at_line_start = true;
        state.capitalize_next = true;
        state.has_output = true;
        state.needs_space = false;
        return;
    }
    if state.has_output && !state.at_line_start {
        parts.push("\n".into());
    }
    if action == "bullet" {
        parts.push("- ".into());
        state.numbered_next = 0;
    } else {
        let number = if action == "numbered_list" || state.numbered_next < 1 {
            1
        } else {
            state.numbered_next
        };
        parts.push(format!("{number}. "));
        state.numbered_next = number + 1;
    }
    state.at_line_start = false;
    state.capitalize_next = true;
    state.has_output = true;
    state.needs_space = false;
}

pub fn dictation_projection(
    words: &[String],
    state: Option<&FormatState>,
    replacements: &HashMap<String, String>,
    live: bool,
) -> Projection {
    let mut next_state = state.cloned().unwrap_or_default();
    let canonical_words: Vec<String> = words.iter().map(|w| canonical_dictation_word(w)).collect();
    let replacement_options = replacement_phrases(replacements);
    let command_options: Vec<(Vec<String>, Command)> = DICTATION_COMMANDS
        .iter()
        .map(|(phrase, command)| (phrase.iter().map(|s| (*s).to_string()).collect(), *command))
        .collect();
    let commit_limit = if live {
        words.len().saturating_sub(DICTATION_LIVE_TAIL_WORDS)
    } else {
        words.len()
    };
    let mut parts = Vec::new();
    let mut index = 0usize;
    while index < commit_limit {
        if canonical_words[index] == "literal" && index + 1 < words.len() {
            let mut options = command_options.clone();
            options.extend(replacement_options.iter().map(|(p, v)| (p.clone(), ("replacement", v.as_str()))));
            // Literal escapes only commands/replacements by length of match.
            let literal_match = matching_phrase(&canonical_words, index + 1, &command_options)
                .map(|(p, _)| p.len())
                .or_else(|| matching_phrase(&canonical_words, index + 1, &replacement_options).map(|(p, _)| p.len()))
                .unwrap_or(1);
            let literal_end = index + 1 + literal_match;
            if literal_end > commit_limit {
                break;
            }
            append_dictation_text(
                &mut parts,
                &mut next_state,
                &words[index + 1..literal_end].join(" "),
            );
            index = literal_end;
            continue;
        }

        if let Some((phrase, command)) = matching_phrase(&canonical_words, index, &command_options) {
            let command_end = index + phrase.len();
            if command_end > commit_limit {
                break;
            }
            append_dictation_command(&mut parts, &mut next_state, command);
            index = command_end;
            continue;
        }

        if let Some((phrase, written)) = matching_phrase(&canonical_words, index, &replacement_options) {
            let replacement_end = index + phrase.len();
            if replacement_end > commit_limit {
                break;
            }
            append_dictation_text(&mut parts, &mut next_state, &written);
            index = replacement_end;
            continue;
        }

        append_dictation_text(&mut parts, &mut next_state, &words[index]);
        index += 1;
    }
    Projection {
        consumed: index,
        state: next_state,
        text: parts.join(""),
    }
}

pub fn format_dictation(text: &str, replacements: &HashMap<String, String>) -> String {
    let words: Vec<String> = text.split_whitespace().map(str::to_string).collect();
    dictation_projection(&words, None, replacements, false).text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_shared_prefix() {
        let hypotheses = vec![
            "please open the".into(),
            "please open the file".into(),
            "please open the file now".into(),
        ];
        assert_eq!(stable_words(&hypotheses), vec!["please", "open", "the"]);
    }

    #[test]
    fn formats_punctuation_and_replacements() {
        let mut replacements = HashMap::new();
        replacements.insert("Joseph".into(), "Yosef".into());
        assert_eq!(
            format_dictation("Hello comma my name is Joseph period", &replacements),
            "Hello, my name is Yosef."
        );
    }

    #[test]
    fn formats_lists() {
        let empty = HashMap::new();
        assert_eq!(
            format_dictation(
                "I need three changes period new line bullet fix authentication next bullet add tests next bullet update documentation",
                &empty
            ),
            "I need three changes.\n- Fix authentication\n- Add tests\n- Update documentation"
        );
        assert_eq!(
            format_dictation("numbered list fix login next item add tests next item deploy", &empty),
            "1. Fix login\n2. Add tests\n3. Deploy"
        );
    }

    #[test]
    fn live_keeps_tail() {
        let empty = HashMap::new();
        let words: Vec<String> = ["one", "two", "three", "four", "five", "six"]
            .into_iter()
            .map(str::to_string)
            .collect();
        let projection = dictation_projection(&words, None, &empty, true);
        assert_eq!(projection.consumed, 2);
        assert_eq!(projection.text, "One two");
    }

    #[test]
    fn remaining_skips_prefix() {
        let typed = vec!["please".into(), "open".into(), "the".into()];
        assert_eq!(remaining_text(&typed, "please open the file now"), "file now");
    }
}
