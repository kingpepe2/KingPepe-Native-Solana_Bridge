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
    account_info::AccountInfo,
    declare_id,
    entrypoint::ProgramResult,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvar::{
        instructions::{
            load_current_index_checked, load_instruction_at_checked, ID as INSTRUCTIONS_SYSVAR_ID,
        },
        rent::Rent,
        Sysvar,
    },
};
use solana_system_interface::{instruction as system_instruction, program as system_program};
use thiserror::Error;

declare_id!("AkqLGFTy43D9cLjHRTQGpRGb2uWA8nuVyGb2bJYHKCrN");

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

pub const PROGRAM_NAME: &str = "kingpepe_transceiver";
pub const LOCALNET_PROGRAM_ID_BASE58: &str = "AkqLGFTy43D9cLjHRTQGpRGb2uWA8nuVyGb2bJYHKCrN";
pub const PROGRAM_ABI_STATUS: &str = "ECONOMIC_ABI_ENABLED";
pub const TRANSCEIVER_INSTRUCTION_INITIALIZE: u8 = 1;
pub const TRANSCEIVER_INSTRUCTION_VERIFY_MESSAGE_FROM_ED25519: u8 = 2;
pub const TRANSCEIVER_CONFIG_INSTRUCTION_LENGTH: usize = 197;
pub const TRANSCEIVER_CONFIG_PDA_SEED_PREFIX: &[u8] = b"kingpepe-transceiver-config";
pub const TRANSCEIVER_RECEIPT_PDA_SEED_PREFIX: &[u8] = b"kingpepe-transceiver-receipt";
pub const TRANSCEIVER_ACCOUNT_VERSION: u8 = 1;
pub const TRANSCEIVER_CONFIG_ACCOUNT_MAGIC: [u8; 8] = *b"KPTCFG01";
pub const TRANSCEIVER_RECEIPT_ACCOUNT_MAGIC: [u8; 8] = *b"KPTRCPT1";
pub const TRANSCEIVER_CONFIG_ACCOUNT_LENGTH: usize = 8 + 1 + TRANSCEIVER_CONFIG_INSTRUCTION_LENGTH;
pub const VERIFIED_RECEIPT_ACCOUNT_LENGTH: usize = 240;
pub const ED25519_PROGRAM_ID: PubkeyBytes = [
    0x03, 0x7d, 0x46, 0xd6, 0x7c, 0x93, 0xfb, 0xbe, 0x12, 0xf9, 0x42, 0x8f, 0x83, 0x8d, 0x40, 0xff,
    0x05, 0x70, 0x74, 0x49, 0x27, 0xf4, 0x8a, 0x64, 0xfc, 0xca, 0x70, 0x44, 0x80, 0x00, 0x00, 0x00,
];
pub const ED25519_SIGNATURE_LENGTH: usize = 64;
pub const ED25519_PUBLIC_KEY_LENGTH: usize = 32;
pub const ED25519_INSTRUCTION_HEADER_LENGTH: usize = 16;

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    process_instruction_accounts(program_id, accounts, instruction_data).map_err(ProgramError::from)
}

pub fn process_instruction_boundary(instruction_data: &[u8]) -> Result<(), EntrypointError> {
    let _instruction = decode_transceiver_instruction(instruction_data)?;
    Ok(())
}

