use std::collections::{BTreeMap, BTreeSet};

use thiserror::Error;

use crate::policy::{policy_bound_domain_ok, validate_amount_fits_limits, DomainBinding, SigningPolicy};
use crate::signer::{build_message, ParticipantPublicKey, SignerRole, SignedShare, SigningRequest};
use crate::state::{NonceId, NonceStore, NonceStoreError};

#[derive(Debug, Clone)]
pub struct SigningRecord {
    pub request_id: [u8; 32],
    pub operation_id: [u8; 32],
    pub epoch: u64,
    pub digest: [u8; 32],
    pub nonce: NonceId,
    pub amount: u64,
    pub fee: u64,
}

#[derive(Debug, Clone)]
pub struct AggregateSignature {
    pub request_id: [u8; 32],
    pub aggregate_message: [u8; 32],
    pub shares: Vec<SignedShare>,
}

#[derive(Debug, Clone)]
pub struct SigningSession {
    pub record: SigningRecord,
    pub seen: BTreeSet<SignerRole>,
    pub shares: BTreeMap<SignerRole, SignedShare>,
}

impl SigningSession {
    fn request(&self) -> SigningRequest {
        SigningRequest {
            request_id: self.record.request_id,
            digest: self.record.digest,
            operation_id: self.record.operation_id,
            nonce: self.record.nonce,
            epoch: self.record.epoch,
            amount: self.record.amount,
            fee: self.record.fee,
        }
    }
}

#[derive(Debug)]
pub struct SigningCoordinator {
    required_participants: BTreeSet<SignerRole>,
    policy: SigningPolicy,
    epoch: u64,
    nonce_store: NonceStore,
    sessions: BTreeMap<[u8; 32], SigningSession>,
    completed: BTreeMap<[u8; 32], AggregateSignature>,
    participant_keys: BTreeMap<SignerRole, ParticipantPublicKey>,
}

impl SigningCoordinator {
    pub fn new(policy: SigningPolicy, epoch: u64, participant_keys: BTreeMap<SignerRole, ParticipantPublicKey>) -> Self {
        let required_participants: BTreeSet<SignerRole> = [SignerRole::A, SignerRole::B].into_iter().collect();
        Self {
            required_participants,
            policy,
            epoch,
            nonce_store: NonceStore::new(),
            sessions: BTreeMap::new(),
            completed: BTreeMap::new(),
            participant_keys,
        }
    }

    pub fn start_session(
        &mut self,
        request_id: [u8; 32],
        operation_id: [u8; 32],
        digest: [u8; 32],
        amount: u64,
        fee: u64,
        domains: &DomainBinding,
        nonce: NonceId,
    ) -> Result<SigningRecord, CoordinatorError> {
        if self.required_participants.len() != 2 {
            return Err(CoordinatorError::PolicyRejected);
        }

        policy_bound_domain_ok(&self.policy, domains, self.epoch).map_err(|_| CoordinatorError::DomainMismatch)?;
        validate_amount_fits_limits(&self.policy, amount, fee).map_err(|_| CoordinatorError::PolicyRejected)?;

        self.nonce_store
            .reserve_nonce(nonce, request_id, operation_id, self.epoch)
            .map_err(|_| CoordinatorError::NonceRejected)?;

        let record = SigningRecord {
            request_id,
            operation_id,
            epoch: self.epoch,
            digest,
            nonce,
            amount,
            fee,
        };
        let session = SigningSession {
            record: record.clone(),
            seen: BTreeSet::new(),
            shares: BTreeMap::new(),
        };
        self.sessions.insert(request_id, session);
        Ok(record)
    }

    pub fn consume_signature(&mut self, request_id: [u8; 32], share: SignedShare) -> Result<(), CoordinatorError> {
        let session = self
            .sessions
            .get_mut(&request_id)
            .ok_or(CoordinatorError::UnknownSession)?;
        if session.record.epoch != self.epoch {
            return Err(CoordinatorError::EpochMismatch);
        }
        if !share.signer_role.is_participant() {
            return Err(CoordinatorError::UnknownParticipant);
        }
        if session.seen.contains(&share.signer_role) {
            return Err(CoordinatorError::DuplicateShare);
        }

        let verifying_key = self
            .participant_keys
            .get(&share.signer_role)
            .ok_or(CoordinatorError::UnknownParticipant)?;
        let request = session.request();
        if !share
            .validate(verifying_key, &request)
            .map_err(|_| CoordinatorError::InvalidSignature)?
        {
            return Err(CoordinatorError::InvalidSignature);
        }

        session.seen.insert(share.signer_role);
        let role = share.signer_role;
        session.shares.insert(role, share);

        self.nonce_store
            .record_signature(&session.record.nonce, role)
            .map_err(|store_err| match store_err {
                NonceStoreError::InvalidTransition { .. } => CoordinatorError::InvalidTransition,
                NonceStoreError::CompletedCannotRollback => CoordinatorError::HardStop,
                _ => CoordinatorError::SignatureStateFailure,
            })?;

        if self
            .required_participants
            .iter()
            .all(|role| session.seen.contains(role))
        {
            let aggregate_message = build_message(&request);
            let shares = session.shares.values().cloned().collect::<Vec<_>>();
            self.completed.insert(
                request_id,
                AggregateSignature {
                    request_id,
                    aggregate_message,
                    shares,
                },
            );
        }

        Ok(())
    }

    pub fn finalize(&self, request_id: [u8; 32]) -> Result<&AggregateSignature, CoordinatorError> {
        let session = self
            .sessions
            .get(&request_id)
            .ok_or(CoordinatorError::UnknownSession)?;

        if !self
            .required_participants
            .iter()
            .all(|role| session.seen.contains(role))
        {
            return Err(CoordinatorError::NotReady);
        }

        self.completed
            .get(&request_id)
            .ok_or(CoordinatorError::SignatureUnknown)
    }

    pub fn restart_recovery(&mut self, nonce: &NonceId) -> Result<(), CoordinatorError> {
        self.nonce_store
            .rollback_on_restart(nonce)
            .map_err(|_| CoordinatorError::RecoveryFailed)
    }
}

#[derive(Debug, Error)]
pub enum CoordinatorError {
    #[error("signature not from required participant")]
    UnknownParticipant,
    #[error("session not found")]
    UnknownSession,
    #[error("policy rejected request")]
    PolicyRejected,
    #[error("policy-domain mismatch")]
    DomainMismatch,
    #[error("session nonce rejected")]
    NonceRejected,
    #[error("invalid transition")]
    InvalidTransition,
    #[error("signature invalid")]
    InvalidSignature,
    #[error("epoch mismatch")]
    EpochMismatch,
    #[error("operation not ready")]
    NotReady,
    #[error("signature unknown")]
    SignatureUnknown,
    #[error("recovery failed")]
    RecoveryFailed,
    #[error("this signature is a duplicate role share")]
    DuplicateShare,
    #[error("signature state machine failure")]
    SignatureStateFailure,
    #[error("hard stop")]
    HardStop,
}
