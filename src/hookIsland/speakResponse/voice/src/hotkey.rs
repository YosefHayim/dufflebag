//! Shift-key hold finite state machine (tap / hold-to-dictate / release).
//!
//! Shift is detected by polling HID key state so we do not depend on
//! CGEventTap / Input Monitoring (often missing for a rebuilt binary).
//! Shift is also a typing key, so any other key pressed while Shift is held
//! means the user is typing or using a shortcut: the hold is cancelled.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HoldState {
    Idle,
    Waiting,
    Shortcut,
    Listening,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HoldEvent {
    ShiftDown,
    ShiftUp,
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

pub fn shift_hold_transition(
    state: HoldState,
    event: HoldEvent,
    injected: bool,
) -> (HoldState, HoldAction) {
    if injected {
        return (state, HoldAction::None);
    }
    match (state, event) {
        (HoldState::Idle, HoldEvent::ShiftDown) => (HoldState::Waiting, HoldAction::Schedule),
        (HoldState::Waiting, HoldEvent::ShiftUp) => (HoldState::Idle, HoldAction::Tap),
        (HoldState::Waiting, HoldEvent::OtherDown) => (HoldState::Shortcut, HoldAction::Cancel),
        (HoldState::Waiting, HoldEvent::HoldElapsed) => (HoldState::Listening, HoldAction::Start),
        (HoldState::Shortcut, HoldEvent::ShiftUp) => (HoldState::Idle, HoldAction::None),
        // A slow capital letter can outlast the hold threshold: drop the clip.
        (HoldState::Listening, HoldEvent::OtherDown) => (HoldState::Shortcut, HoldAction::Cancel),
        (HoldState::Listening, HoldEvent::ShiftUp) => (HoldState::Idle, HoldAction::Stop),
        _ => (state, HoldAction::None),
    }
}

/// Hold threshold before listening. Longer than a Shift press for a capital
/// letter; the mic buffer already started at Shift down, so no audio is lost.
pub const SHIFT_HOLD_SECONDS: f64 = 0.3;
/// Max gap between taps for double-tap Shift (cancel TTS / mute / refine).
pub const SHIFT_DOUBLE_TAP_SECONDS: f64 = 0.4;
/// How often to sample HID Shift state (edge-detect hold).
pub const SHIFT_POLL_MS: u64 = 8;

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceFlagsState(state_id: u32) -> u64;
    fn CGEventSourceKeyState(state_id: u32, key: u16) -> bool;
}

#[cfg(target_os = "macos")]
const HID_SYSTEM_STATE: u32 = 1;
/// kVK_Shift and kVK_RightShift.
#[cfg(target_os = "macos")]
const SHIFT_KEYS: [u16; 2] = [0x38, 0x3C];
/// kVK_CapsLock: its HID state follows the lock light, not a press.
#[cfg(target_os = "macos")]
const CAPS_LOCK_KEY: u16 = 0x39;

/// True while either Shift key is held.
#[cfg(target_os = "macos")]
pub fn shift_key_down() -> bool {
    unsafe {
        let _ = CGEventSourceFlagsState(HID_SYSTEM_STATE);
        SHIFT_KEYS
            .iter()
            .any(|key| CGEventSourceKeyState(HID_SYSTEM_STATE, *key))
    }
}

/// True while any key other than Shift is held (letters, modifiers, Fn).
#[cfg(target_os = "macos")]
pub fn other_key_down() -> bool {
    (0u16..0x80)
        .filter(|key| !SHIFT_KEYS.contains(key) && *key != CAPS_LOCK_KEY)
        .any(|key| unsafe { CGEventSourceKeyState(HID_SYSTEM_STATE, key) })
}

#[cfg(not(target_os = "macos"))]
pub fn shift_key_down() -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
pub fn other_key_down() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hold_becomes_listening() {
        let (state, action) = shift_hold_transition(HoldState::Idle, HoldEvent::ShiftDown, false);
        assert_eq!(state, HoldState::Waiting);
        assert_eq!(action, HoldAction::Schedule);
        let (state, action) = shift_hold_transition(state, HoldEvent::HoldElapsed, false);
        assert_eq!(state, HoldState::Listening);
        assert_eq!(action, HoldAction::Start);
    }

    #[test]
    fn short_press_is_tap() {
        let (state, _) = shift_hold_transition(HoldState::Idle, HoldEvent::ShiftDown, false);
        let (state, action) = shift_hold_transition(state, HoldEvent::ShiftUp, false);
        assert_eq!(state, HoldState::Idle);
        assert_eq!(action, HoldAction::Tap);
    }

    #[test]
    fn typing_a_capital_letter_cancels_the_hold() {
        let (state, _) = shift_hold_transition(HoldState::Idle, HoldEvent::ShiftDown, false);
        let (state, action) = shift_hold_transition(state, HoldEvent::OtherDown, false);
        assert_eq!(state, HoldState::Shortcut);
        assert_eq!(action, HoldAction::Cancel);
        let (state, action) = shift_hold_transition(state, HoldEvent::ShiftUp, false);
        assert_eq!(state, HoldState::Idle);
        assert_eq!(action, HoldAction::None);
    }

    #[test]
    fn a_key_pressed_while_listening_drops_the_clip() {
        let (state, _) = shift_hold_transition(HoldState::Idle, HoldEvent::ShiftDown, false);
        let (state, _) = shift_hold_transition(state, HoldEvent::HoldElapsed, false);
        let (state, action) = shift_hold_transition(state, HoldEvent::OtherDown, false);
        assert_eq!(state, HoldState::Shortcut);
        assert_eq!(action, HoldAction::Cancel);
    }
}