pub fn process_instruction_accounts(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> Result<(), EntrypointError> {
    match decode_transceiver_instruction(instruction_data)? {
        TransceiverInstruction::Initialize(config) => {
            process_initialize_accounts(program_id, accounts, config)
        }
        TransceiverInstruction::VerifyMessageFromEd25519 {
            message,
            ed25519_instruction_indexes,
        } => process_verify_message_accounts(
            program_id,
            accounts,
            *message,
            ed25519_instruction_indexes,
        ),
    }
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
                message: Box::new(message),
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
        message: Box<CanonicalBridgeMessage>,
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
            || self.authorized_attesters.contains(&[0u8; 32])
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransceiverConfigAccount {
    pub config: TransceiverConfig,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedReceiptAccount {
    pub receipt: VerifiedMessageReceipt,
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

    /// Validate views loaded from the real instructions sysvar. A compact verifier
    /// references the canonical bytes in this top-level transceiver instruction;
    /// it never authorizes a caller-selected slice or a digest in place of them.
    pub fn verify_message_from_transaction_instructions(
        &mut self,
        message: &CanonicalBridgeMessage,
        instructions: &[SolanaInstructionView],
        current: &SolanaInstructionView,
    ) -> Result<Hash32, TransceiverError> {
        if instructions.len() != 2 {
            return Err(TransceiverError::ThresholdNotMet);
        }
        let indexes = [
            instructions[0].instruction_index,
            instructions[1].instruction_index,
        ];
        let expected_current = TransceiverInstruction::VerifyMessageFromEd25519 {
            message: Box::new(message.clone()),
            ed25519_instruction_indexes: indexes,
        }
        .encode()
        .map_err(|_| TransceiverError::InvalidMessage)?;
        if current.program_id != self.config.transceiver_program_id
            || current.data != expected_current
            || indexes[0] == indexes[1]
            || indexes
                .iter()
                .any(|index| *index >= current.instruction_index)
        {
            return Err(TransceiverError::InvalidEd25519InstructionOffsets);
        }
        let encoded = message
            .encode()
            .map_err(|_| TransceiverError::InvalidMessage)?;
        let digest = message
            .message_digest()
            .map_err(|_| TransceiverError::InvalidMessage)?;
        let observations = instructions
            .iter()
            .map(|instruction| {
                if instruction.data.len()
                    == ED25519_INSTRUCTION_HEADER_LENGTH
                        + ED25519_SIGNATURE_LENGTH
                        + ED25519_PUBLIC_KEY_LENGTH
                {
                    parse_shared_message_ed25519_instruction(
                        instruction,
                        current.instruction_index,
                        digest,
                        message.key_epoch,
                    )
                } else {
                    parse_ed25519_instruction(instruction, &encoded, digest, message.key_epoch)
                }
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

pub fn derive_transceiver_config_pda(
    transceiver_program_id: &PubkeyBytes,
    mint: &PubkeyBytes,
) -> PubkeyBytes {
    let transceiver_program_id = Pubkey::new_from_array(*transceiver_program_id);
    let mint = Pubkey::new_from_array(*mint);
    Pubkey::find_program_address(
        &[TRANSCEIVER_CONFIG_PDA_SEED_PREFIX, mint.as_ref()],
        &transceiver_program_id,
    )
    .0
    .to_bytes()
}

pub fn derive_verified_receipt_pda(
    transceiver_program_id: &PubkeyBytes,
    message_digest: &Hash32,
) -> PubkeyBytes {
    let transceiver_program_id = Pubkey::new_from_array(*transceiver_program_id);
    Pubkey::find_program_address(
        &[TRANSCEIVER_RECEIPT_PDA_SEED_PREFIX, message_digest],
        &transceiver_program_id,
    )
    .0
    .to_bytes()
}

fn process_initialize_accounts(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    config: TransceiverConfig,
) -> Result<(), EntrypointError> {
    config.validate()?;
    if config.transceiver_program_id != program_id.to_bytes() {
        return Err(EntrypointError::AccountKeyMismatch);
    }

    let mut account_iter = accounts.iter();
    let config_account = next_required_account(&mut account_iter)?;
    let (payer, system_program_account) = optional_payer_and_system(&mut account_iter)?;
    require_writable(config_account)?;
    let config_pda = derive_transceiver_config_pda(&config.transceiver_program_id, &config.mint);
    let mint_pubkey = Pubkey::new_from_array(config.mint);
    let (_config_pda_with_bump, config_bump) = Pubkey::find_program_address(
        &[TRANSCEIVER_CONFIG_PDA_SEED_PREFIX, mint_pubkey.as_ref()],
        program_id,
    );
    ensure_program_pda_account(
        config_account,
        payer,
        system_program_account,
        program_id,
        &config_pda,
        &[
            TRANSCEIVER_CONFIG_PDA_SEED_PREFIX,
            mint_pubkey.as_ref(),
            &[config_bump],
        ],
        TRANSCEIVER_CONFIG_ACCOUNT_LENGTH,
    )?;
    require_zeroed_account(config_account)?;

    write_account_data(config_account, &encode_transceiver_config_account(&config))?;
    Ok(())
}

fn process_verify_message_accounts(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    message: CanonicalBridgeMessage,
    ed25519_instruction_indexes: [u16; 2],
) -> Result<(), EntrypointError> {
    let mut account_iter = accounts.iter();
    let config_account = next_required_account(&mut account_iter)?;
    let receipt_account = next_required_account(&mut account_iter)?;
    let instructions_sysvar = next_required_account(&mut account_iter)?;
    let (payer, system_program_account) = optional_payer_and_system(&mut account_iter)?;

    require_account_owner(config_account, program_id)?;
    require_writable(receipt_account)?;
    require_account_key(instructions_sysvar, &INSTRUCTIONS_SYSVAR_ID.to_bytes())?;

    let config = read_transceiver_config_account(config_account)?.config;
    if config.transceiver_program_id != program_id.to_bytes() {
        return Err(EntrypointError::AccountKeyMismatch);
    }
    require_account_key(
        config_account,
        &derive_transceiver_config_pda(&config.transceiver_program_id, &config.mint),
    )?;

    let digest = message
        .message_digest()
        .map_err(|_| TransceiverError::InvalidMessage)?;
    let receipt_pda = derive_verified_receipt_pda(&config.transceiver_program_id, &digest);
    require_account_key(receipt_account, &receipt_pda)?;
    let digest_pubkey = Pubkey::new_from_array(digest);
    let (_receipt_pda_with_bump, receipt_bump) = Pubkey::find_program_address(
        &[TRANSCEIVER_RECEIPT_PDA_SEED_PREFIX, digest_pubkey.as_ref()],
        program_id,
    );
    ensure_program_pda_account(
        receipt_account,
        payer,
        system_program_account,
        program_id,
        &receipt_pda,
        &[
            TRANSCEIVER_RECEIPT_PDA_SEED_PREFIX,
            digest_pubkey.as_ref(),
            &[receipt_bump],
        ],
        VERIFIED_RECEIPT_ACCOUNT_LENGTH,
    )?;

    let first_instruction =
        load_ed25519_instruction(instructions_sysvar, ed25519_instruction_indexes[0])?;
    let second_instruction =
        load_ed25519_instruction(instructions_sysvar, ed25519_instruction_indexes[1])?;
    let current_index = load_current_index_checked(instructions_sysvar)
        .map_err(|_| EntrypointError::InvalidInstructionsSysvar)?;
    let current_instruction = load_ed25519_instruction(instructions_sysvar, current_index)?;

    let mut transceiver = TransceiverProgram::initialize(config)?;
    if !account_data_is_zero(receipt_account)? {
        let existing = read_verified_receipt_account(receipt_account)?.receipt;
        if existing.consumed {
            return Err(TransceiverError::ReceiptAlreadyConsumed.into());
        }
        transceiver
            .receipts
            .insert(existing.message_digest, existing);
    }

    let verified_digest = transceiver.verify_message_from_transaction_instructions(
        &message,
        &[first_instruction, second_instruction],
        &current_instruction,
    )?;
    let receipt = transceiver
        .receipt(&verified_digest)
        .ok_or(TransceiverError::UnknownReceipt)?
        .clone();
    write_account_data(receipt_account, &encode_verified_receipt_account(&receipt))?;
    Ok(())
}

fn load_ed25519_instruction(
    instructions_sysvar: &AccountInfo,
    instruction_index: u16,
) -> Result<SolanaInstructionView, EntrypointError> {
    let instruction = load_instruction_at_checked(instruction_index as usize, instructions_sysvar)
        .map_err(|_| EntrypointError::InvalidInstructionsSysvar)?;
    Ok(SolanaInstructionView {
        program_id: instruction.program_id.to_bytes(),
        instruction_index,
        data: instruction.data,
    })
}

fn read_transceiver_config_account(
    account: &AccountInfo,
) -> Result<TransceiverConfigAccount, EntrypointError> {
    require_account_len(account, TRANSCEIVER_CONFIG_ACCOUNT_LENGTH)?;
    let data = account
        .try_borrow_data()
        .map_err(|_| EntrypointError::AccountBorrowFailed)?;
    Ok(decode_transceiver_config_account(&data)?)
}

fn read_verified_receipt_account(
    account: &AccountInfo,
) -> Result<VerifiedReceiptAccount, EntrypointError> {
    require_account_len(account, VERIFIED_RECEIPT_ACCOUNT_LENGTH)?;
    let data = account
        .try_borrow_data()
        .map_err(|_| EntrypointError::AccountBorrowFailed)?;
    Ok(decode_verified_receipt_account(&data)?)
}

fn next_required_account<'a, 'b, I>(
    accounts: &mut I,
) -> Result<&'a AccountInfo<'b>, EntrypointError>
where
    'b: 'a,
    I: Iterator<Item = &'a AccountInfo<'b>>,
{
    accounts.next().ok_or(EntrypointError::NotEnoughAccounts)
}

fn require_no_extra_accounts<'a, 'b, I>(accounts: &mut I) -> Result<(), EntrypointError>
where
    'b: 'a,
    I: Iterator<Item = &'a AccountInfo<'b>>,
{
    if accounts.next().is_some() {
        Err(EntrypointError::UnexpectedAdditionalAccounts)
    } else {
        Ok(())
    }
}

fn optional_payer_and_system<'a, 'b, I>(
    accounts: &mut I,
) -> Result<(Option<&'a AccountInfo<'b>>, Option<&'a AccountInfo<'b>>), EntrypointError>
where
    'b: 'a,
    I: Iterator<Item = &'a AccountInfo<'b>>,
{
    let payer = accounts.next();
    let system_program_account = accounts.next();
    if payer.is_some() != system_program_account.is_some() {
        return Err(EntrypointError::NotEnoughAccounts);
    }
    require_no_extra_accounts(accounts)?;
    Ok((payer, system_program_account))
}

fn require_writable(account: &AccountInfo) -> Result<(), EntrypointError> {
    if account.is_writable {
        Ok(())
    } else {
        Err(EntrypointError::AccountNotWritable)
    }
}

fn require_signer(account: &AccountInfo) -> Result<(), EntrypointError> {
    if account.is_signer {
        Ok(())
    } else {
        Err(EntrypointError::MissingRequiredSignature)
    }
}

fn ensure_program_pda_account<'a>(
    account: &AccountInfo<'a>,
    payer: Option<&AccountInfo<'a>>,
    system_program_account: Option<&AccountInfo<'a>>,
    program_id: &Pubkey,
    expected_key: &PubkeyBytes,
    signer_seeds: &[&[u8]],
    expected_len: usize,
) -> Result<(), EntrypointError> {
    require_writable(account)?;
    require_account_key(account, expected_key)?;
    if account.data_len() == expected_len {
        require_account_owner(account, program_id)?;
        return Ok(());
    }
    if account.data_len() != 0 {
        return Err(EntrypointError::InvalidAccountData);
    }
    require_account_owner(account, &system_program::id())?;
    let payer = payer.ok_or(EntrypointError::NotEnoughAccounts)?;
    let system_program_account =
        system_program_account.ok_or(EntrypointError::NotEnoughAccounts)?;
    require_signer(payer)?;
    require_writable(payer)?;
    if system_program_account.key != &system_program::id() {
        return Err(EntrypointError::AccountKeyMismatch);
    }

    let space = u64::try_from(expected_len).map_err(|_| EntrypointError::InvalidAccountData)?;
    let lamports = Rent::get()
        .map_err(|_| EntrypointError::RentUnavailable)?
        .minimum_balance(expected_len);
    let instruction =
        system_instruction::create_account(payer.key, account.key, lamports, space, program_id);
    invoke_signed(
        &instruction,
        &[
            payer.clone(),
            account.clone(),
            system_program_account.clone(),
        ],
        &[signer_seeds],
    )
    .map_err(|_| EntrypointError::SystemCpiFailed)?;
    require_account_owner(account, program_id)?;
    require_account_len(account, expected_len)
}

fn require_account_owner(account: &AccountInfo, expected: &Pubkey) -> Result<(), EntrypointError> {
    if account.owner == expected {
        Ok(())
    } else {
        Err(EntrypointError::AccountOwnerMismatch)
    }
}

fn require_account_key(
    account: &AccountInfo,
    expected: &PubkeyBytes,
) -> Result<(), EntrypointError> {
    if account.key.to_bytes() == *expected {
        Ok(())
    } else {
        Err(EntrypointError::AccountKeyMismatch)
    }
}

fn require_account_len(account: &AccountInfo, expected: usize) -> Result<(), EntrypointError> {
    if account.data_len() == expected {
        Ok(())
    } else {
        Err(EntrypointError::InvalidAccountData)
    }
}

fn require_zeroed_account(account: &AccountInfo) -> Result<(), EntrypointError> {
    if account_data_is_zero(account)? {
        Ok(())
    } else {
        Err(EntrypointError::AccountAlreadyInitialized)
    }
}

fn account_data_is_zero(account: &AccountInfo) -> Result<bool, EntrypointError> {
    let data = account
        .try_borrow_data()
        .map_err(|_| EntrypointError::AccountBorrowFailed)?;
    Ok(data.iter().all(|byte| *byte == 0))
}

fn write_account_data(account: &AccountInfo, encoded: &[u8]) -> Result<(), EntrypointError> {
    require_account_len(account, encoded.len())?;
    let mut data = account
        .try_borrow_mut_data()
        .map_err(|_| EntrypointError::AccountBorrowFailed)?;
    data.copy_from_slice(encoded);
    Ok(())
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

pub fn encode_transceiver_config_account(config: &TransceiverConfig) -> Vec<u8> {
    let mut out = Vec::with_capacity(TRANSCEIVER_CONFIG_ACCOUNT_LENGTH);
    out.extend(TRANSCEIVER_CONFIG_ACCOUNT_MAGIC);
    out.push(TRANSCEIVER_ACCOUNT_VERSION);
    encode_transceiver_config(config, &mut out);
    debug_assert_eq!(out.len(), TRANSCEIVER_CONFIG_ACCOUNT_LENGTH);
    out
}

pub fn decode_transceiver_config_account(
    data: &[u8],
) -> Result<TransceiverConfigAccount, AccountCodecError> {
    if data.len() != TRANSCEIVER_CONFIG_ACCOUNT_LENGTH {
        return Err(AccountCodecError::InvalidAccountLength {
            expected: TRANSCEIVER_CONFIG_ACCOUNT_LENGTH,
            found: data.len(),
        });
    }
    let mut cursor = AccountCursor::new(data);
    if cursor.read_array::<8>()? != TRANSCEIVER_CONFIG_ACCOUNT_MAGIC {
        return Err(AccountCodecError::InvalidMagic);
    }
    if cursor.read_u8()? != TRANSCEIVER_ACCOUNT_VERSION {
        return Err(AccountCodecError::UnsupportedVersion);
    }
    let config = decode_transceiver_config(cursor.remaining())
        .map_err(|_| AccountCodecError::InvalidEncoding)?;
    cursor.advance(TRANSCEIVER_CONFIG_INSTRUCTION_LENGTH)?;
    cursor.finish()?;
    config.validate()?;
    Ok(TransceiverConfigAccount { config })
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

pub fn encode_verified_receipt_account(receipt: &VerifiedMessageReceipt) -> Vec<u8> {
    let mut out = Vec::with_capacity(VERIFIED_RECEIPT_ACCOUNT_LENGTH);
    out.extend(TRANSCEIVER_RECEIPT_ACCOUNT_MAGIC);
    out.push(TRANSCEIVER_ACCOUNT_VERSION);
    out.extend(receipt.message_digest);
    out.extend(receipt.operation_id);
    out.extend(receipt.transceiver_program_id);
    out.extend(receipt.manager_program_id);
    out.extend(receipt.mint);
    out.push(u8::from(receipt.direction));
    out.push(u8::from(receipt.action));
    out.extend(receipt.key_epoch.to_le_bytes());
    out.extend(receipt.attesters[0]);
    out.extend(receipt.attesters[1]);
    out.push(receipt.consumed as u8);
    debug_assert_eq!(out.len(), VERIFIED_RECEIPT_ACCOUNT_LENGTH);
    out
}

pub fn decode_verified_receipt_account(
    data: &[u8],
) -> Result<VerifiedReceiptAccount, AccountCodecError> {
    if data.len() != VERIFIED_RECEIPT_ACCOUNT_LENGTH {
        return Err(AccountCodecError::InvalidAccountLength {
            expected: VERIFIED_RECEIPT_ACCOUNT_LENGTH,
            found: data.len(),
        });
    }
    let mut cursor = AccountCursor::new(data);
    if cursor.read_array::<8>()? != TRANSCEIVER_RECEIPT_ACCOUNT_MAGIC {
        return Err(AccountCodecError::InvalidMagic);
    }
    if cursor.read_u8()? != TRANSCEIVER_ACCOUNT_VERSION {
        return Err(AccountCodecError::UnsupportedVersion);
    }
    let receipt = VerifiedMessageReceipt {
        message_digest: cursor.read_array::<32>()?,
        operation_id: cursor.read_array::<32>()?,
        transceiver_program_id: cursor.read_array::<32>()?,
        manager_program_id: cursor.read_array::<32>()?,
        mint: cursor.read_array::<32>()?,
        direction: BridgeDirection::try_from(cursor.read_u8()?)
            .map_err(|_| AccountCodecError::InvalidEncoding)?,
        action: BridgeAction::try_from(cursor.read_u8()?)
            .map_err(|_| AccountCodecError::InvalidEncoding)?,
        key_epoch: cursor.read_u32_le()?,
        attesters: [cursor.read_array::<32>()?, cursor.read_array::<32>()?],
        consumed: cursor.read_bool()?,
    };
    cursor.finish()?;
    Ok(VerifiedReceiptAccount { receipt })
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

    if signature_offset < ED25519_INSTRUCTION_HEADER_LENGTH
        || public_key_offset < ED25519_INSTRUCTION_HEADER_LENGTH
        || message_data_offset < ED25519_INSTRUCTION_HEADER_LENGTH
        || signature_end > data.len()
        || public_key_end > data.len()
        || message_end > data.len()
    {
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

fn parse_shared_message_ed25519_instruction(
    instruction: &SolanaInstructionView,
    current_index: u16,
    expected_digest: Hash32,
    key_epoch: u32,
) -> Result<AttestationObservation, TransceiverError> {
    if instruction.program_id != ED25519_PROGRAM_ID {
        return Err(TransceiverError::InvalidEd25519Program);
    }
    let data = &instruction.data;
    let signature_offset = ED25519_INSTRUCTION_HEADER_LENGTH;
    let public_key_offset = signature_offset + ED25519_SIGNATURE_LENGTH;
    if data.len() != public_key_offset + ED25519_PUBLIC_KEY_LENGTH || data[0] != 1 || data[1] != 0 {
        return Err(TransceiverError::InvalidEd25519Instruction);
    }
    // Signature and key must be local, non-overlapping, and fill the entire
    // verifier payload. Only the message may reference the current instruction.
    if read_u16_le(data, 2)? as usize != signature_offset
        || read_u16_le(data, 4)? != instruction.instruction_index
        || read_u16_le(data, 6)? as usize != public_key_offset
        || read_u16_le(data, 8)? != instruction.instruction_index
        || read_u16_le(data, 10)? != 1
        || read_u16_le(data, 12)? as usize != MESSAGE_LENGTH
        || read_u16_le(data, 14)? != current_index
    {
        return Err(TransceiverError::InvalidEd25519InstructionOffsets);
    }
    Ok(AttestationObservation {
        attester: data[public_key_offset..]
            .try_into()
            .expect("length checked"),
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

struct AccountCursor<'a> {
    data: &'a [u8],
    offset: usize,
}

impl<'a> AccountCursor<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, offset: 0 }
    }

    fn read_array<const N: usize>(&mut self) -> Result<[u8; N], AccountCodecError> {
        let end = self
            .offset
            .checked_add(N)
            .ok_or(AccountCodecError::InvalidEncoding)?;
        let bytes = self
            .data
            .get(self.offset..end)
            .ok_or(AccountCodecError::InvalidEncoding)?;
        self.offset = end;
        Ok(bytes.try_into().expect("slice length checked"))
    }

    fn read_u8(&mut self) -> Result<u8, AccountCodecError> {
        Ok(self.read_array::<1>()?[0])
    }

    fn read_bool(&mut self) -> Result<bool, AccountCodecError> {
        match self.read_u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(AccountCodecError::InvalidEncoding),
        }
    }

    fn read_u32_le(&mut self) -> Result<u32, AccountCodecError> {
        Ok(u32::from_le_bytes(self.read_array::<4>()?))
    }

    fn advance(&mut self, count: usize) -> Result<(), AccountCodecError> {
        let end = self
            .offset
            .checked_add(count)
            .ok_or(AccountCodecError::InvalidEncoding)?;
        if end > self.data.len() {
            return Err(AccountCodecError::InvalidEncoding);
        }
        self.offset = end;
        Ok(())
    }

    fn remaining(&self) -> &'a [u8] {
        &self.data[self.offset..]
    }

    fn finish(&self) -> Result<(), AccountCodecError> {
        if self.offset == self.data.len() {
            Ok(())
        } else {
            Err(AccountCodecError::InvalidAccountLength {
                expected: self.offset,
                found: self.data.len(),
            })
        }
    }
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
    #[error("Solana instruction length mismatch, expected {expected}, found {found}")]
    InvalidInstructionLength { expected: usize, found: usize },
    #[error("Solana instruction encoding is invalid")]
    InvalidInstructionEncoding,
    #[error("canonical bridge message in Solana instruction is invalid")]
    InvalidCanonicalMessage,
    #[error("unsupported Solana instruction tag {0}")]
    UnsupportedInstructionTag(u8),
    #[error("not enough Solana accounts")]
    NotEnoughAccounts,
    #[error("unexpected additional Solana accounts")]
    UnexpectedAdditionalAccounts,
    #[error("Solana account is not writable")]
    AccountNotWritable,
    #[error("Solana required signer is missing")]
    MissingRequiredSignature,
    #[error("Solana account owner mismatch")]
    AccountOwnerMismatch,
    #[error("Solana account key mismatch")]
    AccountKeyMismatch,
    #[error("Solana account is already initialized")]
    AccountAlreadyInitialized,
    #[error("Solana account data is invalid")]
    InvalidAccountData,
    #[error("Solana account data borrow failed")]
    AccountBorrowFailed,
    #[error("Solana rent sysvar is unavailable")]
    RentUnavailable,
    #[error("Solana System Program CPI failed")]
    SystemCpiFailed,
    #[error("Solana instructions sysvar is invalid")]
    InvalidInstructionsSysvar,
    #[error("transceiver account codec error: {0}")]
    AccountCodec(#[from] AccountCodecError),
    #[error("transceiver error: {0}")]
    Transceiver(#[from] TransceiverError),
}

impl From<EntrypointError> for ProgramError {
    fn from(value: EntrypointError) -> Self {
        match value {
            EntrypointError::EmptyInstruction
            | EntrypointError::InvalidInstructionLength { .. }
            | EntrypointError::InvalidInstructionEncoding
            | EntrypointError::InvalidCanonicalMessage
            | EntrypointError::UnsupportedInstructionTag(_) => ProgramError::InvalidInstructionData,
            EntrypointError::NotEnoughAccounts => ProgramError::NotEnoughAccountKeys,
            EntrypointError::AccountOwnerMismatch => ProgramError::IllegalOwner,
            EntrypointError::MissingRequiredSignature => ProgramError::MissingRequiredSignature,
            EntrypointError::AccountNotWritable
            | EntrypointError::AccountKeyMismatch
            | EntrypointError::AccountAlreadyInitialized
            | EntrypointError::InvalidAccountData
            | EntrypointError::AccountBorrowFailed
            | EntrypointError::RentUnavailable
            | EntrypointError::SystemCpiFailed
            | EntrypointError::InvalidInstructionsSysvar
            | EntrypointError::UnexpectedAdditionalAccounts
            | EntrypointError::AccountCodec(_)
            | EntrypointError::Transceiver(_) => ProgramError::InvalidAccountData,
        }
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum AccountCodecError {
    #[error("Solana account data length mismatch, expected {expected}, found {found}")]
    InvalidAccountLength { expected: usize, found: usize },
    #[error("Solana account data magic is invalid")]
    InvalidMagic,
    #[error("Solana account data version is unsupported")]
    UnsupportedVersion,
    #[error("Solana account data encoding is invalid")]
    InvalidEncoding,
    #[error("transceiver error: {0}")]
    Transceiver(#[from] TransceiverError),
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
    use solana_instructions_sysvar::store_current_index_checked;
    use solana_program::sysvar::instructions::{construct_instructions_data, BorrowedInstruction};

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

    fn account_execution_config() -> TransceiverConfig {
        let mut config = config();
        config.transceiver_program_id = id().to_bytes();
        config
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

    fn test_account(
        key: Pubkey,
        account_owner: Pubkey,
        data: Vec<u8>,
        is_signer: bool,
        is_writable: bool,
    ) -> AccountInfo<'static> {
        let key = Box::leak(Box::new(key));
        let account_owner = Box::leak(Box::new(account_owner));
        let lamports = Box::leak(Box::new(1u64));
        let data = Box::leak(data.into_boxed_slice());
        AccountInfo::new(
            key,
            is_signer,
            is_writable,
            lamports,
            data,
            account_owner,
            false,
        )
    }

    fn current_instruction(message: &CanonicalBridgeMessage) -> SolanaInstructionView {
        SolanaInstructionView {
            program_id: message.deployment.transceiver_program_id,
            instruction_index: 2,
            data: TransceiverInstruction::VerifyMessageFromEd25519 {
                message: Box::new(message.clone()),
                ed25519_instruction_indexes: [0, 1],
            }
            .encode()
            .unwrap(),
        }
    }

    fn shared_ed25519_instruction(
        attester: PubkeyBytes,
        message: &CanonicalBridgeMessage,
        index: u16,
    ) -> SolanaInstructionView {
        let mut view = ed25519_instruction(attester, message, index);
        view.data.truncate(
            ED25519_INSTRUCTION_HEADER_LENGTH
                + ED25519_SIGNATURE_LENGTH
                + ED25519_PUBLIC_KEY_LENGTH,
        );
        view.data[10..12].copy_from_slice(&1u16.to_le_bytes());
        view.data[14..16].copy_from_slice(&2u16.to_le_bytes());
        view
    }

    fn instructions_sysvar_account(
        instructions: &[SolanaInstructionView],
        message: &CanonicalBridgeMessage,
    ) -> AccountInfo<'static> {
        let mut all = instructions.to_vec();
        all.push(current_instruction(message));
        let instructions = &all;
        let program_ids = instructions
            .iter()
            .map(|instruction| Pubkey::new_from_array(instruction.program_id))
            .collect::<Vec<_>>();
        let borrowed = instructions
            .iter()
            .zip(program_ids.iter())
            .map(|(instruction, program_id)| BorrowedInstruction {
                program_id,
                accounts: Vec::new(),
                data: &instruction.data,
            })
            .collect::<Vec<_>>();
        let mut data = construct_instructions_data(&borrowed);
        store_current_index_checked(&mut data, 2).unwrap();
        test_account(
            INSTRUCTIONS_SYSVAR_ID,
            solana_program::sysvar::id(),
            data,
            false,
            false,
        )
    }

    #[test]
    fn transceiver_default_has_no_verifications() {
        let program = TransceiverProgram::initialize(config()).unwrap();
        assert_eq!(program.verified_messages(), 0);
    }

    #[test]
    fn solana_entrypoint_identity_is_localnet_only_and_validate_only() {
        assert_eq!(id().to_string(), LOCALNET_PROGRAM_ID_BASE58);
        assert_eq!(PROGRAM_ABI_STATUS, "ECONOMIC_ABI_ENABLED");
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
            message: Box::new(message.clone()),
            ed25519_instruction_indexes: [0, 1],
        };
        let verify_bytes = verify.encode().unwrap();
        assert_eq!(
            decode_transceiver_instruction(&verify_bytes).unwrap(),
            verify
        );
        assert_eq!(process_instruction_boundary(&verify_bytes), Ok(()));

        let duplicate = TransceiverInstruction::VerifyMessageFromEd25519 {
            message: Box::new(message),
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
    fn transceiver_account_codecs_round_trip_and_reject_malformed_data() {
        let config = config();
        let config_bytes = encode_transceiver_config_account(&config);
        assert_eq!(config_bytes.len(), TRANSCEIVER_CONFIG_ACCOUNT_LENGTH);
        assert_eq!(
            decode_transceiver_config_account(&config_bytes).unwrap(),
            TransceiverConfigAccount {
                config: config.clone()
            }
        );

        let mut wrong_magic = config_bytes.clone();
        wrong_magic[0] ^= 1;
        assert_eq!(
            decode_transceiver_config_account(&wrong_magic),
            Err(AccountCodecError::InvalidMagic)
        );

        let mut wrong_version = config_bytes.clone();
        wrong_version[8] = TRANSCEIVER_ACCOUNT_VERSION + 1;
        assert_eq!(
            decode_transceiver_config_account(&wrong_version),
            Err(AccountCodecError::UnsupportedVersion)
        );

        let message = message(&config);
        let digest = message.message_digest().unwrap();
        let mut program = TransceiverProgram::initialize(config.clone()).unwrap();
        program
            .verify_message(&message, &observations(&config, digest))
            .unwrap();
        let receipt = program.receipt(&digest).unwrap().clone();
        let receipt_bytes = encode_verified_receipt_account(&receipt);
        assert_eq!(receipt_bytes.len(), VERIFIED_RECEIPT_ACCOUNT_LENGTH);
        assert_eq!(
            decode_verified_receipt_account(&receipt_bytes).unwrap(),
            VerifiedReceiptAccount { receipt }
        );

        let mut truncated = receipt_bytes;
        truncated.pop();
        assert_eq!(
            decode_verified_receipt_account(&truncated),
            Err(AccountCodecError::InvalidAccountLength {
                expected: VERIFIED_RECEIPT_ACCOUNT_LENGTH,
                found: VERIFIED_RECEIPT_ACCOUNT_LENGTH - 1,
            })
        );
    }

    #[test]
    fn transceiver_account_execution_initializes_config_and_writes_receipt() {
        let config = account_execution_config();
        let config_key = Pubkey::new_from_array(derive_transceiver_config_pda(
            &config.transceiver_program_id,
            &config.mint,
        ));
        let config_account = test_account(
            config_key,
            id(),
            vec![0; TRANSCEIVER_CONFIG_ACCOUNT_LENGTH],
            false,
            true,
        );
        let initialize = TransceiverInstruction::Initialize(config.clone())
            .encode()
            .unwrap();
        process_instruction_accounts(&id(), std::slice::from_ref(&config_account), &initialize)
            .unwrap();
        assert_eq!(
            read_transceiver_config_account(&config_account)
                .unwrap()
                .config,
            config
        );
        assert_eq!(
            process_instruction_accounts(&id(), std::slice::from_ref(&config_account), &initialize),
            Err(EntrypointError::AccountAlreadyInitialized)
        );

        let message = message(&config);
        let digest = message.message_digest().unwrap();
        let first = ed25519_instruction(config.authorized_attesters[0], &message, 0);
        let second = ed25519_instruction(config.authorized_attesters[1], &message, 1);
        let instructions_sysvar = instructions_sysvar_account(&[first, second], &message);
        let receipt_key = Pubkey::new_from_array(derive_verified_receipt_pda(
            &config.transceiver_program_id,
            &digest,
        ));
        let receipt_account = test_account(
            receipt_key,
            id(),
            vec![0; VERIFIED_RECEIPT_ACCOUNT_LENGTH],
            false,
            true,
        );
        let verify = TransceiverInstruction::VerifyMessageFromEd25519 {
            message: Box::new(message.clone()),
            ed25519_instruction_indexes: [0, 1],
        }
        .encode()
        .unwrap();

        process_instruction_accounts(
            &id(),
            &[
                config_account.clone(),
                receipt_account.clone(),
                instructions_sysvar,
            ],
            &verify,
        )
        .unwrap();
        let receipt = read_verified_receipt_account(&receipt_account)
            .unwrap()
            .receipt;
        assert_eq!(receipt.message_digest, digest);
        assert_eq!(receipt.operation_id, message.operation_id);
        assert_eq!(receipt.attesters, config.authorized_attesters);
        assert!(!receipt.consumed);
    }

    #[test]
    fn transceiver_account_execution_rejects_wrong_receipt_pda() {
        let config = account_execution_config();
        let config_key = Pubkey::new_from_array(derive_transceiver_config_pda(
            &config.transceiver_program_id,
            &config.mint,
        ));
        let config_account = test_account(
            config_key,
            id(),
            encode_transceiver_config_account(&config),
            false,
            false,
        );
        let message = message(&config);
        let first = ed25519_instruction(config.authorized_attesters[0], &message, 0);
        let second = ed25519_instruction(config.authorized_attesters[1], &message, 1);
        let instructions_sysvar = instructions_sysvar_account(&[first, second], &message);
        let wrong_receipt = test_account(
            Pubkey::new_unique(),
            id(),
            vec![0; VERIFIED_RECEIPT_ACCOUNT_LENGTH],
            false,
            true,
        );
        let verify = TransceiverInstruction::VerifyMessageFromEd25519 {
            message: Box::new(message),
            ed25519_instruction_indexes: [0, 1],
        }
        .encode()
        .unwrap();

        assert_eq!(
            process_instruction_accounts(
                &id(),
                &[config_account, wrong_receipt, instructions_sysvar],
                &verify,
            ),
            Err(EntrypointError::AccountKeyMismatch)
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
    fn shared_message_requires_two_distinct_authorized_signers() {
        let config = config();
        let msg = message(&config);
        let first = shared_ed25519_instruction(config.authorized_attesters[0], &msg, 0);
        let second = shared_ed25519_instruction(config.authorized_attesters[1], &msg, 1);
        let verify = |instructions: &[SolanaInstructionView]| {
            TransceiverProgram::initialize(config.clone())
                .unwrap()
                .verify_message_from_transaction_instructions(
                    &msg,
                    instructions,
                    &current_instruction(&msg),
                )
        };
        assert_eq!(
            verify(&[first.clone(), second.clone()]),
            Ok(msg.message_digest().unwrap())
        );
        assert!(verify(std::slice::from_ref(&first)).is_err());
        assert!(verify(&[second]).is_err());
        let duplicate = shared_ed25519_instruction(config.authorized_attesters[0], &msg, 1);
        assert!(verify(&[first.clone(), duplicate]).is_err());
        assert!(verify(&[first.clone(), first]).is_err());
    }

    #[test]
    fn shared_message_rejects_all_header_offset_and_context_substitutions() {
        let config = config();
        let msg = message(&config);
        let first = shared_ed25519_instruction(config.authorized_attesters[0], &msg, 0);
        let second = shared_ed25519_instruction(config.authorized_attesters[1], &msg, 1);
        let current = current_instruction(&msg);
        let verify = |a: &SolanaInstructionView, c: &SolanaInstructionView| {
            TransceiverProgram::initialize(config.clone())
                .unwrap()
                .verify_message_from_transaction_instructions(&msg, &[a.clone(), second.clone()], c)
        };
        for offset in 0..ED25519_INSTRUCTION_HEADER_LENGTH {
            let mut bad = first.clone();
            bad.data[offset] ^= 1;
            assert!(verify(&bad, &current).is_err(), "offset {offset}");
        }
        let mut wrong_program = first.clone();
        wrong_program.program_id = [0; 32];
        assert!(verify(&wrong_program, &current).is_err());
        let mut trailing = first.clone();
        trailing.data.push(0);
        assert!(verify(&trailing, &current).is_err());
        let mut short = first.clone();
        short.data.pop();
        assert!(verify(&short, &current).is_err());
        for offset in 0..current.data.len() {
            let mut substituted = current.clone();
            substituted.data[offset] ^= 1;
            assert!(
                verify(&first, &substituted).is_err(),
                "context byte {offset}"
            );
        }
        let mut wrong_program = current.clone();
        wrong_program.program_id = [0; 32];
        assert!(verify(&first, &wrong_program).is_err());
        let mut future_verifier = current.clone();
        future_verifier.instruction_index = 1;
        assert!(verify(&first, &future_verifier).is_err());
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
