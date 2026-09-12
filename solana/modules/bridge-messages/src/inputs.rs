//! Canonical Borsh hash-preimage schemas, shared with bridge-inputs.mjs.
//! Economic validation stays at callers. These schemas do not define Native
//! consensus transactions or Noble FROST cryptographic transcripts.
use borsh::BorshSerialize;

pub trait CanonicalInput: BorshSerialize {
    const KIND: u16;
    fn encode(&self) -> std::io::Result<Vec<u8>> {
        borsh::to_vec(&(*b"KPINPUT2", Self::KIND, self))
    }
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct InputOutpoint {
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub txid: [u8; 32],
    pub vout: u32,
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct NativeSigningIntent {
    pub protocol: String,
    pub mode: String,
    pub purpose: String,
    pub native_network: String,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub native_genesis_hash: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub solana_deployment: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub bridge_program_id: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub transceiver_program_id: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub mint: [u8; 32],
    pub key_epoch: u32,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub signing_request_id: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub operation_id: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub withdrawal_id: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub proof_fingerprint: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub unsigned_native_transaction_id: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub transaction_commitment: [u8; 32],
    pub signing_input_index: u32,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub taproot_sighash_hex: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::bytes"))]
    pub recipient_script_pub_key_hex: Vec<u8>,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::u64_decimal"))]
    pub amount_atomic: u64,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::u64_decimal"))]
    pub fee_atomic: u64,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::bytes"))]
    pub change_script_pub_key_hex: Vec<u8>,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::u64_decimal"))]
    pub change_atomic: u64,
    pub input_outpoints: Vec<InputOutpoint>,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::list"))]
    pub output_commitments: Vec<[u8; 32]>,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub reserve_commitment: [u8; 32],
    pub pause_withdrawals: bool,
    pub hard_stop: bool,
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct FrostSession {
    pub protocol: String,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub request_id: [u8; 32],
    pub epoch: u32,
    pub attempt: u32,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub intent_digest: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub message_hex: [u8; 32],
    pub participant_ids: [String; 2],
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct FrostKeyContext {
    pub protocol: String,
    pub environment: String,
    pub native_network: String,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub native_genesis_hash: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub solana_deployment: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub bridge_program_id: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub transceiver_program_id: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub mint: [u8; 32],
    pub key_epoch: u32,
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct FrostParticipantSetParticipantsItem {
    pub signer_id: String,
    pub index: u32,
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct FrostParticipantSet {
    pub protocol: String,
    pub participants: [FrostParticipantSetParticipantsItem; 2],
    pub threshold: u16,
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct FrostDkgSession {
    pub protocol: String,
    pub epoch: u32,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub context_digest: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub participant_set_hash: [u8; 32],
    pub threshold: u16,
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct FrostDkgHandoffRequest {
    pub protocol: String,
    pub epoch: u32,
    pub context: FrostKeyContext,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub context_digest: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub session_id: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub participant_set_hash: [u8; 32],
    pub threshold: u16,
    pub participants: [FrostParticipantSetParticipantsItem; 2],
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct FrostDkgHandoffRound1Item {
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub identifier: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::fixed_list"))]
    pub commitments_hex: [[u8; 33]; 2],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub proof_of_knowledge_hex: [u8; 64],
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct FrostDkgHandoffIncomingItemRound2 {
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub identifier: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub signing_share_hex: [u8; 32],
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct FrostDkgHandoffIncomingItem {
    pub sender_id: String,
    pub round2: FrostDkgHandoffIncomingItemRound2,
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct FrostDkgHandoff {
    pub protocol: String,
    pub request: FrostDkgHandoffRequest,
    pub signer_id: String,
    pub round1: [FrostDkgHandoffRound1Item; 2],
    pub incoming: [FrostDkgHandoffIncomingItem; 1],
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct FrostNonceReservationCommitment {
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub identifier: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub hiding_hex: [u8; 33],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub binding_hex: [u8; 33],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub intent_digest: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub message_hex: [u8; 32],
    pub participant_ids: [String; 2],
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct FrostNonceReservation {
    pub domain: String,
    pub signer_id: String,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::u64_decimal"))]
    pub reservation_counter: u64,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub request_id: [u8; 32],
    pub epoch: u32,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub session_id: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub intent_digest: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub message_hex: [u8; 32],
    pub participant_ids: [String; 2],
    pub commitment: FrostNonceReservationCommitment,
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct FrostCommitment {
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub identifier: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub hiding_hex: [u8; 33],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub binding_hex: [u8; 33],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub intent_digest: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub message_hex: [u8; 32],
    pub participant_ids: [String; 2],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub nonce_reservation_id: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::u64_decimal"))]
    pub reservation_counter: u64,
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(transparent))]
pub struct FrostCommitmentSet(pub [FrostCommitment; 2]);

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct FrostShare {
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub share_hex: [u8; 32],
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct FrostPublicPackageSigners {
    pub min: u16,
    pub max: u16,
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct FrostPublicPackageVerifyingSharesHexItem {
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub identifier: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub share_hex: [u8; 33],
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct FrostPublicPackage {
    pub signers: FrostPublicPackageSigners,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::fixed_list"))]
    pub commitments_hex: [[u8; 33]; 2],
    pub verifying_shares_hex: [FrostPublicPackageVerifyingSharesHexItem; 2],
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct CoordinatorKey {
    pub protocol: String,
    pub public_package: FrostPublicPackage,
    #[cfg_attr(
        test,
        serde(
            rename = "aggregateTweakedXOnlyPublicKey",
            deserialize_with = "fixture_hex::array"
        )
    )]
    pub aggregate_tweaked_xonly_public_key: [u8; 32],
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct DepositPolicy {
    pub environment: String,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub native_genesis: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub solana_deployment: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub solana_genesis: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::u64_decimal"))]
    pub minimum_solana_slot: u64,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub manager_program_id: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub transceiver_program_id: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub mint: [u8; 32],
    pub protocol_id: u32,
    pub native_network: u32,
    pub policy_epoch: u32,
    pub key_epoch: u32,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub frost_public_key_hex: [u8; 32],
    pub csv_delay_blocks: u32,
    pub minimum_confirmations: u32,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::u64_decimal"))]
    pub maximum_amount_atomic: u64,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::u64_decimal"))]
    pub maximum_fee_atomic: u64,
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct ReserveAllocation {
    pub protocol: String,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub policy_digest: [u8; 32],
    pub deposit: InputOutpoint,
    pub sweep: InputOutpoint,
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct ReserveCreditEvidence {
    pub protocol: String,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub policy_digest: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub allocation_id: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub proof_digest: [u8; 32],
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct ReserveCreditNonce {
    pub protocol: String,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub allocation_id: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub deposit_nonce: [u8; 32],
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct TransactionCommitment {
    pub protocol: String,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub txid_hex: [u8; 32],
    pub input_outpoints: Vec<InputOutpoint>,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::list"))]
    pub output_commitments: Vec<[u8; 32]>,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub sha_prevouts: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub sha_amounts: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub sha_script_pub_keys: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub sha_sequences: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub sha_outputs: [u8; 32],
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct IndexedOutput {
    pub index: u32,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::u64_decimal"))]
    pub amount_atomic: u64,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::bytes"))]
    pub script_pub_key_hex: Vec<u8>,
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct SweepRequest {
    pub protocol: String,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub operation_id_hex: [u8; 32],
    pub deposit_outpoint: InputOutpoint,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub unsigned_native_transaction_fingerprint_hex: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub taproot_sighash_hex: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub transaction_commitment: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub proof_fingerprint_hex: [u8; 32],
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct WithdrawalProof {
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub withdrawal: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub native: [u8; 32],
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct WithdrawalSigningRequest {
    pub purpose: String,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub operation_id: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub txid: [u8; 32],
    pub input: u32,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub sighash: [u8; 32],
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct FinalizedWithdrawal {
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub signature: [u8; 64],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub message: [u8; 514],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub record: [u8; 283],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::u64_decimal"))]
    pub slot: u64,
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct WithdrawalObservation {
    pub protocol: String,
    pub cluster: String,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub solana_deployment_hex: [u8; 32],
    pub transaction_signature: String,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::u64_decimal"))]
    pub slot: u64,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::u64_decimal"))]
    pub root_slot: u64,
    pub commitment: String,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub operation_id_hex: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub withdrawal_id_hex: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub message_digest_hex: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::u64_decimal"))]
    pub gross_amount_atomic: u64,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::u64_decimal"))]
    pub fee_atomic: u64,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::bytes"))]
    pub native_destination_hex: Vec<u8>,
    pub trust: String,
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct DepositReserveEvidenceDeposit {
    pub trust: String,
    pub native_network: u32,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub native_genesis_hash: [u8; 32],
    pub deposit_outpoint: InputOutpoint,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::u64_decimal"))]
    pub amount_atomic: u64,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub solana_recipient_hex: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub proof_fingerprint: [u8; 32],
    pub finality_satisfied: bool,
    pub utxo_unspent_at_deposit: bool,
    pub no_prior_consumption: bool,
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct DepositReserveEvidenceReserveSweep {
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub reserve_allocation_id_hex: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub native_sweep_txid_hex: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::bytes"))]
    pub canonical_reserve_script_pub_key_hex: Vec<u8>,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub transaction_commitment: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub taproot_sighash_hex: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::list"))]
    pub output_commitments: Vec<[u8; 32]>,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::u64_decimal"))]
    pub change_atomic: u64,
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct DepositReserveEvidence {
    pub protocol: String,
    pub deposit: DepositReserveEvidenceDeposit,
    pub reserve_sweep: DepositReserveEvidenceReserveSweep,
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct LocalClaimNonce {
    pub protocol: String,
    pub deposit_outpoint: InputOutpoint,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub reserve_allocation_id_hex: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub solana_recipient_hex: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub mint_hex: [u8; 32],
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct LocalSweepSummary {
    pub protocol: String,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub unsigned_native_transaction_fingerprint_hex: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub native_sweep_txid_hex: [u8; 32],
    pub input_outpoints: Vec<InputOutpoint>,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::u64_decimal"))]
    pub reserve_amount_atomic: u64,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::bytes"))]
    pub canonical_reserve_script_pub_key_hex: Vec<u8>,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::u64_decimal"))]
    pub native_miner_fee_atomic: u64,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub all_sighash_digest_hex: [u8; 32],
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct LocalReserveOutput {
    pub protocol: String,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub native_sweep_txid_hex: [u8; 32],
    pub vout: u32,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::u64_decimal"))]
    pub amount_atomic: u64,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::bytes"))]
    pub script_pub_key_hex: Vec<u8>,
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct TaprootEvidenceSetEvidencesItem {
    pub signing_input_index: u32,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub taproot_sighash_hex: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub unsigned_native_transaction_fingerprint_hex: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub native_sweep_txid_hex: [u8; 32],
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct TaprootEvidenceSet {
    pub protocol: String,
    pub evidences: Vec<TaprootEvidenceSetEvidencesItem>,
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct LocalReserveAllocation {
    pub protocol: String,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub solana_deployment_hex: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub mint_hex: [u8; 32],
    pub deposit_outpoint: InputOutpoint,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub unsigned_native_transaction_fingerprint_hex: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub native_sweep_txid_hex: [u8; 32],
    pub input_outpoints: Vec<InputOutpoint>,
    pub reserve_output_vout: u32,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::u64_decimal"))]
    pub reserve_amount_atomic: u64,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::bytes"))]
    pub canonical_reserve_script_pub_key_hex: Vec<u8>,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub solana_recipient_hex: [u8; 32],
}

#[derive(BorshSerialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(test, serde(rename_all = "camelCase", deny_unknown_fields))]
pub struct SweepJobIdentity {
    pub protocol: String,
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub policy_digest: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub signing_request_id: [u8; 32],
    #[cfg_attr(test, serde(deserialize_with = "fixture_hex::array"))]
    pub intent_digest: [u8; 32],
}

macro_rules! input_kind {
    ($($name:ident => $kind:expr),* $(,)?) => {$(
        impl CanonicalInput for $name { const KIND: u16 = $kind; }
    )*};
}
input_kind! {
    NativeSigningIntent => 1,
    FrostSession => 2,
    FrostKeyContext => 3,
    FrostParticipantSet => 4,
    FrostDkgSession => 5,
    FrostDkgHandoff => 6,
    FrostNonceReservation => 7,
    FrostCommitment => 8,
    FrostCommitmentSet => 9,
    FrostShare => 10,
    FrostPublicPackage => 11,
    CoordinatorKey => 12,
    DepositPolicy => 13,
    ReserveAllocation => 14,
    ReserveCreditEvidence => 15,
    ReserveCreditNonce => 16,
    TransactionCommitment => 17,
    IndexedOutput => 18,
    SweepRequest => 19,
    WithdrawalProof => 20,
    WithdrawalSigningRequest => 21,
    FinalizedWithdrawal => 22,
    WithdrawalObservation => 23,
    DepositReserveEvidence => 24,
    LocalClaimNonce => 25,
    LocalSweepSummary => 26,
    LocalReserveOutput => 27,
    TaprootEvidenceSet => 28,
    LocalReserveAllocation => 29,
    SweepJobIdentity => 30,
}

#[cfg(test)]
mod fixture_hex {
    use serde::{de::Error, Deserialize, Deserializer};
    fn parse<E: Error>(text: &str) -> Result<Vec<u8>, E> {
        if text.len() % 2 != 0
            || !text
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(E::custom("invalid fixture hex"));
        }
        (0..text.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&text[i..i + 2], 16).map_err(E::custom))
            .collect()
    }
    pub fn bytes<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
        parse(&String::deserialize(d)?)
    }
    pub fn array<'de, D: Deserializer<'de>, const N: usize>(d: D) -> Result<[u8; N], D::Error> {
        bytes(d)?
            .try_into()
            .map_err(|_| D::Error::custom("fixture byte length"))
    }
    pub fn list<'de, D: Deserializer<'de>, const N: usize>(d: D) -> Result<Vec<[u8; N]>, D::Error> {
        Vec::<String>::deserialize(d)?
            .iter()
            .map(|v| {
                parse::<D::Error>(v)?
                    .try_into()
                    .map_err(|_| D::Error::custom("fixture element length"))
            })
            .collect()
    }
    pub fn fixed_list<'de, D: Deserializer<'de>, const N: usize, const M: usize>(
        d: D,
    ) -> Result<[[u8; N]; M], D::Error> {
        list(d)?
            .try_into()
            .map_err(|_| D::Error::custom("fixture list length"))
    }
    pub fn u64_decimal<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
        String::deserialize(d)?.parse().map_err(D::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    fn check<T: CanonicalInput + serde::de::DeserializeOwned>(vector: &serde_json::Value) {
        let value: T = serde_json::from_value(vector["input"].clone()).unwrap();
        let bytes = value.encode().unwrap();
        let hex = |bytes: &[u8]| bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
        assert_eq!(
            hex(&bytes),
            vector["encodedHex"].as_str().unwrap(),
            "{}",
            vector["name"]
        );
        assert_eq!(
            hex(&Sha256::digest(&bytes)),
            vector["sha256"].as_str().unwrap(),
            "{}",
            vector["name"]
        );
    }
    #[test]
    fn all_bridge_input_objects_match_typescript_borsh_bytes_and_hashes() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../vectors/inputs-borsh-v2.json")).unwrap();
        for vector in fixture["vectors"].as_array().unwrap() {
            match vector["type"].as_str().unwrap() {
                "NativeSigningIntent" => check::<NativeSigningIntent>(vector),
                "FrostSession" => check::<FrostSession>(vector),
                "FrostKeyContext" => check::<FrostKeyContext>(vector),
                "FrostParticipantSet" => check::<FrostParticipantSet>(vector),
                "FrostDkgSession" => check::<FrostDkgSession>(vector),
                "FrostDkgHandoff" => check::<FrostDkgHandoff>(vector),
                "FrostNonceReservation" => check::<FrostNonceReservation>(vector),
                "FrostCommitment" => check::<FrostCommitment>(vector),
                "FrostCommitmentSet" => check::<FrostCommitmentSet>(vector),
                "FrostShare" => check::<FrostShare>(vector),
                "FrostPublicPackage" => check::<FrostPublicPackage>(vector),
                "CoordinatorKey" => check::<CoordinatorKey>(vector),
                "DepositPolicy" => check::<DepositPolicy>(vector),
                "ReserveAllocation" => check::<ReserveAllocation>(vector),
                "ReserveCreditEvidence" => check::<ReserveCreditEvidence>(vector),
                "ReserveCreditNonce" => check::<ReserveCreditNonce>(vector),
                "TransactionCommitment" => check::<TransactionCommitment>(vector),
                "IndexedOutput" => check::<IndexedOutput>(vector),
                "SweepRequest" => check::<SweepRequest>(vector),
                "WithdrawalProof" => check::<WithdrawalProof>(vector),
                "WithdrawalSigningRequest" => check::<WithdrawalSigningRequest>(vector),
                "FinalizedWithdrawal" => check::<FinalizedWithdrawal>(vector),
                "WithdrawalObservation" => check::<WithdrawalObservation>(vector),
                "DepositReserveEvidence" => check::<DepositReserveEvidence>(vector),
                "LocalClaimNonce" => check::<LocalClaimNonce>(vector),
                "LocalSweepSummary" => check::<LocalSweepSummary>(vector),
                "LocalReserveOutput" => check::<LocalReserveOutput>(vector),
                "TaprootEvidenceSet" => check::<TaprootEvidenceSet>(vector),
                "LocalReserveAllocation" => check::<LocalReserveAllocation>(vector),
                "SweepJobIdentity" => check::<SweepJobIdentity>(vector),
                other => panic!("unknown bridge input vector: {other}"),
            }
        }
    }
}
