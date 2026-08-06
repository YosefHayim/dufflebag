//! Control-hold finite state machine (tap / hold-to-dictate / release).
//!
//! Control is detected by polling HID key state + modifier flags so we do not
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
    ControlDown,
    ControlUp,
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

pub fn control_hold_transition(
    state: HoldState,
    event: HoldEvent,
    injected: bool,
) -> (HoldState, HoldAction) {
    if injected {
        return (state, HoldAction::None);
    }
    match (state, event) {
        (HoldState::Idle, HoldEvent::ControlDown) => (HoldState::Waiting, HoldAction::Schedule),
        (HoldState::Waiting, HoldEvent::ControlUp) => (HoldState::Idle, HoldAction::Tap),
        (HoldState::Waiting, HoldEvent::OtherDown) => (HoldState::Shortcut, HoldAction::Cancel),
        (HoldState::Waiting, HoldEvent::HoldElapsed) => (HoldState::Listening, HoldAction::Start),
        (HoldState::Shortcut, HoldEvent::ControlUp) => (HoldState::Idle, HoldAction::None),
        (HoldState::Listening, HoldEvent::ControlUp) => (HoldState::Idle, HoldAction::Stop),
        _ => (state, HoldAction::None),
    }
}

/// Hold threshold before listening (short, but long enough to beat key bounce).
pub const CONTROL_HOLD_SECONDS: f64 = 0.12;
/// Max gap between taps for double-tap Control (cancel TTS / mute / refine).
pub const CONTROL_DOUBLE_TAP_SECONDS: f64 = 0.4;
/// Default release tail (ms) when config is missing — keep the mic open after Control-up.
pub const DICTATION_RELEASE_GRACE_MS: u64 = 200;
/// How often to sample HID Control state (edge-detect hold).
pub const CONTROL_POLL_MS: u64 = 8;

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceFlagsState(state_id: u32) -> u64;
    fn CGEventSourceKeyState(state_id: u32, key: u16) -> bool;
}

/// True while either Control key is held.
/// Uses both the Control modifier flag and raw keycodes (59 left / 62 right).
#[cfg(target_os = "macos")]
pub fn control_modifier_down() -> bool {
    const HID_SYSTEM_STATE: u32 = 1;
    // kCGEventFlagMaskControl
    const CONTROL_MASK: u64 = 0x0004_0000;
    // Hardware keycodes (Carbon / HID)
    const CONTROL_LEFT: u16 = 59;
    const CONTROL_RIGHT: u16 = 62;
    unsafe {
        let flags = CGEventSourceFlagsState(HID_SYSTEM_STATE);
        if flags & CONTROL_MASK != 0 {
            return true;
        }
        if CGEventSourceKeyState(HID_SYSTEM_STATE, CONTROL_LEFT) {
            return true;
        }
        if CGEventSourceKeyState(HID_SYSTEM_STATE, CONTROL_RIGHT) {
            return true;
        }
        false
    }
}

#[cfg(not(target_os = "macos"))]
pub fn control_modifier_down() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hold_becomes_listening() {
        let (state, action) =
            control_hold_transition(HoldState::Idle, HoldEvent::ControlDown, false);
        assert_eq!(state, HoldState::Waiting);
        assert_eq!(action, HoldAction::Schedule);
        let (state, action) = control_hold_transition(state, HoldEvent::HoldElapsed, false);
        assert_eq!(state, HoldState::Listening);
        assert_eq!(action, HoldAction::Start);
    }

    #[test]
    fn short_press_is_tap() {
        let (state, _) = control_hold_transition(HoldState::Idle, HoldEvent::ControlDown, false);
        let (state, action) = control_hold_transition(state, HoldEvent::ControlUp, false);
        assert_eq!(state, HoldState::Idle);
        assert_eq!(action, HoldAction::Tap);
    }
}
