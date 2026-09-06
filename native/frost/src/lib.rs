//! Native FROST runtime primitives for same-host dual participant signing.
//!
//! This crate intentionally implements a staged and testable subset:
//!  - deterministic identity and epoch binding
//!  - nonce/session ownership and replay guards
//!  - per-signer request policy checks
//!  - coordinated dual-signature collection (one signature per participant)
//!  - explicit failure modes and restart-safe bookkeeping hooks

mod coordinator;
mod policy;
mod recovery;
mod signer;
mod state;

pub use coordinator::{AggregateSignature, CoordinatorError, SigningCoordinator, SigningRecord};
pub use policy::{DomainBinding, SigningPolicy, SigningPolicyError};
pub use recovery::{RecoveryInstruction, RecoveryError, RecoveryRecord};
pub use signer::{SigningRequest, Signer, SignerRole, SignerState, SignedShare};
pub use state::{NonceId, NonceState, NonceStore};
