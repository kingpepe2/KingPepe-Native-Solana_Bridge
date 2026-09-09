//! KingPepe bridge manager boundary model.
//!
//! Phase 05 implements deterministic program-state validation, mint/PDA
//! authority policy, transceiver receipt consumption, deposit replay
//! protection, and atomic burn plus withdrawal recording. Mainnet activation
//! remains disabled.

#![allow(unexpected_cfgs)]

use std::collections::{BTreeMap, BTreeSet};

use bridge_messages::{
    BridgeAction, BridgeDirection, CanonicalBridgeMessage, Hash32, PubkeyBytes,
    MAX_DESTINATION_LENGTH,
};
use kingpepe_transceiver::{TransceiverError, TransceiverProgram, VerifiedMessageReceipt};
use solana_program::{
    account_info::AccountInfo, declare_id, entrypoint::ProgramResult, program_error::ProgramError,
    pubkey::Pubkey,
};
use thiserror::Error;

declare_id!("EfoRF4BDDspsi53XYL62mCyhCtf3FceV5LpRkRdwYqKM");

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

pub const PROGRAM_NAME: &str = "kingpepe_bridge";
pub const LOCALNET_PROGRAM_ID_BASE58: &str = "EfoRF4BDDspsi53XYL62mCyhCtf3FceV5LpRkRdwYqKM";
pub const PROGRAM_ABI_STATUS: &str = "ECONOMIC_ABI_VALIDATE_ONLY";
pub const BRIDGE_INSTRUCTION_INITIALIZE: u8 = 1;
pub const BRIDGE_INSTRUCTION_ACCEPT_DEPOSIT_CLAIM: u8 = 2;
pub const BRIDGE_INSTRUCTION_RECORD_WITHDRAWAL_REQUEST: u8 = 3;
pub const BRIDGE_CONFIG_INSTRUCTION_LENGTH: usize = 256;
pub const BURN_CHECKED_INSTRUCTION_LENGTH: usize = 105;
pub const MINT_AUTHORITY_PDA_SEED_PREFIX: &[u8] = b"kingpepe-mint-authority";
pub const BRIDGE_ACCOUNT_VERSION: u8 = 1;
pub const BRIDGE_STATE_ACCOUNT_MAGIC: [u8; 8] = *b"KPBSTAT1";
pub const DEPOSIT_CLAIM_ACCOUNT_MAGIC: [u8; 8] = *b"KPBCLM01";
pub const WITHDRAWAL_RECORD_ACCOUNT_MAGIC: [u8; 8] = *b"KPBWDR01";
pub const BRIDGE_STATE_ACCOUNT_LENGTH: usize =
    8 + 1 + 1 + BRIDGE_CONFIG_INSTRUCTION_LENGTH + 16 + 16;
pub const DEPOSIT_CLAIM_ACCOUNT_LENGTH: usize = 8 + 1 + 32 + 32 + 8 + 2 + MAX_DESTINATION_LENGTH;
pub const WITHDRAWAL_RECORD_ACCOUNT_LENGTH: usize =
    8 + 1 + 32 + 32 + 32 + 8 + 8 + 2 + MAX_DESTINATION_LENGTH + 32;
pub const KPEPE_SYMBOL: &str = "KPEPE";
pub const KPEPE_NAME: &str = "KingPepe";
pub const EXPECTED_INITIAL_SUPPLY: u128 = 0;
pub const PROJECT_BRIDGE_FEE_ATOMIC: u64 = 0;

pub fn process_instruction(
    _program_id: &Pubkey,
    _accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    process_instruction_boundary(instruction_data).map_err(|_| ProgramError::InvalidInstructionData)
}

pub fn process_instruction_boundary(instruction_data: &[u8]) -> Result<(), EntrypointError> {
    let _instruction = decode_bridge_instruction(instruction_data)?;
    Err(EntrypointError::InstructionExecutionDisabled)
}

