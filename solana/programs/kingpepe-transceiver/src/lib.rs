//! KingPepe transceiver boundary model.
//!
//! Phase 05 implements the receipt, replay, and domain-validation logic that
//! the bridge manager consumes. Phase 07 adds attestation service integration
//! and Solana Ed25519 instruction parsing. No caller-provided `proofVerified`
//! style shortcut exists in this boundary.

#![allow(unexpected_cfgs)]

use std::collections::{BTreeMap, BTreeSet};

use bridge_messages::{
    BridgeAction, BridgeDirection, CanonicalBridgeMessage, Hash32, PubkeyBytes, MESSAGE_LENGTH,
};
use solana_program::{
    account_info::AccountInfo, declare_id, entrypoint::ProgramResult, program_error::ProgramError,
    pubkey::Pubkey,
};
use thiserror::Error;

declare_id!("AkqLGFTy43D9cLjHRTQGpRGb2uWA8nuVyGb2bJYHKCrN");

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

pub const PROGRAM_NAME: &str = "kingpepe_transceiver";
pub const LOCALNET_PROGRAM_ID_BASE58: &str = "AkqLGFTy43D9cLjHRTQGpRGb2uWA8nuVyGb2bJYHKCrN";
pub const PROGRAM_ABI_STATUS: &str = "ECONOMIC_ABI_VALIDATE_ONLY";
pub const TRANSCEIVER_INSTRUCTION_INITIALIZE: u8 = 1;
pub const TRANSCEIVER_INSTRUCTION_VERIFY_MESSAGE_FROM_ED25519: u8 = 2;
pub const TRANSCEIVER_CONFIG_INSTRUCTION_LENGTH: usize = 197;
pub const ED25519_PROGRAM_ID: PubkeyBytes = [
    0x03, 0x7d, 0x46, 0xd6, 0x7c, 0x93, 0xfb, 0xbe, 0x12, 0xf9, 0x42, 0x8f, 0x83, 0x8d, 0x40, 0xff,
    0x05, 0x70, 0x74, 0x49, 0x27, 0xf4, 0x8a, 0x64, 0xfc, 0xca, 0x70, 0x44, 0x80, 0x00, 0x00, 0x00,
];
pub const ED25519_SIGNATURE_LENGTH: usize = 64;
pub const ED25519_PUBLIC_KEY_LENGTH: usize = 32;
pub const ED25519_INSTRUCTION_HEADER_LENGTH: usize = 16;

pub fn process_instruction(
    _program_id: &Pubkey,
    _accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    process_instruction_boundary(instruction_data).map_err(|_| ProgramError::InvalidInstructionData)
}

pub fn process_instruction_boundary(instruction_data: &[u8]) -> Result<(), EntrypointError> {
    let _instruction = decode_transceiver_instruction(instruction_data)?;
    Err(EntrypointError::InstructionExecutionDisabled)
}

