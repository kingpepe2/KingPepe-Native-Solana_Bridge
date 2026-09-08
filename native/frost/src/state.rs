use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::signer::SignerRole;

pub type NonceId = [u8; 32];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NonceState {
    Allocated,
    SignedByA,
    SignedByB,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NonceEntry {
    pub nonce: NonceId,
    pub request_id: [u8; 32],
    pub operation_id: [u8; 32],
    pub epoch: u64,
    pub state: NonceState,
    pub created_at_unix: u64,
}

impl NonceEntry {
    pub fn new(nonce: NonceId, request_id: [u8; 32], operation_id: [u8; 32], epoch: u64) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        Self {
            nonce,
            request_id,
            operation_id,
            epoch,
            state: NonceState::Allocated,
            created_at_unix: now,
        }
    }
}

#[derive(Debug, Clone)]
pub struct NonceStore {
    entries: BTreeMap<NonceId, NonceEntry>,
    used_request_ids: HashSet<[u8; 32]>,
}

impl NonceStore {
    pub fn new() -> Self {
        Self {
            entries: BTreeMap::new(),
            used_request_ids: HashSet::new(),
        }
    }

    pub fn reserve_nonce(
        &mut self,
        nonce: NonceId,
        request_id: [u8; 32],
        operation_id: [u8; 32],
        epoch: u64,
    ) -> Result<NonceEntry, NonceStoreError> {
        if self.entries.contains_key(&nonce) {
            return Err(NonceStoreError::NonceReused);
        }
        if self.used_request_ids.contains(&request_id) {
            return Err(NonceStoreError::ReplayRequest);
        }

        let entry = NonceEntry::new(nonce, request_id, operation_id, epoch);
        self.entries.insert(nonce, entry.clone());
        self.used_request_ids.insert(request_id);
        Ok(entry)
    }

    pub fn record_signature(
        &mut self,
        nonce: &NonceId,
        role: SignerRole,
    ) -> Result<(), NonceStoreError> {
        let entry = self
            .entries
            .get_mut(nonce)
            .ok_or(NonceStoreError::NonceMissing)?;

        let next_state = match (entry.state, role) {
            (NonceState::Allocated, SignerRole::A) => NonceState::SignedByA,
            (NonceState::Allocated, SignerRole::B) => NonceState::SignedByB,
            (NonceState::SignedByA, SignerRole::B) => NonceState::Completed,
            (NonceState::SignedByB, SignerRole::A) => NonceState::Completed,
            (state, _) => {
                return Err(NonceStoreError::InvalidTransition {
                    from: state,
                    to: match role {
                        SignerRole::A => NonceState::SignedByA,
                        SignerRole::B => NonceState::SignedByB,
                    },
                });
            }
        };
        entry.state = next_state;
        Ok(())
    }

    pub fn rollback_on_restart(&mut self, nonce: &NonceId) -> Result<(), NonceStoreError> {
        let entry = self.entries.get_mut(nonce).ok_or(NonceStoreError::NonceMissing)?;
        if matches!(entry.state, NonceState::Completed) {
            return Err(NonceStoreError::CompletedCannotRollback);
        }
        entry.state = NonceState::Failed;
        Ok(())
    }

    pub fn fetch(&self, nonce: &NonceId) -> Option<&NonceEntry> {
        self.entries.get(nonce)
    }
}

impl Default for NonceStore {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum NonceStoreError {
    NonceReused,
    ReplayRequest,
    NonceMissing,
    InvalidTransition { from: NonceState, to: NonceState },
    CompletedCannotRollback,
}
