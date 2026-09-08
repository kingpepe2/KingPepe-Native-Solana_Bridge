use num_bigint::BigUint;

use crate::chain::{NativeChainParams, NativeNetwork};
use crate::transaction::OutPoint;
use crate::NativeProofError;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ObservationTrust {
    RpcObservation,
    LocallyValidatedChainState,
    ProjectAttestation,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeSourceSnapshot {
    pub trust: ObservationTrust,
    pub network: NativeNetwork,
    pub genesis_hash: [u8; 32],
    pub best_hash: [u8; 32],
    pub best_height: u32,
    pub chainwork: BigUint,
    pub in_initial_block_download: bool,
    pub stale: bool,
    pub internally_consistent: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UtxoObservation {
    pub outpoint: OutPoint,
    pub value_atomic: u64,
    pub script_pubkey: Vec<u8>,
    pub best_block_hash: [u8; 32],
    pub confirmations: u32,
    pub coinbase: bool,
    pub unspent: bool,
}

pub struct UtxoMatchInput<'a> {
    pub observation: &'a UtxoObservation,
    pub outpoint: OutPoint,
    pub value_atomic: u64,
    pub script_pubkey: &'a [u8],
    pub minimum_confirmations: u32,
}

pub fn assert_source_usable(
    params: NativeChainParams,
    snapshot: &NativeSourceSnapshot,
    minimum_height: u32,
) -> Result<(), NativeProofError> {
    if snapshot.network != params.network || snapshot.genesis_hash != params.genesis_hash() {
        return Err(NativeProofError::WrongNetworkOrGenesis);
    }
    if snapshot.in_initial_block_download
        || snapshot.stale
        || !snapshot.internally_consistent
        || snapshot.best_height < minimum_height
    {
        return Err(NativeProofError::NativeSourceUnavailable);
    }
    Ok(())
}

pub fn assert_utxo_matches(input: UtxoMatchInput<'_>) -> Result<(), NativeProofError> {
    let observation = input.observation;
    if !observation.unspent {
        return Err(NativeProofError::UtxoNotUnspent);
    }
    if observation.outpoint != input.outpoint
        || observation.value_atomic != input.value_atomic
        || observation.script_pubkey != input.script_pubkey
    {
        return Err(NativeProofError::OutputMismatch);
    }
    if observation.confirmations < input.minimum_confirmations {
        return Err(NativeProofError::FinalityNotSatisfied);
    }
    Ok(())
}
