//! Placeholder transceiver program crate.
//! Placeholder behavior is intentionally narrow to keep this phase buildable.

pub const PROGRAM_NAME: &str = "kingpepe_transceiver";

#[derive(Default, Debug, Clone, Copy, PartialEq, Eq)]
pub struct TransceiverState {
    pub verified_messages: u64,
}

impl TransceiverState {
    pub fn new() -> Self {
        Self {
            verified_messages: 0,
        }
    }

    pub fn record_message(&mut self) {
        self.verified_messages += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transceiver_default_has_no_verifications() {
        let state = TransceiverState::new();
        assert_eq!(state.verified_messages, 0);
    }
}

