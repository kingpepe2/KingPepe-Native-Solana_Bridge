//! Canonical Native reserve transition primitives for Phase 06.
//!
//! Temporary deposits are recoverable user outputs and do not authorize Solana
//! minting. Mint credit is created only after a validated reserve sweep moves
//! backing into the canonical reserve script.

use std::collections::{BTreeMap, BTreeSet};

use kingpepe_native_proof::bytes::sha256d;
use kingpepe_native_proof::chain::{assert_finality, HeaderMeta};
use kingpepe_native_proof::deposit::ValidatedTemporaryDeposit;
use kingpepe_native_proof::merkle::reconstruct_merkle_root;
use kingpepe_native_proof::transaction::{output_at, spends_outpoint, OutPoint, ParsedTransaction};
use kingpepe_native_proof::NativeProofError;
use thiserror::Error;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReserveTransitionState {
    TemporaryRecoverable,
    CanonicalReserve,
    MintCreditAuthorized,
    MintCreditConsumed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReserveSweepRecord {
    pub allocation_id: [u8; 32],
    pub temporary_outpoint: OutPoint,
    pub sweep_txid: [u8; 32],
    pub reserve_output_index: u32,
    pub reserve_amount_atomic: u64,
    pub native_network_fee_atomic: u64,
    pub block_hash: [u8; 32],
    pub block_height: u32,
}

pub struct ReserveSweepInput<'a> {
    pub temporary_deposit: &'a ValidatedTemporaryDeposit,
    pub sweep_transaction: &'a ParsedTransaction,
    pub reserve_output_index: u32,
    pub expected_reserve_script_pubkey: &'a [u8],
    pub reserve_amount_atomic: u64,
    pub native_network_fee_atomic: u64,
    pub merkle_branch: &'a [[u8; 32]],
    pub merkle_index: u32,
    pub containing_block: &'a HeaderMeta,
    pub observed_tip: &'a HeaderMeta,
    pub minimum_confirmations: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ReserveLedger {
    canonical_reserve_atomic: u128,
    authorized_unminted_credits_atomic: u128,
    spent_native_fees_atomic: u128,
    temporary_deposits: BTreeMap<OutPoint, ValidatedTemporaryDeposit>,
    consumed_temporary_outpoints: BTreeSet<OutPoint>,
    reserve_allocations: BTreeMap<[u8; 32], ReserveSweepRecord>,
    consumed_mint_allocations: BTreeSet<[u8; 32]>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ReserveError {
    #[error("Native proof validation failed")]
    Proof(#[from] NativeProofError),
    #[error("temporary deposit is already recorded")]
    DuplicateTemporaryDeposit,
    #[error("temporary deposit is not recorded")]
    UnknownTemporaryDeposit,
    #[error("temporary deposit is still recoverable and cannot authorize minting")]
    TemporaryDepositCannotMint,
    #[error("reserve sweep does not spend the temporary outpoint")]
    SweepDoesNotSpendTemporaryOutpoint,
    #[error("reserve sweep output does not match the expected reserve allocation")]
    ReserveOutputMismatch,
    #[error("reserve sweep fee and allocation do not exactly consume the temporary deposit")]
    ReserveAmountMismatch,
    #[error("reserve backing allocation was already used")]
    DuplicateReserveAllocation,
    #[error("temporary backing outpoint was already consumed")]
    DuplicateTemporaryOutpointConsumption,
    #[error("mint credit amount is unavailable")]
    MintCreditUnavailable,
    #[error("reserve arithmetic overflow")]
    ReserveOverflow,
}

impl ReserveLedger {
    pub fn record_temporary_deposit(
        &mut self,
        deposit: ValidatedTemporaryDeposit,
    ) -> Result<(), ReserveError> {
        if self.temporary_deposits.contains_key(&deposit.outpoint) {
            return Err(ReserveError::DuplicateTemporaryDeposit);
        }
        self.temporary_deposits.insert(deposit.outpoint, deposit);
        Ok(())
    }

    pub fn authorize_mint_from_temporary(&self, outpoint: OutPoint) -> Result<(), ReserveError> {
        if self.temporary_deposits.contains_key(&outpoint) {
            return Err(ReserveError::TemporaryDepositCannotMint);
        }
        Err(ReserveError::UnknownTemporaryDeposit)
    }

    pub fn validate_reserve_sweep(
        input: ReserveSweepInput<'_>,
    ) -> Result<ReserveSweepRecord, ReserveError> {
        if !spends_outpoint(input.sweep_transaction, input.temporary_deposit.outpoint) {
            return Err(ReserveError::SweepDoesNotSpendTemporaryOutpoint);
        }
        let output = output_at(input.sweep_transaction, input.reserve_output_index)?;
        if output.value_atomic != input.reserve_amount_atomic
            || output.script_pubkey != input.expected_reserve_script_pubkey
        {
            return Err(ReserveError::ReserveOutputMismatch);
        }
        let total = input
            .reserve_amount_atomic
            .checked_add(input.native_network_fee_atomic)
            .ok_or(ReserveError::ReserveOverflow)?;
        if total != input.temporary_deposit.amount_atomic {
            return Err(ReserveError::ReserveAmountMismatch);
        }
        let merkle_root = reconstruct_merkle_root(
            input.sweep_transaction.txid,
            input.merkle_branch,
            input.merkle_index,
        )?;
        if merkle_root != input.containing_block.merkle_root {
            return Err(ReserveError::Proof(NativeProofError::InvalidMerkleProof));
        }
        assert_finality(
            input.containing_block,
            input.observed_tip,
            input.minimum_confirmations,
        )?;
        let allocation_id = reserve_allocation_id(
            input.temporary_deposit.outpoint,
            input.sweep_transaction.txid,
            input.reserve_output_index,
            input.reserve_amount_atomic,
        );
        Ok(ReserveSweepRecord {
            allocation_id,
            temporary_outpoint: input.temporary_deposit.outpoint,
            sweep_txid: input.sweep_transaction.txid,
            reserve_output_index: input.reserve_output_index,
            reserve_amount_atomic: input.reserve_amount_atomic,
            native_network_fee_atomic: input.native_network_fee_atomic,
            block_hash: input.containing_block.hash,
            block_height: input.containing_block.height,
        })
    }

    pub fn settle_reserve_sweep(&mut self, record: ReserveSweepRecord) -> Result<(), ReserveError> {
        if !self
            .temporary_deposits
            .contains_key(&record.temporary_outpoint)
        {
            return Err(ReserveError::UnknownTemporaryDeposit);
        }
        if self
            .consumed_temporary_outpoints
            .contains(&record.temporary_outpoint)
        {
            return Err(ReserveError::DuplicateTemporaryOutpointConsumption);
        }
        if self.reserve_allocations.contains_key(&record.allocation_id) {
            return Err(ReserveError::DuplicateReserveAllocation);
        }
        self.temporary_deposits.remove(&record.temporary_outpoint);
        self.consumed_temporary_outpoints
            .insert(record.temporary_outpoint);
        self.canonical_reserve_atomic = self
            .canonical_reserve_atomic
            .checked_add(record.reserve_amount_atomic as u128)
            .ok_or(ReserveError::ReserveOverflow)?;
        self.authorized_unminted_credits_atomic = self
            .authorized_unminted_credits_atomic
            .checked_add(record.reserve_amount_atomic as u128)
            .ok_or(ReserveError::ReserveOverflow)?;
        self.spent_native_fees_atomic = self
            .spent_native_fees_atomic
            .checked_add(record.native_network_fee_atomic as u128)
            .ok_or(ReserveError::ReserveOverflow)?;
        self.reserve_allocations
            .insert(record.allocation_id, record);
        Ok(())
    }

    pub fn consume_mint_credit(
        &mut self,
        allocation_id: [u8; 32],
        amount_atomic: u64,
    ) -> Result<(), ReserveError> {
        let allocation = self
            .reserve_allocations
            .get(&allocation_id)
            .ok_or(ReserveError::MintCreditUnavailable)?;
        if allocation.reserve_amount_atomic != amount_atomic
            || self.consumed_mint_allocations.contains(&allocation_id)
        {
            return Err(ReserveError::MintCreditUnavailable);
        }
        self.authorized_unminted_credits_atomic = self
            .authorized_unminted_credits_atomic
            .checked_sub(amount_atomic as u128)
            .ok_or(ReserveError::MintCreditUnavailable)?;
        self.consumed_mint_allocations.insert(allocation_id);
        Ok(())
    }

    pub fn canonical_reserve_atomic(&self) -> u128 {
        self.canonical_reserve_atomic
    }

    pub fn authorized_unminted_credits_atomic(&self) -> u128 {
        self.authorized_unminted_credits_atomic
    }

    pub fn spent_native_fees_atomic(&self) -> u128 {
        self.spent_native_fees_atomic
    }
}

pub fn reserve_allocation_id(
    temporary_outpoint: OutPoint,
    sweep_txid: [u8; 32],
    reserve_output_index: u32,
    reserve_amount_atomic: u64,
) -> [u8; 32] {
    let mut input = Vec::with_capacity(108);
    input.extend(temporary_outpoint.txid);
    input.extend(temporary_outpoint.vout.to_le_bytes());
    input.extend(sweep_txid);
    input.extend(reserve_output_index.to_le_bytes());
    input.extend(reserve_amount_atomic.to_le_bytes());
    sha256d(&input)
}

#[cfg(test)]
mod tests {
    use num_bigint::BigUint;

    use super::*;
    use kingpepe_native_proof::chain::{HeaderMeta, NativeChainParams, NativeNetwork};
    use kingpepe_native_proof::deposit::ValidatedTemporaryDeposit;
    use kingpepe_native_proof::merkle::build_merkle_branch;
    use kingpepe_native_proof::transaction::{encode_varint, parse_transaction};

    #[test]
    fn temporary_deposit_cannot_authorize_mint_until_reserve_sweep_settles() {
        let temporary = deposit();
        let mut ledger = ReserveLedger::default();
        ledger.record_temporary_deposit(temporary.clone()).unwrap();
        assert_eq!(
            ledger
                .authorize_mint_from_temporary(temporary.outpoint)
                .unwrap_err(),
            ReserveError::TemporaryDepositCannotMint
        );
        assert_eq!(ledger.authorized_unminted_credits_atomic(), 0);
    }

    #[test]
    fn reserve_sweep_creates_once_only_canonical_allocation_and_mint_credit() {
        let temporary = deposit();
        let sweep = sweep_transaction(temporary.outpoint, 4_900, &[0x51, 0x20, 8]);
        let (root, branch) = build_merkle_branch(&[sweep.txid], 0).unwrap();
        let block = header(20, root, 20);
        let tip = header(25, root, 30);
        let record = ReserveLedger::validate_reserve_sweep(ReserveSweepInput {
            temporary_deposit: &temporary,
            sweep_transaction: &sweep,
            reserve_output_index: 0,
            expected_reserve_script_pubkey: &[0x51, 0x20, 8],
            reserve_amount_atomic: 4_900,
            native_network_fee_atomic: 100,
            merkle_branch: &branch,
            merkle_index: 0,
            containing_block: &block,
            observed_tip: &tip,
            minimum_confirmations: 6,
        })
        .unwrap();
        let mut ledger = ReserveLedger::default();
        ledger.record_temporary_deposit(temporary).unwrap();
        ledger.settle_reserve_sweep(record.clone()).unwrap();
        assert_eq!(ledger.canonical_reserve_atomic(), 4_900);
        assert_eq!(ledger.authorized_unminted_credits_atomic(), 4_900);
        assert_eq!(ledger.spent_native_fees_atomic(), 100);
        assert_eq!(
            ledger.settle_reserve_sweep(record).unwrap_err(),
            ReserveError::UnknownTemporaryDeposit
        );
    }

    #[test]
    fn reserve_sweep_rejects_wrong_input_output_amount_and_merkle_root() {
        let temporary = deposit();
        let wrong_input = sweep_transaction(
            OutPoint {
                txid: [9; 32],
                vout: 0,
            },
            4_900,
            &[0x51, 0x20, 8],
        );
        let root = [7; 32];
        let block = header(20, root, 20);
        let tip = header(25, root, 30);
        assert_eq!(
            ReserveLedger::validate_reserve_sweep(ReserveSweepInput {
                temporary_deposit: &temporary,
                sweep_transaction: &wrong_input,
                reserve_output_index: 0,
                expected_reserve_script_pubkey: &[0x51, 0x20, 8],
                reserve_amount_atomic: 4_900,
                native_network_fee_atomic: 100,
                merkle_branch: &[],
                merkle_index: 0,
                containing_block: &block,
                observed_tip: &tip,
                minimum_confirmations: 6,
            })
            .unwrap_err(),
            ReserveError::SweepDoesNotSpendTemporaryOutpoint
        );

        let sweep = sweep_transaction(temporary.outpoint, 4_899, &[0x51, 0x20, 8]);
        let (actual_root, branch) = build_merkle_branch(&[sweep.txid], 0).unwrap();
        let actual_block = header(20, actual_root, 20);
        assert_eq!(
            ReserveLedger::validate_reserve_sweep(ReserveSweepInput {
                temporary_deposit: &temporary,
                sweep_transaction: &sweep,
                reserve_output_index: 0,
                expected_reserve_script_pubkey: &[0x51, 0x20, 8],
                reserve_amount_atomic: 4_899,
                native_network_fee_atomic: 100,
                merkle_branch: &branch,
                merkle_index: 0,
                containing_block: &actual_block,
                observed_tip: &tip,
                minimum_confirmations: 1,
            })
            .unwrap_err(),
            ReserveError::ReserveAmountMismatch
        );
    }

    fn deposit() -> ValidatedTemporaryDeposit {
        ValidatedTemporaryDeposit {
            network: NativeNetwork::Regtest,
            native_genesis_hash: NativeChainParams::regtest().genesis_hash(),
            outpoint: OutPoint {
                txid: [1; 32],
                vout: 0,
            },
            amount_atomic: 5_000,
            script_pubkey: vec![0x51, 0x20, 7],
            recipient_commitment_script: Some(vec![0x6a, 0x14, 9]),
            block_hash: [2; 32],
            block_height: 10,
            evidence_digest: [3; 32],
        }
    }

    fn sweep_transaction(
        outpoint: OutPoint,
        amount: u64,
        script_pubkey: &[u8],
    ) -> ParsedTransaction {
        let mut raw = Vec::new();
        raw.extend(2_i32.to_le_bytes());
        raw.push(1);
        let mut previous = outpoint.txid;
        previous.reverse();
        raw.extend(previous);
        raw.extend(outpoint.vout.to_le_bytes());
        raw.push(0);
        raw.extend(0xffff_fffe_u32.to_le_bytes());
        raw.push(1);
        raw.extend(amount.to_le_bytes());
        raw.extend(encode_varint(script_pubkey.len() as u64));
        raw.extend(script_pubkey);
        raw.extend(0_u32.to_le_bytes());
        parse_transaction(&raw).unwrap()
    }

    fn header(height: u32, merkle_root: [u8; 32], work: u32) -> HeaderMeta {
        HeaderMeta {
            height,
            hash: [height as u8; 32],
            merkle_root,
            time: height,
            bits: 0x207f_ffff,
            chainwork: BigUint::from(work),
        }
    }
}
