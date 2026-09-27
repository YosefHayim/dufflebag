//! Section-key hold finite state machine (tap / hold-to-dictate / release).
//!
//! The §/± key is detected by polling HID key state so we do not
//! depend on CGEventTap / Input Monitoring (often missing for a rebuilt binary).

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HoldState {
    Idle,
    Waiting,
    Shortcut,
    Listening,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HoldEvent {
    CommandDown,
    CommandUp,
    OtherDown,
    HoldElapsed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HoldAction {
    None,
    Schedule,
    Cancel,
    Tap,
    Start,
    Stop,
}

pub fn command_hold_transition(
    state: HoldState,
    event: HoldEvent,
    injected: bool,
) -> (HoldState, HoldAction) {
    if injected {
        return (state, HoldAction::None);
    }
    match (state, event) {
        (HoldState::Idle, HoldEvent::CommandDown) => (HoldState::Waiting, HoldAction::Schedule),
        (HoldState::Waiting, HoldEvent::CommandUp) => (HoldState::Idle, HoldAction::Tap),
        (HoldState::Waiting, HoldEvent::OtherDown) => (HoldState::Shortcut, HoldAction::Cancel),
        (HoldState::Waiting, HoldEvent::HoldElapsed) => (HoldState::Listening, HoldAction::Start),
        (HoldState::Shortcut, HoldEvent::CommandUp) => (HoldState::Idle, HoldAction::None),
        (HoldState::Listening, HoldEvent::CommandUp) => (HoldState::Idle, HoldAction::Stop),
        _ => (state, HoldAction::None),
    }
}

/// Hold threshold before listening (short, but long enough to beat key bounce).
pub const COMMAND_HOLD_SECONDS: f64 = 0.12;
/// Max gap between taps for double-tap § (cancel TTS / mute / refine).
pub const COMMAND_DOUBLE_TAP_SECONDS: f64 = 0.4;
/// Default release tail (ms) when config is missing — keep the mic open after § up.
pub const DICTATION_RELEASE_GRACE_MS: u64 = 200;
/// How often to sample HID § state (edge-detect hold).
pub const COMMAND_POLL_MS: u64 = 8;

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceFlagsState(state_id: u32) -> u64;
    fn CGEventSourceKeyState(state_id: u32, key: u16) -> bool;
}

/// True while the MacBook §/± key is held.
#[cfg(target_os = "macos")]
pub fn command_modifier_down() -> bool {
    const HID_SYSTEM_STATE: u32 = 1;
    // kVK_ISO_Section: the physical §/± key under Esc on ISO MacBook keyboards.
    const SECTION_KEY: u16 = 0x0A;
    unsafe {
        let _ = CGEventSourceFlagsState(HID_SYSTEM_STATE);
        CGEventSourceKeyState(HID_SYSTEM_STATE, SECTION_KEY)
    }
}

#[cfg(not(target_os = "macos"))]
pub fn command_modifier_down() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hold_becomes_listening() {
        let (state, action) =
            command_hold_transition(HoldState::Idle, HoldEvent::CommandDown, false);
        assert_eq!(state, HoldState::Waiting);
        assert_eq!(action, HoldAction::Schedule);
        let (state, action) = command_hold_transition(state, HoldEvent::HoldElapsed, false);
        assert_eq!(state, HoldState::Listening);
        assert_eq!(action, HoldAction::Start);
    }

    #[test]
    fn short_press_is_tap() {
        let (state, _) = command_hold_transition(HoldState::Idle, HoldEvent::CommandDown, false);
        let (state, action) = command_hold_transition(state, HoldEvent::CommandUp, false);
        assert_eq!(state, HoldState::Idle);
        assert_eq!(action, HoldAction::Tap);
    }
}
