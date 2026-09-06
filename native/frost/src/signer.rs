use ed25519_dalek::{Signer as _, Verifier};
use ed25519_dalek::{Signature, SigningKey, VerifyingKey};
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

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
    key: SigningKey,
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
    pub signature: [u8; 64],
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
        Self {
            role,
            key: SigningKey::from_bytes(&seed),
        }
    }

    pub fn generate(role: SignerRole) -> Self {
        let mut rng = OsRng;
        Self {
            role,
            key: SigningKey::generate(&mut rng),
        }
    }

    pub fn public_key(&self) -> VerifyingKey {
        self.key.verifying_key()
    }

    pub fn public_key_bytes(&self) -> [u8; 32] {
        self.public_key().to_bytes()
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
        let message = build_message(request);
        let signature = self.key.sign(&message);
        Ok(SignedShare {
            request_id: request.request_id,
            signer_role: self.role,
            epoch: request.epoch,
            nonce: request.nonce,
            message_hash: message,
            signature: signature.to_bytes(),
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
        let signature = Signature::from_slice(&share.signature)
            .map_err(|_| SignerError::BadSignature)?;
        let public_key = self.public_key();
        public_key
            .verify(&share.message_hash, &signature)
            .map_err(|_| SignerError::BadSignature)?;
        Ok(true)
    }
}

impl SignedShare {
    pub fn validate(
        &self,
        public_key: &VerifyingKey,
        request: &SigningRequest,
    ) -> Result<bool, SignerError> {
        if self.request_id != request.request_id || self.nonce != request.nonce || self.epoch != request.epoch {
            return Err(SignerError::RequestIdMismatch);
        }
        if self.message_hash != build_message(request) {
            return Err(SignerError::DigestMismatch);
        }
        let signature = Signature::from_slice(&self.signature)
            .map_err(|_| SignerError::BadSignature)?;
        public_key
            .verify(&self.message_hash, &signature)
            .map_err(|_| SignerError::BadSignature)?;
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
