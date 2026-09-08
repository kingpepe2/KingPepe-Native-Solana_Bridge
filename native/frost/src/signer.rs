use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

pub const ROLE_A: u8 = 0;
pub const ROLE_B: u8 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[repr(u8)]
pub enum SignerRole {
    A = ROLE_A,
    B = ROLE_B,
}

impl SignerRole {
    pub fn is_participant(&self) -> bool {
        matches!(self, Self::A | Self::B)
    }
}

#[derive(Debug)]
pub struct Signer {
    pub role: SignerRole,
    seed: [u8; 32],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct ParticipantPublicKey([u8; 32]);

impl ParticipantPublicKey {
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigningRequest {
    pub request_id: [u8; 32],
    pub digest: [u8; 32],
    pub operation_id: [u8; 32],
    pub nonce: [u8; 32],
    pub epoch: u64,
    pub amount: u64,
    pub fee: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedShare {
    pub request_id: [u8; 32],
    pub signer_role: SignerRole,
    pub epoch: u64,
    pub nonce: [u8; 32],
    pub message_hash: [u8; 32],
    pub signature: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct SignerState {
    pub last_consumed: u64,
    pub active_sessions: u32,
}

impl Default for SignerState {
    fn default() -> Self {
        Self {
            last_consumed: 0,
            active_sessions: 0,
        }
    }
}

impl Signer {
    pub fn from_seed(role: SignerRole, seed: [u8; 32]) -> Self {
        Self { role, seed }
    }

    pub fn generate(role: SignerRole) -> Self {
        let mut rng = OsRng;
        let mut seed = [0u8; 32];
        rng.fill_bytes(&mut seed);
        Self {
            role,
            seed,
        }
    }

    pub fn public_key(&self) -> ParticipantPublicKey {
        let mut digest = Sha256::new();
        digest.update(b"KINGPEPE_PHASE02_SIGNER_PUBLIC_KEY_V1");
        digest.update([self.role as u8]);
        digest.update(self.seed);
        ParticipantPublicKey(digest.finalize().into())
    }

    pub fn public_key_bytes(&self) -> [u8; 32] {
        *self.public_key().as_bytes()
    }

    pub fn sign(
        &self,
        request: &SigningRequest,
        state: &SignerState,
    ) -> Result<SignedShare, SignerError> {
        if request.amount == 0 {
            return Err(SignerError::AmountZero);
        }
        if request.epoch == 0 {
            return Err(SignerError::EpochInvalid);
        }
        if state.last_consumed > 0 && state.active_sessions > 128 {
            return Err(SignerError::RateLimited);
        }
        let message_hash = build_message(request);
        let signature = build_test_signature(&self.public_key(), self.role, &message_hash);
        Ok(SignedShare {
            request_id: request.request_id,
            signer_role: self.role,
            epoch: request.epoch,
            nonce: request.nonce,
            message_hash,
            signature: signature.to_vec(),
        })
    }

    pub fn verify_local(&self, request: &SigningRequest, share: &SignedShare) -> Result<bool, SignerError> {
        if share.signer_role != self.role {
            return Err(SignerError::WrongRole);
        }
        if share.epoch != request.epoch {
            return Err(SignerError::EpochInvalid);
        }
        if share.nonce != request.nonce {
            return Err(SignerError::DigestMismatch);
        }
        if share.request_id != request.request_id {
            return Err(SignerError::RequestIdMismatch);
        }
        if share.message_hash != build_message(request) {
            return Err(SignerError::DigestMismatch);
        }
        validate_test_signature(&self.public_key(), share)?;
        Ok(true)
    }
}

impl SignedShare {
    pub fn validate(
        &self,
        public_key: &ParticipantPublicKey,
        request: &SigningRequest,
    ) -> Result<bool, SignerError> {
        if self.request_id != request.request_id || self.nonce != request.nonce || self.epoch != request.epoch {
            return Err(SignerError::RequestIdMismatch);
        }
        if self.message_hash != build_message(request) {
            return Err(SignerError::DigestMismatch);
        }
        validate_test_signature(public_key, self)?;
        Ok(true)
    }
}

pub fn build_message(request: &SigningRequest) -> [u8; 32] {
    let mut digest = Sha256::new();
    digest.update(request.request_id);
    digest.update(request.digest);
    digest.update(request.epoch.to_le_bytes());
    digest.update(request.nonce);
    digest.update(request.operation_id);
    digest.update(request.amount.to_le_bytes());
    digest.update(request.fee.to_le_bytes());
    digest.finalize().into()
}

fn build_test_signature(
    public_key: &ParticipantPublicKey,
    role: SignerRole,
    message_hash: &[u8; 32],
) -> [u8; 32] {
    let mut digest = Sha256::new();
    digest.update(b"KINGPEPE_PHASE02_SIGNER_SHARE_V1");
    digest.update(public_key.as_bytes());
    digest.update([role as u8]);
    digest.update(message_hash);
    digest.finalize().into()
}

fn validate_test_signature(public_key: &ParticipantPublicKey, share: &SignedShare) -> Result<(), SignerError> {
    let expected = build_test_signature(public_key, share.signer_role, &share.message_hash);
    if share.signature.as_slice() != expected {
        return Err(SignerError::BadSignature);
    }
    Ok(())
}

#[derive(Debug, Error)]
pub enum SignerError {
    #[error("unsupported signer role")]
    WrongRole,
    #[error("bad signature")]
    BadSignature,
    #[error("zero amount")]
    AmountZero,
    #[error("epoch is invalid")]
    EpochInvalid,
    #[error("signer is rate-limited")]
    RateLimited,
    #[error("digest mismatch")]
    DigestMismatch,
    #[error("request id mismatch")]
    RequestIdMismatch,
}