pub fn decode_transceiver_instruction(
    instruction_data: &[u8],
) -> Result<TransceiverInstruction, EntrypointError> {
    let Some(tag) = instruction_data.first().copied() else {
        return Err(EntrypointError::EmptyInstruction);
    };
    match tag {
        TRANSCEIVER_INSTRUCTION_INITIALIZE => {
            let expected = 1 + TRANSCEIVER_CONFIG_INSTRUCTION_LENGTH;
            if instruction_data.len() != expected {
                return Err(EntrypointError::InvalidInstructionLength {
                    expected,
                    found: instruction_data.len(),
                });
            }
            Ok(TransceiverInstruction::Initialize(
                decode_transceiver_config(&instruction_data[1..])?,
            ))
        }
        TRANSCEIVER_INSTRUCTION_VERIFY_MESSAGE_FROM_ED25519 => {
            let expected = 1 + MESSAGE_LENGTH + 4;
            if instruction_data.len() != expected {
                return Err(EntrypointError::InvalidInstructionLength {
                    expected,
                    found: instruction_data.len(),
                });
            }
            let message_end = 1 + MESSAGE_LENGTH;
            let message = CanonicalBridgeMessage::decode(&instruction_data[1..message_end])
                .map_err(|_| EntrypointError::InvalidCanonicalMessage)?;
            let mut cursor = InstructionCursor::new(&instruction_data[message_end..]);
            let first = cursor.read_u16_le()?;
            let second = cursor.read_u16_le()?;
            cursor.finish()?;
            if first == second {
                return Err(EntrypointError::InvalidInstructionEncoding);
            }
            Ok(TransceiverInstruction::VerifyMessageFromEd25519 {
                message,
                ed25519_instruction_indexes: [first, second],
            })
        }
        other => Err(EntrypointError::UnsupportedInstructionTag(other)),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransceiverInstruction {
    Initialize(TransceiverConfig),
    VerifyMessageFromEd25519 {
        message: CanonicalBridgeMessage,
        ed25519_instruction_indexes: [u16; 2],
    },
}

impl TransceiverInstruction {
    pub fn encode(&self) -> Result<Vec<u8>, EntrypointError> {
        let mut out = Vec::new();
        match self {
            TransceiverInstruction::Initialize(config) => {
                out.push(TRANSCEIVER_INSTRUCTION_INITIALIZE);
                encode_transceiver_config(config, &mut out);
            }
            TransceiverInstruction::VerifyMessageFromEd25519 {
                message,
                ed25519_instruction_indexes,
            } => {
                out.push(TRANSCEIVER_INSTRUCTION_VERIFY_MESSAGE_FROM_ED25519);
                out.extend(
                    message
                        .encode()
                        .map_err(|_| EntrypointError::InvalidCanonicalMessage)?,
                );
                out.extend(ed25519_instruction_indexes[0].to_le_bytes());
                out.extend(ed25519_instruction_indexes[1].to_le_bytes());
            }
        }
        Ok(out)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransceiverConfig {
    pub transceiver_program_id: PubkeyBytes,
    pub manager_program_id: PubkeyBytes,
    pub mint: PubkeyBytes,
    pub solana_deployment: Hash32,
    pub authorized_attesters: [PubkeyBytes; 2],
    pub active: bool,
    pub key_epoch: u32,
}

impl TransceiverConfig {
    pub fn validate(&self) -> Result<(), TransceiverError> {
        if self.transceiver_program_id == [0u8; 32]
            || self.manager_program_id == [0u8; 32]
            || self.mint == [0u8; 32]
            || self.solana_deployment == [0u8; 32]
        {
            return Err(TransceiverError::InvalidConfig);
        }
        if self.key_epoch == 0 {
            return Err(TransceiverError::InvalidConfig);
        }
        if self.authorized_attesters[0] == self.authorized_attesters[1]
            || self
                .authorized_attesters
                .iter()
                .any(|key| *key == [0u8; 32])
        {
            return Err(TransceiverError::InvalidAttesterSet);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttestationObservation {
    pub attester: PubkeyBytes,
    pub message_digest: Hash32,
    pub key_epoch: u32,
    pub instruction_index: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SolanaInstructionView {
    pub program_id: PubkeyBytes,
    pub instruction_index: u16,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedMessageReceipt {
    pub message_digest: Hash32,
    pub operation_id: Hash32,
    pub transceiver_program_id: PubkeyBytes,
    pub manager_program_id: PubkeyBytes,
    pub mint: PubkeyBytes,
    pub direction: BridgeDirection,
    pub action: BridgeAction,
    pub key_epoch: u32,
    pub attesters: [PubkeyBytes; 2],
    pub consumed: bool,
}

#[derive(Debug, Clone)]
pub struct TransceiverProgram {
    config: TransceiverConfig,
    receipts: BTreeMap<Hash32, VerifiedMessageReceipt>,
}

impl TransceiverProgram {
    pub fn initialize(config: TransceiverConfig) -> Result<Self, TransceiverError> {
        config.validate()?;
        Ok(Self {
            config,
            receipts: BTreeMap::new(),
        })
    }

    pub fn config(&self) -> &TransceiverConfig {
        &self.config
    }

    pub fn verified_messages(&self) -> usize {
        self.receipts.len()
    }

    pub fn receipt(&self, digest: &Hash32) -> Option<&VerifiedMessageReceipt> {
        self.receipts.get(digest)
    }

    pub fn verify_message(
        &mut self,
        message: &CanonicalBridgeMessage,
        observations: &[AttestationObservation],
    ) -> Result<Hash32, TransceiverError> {
        if !self.config.active {
            return Err(TransceiverError::Inactive);
        }
        message
            .validate()
            .map_err(|_| TransceiverError::InvalidMessage)?;
        if message.deployment.transceiver_program_id != self.config.transceiver_program_id
            || message.deployment.manager_program_id != self.config.manager_program_id
            || message.deployment.mint != self.config.mint
            || message.deployment.solana_deployment != self.config.solana_deployment
            || message.key_epoch != self.config.key_epoch
        {
            return Err(TransceiverError::DomainMismatch);
        }

        let digest = message
            .message_digest()
            .map_err(|_| TransceiverError::InvalidMessage)?;
        let attesters = self.validate_observations(digest, observations)?;
        if let Some(existing) = self.receipts.get(&digest) {
            if existing.operation_id != message.operation_id || existing.attesters != attesters {
                return Err(TransceiverError::ReceiptConflict);
            }
            return Ok(digest);
        }

        self.receipts.insert(
            digest,
            VerifiedMessageReceipt {
                message_digest: digest,
                operation_id: message.operation_id,
                transceiver_program_id: self.config.transceiver_program_id,
                manager_program_id: self.config.manager_program_id,
                mint: self.config.mint,
                direction: message.direction,
                action: message.action,
                key_epoch: message.key_epoch,
                attesters,
                consumed: false,
            },
        );
        Ok(digest)
    }

    pub fn verify_message_from_ed25519_instructions(
        &mut self,
        message: &CanonicalBridgeMessage,
        instructions: &[SolanaInstructionView],
    ) -> Result<Hash32, TransceiverError> {
        let encoded = message
            .encode()
            .map_err(|_| TransceiverError::InvalidMessage)?;
        let digest = message
            .message_digest()
            .map_err(|_| TransceiverError::InvalidMessage)?;
        let observations = instructions
            .iter()
            .map(|instruction| {
                parse_ed25519_instruction(instruction, &encoded, digest, message.key_epoch)
            })
            .collect::<Result<Vec<_>, _>>()?;
        self.verify_message(message, &observations)
    }

    pub fn consume_receipt(
        &mut self,
        digest: &Hash32,
    ) -> Result<VerifiedMessageReceipt, TransceiverError> {
        let receipt = self
            .receipts
            .get_mut(digest)
            .ok_or(TransceiverError::UnknownReceipt)?;
        if receipt.consumed {
            return Err(TransceiverError::ReceiptAlreadyConsumed);
        }
        receipt.consumed = true;
        Ok(receipt.clone())
    }

    fn validate_observations(
        &self,
        digest: Hash32,
        observations: &[AttestationObservation],
    ) -> Result<[PubkeyBytes; 2], TransceiverError> {
        if observations.len() != 2 {
            return Err(TransceiverError::ThresholdNotMet);
        }
        let authorized: BTreeSet<PubkeyBytes> =
            self.config.authorized_attesters.iter().copied().collect();
        let mut seen = BTreeSet::new();
        let mut sorted = Vec::new();
        for observation in observations {
            if observation.message_digest != digest
                || observation.key_epoch != self.config.key_epoch
            {
                return Err(TransceiverError::AttestationDomainMismatch);
            }
            if !authorized.contains(&observation.attester) {
                return Err(TransceiverError::UnauthorizedAttester);
            }
            if !seen.insert(observation.attester) {
                return Err(TransceiverError::DuplicateAttester);
            }
            sorted.push(observation.attester);
        }
        sorted.sort();
        Ok([sorted[0], sorted[1]])
    }
}

fn encode_transceiver_config(config: &TransceiverConfig, out: &mut Vec<u8>) {
    out.extend(config.transceiver_program_id);
    out.extend(config.manager_program_id);
    out.extend(config.mint);
    out.extend(config.solana_deployment);
    out.extend(config.authorized_attesters[0]);
    out.extend(config.authorized_attesters[1]);
    out.push(config.active as u8);
    out.extend(config.key_epoch.to_le_bytes());
}

fn decode_transceiver_config(data: &[u8]) -> Result<TransceiverConfig, EntrypointError> {
    let mut cursor = InstructionCursor::new(data);
    let transceiver_program_id = cursor.read_array::<32>()?;
    let manager_program_id = cursor.read_array::<32>()?;
    let mint = cursor.read_array::<32>()?;
    let solana_deployment = cursor.read_array::<32>()?;
    let first_attester = cursor.read_array::<32>()?;
    let second_attester = cursor.read_array::<32>()?;
    let active = cursor.read_bool()?;
    let key_epoch = cursor.read_u32_le()?;
    cursor.finish()?;
    Ok(TransceiverConfig {
        transceiver_program_id,
        manager_program_id,
        mint,
        solana_deployment,
        authorized_attesters: [first_attester, second_attester],
        active,
        key_epoch,
    })
}

fn parse_ed25519_instruction(
    instruction: &SolanaInstructionView,
    expected_message: &[u8],
    expected_digest: Hash32,
    key_epoch: u32,
) -> Result<AttestationObservation, TransceiverError> {
    if instruction.program_id != ED25519_PROGRAM_ID {
        return Err(TransceiverError::InvalidEd25519Program);
    }
    let data = &instruction.data;
    if data.len() < ED25519_INSTRUCTION_HEADER_LENGTH
        || data[0] != 1
        || data[1] != 0
        || expected_message.len() != MESSAGE_LENGTH
    {
        return Err(TransceiverError::InvalidEd25519Instruction);
    }

    let signature_offset = read_u16_le(data, 2)? as usize;
    let signature_instruction_index = read_u16_le(data, 4)?;
    let public_key_offset = read_u16_le(data, 6)? as usize;
    let public_key_instruction_index = read_u16_le(data, 8)?;
    let message_data_offset = read_u16_le(data, 10)? as usize;
    let message_data_size = read_u16_le(data, 12)? as usize;
    let message_instruction_index = read_u16_le(data, 14)?;

    if signature_instruction_index != instruction.instruction_index
        || public_key_instruction_index != instruction.instruction_index
        || message_instruction_index != instruction.instruction_index
    {
        return Err(TransceiverError::InvalidEd25519InstructionOffsets);
    }
    if message_data_size != expected_message.len() {
        return Err(TransceiverError::Ed25519MessageMismatch);
    }

    let signature_end = signature_offset
        .checked_add(ED25519_SIGNATURE_LENGTH)
        .ok_or(TransceiverError::InvalidEd25519InstructionOffsets)?;
    let public_key_end = public_key_offset
        .checked_add(ED25519_PUBLIC_KEY_LENGTH)
        .ok_or(TransceiverError::InvalidEd25519InstructionOffsets)?;
    let message_end = message_data_offset
        .checked_add(message_data_size)
        .ok_or(TransceiverError::InvalidEd25519InstructionOffsets)?;

    if signature_end > data.len() || public_key_end > data.len() || message_end > data.len() {
        return Err(TransceiverError::InvalidEd25519InstructionOffsets);
    }
    if ranges_overlap(
        signature_offset,
        signature_end,
        public_key_offset,
        public_key_end,
    ) || ranges_overlap(
        signature_offset,
        signature_end,
        message_data_offset,
        message_end,
    ) || ranges_overlap(
        public_key_offset,
        public_key_end,
        message_data_offset,
        message_end,
    ) {
        return Err(TransceiverError::InvalidEd25519InstructionOffsets);
    }
    if message_end != data.len() {
        return Err(TransceiverError::InvalidEd25519Instruction);
    }
    if &data[message_data_offset..message_end] != expected_message {
        return Err(TransceiverError::Ed25519MessageMismatch);
    }

    let attester = data[public_key_offset..public_key_end]
        .try_into()
        .expect("public key length checked");
    Ok(AttestationObservation {
        attester,
        message_digest: expected_digest,
        key_epoch,
        instruction_index: instruction.instruction_index,
    })
}

fn read_u16_le(data: &[u8], offset: usize) -> Result<u16, TransceiverError> {
    let bytes = data
        .get(offset..offset + 2)
        .ok_or(TransceiverError::InvalidEd25519InstructionOffsets)?;
    Ok(u16::from_le_bytes(
        bytes.try_into().expect("slice length checked"),
    ))
}

fn ranges_overlap(a_start: usize, a_end: usize, b_start: usize, b_end: usize) -> bool {
    a_start < b_end && b_start < a_end
}

struct InstructionCursor<'a> {
    data: &'a [u8],
    offset: usize,
}

impl<'a> InstructionCursor<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, offset: 0 }
    }

    fn read_array<const N: usize>(&mut self) -> Result<[u8; N], EntrypointError> {
        let end = self
            .offset
            .checked_add(N)
            .ok_or(EntrypointError::InvalidInstructionEncoding)?;
        let bytes = self
            .data
            .get(self.offset..end)
            .ok_or(EntrypointError::InvalidInstructionEncoding)?;
        self.offset = end;
        Ok(bytes.try_into().expect("slice length checked"))
    }

    fn read_u8(&mut self) -> Result<u8, EntrypointError> {
        Ok(self.read_array::<1>()?[0])
    }

    fn read_bool(&mut self) -> Result<bool, EntrypointError> {
        match self.read_u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(EntrypointError::InvalidInstructionEncoding),
        }
    }

    fn read_u16_le(&mut self) -> Result<u16, EntrypointError> {
        Ok(u16::from_le_bytes(self.read_array::<2>()?))
    }

    fn read_u32_le(&mut self) -> Result<u32, EntrypointError> {
        Ok(u32::from_le_bytes(self.read_array::<4>()?))
    }

    fn finish(&self) -> Result<(), EntrypointError> {
        if self.offset == self.data.len() {
            Ok(())
        } else {
            Err(EntrypointError::InvalidInstructionLength {
                expected: self.offset,
                found: self.data.len(),
            })
        }
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum EntrypointError {
    #[error("Solana instruction data is empty")]
    EmptyInstruction,
    #[error("Solana economic instruction execution is not enabled yet")]
    InstructionExecutionDisabled,
    #[error("Solana instruction length mismatch, expected {expected}, found {found}")]
    InvalidInstructionLength { expected: usize, found: usize },
    #[error("Solana instruction encoding is invalid")]
    InvalidInstructionEncoding,
    #[error("canonical bridge message in Solana instruction is invalid")]
    InvalidCanonicalMessage,
    #[error("unsupported Solana instruction tag {0}")]
    UnsupportedInstructionTag(u8),
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum TransceiverError {
    #[error("transceiver configuration is invalid")]
    InvalidConfig,
    #[error("attester set is invalid")]
    InvalidAttesterSet,
    #[error("transceiver is inactive")]
    Inactive,
    #[error("canonical message is invalid")]
    InvalidMessage,
    #[error("message domain does not match configured transceiver")]
    DomainMismatch,
    #[error("attestation observation domain mismatch")]
    AttestationDomainMismatch,
    #[error("attestation threshold not met")]
    ThresholdNotMet,
    #[error("duplicate attester")]
    DuplicateAttester,
    #[error("unauthorized attester")]
    UnauthorizedAttester,
    #[error("instruction is not the Solana Ed25519 verifier")]
    InvalidEd25519Program,
    #[error("Ed25519 verifier instruction layout is invalid")]
    InvalidEd25519Instruction,
    #[error("Ed25519 verifier instruction offsets are invalid")]
    InvalidEd25519InstructionOffsets,
    #[error("Ed25519 verifier message does not match canonical bridge message")]
    Ed25519MessageMismatch,
    #[error("receipt conflict")]
    ReceiptConflict,
    #[error("receipt is unknown")]
    UnknownReceipt,
    #[error("receipt already consumed")]
    ReceiptAlreadyConsumed,
}

#[cfg(test)]
mod tests {
    use super::*;
    use bridge_messages::{
        DeploymentIdentity, DepositClaimFields, MessageEpochs, NativeOutpoint, ValidityWindow,
    };

    fn h(byte: u8) -> [u8; 32] {
        [byte; 32]
    }

    fn config() -> TransceiverConfig {
        TransceiverConfig {
            transceiver_program_id: h(1),
            manager_program_id: h(2),
            mint: h(3),
            solana_deployment: h(4),
            authorized_attesters: [h(5), h(6)],
            active: true,
            key_epoch: 9,
        }
    }

    fn message(config: &TransceiverConfig) -> CanonicalBridgeMessage {
        CanonicalBridgeMessage::new_deposit_claim(DepositClaimFields {
            deployment: DeploymentIdentity {
                protocol_id: 1,
                native_network: 2,
                native_genesis: h(7),
                solana_deployment: config.solana_deployment,
                manager_program_id: config.manager_program_id,
                transceiver_program_id: config.transceiver_program_id,
                mint: config.mint,
            },
            deposit_outpoint: NativeOutpoint {
                txid: h(8),
                vout: 1,
            },
            amount_atomic: 1_000,
            solana_recipient: h(9),
            epochs: MessageEpochs {
                policy_epoch: 1,
                key_epoch: config.key_epoch,
            },
            nonce: h(10),
            validity: ValidityWindow {
                valid_from: 1,
                valid_until: 2,
            },
            evidence_digest: h(11),
        })
        .unwrap()
    }

    fn observations(config: &TransceiverConfig, digest: Hash32) -> Vec<AttestationObservation> {
        config
            .authorized_attesters
            .iter()
            .enumerate()
            .map(|(index, attester)| AttestationObservation {
                attester: *attester,
                message_digest: digest,
                key_epoch: config.key_epoch,
                instruction_index: index as u16,
            })
            .collect()
    }

    fn ed25519_instruction(
        attester: PubkeyBytes,
        message: &CanonicalBridgeMessage,
        instruction_index: u16,
    ) -> SolanaInstructionView {
        let encoded = message.encode().unwrap();
        let signature_offset = ED25519_INSTRUCTION_HEADER_LENGTH as u16;
        let public_key_offset = signature_offset + ED25519_SIGNATURE_LENGTH as u16;
        let message_offset = public_key_offset + ED25519_PUBLIC_KEY_LENGTH as u16;
        let mut data = Vec::with_capacity(message_offset as usize + encoded.len());
        data.push(1);
        data.push(0);
        data.extend(signature_offset.to_le_bytes());
        data.extend(instruction_index.to_le_bytes());
        data.extend(public_key_offset.to_le_bytes());
        data.extend(instruction_index.to_le_bytes());
        data.extend(message_offset.to_le_bytes());
        data.extend((encoded.len() as u16).to_le_bytes());
        data.extend(instruction_index.to_le_bytes());
        data.extend([instruction_index as u8; ED25519_SIGNATURE_LENGTH]);
        data.extend(attester);
        data.extend(encoded);
        SolanaInstructionView {
            program_id: ED25519_PROGRAM_ID,
            instruction_index,
            data,
        }
    }

    #[test]
    fn transceiver_default_has_no_verifications() {
        let program = TransceiverProgram::initialize(config()).unwrap();
        assert_eq!(program.verified_messages(), 0);
    }

    #[test]
    fn solana_entrypoint_identity_is_localnet_only_and_validate_only() {
        assert_eq!(id().to_string(), LOCALNET_PROGRAM_ID_BASE58);
        assert_eq!(PROGRAM_ABI_STATUS, "ECONOMIC_ABI_VALIDATE_ONLY");
        assert_eq!(
            process_instruction_boundary(&[]),
            Err(EntrypointError::EmptyInstruction)
        );
        assert_eq!(
            process_instruction_boundary(&[0]),
            Err(EntrypointError::UnsupportedInstructionTag(0))
        );
        assert_eq!(
            process_instruction_boundary(&[255]),
            Err(EntrypointError::UnsupportedInstructionTag(255))
        );
    }

    #[test]
    fn transceiver_instruction_abi_round_trips_and_rejects_duplicate_indexes() {
        let config = config();
        let initialize = TransceiverInstruction::Initialize(config.clone());
        let initialize_bytes = initialize.encode().unwrap();
        assert_eq!(
            initialize_bytes.len(),
            1 + TRANSCEIVER_CONFIG_INSTRUCTION_LENGTH
        );
        assert_eq!(
            decode_transceiver_instruction(&initialize_bytes).unwrap(),
            initialize
        );

        let message = message(&config);
        let verify = TransceiverInstruction::VerifyMessageFromEd25519 {
            message: message.clone(),
            ed25519_instruction_indexes: [0, 1],
        };
        let verify_bytes = verify.encode().unwrap();
        assert_eq!(decode_transceiver_instruction(&verify_bytes).unwrap(), verify);
        assert_eq!(
            process_instruction_boundary(&verify_bytes),
            Err(EntrypointError::InstructionExecutionDisabled)
        );

        let duplicate = TransceiverInstruction::VerifyMessageFromEd25519 {
            message,
            ed25519_instruction_indexes: [2, 2],
        }
        .encode()
        .unwrap();
        assert_eq!(
            decode_transceiver_instruction(&duplicate),
            Err(EntrypointError::InvalidInstructionEncoding)
        );

        let mut trailing = verify_bytes;
        trailing.push(0);
        assert_eq!(
            decode_transceiver_instruction(&trailing),
            Err(EntrypointError::InvalidInstructionLength {
                expected: 1 + MESSAGE_LENGTH + 4,
                found: 2 + MESSAGE_LENGTH + 4,
            })
        );
    }

    #[test]
    fn transceiver_requires_two_distinct_authorized_attesters() {
        let config = config();
        let msg = message(&config);
        let digest = msg.message_digest().unwrap();
        let mut program = TransceiverProgram::initialize(config.clone()).unwrap();
        assert_eq!(
            program.verify_message(&msg, &observations(&config, digest)[0..1]),
            Err(TransceiverError::ThresholdNotMet)
        );
        let duplicate = vec![
            AttestationObservation {
                attester: config.authorized_attesters[0],
                message_digest: digest,
                key_epoch: config.key_epoch,
                instruction_index: 0,
            },
            AttestationObservation {
                attester: config.authorized_attesters[0],
                message_digest: digest,
                key_epoch: config.key_epoch,
                instruction_index: 1,
            },
        ];
        assert_eq!(
            program.verify_message(&msg, &duplicate),
            Err(TransceiverError::DuplicateAttester)
        );
    }

    #[test]
    fn transceiver_records_and_consumes_receipts_once() {
        let config = config();
        let msg = message(&config);
        let digest = msg.message_digest().unwrap();
        let mut program = TransceiverProgram::initialize(config.clone()).unwrap();
        let recorded = program
            .verify_message(&msg, &observations(&config, digest))
            .unwrap();
        assert_eq!(recorded, digest);
        assert_eq!(program.verified_messages(), 1);
        let consumed = program.consume_receipt(&digest).unwrap();
        assert!(consumed.consumed);
        assert_eq!(
            program.consume_receipt(&digest),
            Err(TransceiverError::ReceiptAlreadyConsumed)
        );
    }

    #[test]
    fn transceiver_accepts_exact_ed25519_instruction_attestations() {
        let config = config();
        let msg = message(&config);
        let mut program = TransceiverProgram::initialize(config.clone()).unwrap();
        let digest = program
            .verify_message_from_ed25519_instructions(
                &msg,
                &[
                    ed25519_instruction(config.authorized_attesters[0], &msg, 0),
                    ed25519_instruction(config.authorized_attesters[1], &msg, 1),
                ],
            )
            .unwrap();
        let receipt = program.receipt(&digest).unwrap();
        assert_eq!(receipt.operation_id, msg.operation_id);
        assert_eq!(receipt.attesters[0], config.authorized_attesters[0]);
        assert_eq!(receipt.attesters[1], config.authorized_attesters[1]);
    }

    #[test]
    fn transceiver_rejects_ed25519_message_or_offset_substitution() {
        let config = config();
        let msg = message(&config);
        let mut wrong_message = ed25519_instruction(config.authorized_attesters[0], &msg, 0);
        let last = wrong_message.data.len() - 1;
        wrong_message.data[last] ^= 1;
        assert_eq!(
            parse_ed25519_instruction(
                &wrong_message,
                &msg.encode().unwrap(),
                msg.message_digest().unwrap(),
                msg.key_epoch,
            ),
            Err(TransceiverError::Ed25519MessageMismatch)
        );

        let mut wrong_index = ed25519_instruction(config.authorized_attesters[0], &msg, 0);
        wrong_index.data[4..6].copy_from_slice(&1u16.to_le_bytes());
        assert_eq!(
            parse_ed25519_instruction(
                &wrong_index,
                &msg.encode().unwrap(),
                msg.message_digest().unwrap(),
                msg.key_epoch,
            ),
            Err(TransceiverError::InvalidEd25519InstructionOffsets)
        );
    }

    #[test]
    fn transceiver_rejects_wrong_ed25519_program_and_duplicate_attesters() {
        let config = config();
        let msg = message(&config);
        let mut wrong_program = ed25519_instruction(config.authorized_attesters[0], &msg, 0);
        wrong_program.program_id = h(99);
        assert_eq!(
            parse_ed25519_instruction(
                &wrong_program,
                &msg.encode().unwrap(),
                msg.message_digest().unwrap(),
                msg.key_epoch,
            ),
            Err(TransceiverError::InvalidEd25519Program)
        );

        let mut program = TransceiverProgram::initialize(config.clone()).unwrap();
        assert_eq!(
            program.verify_message_from_ed25519_instructions(
                &msg,
                &[
                    ed25519_instruction(config.authorized_attesters[0], &msg, 0),
                    ed25519_instruction(config.authorized_attesters[0], &msg, 1),
                ],
            ),
            Err(TransceiverError::DuplicateAttester)
        );
    }

    #[test]
    fn transceiver_rejects_wrong_domain_message() {
        let config = config();
        let mut wrong_config = config.clone();
        wrong_config.mint = h(99);
        let msg = message(&wrong_config);
        let digest = msg.message_digest().unwrap();
        let mut program = TransceiverProgram::initialize(config.clone()).unwrap();
        assert_eq!(
            program.verify_message(&msg, &observations(&config, digest)),
            Err(TransceiverError::DomainMismatch)
        );
    }
}
