//! KingPepe Native proof and node-observation validation primitives.
//!
//! This crate implements Phase 06 source-side validation boundaries:
//! headers, compact PoW targets, difficulty, chainwork, Merkle inclusion,
//! bounded transaction parsing, UTXO-state observations, and deposit evidence.
//! It does not broadcast transactions, manage wallets, or authorize Mainnet.

pub mod bytes;
pub mod chain;
pub mod deposit;
pub mod difficulty;
pub mod evidence;
pub mod header;
pub mod merkle;
pub mod node;
pub mod transaction;

use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum NativeProofError {
    #[error("{0} must be hexadecimal text")]
    InvalidHex(String),
    #[error("{0} has an invalid byte length")]
    InvalidLength(String),
    #[error("buffer underflow while parsing {0}")]
    BufferUnderflow(String),
    #[error("non-canonical compact size")]
    NonCanonicalCompactSize,
    #[error("resource limit exceeded for {0}")]
    ResourceLimit(String),
    #[error("invalid compact target")]
    InvalidCompactTarget,
    #[error("proof of work is invalid")]
    InvalidProofOfWork,
    #[error("header does not link to the current tip")]
    HeaderParentMismatch,
    #[error("header difficulty does not match expected work")]
    BadDifficulty,
    #[error("outdated block version for activation height")]
    OutdatedBlockVersion,
    #[error("Native header time violates median-time-past or future-time bounds")]
    InvalidHeaderTime,
    #[error("raw Native evidence is malformed or does not bind the requested transaction")]
    InvalidEvidence,
    #[error("validated header tip does not match the observed Native source snapshot")]
    EvidenceTipMismatch,
    #[error("chainwork overflow")]
    ChainworkOverflow,
    #[error("wrong Native network or genesis")]
    WrongNetworkOrGenesis,
    #[error("Native source is unavailable, stale, or internally inconsistent")]
    NativeSourceUnavailable,
    #[error("Merkle proof is invalid")]
    InvalidMerkleProof,
    #[error("transaction output does not match the expected outpoint")]
    OutputMismatch,
    #[error("UTXO observation does not prove the output remains unspent")]
    UtxoNotUnspent,
    #[error("Native finality policy is not satisfied")]
    FinalityNotSatisfied,
    #[error("transaction does not contain the required deposit commitment")]
    MissingDepositCommitment,
    #[error("trailing bytes after transaction")]
    TrailingTransactionData,
    #[error("unsupported witness serialization")]
    UnsupportedWitness,
}
