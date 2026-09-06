use crate::state::NonceId;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RecoveryInstruction {
    ReconcileSignatures {
        request_id: [u8; 32],
        nonce: NonceId,
    },
    MarkSessionFailed {
        request_id: [u8; 32],
        reason: String,
    },
    ForgetSession {
        request_id: [u8; 32],
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecoveryRecord {
    pub request_id: [u8; 32],
    pub nonce: NonceId,
    pub instruction: RecoveryInstruction,
    pub epoch: u64,
}

#[derive(Debug, Error)]
pub enum RecoveryError {
    #[error("recovery instruction does not match active session")]
    WrongSession,
    #[error("recovery action is unsupported in current state")]
    UnsupportedAction,
}
