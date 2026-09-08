//! Offline-safe user recovery eligibility checks for temporary Native deposits.
//!
//! This crate does not sign or broadcast a recovery transaction. It only
//! validates that the public evidence is compatible with preparing an unsigned
//! recovery transaction in a later CLI phase.

use kingpepe_native_proof::chain::{NativeChainParams, NativeNetwork};
use kingpepe_native_proof::deposit::ValidatedTemporaryDeposit;
use kingpepe_native_proof::transaction::OutPoint;
use thiserror::Error;

pub const MAX_RECOVERY_DELAY_BLOCKS: u32 = 0xffff;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RecoveryStatus {
    UnsignedUnbroadcastNotAuthorized,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecoveryEligibility {
    pub network: NativeNetwork,
    pub native_genesis_hash: [u8; 32],
    pub outpoint: OutPoint,
    pub amount_atomic: u64,
    pub script_pubkey: Vec<u8>,
    pub observed_native_tip_height: u32,
    pub native_outpoint_unspent: bool,
    pub kpepe_minted_for_deposit: bool,
    pub canonical_reserve_sweep_confirmed: bool,
    pub recovery_spend_observed: bool,
}

pub struct RecoveryPlanInput<'a> {
    pub params: NativeChainParams,
    pub deposit: &'a ValidatedTemporaryDeposit,
    pub eligibility: &'a RecoveryEligibility,
    pub recovery_delay_blocks: u32,
    pub destination_script_pubkey: &'a [u8],
    pub native_network_fee_atomic: u64,
    pub maximum_native_network_fee_atomic: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecoveryPlan {
    pub status: RecoveryStatus,
    pub signing_authorized: bool,
    pub broadcast_authorized: bool,
    pub outpoint: OutPoint,
    pub recovery_sequence: u32,
    pub maturity_tip_height: u32,
    pub destination_script_pubkey: Vec<u8>,
    pub recovery_amount_atomic: u64,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum RecoveryError {
    #[error("wrong Native network or genesis")]
    WrongNetworkOrGenesis,
    #[error("recovery delay is not a positive block-based BIP68/CSV uint16")]
    InvalidRecoveryDelay,
    #[error("temporary deposit recovery is not mature")]
    RecoveryNotMature,
    #[error("temporary deposit outpoint is not unspent")]
    OutpointNotUnspent,
    #[error("recovery is forbidden after mint or canonical reserve sweep")]
    RecoveryConflictsWithBridgeSettlement,
    #[error("recovery spend has already been observed")]
    DuplicateRecovery,
    #[error("eligibility evidence does not match the temporary deposit")]
    EligibilityMismatch,
    #[error("recovery fee exceeds the authorized maximum")]
    FeeExceedsMaximum,
    #[error("recovery output would be dust or non-positive")]
    DustOrNonPositiveRecoveryOutput,
}

pub fn validate_recovery_plan(input: RecoveryPlanInput<'_>) -> Result<RecoveryPlan, RecoveryError> {
    if input.params.network != input.deposit.network
        || input.params.genesis_hash() != input.deposit.native_genesis_hash
        || input.eligibility.network != input.deposit.network
        || input.eligibility.native_genesis_hash != input.deposit.native_genesis_hash
    {
        return Err(RecoveryError::WrongNetworkOrGenesis);
    }
    if input.recovery_delay_blocks == 0 || input.recovery_delay_blocks > MAX_RECOVERY_DELAY_BLOCKS {
        return Err(RecoveryError::InvalidRecoveryDelay);
    }
    if input.eligibility.outpoint != input.deposit.outpoint
        || input.eligibility.amount_atomic != input.deposit.amount_atomic
        || input.eligibility.script_pubkey != input.deposit.script_pubkey
    {
        return Err(RecoveryError::EligibilityMismatch);
    }
    if !input.eligibility.native_outpoint_unspent {
        return Err(RecoveryError::OutpointNotUnspent);
    }
    if input.eligibility.kpepe_minted_for_deposit || input.eligibility.canonical_reserve_sweep_confirmed {
        return Err(RecoveryError::RecoveryConflictsWithBridgeSettlement);
    }
    if input.eligibility.recovery_spend_observed {
        return Err(RecoveryError::DuplicateRecovery);
    }
    let maturity_tip_height = input
        .deposit
        .block_height
        .checked_add(input.recovery_delay_blocks)
        .and_then(|height| height.checked_sub(1))
        .ok_or(RecoveryError::InvalidRecoveryDelay)?;
    if input.eligibility.observed_native_tip_height < maturity_tip_height {
        return Err(RecoveryError::RecoveryNotMature);
    }
    if input.native_network_fee_atomic > input.maximum_native_network_fee_atomic {
        return Err(RecoveryError::FeeExceedsMaximum);
    }
    let recovery_amount = input
        .deposit
        .amount_atomic
        .checked_sub(input.native_network_fee_atomic)
        .ok_or(RecoveryError::DustOrNonPositiveRecoveryOutput)?;
    if recovery_amount <= input.params.p2tr_dust_threshold_atomic_units {
        return Err(RecoveryError::DustOrNonPositiveRecoveryOutput);
    }
    Ok(RecoveryPlan {
        status: RecoveryStatus::UnsignedUnbroadcastNotAuthorized,
        signing_authorized: false,
        broadcast_authorized: false,
        outpoint: input.deposit.outpoint,
        recovery_sequence: input.recovery_delay_blocks,
        maturity_tip_height,
        destination_script_pubkey: input.destination_script_pubkey.to_vec(),
        recovery_amount_atomic: recovery_amount,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use kingpepe_native_proof::deposit::ValidatedTemporaryDeposit;

    #[test]
    fn recovery_plan_is_unsigned_and_requires_exact_maturity() {
        let params = NativeChainParams::regtest();
        let deposit = deposit(params);
        let eligibility = eligibility(params, &deposit, 111);
        let plan = validate_recovery_plan(RecoveryPlanInput {
            params,
            deposit: &deposit,
            eligibility: &eligibility,
            recovery_delay_blocks: 12,
            destination_script_pubkey: &[0x51, 0x20, 9],
            native_network_fee_atomic: 700,
            maximum_native_network_fee_atomic: 1_000,
        })
        .unwrap();
        assert_eq!(plan.status, RecoveryStatus::UnsignedUnbroadcastNotAuthorized);
        assert!(!plan.signing_authorized);
        assert!(!plan.broadcast_authorized);
        assert_eq!(plan.maturity_tip_height, 111);
        assert_eq!(plan.recovery_amount_atomic, 4_300);
    }

    #[test]
    fn recovery_blocks_pre_maturity_spent_outputs_and_settlement_conflicts() {
        let params = NativeChainParams::regtest();
        let deposit = deposit(params);
        let build = |eligibility: RecoveryEligibility| {
            validate_recovery_plan(RecoveryPlanInput {
                params,
                deposit: &deposit,
                eligibility: &eligibility,
                recovery_delay_blocks: 12,
                destination_script_pubkey: &[0x51, 0x20, 9],
                native_network_fee_atomic: 700,
                maximum_native_network_fee_atomic: 1_000,
            })
        };
        assert_eq!(
            build(eligibility(params, &deposit, 110)).unwrap_err(),
            RecoveryError::RecoveryNotMature
        );
        assert_eq!(
            build(RecoveryEligibility {
                native_outpoint_unspent: false,
                ..eligibility(params, &deposit, 111)
            })
            .unwrap_err(),
            RecoveryError::OutpointNotUnspent
        );
        assert_eq!(
            build(RecoveryEligibility {
                canonical_reserve_sweep_confirmed: true,
                ..eligibility(params, &deposit, 111)
            })
            .unwrap_err(),
            RecoveryError::RecoveryConflictsWithBridgeSettlement
        );
        assert_eq!(
            build(RecoveryEligibility {
                kpepe_minted_for_deposit: true,
                ..eligibility(params, &deposit, 111)
            })
            .unwrap_err(),
            RecoveryError::RecoveryConflictsWithBridgeSettlement
        );
        assert_eq!(
            build(RecoveryEligibility {
                recovery_spend_observed: true,
                ..eligibility(params, &deposit, 111)
            })
            .unwrap_err(),
            RecoveryError::DuplicateRecovery
        );
    }

    #[test]
    fn recovery_rejects_wrong_network_amount_script_and_fee_bounds() {
        let params = NativeChainParams::regtest();
        let deposit = deposit(params);
        let base = eligibility(params, &deposit, 111);
        assert_eq!(
            validate_recovery_plan(RecoveryPlanInput {
                params,
                deposit: &deposit,
                eligibility: &RecoveryEligibility {
                    native_genesis_hash: NativeChainParams::mainnet().genesis_hash(),
                    ..base.clone()
                },
                recovery_delay_blocks: 12,
                destination_script_pubkey: &[0x51, 0x20, 9],
                native_network_fee_atomic: 700,
                maximum_native_network_fee_atomic: 1_000,
            })
            .unwrap_err(),
            RecoveryError::WrongNetworkOrGenesis
        );
        assert_eq!(
            validate_recovery_plan(RecoveryPlanInput {
                params,
                deposit: &deposit,
                eligibility: &RecoveryEligibility {
                    amount_atomic: deposit.amount_atomic - 1,
                    ..base.clone()
                },
                recovery_delay_blocks: 12,
                destination_script_pubkey: &[0x51, 0x20, 9],
                native_network_fee_atomic: 700,
                maximum_native_network_fee_atomic: 1_000,
            })
            .unwrap_err(),
            RecoveryError::EligibilityMismatch
        );
        assert_eq!(
            validate_recovery_plan(RecoveryPlanInput {
                params,
                deposit: &deposit,
                eligibility: &base,
                recovery_delay_blocks: 12,
                destination_script_pubkey: &[0x51, 0x20, 9],
                native_network_fee_atomic: 1_001,
                maximum_native_network_fee_atomic: 1_000,
            })
            .unwrap_err(),
            RecoveryError::FeeExceedsMaximum
        );
    }

    fn deposit(params: NativeChainParams) -> ValidatedTemporaryDeposit {
        ValidatedTemporaryDeposit {
            network: params.network,
            native_genesis_hash: params.genesis_hash(),
            outpoint: OutPoint { txid: [1; 32], vout: 0 },
            amount_atomic: 5_000,
            script_pubkey: vec![0x51, 0x20, 7],
            recipient_commitment_script: Some(vec![0x6a, 0x14, 9]),
            block_hash: [2; 32],
            block_height: 100,
            evidence_digest: [3; 32],
        }
    }

    fn eligibility(
        params: NativeChainParams,
        deposit: &ValidatedTemporaryDeposit,
        observed_tip_height: u32,
    ) -> RecoveryEligibility {
        RecoveryEligibility {
            network: params.network,
            native_genesis_hash: params.genesis_hash(),
            outpoint: deposit.outpoint,
            amount_atomic: deposit.amount_atomic,
            script_pubkey: deposit.script_pubkey.clone(),
            observed_native_tip_height: observed_tip_height,
            native_outpoint_unspent: true,
            kpepe_minted_for_deposit: false,
            canonical_reserve_sweep_confirmed: false,
            recovery_spend_observed: false,
        }
    }
}
