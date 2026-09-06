//! Versioned bridge message definitions shared by program crates.

use serde::{Deserialize, Serialize};

pub const MESSAGE_VERSION: u8 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BridgeMessage {
    pub version: u8,
    pub protocol: u32,
    pub amount: u64,
    pub recipient: [u8; 32],
}

impl Default for BridgeMessage {
    fn default() -> Self {
        Self {
            version: MESSAGE_VERSION,
            protocol: 1,
            amount: 0,
            recipient: [0u8; 32],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::BridgeMessage;

    #[test]
    fn default_has_version_one() {
        let msg = BridgeMessage::default();
        assert_eq!(msg.version, 1);
        assert_eq!(msg.protocol, 1);
    }
}

