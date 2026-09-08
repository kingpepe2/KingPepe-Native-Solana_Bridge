//! Native signing runtime primitives for same-host dual participant signing.
//!
//! This crate intentionally implements a staged and testable subset:
//!  - deterministic identity and epoch binding
//!  - nonce/session ownership and replay guards
//!  - per-signer request policy checks
//!  - coordinated dual-signature collection (one signature per participant)
//!  - explicit failure modes and restart-safe bookkeeping hooks
//!
//! Phase 02 does not implement final Native-compatible FROST. The final
//! threshold signer is a Phase 04 requirement and must not be replaced by this
//! deterministic test-share model.

mod coordinator;
mod policy;
mod recovery;
mod signer;
mod state;

pub use coordinator::{AggregateSignature, CoordinatorError, SigningCoordinator, SigningRecord};
pub use policy::{DomainBinding, SigningPolicy, SigningPolicyError};
pub use recovery::{RecoveryInstruction, RecoveryError, RecoveryRecord};
pub use signer::{ParticipantPublicKey, SignedShare, Signer, SignerRole, SignerState, SigningRequest};
pub use state::{NonceId, NonceState, NonceStore};