pub fn decode_bridge_instruction(
    instruction_data: &[u8],
) -> Result<BridgeInstruction, EntrypointError> {
    let Some(tag) = instruction_data.first().copied() else {
        return Err(EntrypointError::EmptyInstruction);
    };
    match tag {
        BRIDGE_INSTRUCTION_INITIALIZE => {
            let expected = 1 + BRIDGE_CONFIG_INSTRUCTION_LENGTH;
            if instruction_data.len() != expected {
                return Err(EntrypointError::InvalidInstructionLength {
                    expected,
                    found: instruction_data.len(),
                });
            }
            Ok(BridgeInstruction::Initialize(decode_bridge_config(
                &instruction_data[1..],
            )?))
        }
        BRIDGE_INSTRUCTION_ACCEPT_DEPOSIT_CLAIM => {
            let expected = 1 + bridge_messages::MESSAGE_LENGTH;
            if instruction_data.len() != expected {
                return Err(EntrypointError::InvalidInstructionLength {
                    expected,
                    found: instruction_data.len(),
                });
            }
            let message = CanonicalBridgeMessage::decode(&instruction_data[1..])
                .map_err(|_| EntrypointError::InvalidCanonicalMessage)?;
            Ok(BridgeInstruction::AcceptDepositClaim(Box::new(message)))
        }
        BRIDGE_INSTRUCTION_RECORD_WITHDRAWAL_REQUEST => {
            let expected = 1 + bridge_messages::MESSAGE_LENGTH + BURN_CHECKED_INSTRUCTION_LENGTH;
            if instruction_data.len() != expected {
                return Err(EntrypointError::InvalidInstructionLength {
                    expected,
                    found: instruction_data.len(),
                });
            }
            let message_end = 1 + bridge_messages::MESSAGE_LENGTH;
            let message = CanonicalBridgeMessage::decode(&instruction_data[1..message_end])
                .map_err(|_| EntrypointError::InvalidCanonicalMessage)?;
            let burn = decode_burn_checked(&instruction_data[message_end..])?;
            Ok(BridgeInstruction::RecordWithdrawalRequest {
                message: Box::new(message),
                burn,
            })
        }
        other => Err(EntrypointError::UnsupportedInstructionTag(other)),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BridgeInstruction {
    Initialize(BridgeConfig),
    AcceptDepositClaim(Box<CanonicalBridgeMessage>),
    RecordWithdrawalRequest {
        message: Box<CanonicalBridgeMessage>,
        burn: BurnChecked,
    },
}

impl BridgeInstruction {
    pub fn encode(&self) -> Result<Vec<u8>, EntrypointError> {
        let mut out = Vec::new();
        match self {
            BridgeInstruction::Initialize(config) => {
                out.push(BRIDGE_INSTRUCTION_INITIALIZE);
                encode_bridge_config(config, &mut out);
            }
            BridgeInstruction::AcceptDepositClaim(message) => {
                out.push(BRIDGE_INSTRUCTION_ACCEPT_DEPOSIT_CLAIM);
                out.extend(
                    message
                        .encode()
                        .map_err(|_| EntrypointError::InvalidCanonicalMessage)?,
                );
            }
            BridgeInstruction::RecordWithdrawalRequest { message, burn } => {
                out.push(BRIDGE_INSTRUCTION_RECORD_WITHDRAWAL_REQUEST);
                out.extend(
                    message
                        .encode()
                        .map_err(|_| EntrypointError::InvalidCanonicalMessage)?,
                );
                encode_burn_checked(burn, &mut out);
            }
        }
        Ok(out)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProgramState {
    Uninitialized,
    Phase0Disabled,
    LocalnetTesting,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BridgeEnvironment {
    Localnet,
    Devnet,
    Mainnet,
}

fn encode_bridge_environment(environment: &BridgeEnvironment) -> u8 {
    match environment {
        BridgeEnvironment::Localnet => 0,
        BridgeEnvironment::Devnet => 1,
        BridgeEnvironment::Mainnet => 2,
    }
}

fn decode_bridge_environment(byte: u8) -> Result<BridgeEnvironment, EntrypointError> {
    match byte {
        0 => Ok(BridgeEnvironment::Localnet),
        1 => Ok(BridgeEnvironment::Devnet),
        2 => Ok(BridgeEnvironment::Mainnet),
        _ => Err(EntrypointError::InvalidInstructionEncoding),
    }
}

fn encode_bridge_config(config: &BridgeConfig, out: &mut Vec<u8>) {
    out.push(encode_bridge_environment(&config.environment));
    out.extend(config.manager_program_id);
    out.extend(config.transceiver_program_id);
    out.extend(config.solana_deployment);
    out.extend(config.mint_binding.mint);
    out.extend(config.mint_binding.token_program_id);
    out.extend(config.mint_binding.mint_authority_pda);
    out.push(config.mint_binding.decimals);
    out.push(config.mint_binding.native_decimals);
    match config.mint_binding.freeze_authority {
        Some(freeze_authority) => {
            out.push(1);
            out.extend(freeze_authority);
        }
        None => {
            out.push(0);
            out.extend([0u8; 32]);
        }
    }
    out.extend(config.mint_binding.initial_supply.to_le_bytes());
    out.extend(config.policy_epoch.to_le_bytes());
    out.extend(config.key_epoch.to_le_bytes());
    out.push(config.deposits_paused as u8);
    out.push(config.withdrawals_paused as u8);
    out.push(config.hard_stop as u8);
    out.push(config.mainnet_activation_enabled as u8);
}

fn decode_bridge_config(data: &[u8]) -> Result<BridgeConfig, EntrypointError> {
    let mut cursor = InstructionCursor::new(data);
    let environment = decode_bridge_environment(cursor.read_u8()?)?;
    let manager_program_id = cursor.read_array::<32>()?;
    let transceiver_program_id = cursor.read_array::<32>()?;
    let solana_deployment = cursor.read_array::<32>()?;
    let mint = cursor.read_array::<32>()?;
    let token_program_id = cursor.read_array::<32>()?;
    let mint_authority_pda = cursor.read_array::<32>()?;
    let decimals = cursor.read_u8()?;
    let native_decimals = cursor.read_u8()?;
    let freeze_authority = match cursor.read_u8()? {
        0 => {
            let padded = cursor.read_array::<32>()?;
            if padded != [0u8; 32] {
                return Err(EntrypointError::InvalidInstructionEncoding);
            }
            None
        }
        1 => Some(cursor.read_array::<32>()?),
        _ => return Err(EntrypointError::InvalidInstructionEncoding),
    };
    let initial_supply = cursor.read_u128_le()?;
    let policy_epoch = cursor.read_u32_le()?;
    let key_epoch = cursor.read_u32_le()?;
    let deposits_paused = cursor.read_bool()?;
    let withdrawals_paused = cursor.read_bool()?;
    let hard_stop = cursor.read_bool()?;
    let mainnet_activation_enabled = cursor.read_bool()?;
    cursor.finish()?;

    Ok(BridgeConfig {
        environment,
        manager_program_id,
        transceiver_program_id,
        solana_deployment,
        mint_binding: MintBinding {
            mint,
            token_program_id,
            mint_authority_pda,
            decimals,
            native_decimals,
            freeze_authority,
            initial_supply,
        },
        policy_epoch,
        key_epoch,
        deposits_paused,
        withdrawals_paused,
        hard_stop,
        mainnet_activation_enabled,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MintBinding {
    pub mint: PubkeyBytes,
    pub token_program_id: PubkeyBytes,
    pub mint_authority_pda: PubkeyBytes,
    pub decimals: u8,
    pub native_decimals: u8,
    pub freeze_authority: Option<PubkeyBytes>,
    pub initial_supply: u128,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BridgeConfig {
    pub environment: BridgeEnvironment,
    pub manager_program_id: PubkeyBytes,
    pub transceiver_program_id: PubkeyBytes,
    pub solana_deployment: Hash32,
    pub mint_binding: MintBinding,
    pub policy_epoch: u32,
    pub key_epoch: u32,
    pub deposits_paused: bool,
    pub withdrawals_paused: bool,
    pub hard_stop: bool,
    pub mainnet_activation_enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccountContext {
    pub manager_program_id: PubkeyBytes,
    pub transceiver_program_id: PubkeyBytes,
    pub token_program_id: PubkeyBytes,
    pub mint: PubkeyBytes,
    pub mint_authority_pda: PubkeyBytes,
    pub mint_decimals: u8,
    pub freeze_authority: Option<PubkeyBytes>,
    pub writable_accounts: Vec<PubkeyBytes>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BurnChecked {
    pub token_program_id: PubkeyBytes,
    pub mint: PubkeyBytes,
    pub authority: PubkeyBytes,
    pub amount_atomic: u64,
    pub decimals: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DepositClaimRecord {
    pub operation_id: Hash32,
    pub message_digest: Hash32,
    pub amount_atomic: u64,
    pub recipient: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WithdrawalRecord {
    pub withdrawal_id: Hash32,
    pub operation_id: Hash32,
    pub message_digest: Hash32,
    pub gross_amount_atomic: u64,
    pub fee_atomic: u64,
    pub native_destination: Vec<u8>,
    pub burn_authority: PubkeyBytes,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BridgeStateAccount {
    pub state: ProgramState,
    pub config: BridgeConfig,
    pub minted_supply: u128,
    pub burned_unpaid_withdrawals: u128,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DepositClaimAccount {
    pub record: DepositClaimRecord,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WithdrawalRecordAccount {
    pub record: WithdrawalRecord,
}

#[derive(Debug, Default, Clone)]
pub struct BridgeProgram {
    state: ProgramState,
    config: Option<BridgeConfig>,
    deposit_claims: BTreeMap<Hash32, DepositClaimRecord>,
    withdrawal_records: BTreeMap<Hash32, WithdrawalRecord>,
    consumed_receipts: BTreeSet<Hash32>,
    minted_supply: u128,
    burned_unpaid_withdrawals: u128,
}

impl Default for ProgramState {
    fn default() -> Self {
        Self::Uninitialized
    }
}

impl BridgeProgram {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn initialize(&mut self, config: BridgeConfig) -> Result<(), BridgeError> {
        if self.config.is_some() {
            return Err(BridgeError::AlreadyInitialized);
        }
        validate_config(&config)?;
        self.state = match config.environment {
            BridgeEnvironment::Localnet => ProgramState::LocalnetTesting,
            BridgeEnvironment::Devnet | BridgeEnvironment::Mainnet => ProgramState::Phase0Disabled,
        };
        self.config = Some(config);
        Ok(())
    }

    pub fn state(&self) -> &ProgramState {
        &self.state
    }

    pub fn config(&self) -> Option<&BridgeConfig> {
        self.config.as_ref()
    }

    pub fn is_operational(&self) -> bool {
        self.state == ProgramState::LocalnetTesting
    }

    pub fn minted_supply(&self) -> u128 {
        self.minted_supply
    }

    pub fn burned_unpaid_withdrawals(&self) -> u128 {
        self.burned_unpaid_withdrawals
    }

    pub fn withdrawal_count(&self) -> usize {
        self.withdrawal_records.len()
    }

    pub fn deposit_claim_count(&self) -> usize {
        self.deposit_claims.len()
    }

    pub fn accept_deposit_claim(
        &mut self,
        transceiver: &mut TransceiverProgram,
        message: &CanonicalBridgeMessage,
        accounts: &AccountContext,
    ) -> Result<DepositClaimRecord, BridgeError> {
        let config = self.require_ready_for_deposits()?;
        validate_accounts(config, accounts)?;
        validate_message_domain(config, message)?;
        if message.direction != BridgeDirection::NativeToSolana
            || message.action != BridgeAction::DepositClaim
        {
            return Err(BridgeError::WrongMessageKind);
        }
        if self.deposit_claims.contains_key(&message.operation_id) {
            return Err(BridgeError::Replay);
        }
        let digest = message
            .message_digest()
            .map_err(|_| BridgeError::InvalidMessage)?;
        let receipt = transceiver
            .receipt(&digest)
            .ok_or(BridgeError::MissingReceipt)?;
        validate_receipt(config, receipt, message, digest)?;
        if self.consumed_receipts.contains(&digest) {
            return Err(BridgeError::Replay);
        }

        transceiver
            .consume_receipt(&digest)
            .map_err(BridgeError::Transceiver)?;
        let record = DepositClaimRecord {
            operation_id: message.operation_id,
            message_digest: digest,
            amount_atomic: message.amount_atomic,
            recipient: message.destination.clone(),
        };
        self.minted_supply = self
            .minted_supply
            .checked_add(message.amount_atomic as u128)
            .ok_or(BridgeError::ArithmeticOverflow)?;
        self.deposit_claims
            .insert(message.operation_id, record.clone());
        self.consumed_receipts.insert(digest);
        Ok(record)
    }

    pub fn record_withdrawal_request(
        &mut self,
        message: &CanonicalBridgeMessage,
        burn: &BurnChecked,
        accounts: &AccountContext,
    ) -> Result<WithdrawalRecord, BridgeError> {
        let config = self.require_ready_for_withdrawals()?;
        validate_accounts(config, accounts)?;
        validate_message_domain(config, message)?;
        if message.direction != BridgeDirection::SolanaToNative
            || message.action != BridgeAction::WithdrawalRequest
        {
            return Err(BridgeError::WrongMessageKind);
        }
        if self.withdrawal_records.contains_key(&message.withdrawal_id) {
            return Err(BridgeError::Replay);
        }
        validate_burn(config, message, burn)?;

        let digest = message
            .message_digest()
            .map_err(|_| BridgeError::InvalidMessage)?;
        let record = WithdrawalRecord {
            withdrawal_id: message.withdrawal_id,
            operation_id: message.operation_id,
            message_digest: digest,
            gross_amount_atomic: message.amount_atomic,
            fee_atomic: message.fee_atomic,
            native_destination: message.destination.clone(),
            burn_authority: burn.authority,
        };
        self.withdrawal_records
            .insert(message.withdrawal_id, record.clone());
        self.burned_unpaid_withdrawals = self
            .burned_unpaid_withdrawals
            .checked_add(message.amount_atomic as u128)
            .ok_or(BridgeError::ArithmeticOverflow)?;
        Ok(record)
    }

    pub fn rotate_epochs_for_test(
        &mut self,
        policy_epoch: u32,
        key_epoch: u32,
    ) -> Result<(), BridgeError> {
        let config = self.config.as_mut().ok_or(BridgeError::Uninitialized)?;
        if policy_epoch == 0 || key_epoch == 0 {
            return Err(BridgeError::InvalidConfig);
        }
        config.policy_epoch = policy_epoch;
        config.key_epoch = key_epoch;
        Ok(())
    }

    fn require_ready_for_deposits(&self) -> Result<&BridgeConfig, BridgeError> {
        let config = self.config.as_ref().ok_or(BridgeError::Uninitialized)?;
        if self.state != ProgramState::LocalnetTesting {
            return Err(BridgeError::ActivationDisabled);
        }
        if config.hard_stop || config.deposits_paused {
            return Err(BridgeError::PausedOrHardStopped);
        }
        Ok(config)
    }

    fn require_ready_for_withdrawals(&self) -> Result<&BridgeConfig, BridgeError> {
        let config = self.config.as_ref().ok_or(BridgeError::Uninitialized)?;
        if self.state != ProgramState::LocalnetTesting {
            return Err(BridgeError::ActivationDisabled);
        }
        if config.hard_stop || config.withdrawals_paused {
            return Err(BridgeError::PausedOrHardStopped);
        }
        Ok(config)
    }
}

pub fn derive_mint_authority_pda(
    manager_program_id: &PubkeyBytes,
    mint: &PubkeyBytes,
) -> PubkeyBytes {
    derive_mint_authority_pda_with_bump(manager_program_id, mint).0
}

pub fn derive_mint_authority_pda_with_bump(
    manager_program_id: &PubkeyBytes,
    mint: &PubkeyBytes,
) -> (PubkeyBytes, u8) {
    let manager_program_id = Pubkey::new_from_array(*manager_program_id);
    let mint = Pubkey::new_from_array(*mint);
    let (pda, bump) = Pubkey::find_program_address(
        &[MINT_AUTHORITY_PDA_SEED_PREFIX, mint.as_ref()],
        &manager_program_id,
    );
    (pda.to_bytes(), bump)
}

fn validate_config(config: &BridgeConfig) -> Result<(), BridgeError> {
    if config.manager_program_id == [0u8; 32]
        || config.transceiver_program_id == [0u8; 32]
        || config.solana_deployment == [0u8; 32]
        || config.policy_epoch == 0
        || config.key_epoch == 0
    {
        return Err(BridgeError::InvalidConfig);
    }
    if matches!(config.environment, BridgeEnvironment::Mainnet) && config.mainnet_activation_enabled
    {
        return Err(BridgeError::MainnetActivationDisabled);
    }
    let mint = &config.mint_binding;
    if mint.mint == [0u8; 32] || mint.token_program_id == [0u8; 32] {
        return Err(BridgeError::InvalidMintBinding);
    }
    if mint.initial_supply != EXPECTED_INITIAL_SUPPLY {
        return Err(BridgeError::InitialSupplyMustBeZero);
    }
    if mint.freeze_authority.is_some() {
        return Err(BridgeError::FreezeAuthorityMustBeNone);
    }
    if mint.decimals != mint.native_decimals {
        return Err(BridgeError::DecimalsMismatch);
    }
    if mint.mint_authority_pda != derive_mint_authority_pda(&config.manager_program_id, &mint.mint)
    {
        return Err(BridgeError::MintAuthorityMismatch);
    }
    Ok(())
}

fn validate_accounts(config: &BridgeConfig, accounts: &AccountContext) -> Result<(), BridgeError> {
    let mint = &config.mint_binding;
    if accounts.manager_program_id != config.manager_program_id
        || accounts.transceiver_program_id != config.transceiver_program_id
        || accounts.token_program_id != mint.token_program_id
        || accounts.mint != mint.mint
        || accounts.mint_authority_pda != mint.mint_authority_pda
        || accounts.mint_decimals != mint.decimals
        || accounts.freeze_authority != mint.freeze_authority
    {
        return Err(BridgeError::AccountMismatch);
    }
    let mut unique = BTreeSet::new();
    for key in [
        accounts.manager_program_id,
        accounts.transceiver_program_id,
        accounts.token_program_id,
        accounts.mint,
        accounts.mint_authority_pda,
    ] {
        if !unique.insert(key) {
            return Err(BridgeError::AccountAliasing);
        }
    }
    for key in &accounts.writable_accounts {
        if !unique.insert(*key) {
            return Err(BridgeError::AccountAliasing);
        }
    }
    Ok(())
}

fn validate_message_domain(
    config: &BridgeConfig,
    message: &CanonicalBridgeMessage,
) -> Result<(), BridgeError> {
    message
        .validate()
        .map_err(|_| BridgeError::InvalidMessage)?;
    if message.deployment.manager_program_id != config.manager_program_id
        || message.deployment.transceiver_program_id != config.transceiver_program_id
        || message.deployment.mint != config.mint_binding.mint
        || message.deployment.solana_deployment != config.solana_deployment
        || message.policy_epoch != config.policy_epoch
        || message.key_epoch != config.key_epoch
    {
        return Err(BridgeError::MessageDomainMismatch);
    }
    Ok(())
}

fn validate_receipt(
    config: &BridgeConfig,
    receipt: &VerifiedMessageReceipt,
    message: &CanonicalBridgeMessage,
    digest: Hash32,
) -> Result<(), BridgeError> {
    if receipt.consumed {
        return Err(BridgeError::Replay);
    }
    if receipt.message_digest != digest
        || receipt.operation_id != message.operation_id
        || receipt.transceiver_program_id != config.transceiver_program_id
        || receipt.manager_program_id != config.manager_program_id
        || receipt.mint != config.mint_binding.mint
        || receipt.direction != message.direction
        || receipt.action != message.action
        || receipt.key_epoch != message.key_epoch
    {
        return Err(BridgeError::ForgedReceipt);
    }
    Ok(())
}

fn validate_burn(
    config: &BridgeConfig,
    message: &CanonicalBridgeMessage,
    burn: &BurnChecked,
) -> Result<(), BridgeError> {
    let mint = &config.mint_binding;
    if burn.token_program_id != mint.token_program_id
        || burn.mint != mint.mint
        || burn.amount_atomic != message.amount_atomic
        || burn.decimals != mint.decimals
    {
        return Err(BridgeError::BurnMismatch);
    }
    if burn.authority == [0u8; 32] {
        return Err(BridgeError::BurnMismatch);
    }
    Ok(())
}

pub fn encode_bridge_state_account(
    state: &BridgeStateAccount,
) -> Result<Vec<u8>, AccountCodecError> {
    validate_config(&state.config)?;
    let mut out = Vec::with_capacity(BRIDGE_STATE_ACCOUNT_LENGTH);
    out.extend(BRIDGE_STATE_ACCOUNT_MAGIC);
    out.push(BRIDGE_ACCOUNT_VERSION);
    out.push(program_state_to_u8(&state.state));
    encode_bridge_config(&state.config, &mut out);
    out.extend(state.minted_supply.to_le_bytes());
    out.extend(state.burned_unpaid_withdrawals.to_le_bytes());
    debug_assert_eq!(out.len(), BRIDGE_STATE_ACCOUNT_LENGTH);
    Ok(out)
}

pub fn decode_bridge_state_account(data: &[u8]) -> Result<BridgeStateAccount, AccountCodecError> {
    if data.len() != BRIDGE_STATE_ACCOUNT_LENGTH {
        return Err(AccountCodecError::InvalidAccountLength {
            expected: BRIDGE_STATE_ACCOUNT_LENGTH,
            found: data.len(),
        });
    }
    let mut cursor = AccountCursor::new(data);
    if cursor.read_array::<8>()? != BRIDGE_STATE_ACCOUNT_MAGIC {
        return Err(AccountCodecError::InvalidMagic);
    }
    if cursor.read_u8()? != BRIDGE_ACCOUNT_VERSION {
        return Err(AccountCodecError::UnsupportedVersion);
    }
    let state = program_state_from_u8(cursor.read_u8()?)?;
    let config_bytes = cursor.read_array::<BRIDGE_CONFIG_INSTRUCTION_LENGTH>()?;
    let config =
        decode_bridge_config(&config_bytes).map_err(|_| AccountCodecError::InvalidEncoding)?;
    let minted_supply = cursor.read_u128_le()?;
    let burned_unpaid_withdrawals = cursor.read_u128_le()?;
    cursor.finish()?;
    validate_config(&config)?;
    Ok(BridgeStateAccount {
        state,
        config,
        minted_supply,
        burned_unpaid_withdrawals,
    })
}

pub fn encode_deposit_claim_account(
    record: &DepositClaimRecord,
) -> Result<Vec<u8>, AccountCodecError> {
    let mut out = Vec::with_capacity(DEPOSIT_CLAIM_ACCOUNT_LENGTH);
    out.extend(DEPOSIT_CLAIM_ACCOUNT_MAGIC);
    out.push(BRIDGE_ACCOUNT_VERSION);
    out.extend(record.operation_id);
    out.extend(record.message_digest);
    out.extend(record.amount_atomic.to_le_bytes());
    write_bounded_bytes(&mut out, &record.recipient)?;
    debug_assert_eq!(out.len(), DEPOSIT_CLAIM_ACCOUNT_LENGTH);
    Ok(out)
}

pub fn decode_deposit_claim_account(data: &[u8]) -> Result<DepositClaimAccount, AccountCodecError> {
    if data.len() != DEPOSIT_CLAIM_ACCOUNT_LENGTH {
        return Err(AccountCodecError::InvalidAccountLength {
            expected: DEPOSIT_CLAIM_ACCOUNT_LENGTH,
            found: data.len(),
        });
    }
    let mut cursor = AccountCursor::new(data);
    if cursor.read_array::<8>()? != DEPOSIT_CLAIM_ACCOUNT_MAGIC {
        return Err(AccountCodecError::InvalidMagic);
    }
    if cursor.read_u8()? != BRIDGE_ACCOUNT_VERSION {
        return Err(AccountCodecError::UnsupportedVersion);
    }
    let record = DepositClaimRecord {
        operation_id: cursor.read_array::<32>()?,
        message_digest: cursor.read_array::<32>()?,
        amount_atomic: cursor.read_u64_le()?,
        recipient: read_bounded_bytes(&mut cursor)?,
    };
    cursor.finish()?;
    Ok(DepositClaimAccount { record })
}

pub fn encode_withdrawal_record_account(
    record: &WithdrawalRecord,
) -> Result<Vec<u8>, AccountCodecError> {
    let mut out = Vec::with_capacity(WITHDRAWAL_RECORD_ACCOUNT_LENGTH);
    out.extend(WITHDRAWAL_RECORD_ACCOUNT_MAGIC);
    out.push(BRIDGE_ACCOUNT_VERSION);
    out.extend(record.withdrawal_id);
    out.extend(record.operation_id);
    out.extend(record.message_digest);
    out.extend(record.gross_amount_atomic.to_le_bytes());
    out.extend(record.fee_atomic.to_le_bytes());
    write_bounded_bytes(&mut out, &record.native_destination)?;
    out.extend(record.burn_authority);
    debug_assert_eq!(out.len(), WITHDRAWAL_RECORD_ACCOUNT_LENGTH);
    Ok(out)
}

pub fn decode_withdrawal_record_account(
    data: &[u8],
) -> Result<WithdrawalRecordAccount, AccountCodecError> {
    if data.len() != WITHDRAWAL_RECORD_ACCOUNT_LENGTH {
        return Err(AccountCodecError::InvalidAccountLength {
            expected: WITHDRAWAL_RECORD_ACCOUNT_LENGTH,
            found: data.len(),
        });
    }
    let mut cursor = AccountCursor::new(data);
    if cursor.read_array::<8>()? != WITHDRAWAL_RECORD_ACCOUNT_MAGIC {
        return Err(AccountCodecError::InvalidMagic);
    }
    if cursor.read_u8()? != BRIDGE_ACCOUNT_VERSION {
        return Err(AccountCodecError::UnsupportedVersion);
    }
    let record = WithdrawalRecord {
        withdrawal_id: cursor.read_array::<32>()?,
        operation_id: cursor.read_array::<32>()?,
        message_digest: cursor.read_array::<32>()?,
        gross_amount_atomic: cursor.read_u64_le()?,
        fee_atomic: cursor.read_u64_le()?,
        native_destination: read_bounded_bytes(&mut cursor)?,
        burn_authority: cursor.read_array::<32>()?,
    };
    cursor.finish()?;
    Ok(WithdrawalRecordAccount { record })
}

fn program_state_to_u8(state: &ProgramState) -> u8 {
    match state {
        ProgramState::Uninitialized => 0,
        ProgramState::Phase0Disabled => 1,
        ProgramState::LocalnetTesting => 2,
    }
}

fn program_state_from_u8(value: u8) -> Result<ProgramState, AccountCodecError> {
    match value {
        0 => Ok(ProgramState::Uninitialized),
        1 => Ok(ProgramState::Phase0Disabled),
        2 => Ok(ProgramState::LocalnetTesting),
        _ => Err(AccountCodecError::InvalidEncoding),
    }
}

fn write_bounded_bytes(out: &mut Vec<u8>, value: &[u8]) -> Result<(), AccountCodecError> {
    if value.is_empty() || value.len() > MAX_DESTINATION_LENGTH {
        return Err(AccountCodecError::InvalidEncoding);
    }
    out.extend((value.len() as u16).to_le_bytes());
    out.extend(value);
    out.resize(out.len() + (MAX_DESTINATION_LENGTH - value.len()), 0);
    Ok(())
}

fn read_bounded_bytes(cursor: &mut AccountCursor<'_>) -> Result<Vec<u8>, AccountCodecError> {
    let len = cursor.read_u16_le()? as usize;
    if len == 0 || len > MAX_DESTINATION_LENGTH {
        return Err(AccountCodecError::InvalidEncoding);
    }
    let padded = cursor.read_array::<MAX_DESTINATION_LENGTH>()?;
    if padded[len..].iter().any(|byte| *byte != 0) {
        return Err(AccountCodecError::InvalidEncoding);
    }
    Ok(padded[..len].to_vec())
}

fn encode_burn_checked(burn: &BurnChecked, out: &mut Vec<u8>) {
    out.extend(burn.token_program_id);
    out.extend(burn.mint);
    out.extend(burn.authority);
    out.extend(burn.amount_atomic.to_le_bytes());
    out.push(burn.decimals);
}

fn decode_burn_checked(data: &[u8]) -> Result<BurnChecked, EntrypointError> {
    let mut cursor = InstructionCursor::new(data);
    let burn = BurnChecked {
        token_program_id: cursor.read_array::<32>()?,
        mint: cursor.read_array::<32>()?,
        authority: cursor.read_array::<32>()?,
        amount_atomic: cursor.read_u64_le()?,
        decimals: cursor.read_u8()?,
    };
    cursor.finish()?;
    Ok(burn)
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

    fn read_u16_le(&mut self) -> Result<u16, AccountCodecError> {
        Ok(u16::from_le_bytes(self.read_array::<2>()?))
    }

    fn read_u64_le(&mut self) -> Result<u64, AccountCodecError> {
        Ok(u64::from_le_bytes(self.read_array::<8>()?))
    }

    fn read_u128_le(&mut self) -> Result<u128, AccountCodecError> {
        Ok(u128::from_le_bytes(self.read_array::<16>()?))
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

    fn read_u32_le(&mut self) -> Result<u32, EntrypointError> {
        Ok(u32::from_le_bytes(self.read_array::<4>()?))
    }

    fn read_u64_le(&mut self) -> Result<u64, EntrypointError> {
        Ok(u64::from_le_bytes(self.read_array::<8>()?))
    }

    fn read_u128_le(&mut self) -> Result<u128, EntrypointError> {
        Ok(u128::from_le_bytes(self.read_array::<16>()?))
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
pub enum AccountCodecError {
    #[error("Solana account data length mismatch, expected {expected}, found {found}")]
    InvalidAccountLength { expected: usize, found: usize },
    #[error("Solana account data magic is invalid")]
    InvalidMagic,
    #[error("Solana account data version is unsupported")]
    UnsupportedVersion,
    #[error("Solana account data encoding is invalid")]
    InvalidEncoding,
    #[error("bridge error: {0}")]
    Bridge(#[from] BridgeError),
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum BridgeError {
    #[error("bridge is uninitialized")]
    Uninitialized,
    #[error("bridge is already initialized")]
    AlreadyInitialized,
    #[error("bridge configuration is invalid")]
    InvalidConfig,
    #[error("mint binding is invalid")]
    InvalidMintBinding,
    #[error("initial supply must be zero")]
    InitialSupplyMustBeZero,
    #[error("freeze authority must be none")]
    FreezeAuthorityMustBeNone,
    #[error("mint authority PDA mismatch")]
    MintAuthorityMismatch,
    #[error("mint decimals must match Native decimals")]
    DecimalsMismatch,
    #[error("mainnet activation is disabled")]
    MainnetActivationDisabled,
    #[error("activation is disabled")]
    ActivationDisabled,
    #[error("bridge is paused or hard-stopped")]
    PausedOrHardStopped,
    #[error("account mismatch")]
    AccountMismatch,
    #[error("account aliasing rejected")]
    AccountAliasing,
    #[error("canonical message is invalid")]
    InvalidMessage,
    #[error("message domain mismatch")]
    MessageDomainMismatch,
    #[error("wrong message kind")]
    WrongMessageKind,
    #[error("verified receipt is missing")]
    MissingReceipt,
    #[error("verified receipt is forged or mismatched")]
    ForgedReceipt,
    #[error("economic operation replay rejected")]
    Replay,
    #[error("burn instruction mismatch")]
    BurnMismatch,
    #[error("arithmetic overflow")]
    ArithmeticOverflow,
    #[error("transceiver error: {0}")]
    Transceiver(#[from] TransceiverError),
}

#[cfg(test)]
mod tests {
    use super::*;
    use bridge_messages::{
        DeploymentIdentity, DepositClaimFields, MessageEpochs, NativeOutpoint, ValidityWindow,
        WithdrawalRequestFields,
    };
    use kingpepe_transceiver::{AttestationObservation, TransceiverConfig};

    fn h(byte: u8) -> [u8; 32] {
        [byte; 32]
    }

    fn base_config() -> BridgeConfig {
        let manager_program_id = h(1);
        let mint = h(2);
        BridgeConfig {
            environment: BridgeEnvironment::Localnet,
            manager_program_id,
            transceiver_program_id: h(3),
            solana_deployment: h(4),
            mint_binding: MintBinding {
                mint,
                token_program_id: h(5),
                mint_authority_pda: derive_mint_authority_pda(&manager_program_id, &mint),
                decimals: 8,
                native_decimals: 8,
                freeze_authority: None,
                initial_supply: 0,
            },
            policy_epoch: 6,
            key_epoch: 7,
            deposits_paused: false,
            withdrawals_paused: false,
            hard_stop: false,
            mainnet_activation_enabled: false,
        }
    }

    fn accounts(config: &BridgeConfig) -> AccountContext {
        AccountContext {
            manager_program_id: config.manager_program_id,
            transceiver_program_id: config.transceiver_program_id,
            token_program_id: config.mint_binding.token_program_id,
            mint: config.mint_binding.mint,
            mint_authority_pda: config.mint_binding.mint_authority_pda,
            mint_decimals: config.mint_binding.decimals,
            freeze_authority: None,
            writable_accounts: vec![h(31), h(32)],
        }
    }

    fn deployment(config: &BridgeConfig) -> DeploymentIdentity {
        DeploymentIdentity {
            protocol_id: 1,
            native_network: 2,
            native_genesis: h(8),
            solana_deployment: config.solana_deployment,
            manager_program_id: config.manager_program_id,
            transceiver_program_id: config.transceiver_program_id,
            mint: config.mint_binding.mint,
        }
    }

    fn deposit_message(config: &BridgeConfig) -> CanonicalBridgeMessage {
        CanonicalBridgeMessage::new_deposit_claim(DepositClaimFields {
            deployment: deployment(config),
            deposit_outpoint: NativeOutpoint {
                txid: h(9),
                vout: 1,
            },
            amount_atomic: 5_000,
            solana_recipient: h(10),
            epochs: MessageEpochs {
                policy_epoch: config.policy_epoch,
                key_epoch: config.key_epoch,
            },
            nonce: h(11),
            validity: ValidityWindow {
                valid_from: 1,
                valid_until: 2,
            },
            evidence_digest: h(12),
        })
        .unwrap()
    }

    fn withdrawal_message(config: &BridgeConfig) -> CanonicalBridgeMessage {
        CanonicalBridgeMessage::new_withdrawal_request(WithdrawalRequestFields {
            deployment: deployment(config),
            withdrawal_id: h(13),
            gross_amount_atomic: 4_000,
            fee_atomic: 25,
            native_destination: vec![0x51, 0x20, 0xAB],
            epochs: MessageEpochs {
                policy_epoch: config.policy_epoch,
                key_epoch: config.key_epoch,
            },
            nonce: h(14),
            validity: ValidityWindow {
                valid_from: 1,
                valid_until: 2,
            },
            evidence_digest: h(15),
        })
        .unwrap()
    }

    fn transceiver(config: &BridgeConfig) -> TransceiverProgram {
        TransceiverProgram::initialize(TransceiverConfig {
            transceiver_program_id: config.transceiver_program_id,
            manager_program_id: config.manager_program_id,
            mint: config.mint_binding.mint,
            solana_deployment: config.solana_deployment,
            authorized_attesters: [h(21), h(22)],
            active: true,
            key_epoch: config.key_epoch,
        })
        .unwrap()
    }

    fn observations(config: &BridgeConfig, digest: Hash32) -> Vec<AttestationObservation> {
        vec![
            AttestationObservation {
                attester: h(21),
                message_digest: digest,
                key_epoch: config.key_epoch,
                instruction_index: 0,
            },
            AttestationObservation {
                attester: h(22),
                message_digest: digest,
                key_epoch: config.key_epoch,
                instruction_index: 1,
            },
        ]
    }

    #[test]
    fn bridge_starts_uninitialized() {
        let program = BridgeProgram::default();
        assert!(!program.is_operational());
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
    fn bridge_instruction_abi_round_trips_and_rejects_trailing_data() {
        let config = base_config();
        let initialize = BridgeInstruction::Initialize(config.clone());
        let initialize_bytes = initialize.encode().unwrap();
        assert_eq!(initialize_bytes.len(), 1 + BRIDGE_CONFIG_INSTRUCTION_LENGTH);
        assert_eq!(
            decode_bridge_instruction(&initialize_bytes).unwrap(),
            initialize
        );

        let deposit = BridgeInstruction::AcceptDepositClaim(Box::new(deposit_message(&config)));
        let deposit_bytes = deposit.encode().unwrap();
        assert_eq!(decode_bridge_instruction(&deposit_bytes).unwrap(), deposit);
        assert_eq!(
            process_instruction_boundary(&deposit_bytes),
            Err(EntrypointError::InstructionExecutionDisabled)
        );

        let withdrawal_message = withdrawal_message(&config);
        let burn = BurnChecked {
            token_program_id: config.mint_binding.token_program_id,
            mint: config.mint_binding.mint,
            authority: h(42),
            amount_atomic: withdrawal_message.amount_atomic,
            decimals: config.mint_binding.decimals,
        };
        let withdrawal = BridgeInstruction::RecordWithdrawalRequest {
            message: Box::new(withdrawal_message),
            burn,
        };
        let withdrawal_bytes = withdrawal.encode().unwrap();
        assert_eq!(
            decode_bridge_instruction(&withdrawal_bytes).unwrap(),
            withdrawal
        );

        let mut trailing = deposit_bytes;
        trailing.push(0);
        assert_eq!(
            decode_bridge_instruction(&trailing),
            Err(EntrypointError::InvalidInstructionLength {
                expected: 1 + bridge_messages::MESSAGE_LENGTH,
                found: 2 + bridge_messages::MESSAGE_LENGTH,
            })
        );
    }

    #[test]
    fn mint_authority_derivation_uses_solana_pda_seeds_and_bump() {
        let manager_program_id = h(1);
        let mint = h(2);
        let (derived, bump) = derive_mint_authority_pda_with_bump(&manager_program_id, &mint);
        let manager_program_id = Pubkey::new_from_array(manager_program_id);
        let mint = Pubkey::new_from_array(mint);
        let expected = Pubkey::create_program_address(
            &[MINT_AUTHORITY_PDA_SEED_PREFIX, mint.as_ref(), &[bump]],
            &manager_program_id,
        )
        .unwrap();

        assert_eq!(derived, expected.to_bytes());
        assert_ne!(derived, [0u8; 32]);
    }

    #[test]
    fn bridge_account_codecs_round_trip_and_reject_malformed_data() {
        let config = base_config();
        let state = BridgeStateAccount {
            state: ProgramState::LocalnetTesting,
            config: config.clone(),
            minted_supply: 55,
            burned_unpaid_withdrawals: 13,
        };
        let state_bytes = encode_bridge_state_account(&state).unwrap();
        assert_eq!(state_bytes.len(), BRIDGE_STATE_ACCOUNT_LENGTH);
        assert_eq!(decode_bridge_state_account(&state_bytes).unwrap(), state);

        let mut wrong_magic = state_bytes.clone();
        wrong_magic[0] ^= 1;
        assert_eq!(
            decode_bridge_state_account(&wrong_magic),
            Err(AccountCodecError::InvalidMagic)
        );

        let mut wrong_version = state_bytes;
        wrong_version[8] = BRIDGE_ACCOUNT_VERSION + 1;
        assert_eq!(
            decode_bridge_state_account(&wrong_version),
            Err(AccountCodecError::UnsupportedVersion)
        );

        let deposit = DepositClaimRecord {
            operation_id: h(10),
            message_digest: h(11),
            amount_atomic: 144,
            recipient: vec![1, 2, 3],
        };
        let deposit_bytes = encode_deposit_claim_account(&deposit).unwrap();
        assert_eq!(deposit_bytes.len(), DEPOSIT_CLAIM_ACCOUNT_LENGTH);
        assert_eq!(
            decode_deposit_claim_account(&deposit_bytes).unwrap(),
            DepositClaimAccount {
                record: deposit.clone()
            }
        );

        let mut alternate_padding = deposit_bytes;
        let padding_index = 8 + 1 + 32 + 32 + 8 + 2 + deposit.recipient.len();
        alternate_padding[padding_index] = 9;
        assert_eq!(
            decode_deposit_claim_account(&alternate_padding),
            Err(AccountCodecError::InvalidEncoding)
        );

        let overlong_deposit = DepositClaimRecord {
            recipient: vec![7; MAX_DESTINATION_LENGTH + 1],
            ..deposit
        };
        assert_eq!(
            encode_deposit_claim_account(&overlong_deposit),
            Err(AccountCodecError::InvalidEncoding)
        );

        let withdrawal = WithdrawalRecord {
            withdrawal_id: h(12),
            operation_id: h(13),
            message_digest: h(14),
            gross_amount_atomic: 233,
            fee_atomic: 1,
            native_destination: vec![4, 5, 6, 7],
            burn_authority: h(15),
        };
        let withdrawal_bytes = encode_withdrawal_record_account(&withdrawal).unwrap();
        assert_eq!(withdrawal_bytes.len(), WITHDRAWAL_RECORD_ACCOUNT_LENGTH);
        assert_eq!(
            decode_withdrawal_record_account(&withdrawal_bytes).unwrap(),
            WithdrawalRecordAccount { record: withdrawal }
        );

        let truncated = &withdrawal_bytes[..WITHDRAWAL_RECORD_ACCOUNT_LENGTH - 1];
        assert_eq!(
            decode_withdrawal_record_account(truncated),
            Err(AccountCodecError::InvalidAccountLength {
                expected: WITHDRAWAL_RECORD_ACCOUNT_LENGTH,
                found: WITHDRAWAL_RECORD_ACCOUNT_LENGTH - 1,
            })
        );
    }

    #[test]
    fn initialization_enforces_zero_supply_pda_and_no_freeze_authority() {
        let mut program = BridgeProgram::new();
        let mut config = base_config();
        config.mint_binding.initial_supply = 1;
        assert_eq!(
            program.initialize(config),
            Err(BridgeError::InitialSupplyMustBeZero)
        );

        let mut program = BridgeProgram::new();
        let mut config = base_config();
        config.mint_binding.freeze_authority = Some(h(99));
        assert_eq!(
            program.initialize(config),
            Err(BridgeError::FreezeAuthorityMustBeNone)
        );

        let mut program = BridgeProgram::new();
        let mut config = base_config();
        config.mint_binding.mint_authority_pda = h(98);
        assert_eq!(
            program.initialize(config),
            Err(BridgeError::MintAuthorityMismatch)
        );
    }

    #[test]
    fn initialization_rejects_reinitialization_and_keeps_mainnet_disabled() {
        let mut program = BridgeProgram::new();
        let config = base_config();
        program.initialize(config.clone()).unwrap();
        assert_eq!(
            program.initialize(config),
            Err(BridgeError::AlreadyInitialized)
        );

        let mut mainnet_config = base_config();
        mainnet_config.environment = BridgeEnvironment::Mainnet;
        mainnet_config.mainnet_activation_enabled = true;
        let mut mainnet_program = BridgeProgram::new();
        assert_eq!(
            mainnet_program.initialize(mainnet_config),
            Err(BridgeError::MainnetActivationDisabled)
        );

        let mut disabled_mainnet = base_config();
        disabled_mainnet.environment = BridgeEnvironment::Mainnet;
        disabled_mainnet.mainnet_activation_enabled = false;
        let mut mainnet_program = BridgeProgram::new();
        mainnet_program
            .initialize(disabled_mainnet.clone())
            .unwrap();
        assert_eq!(mainnet_program.state(), &ProgramState::Phase0Disabled);
        let mut transceiver = transceiver(&disabled_mainnet);
        let message = deposit_message(&disabled_mainnet);
        let account_context = accounts(&disabled_mainnet);
        assert_eq!(
            mainnet_program.accept_deposit_claim(&mut transceiver, &message, &account_context),
            Err(BridgeError::ActivationDisabled)
        );
    }

    #[test]
    fn bridge_consumes_transceiver_receipt_and_mints_once() {
        let config = base_config();
        let accounts = accounts(&config);
        let mut bridge = BridgeProgram::new();
        bridge.initialize(config.clone()).unwrap();
        let mut transceiver = transceiver(&config);
        let message = deposit_message(&config);
        let digest = message.message_digest().unwrap();
        transceiver
            .verify_message(&message, &observations(&config, digest))
            .unwrap();

        let record = bridge
            .accept_deposit_claim(&mut transceiver, &message, &accounts)
            .unwrap();
        assert_eq!(record.amount_atomic, 5_000);
        assert_eq!(bridge.minted_supply(), 5_000);
        assert_eq!(bridge.deposit_claim_count(), 1);
        assert_eq!(
            bridge.accept_deposit_claim(&mut transceiver, &message, &accounts),
            Err(BridgeError::Replay)
        );
    }

    #[test]
    fn bridge_rejects_missing_or_wrong_receipt() {
        let config = base_config();
        let accounts = accounts(&config);
        let mut bridge = BridgeProgram::new();
        bridge.initialize(config.clone()).unwrap();
        let mut transceiver = transceiver(&config);
        let message = deposit_message(&config);
        assert_eq!(
            bridge.accept_deposit_claim(&mut transceiver, &message, &accounts),
            Err(BridgeError::MissingReceipt)
        );
    }

    #[test]
    fn bridge_rejects_wrong_accounts_and_aliasing() {
        let config = base_config();
        let mut bridge = BridgeProgram::new();
        bridge.initialize(config.clone()).unwrap();
        let mut bad_accounts = accounts(&config);
        bad_accounts.mint = h(88);
        assert_eq!(
            validate_accounts(&config, &bad_accounts),
            Err(BridgeError::AccountMismatch)
        );

        let mut alias = accounts(&config);
        alias.writable_accounts.push(config.manager_program_id);
        assert_eq!(
            validate_accounts(&config, &alias),
            Err(BridgeError::AccountAliasing)
        );
    }

    #[test]
    fn atomic_withdrawal_record_requires_matching_burn() {
        let config = base_config();
        let accounts = accounts(&config);
        let mut bridge = BridgeProgram::new();
        bridge.initialize(config.clone()).unwrap();
        let message = withdrawal_message(&config);
        let burn = BurnChecked {
            token_program_id: config.mint_binding.token_program_id,
            mint: config.mint_binding.mint,
            authority: h(42),
            amount_atomic: message.amount_atomic,
            decimals: config.mint_binding.decimals,
        };
        let record = bridge
            .record_withdrawal_request(&message, &burn, &accounts)
            .unwrap();
        assert_eq!(record.gross_amount_atomic, 4_000);
        assert_eq!(bridge.withdrawal_count(), 1);
        assert_eq!(bridge.burned_unpaid_withdrawals(), 4_000);
        assert_eq!(
            bridge.record_withdrawal_request(&message, &burn, &accounts),
            Err(BridgeError::Replay)
        );

        let mut second_bridge = BridgeProgram::new();
        second_bridge.initialize(config.clone()).unwrap();
        let mut wrong_burn = burn;
        wrong_burn.amount_atomic += 1;
        assert_eq!(
            second_bridge.record_withdrawal_request(&message, &wrong_burn, &accounts),
            Err(BridgeError::BurnMismatch)
        );
        assert_eq!(second_bridge.withdrawal_count(), 0);
    }

    #[test]
    fn direct_burn_without_bridge_record_creates_no_withdrawal_entitlement() {
        let config = base_config();
        let mut bridge = BridgeProgram::new();
        bridge.initialize(config).unwrap();
        assert_eq!(bridge.withdrawal_count(), 0);
        assert_eq!(bridge.burned_unpaid_withdrawals(), 0);
    }

    #[test]
    fn epoch_rotation_does_not_erase_replay_markers() {
        let config = base_config();
        let accounts = accounts(&config);
        let mut bridge = BridgeProgram::new();
        bridge.initialize(config.clone()).unwrap();
        let mut transceiver = transceiver(&config);
        let message = deposit_message(&config);
        let digest = message.message_digest().unwrap();
        transceiver
            .verify_message(&message, &observations(&config, digest))
            .unwrap();
        bridge
            .accept_deposit_claim(&mut transceiver, &message, &accounts)
            .unwrap();
        bridge.rotate_epochs_for_test(8, 9).unwrap();
        assert_eq!(bridge.deposit_claim_count(), 1);
        assert_eq!(bridge.minted_supply(), 5_000);
    }
}
