//! Placeholder bridge program crate.
//! This crate is intentionally minimal until protocol state machines and
//! instruction handlers are implemented in later phases.

pub const PROGRAM_NAME: &str = "kingpepe_bridge";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProgramState {
    Uninitialized,
    Operational,
}

pub struct BridgeProgram {
    state: ProgramState,
}

impl Default for BridgeProgram {
    fn default() -> Self {
        Self {
            state: ProgramState::Uninitialized,
        }
    }
}

impl BridgeProgram {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn initialize(&mut self) {
        self.state = ProgramState::Operational;
    }

    pub fn is_operational(&self) -> bool {
        self.state == ProgramState::Operational
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_starts_uninitialized() {
        let program = BridgeProgram::default();
        assert!(!program.is_operational());
    }
}

