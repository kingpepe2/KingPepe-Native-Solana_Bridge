//! KingPepe bridge manager boundary model.
//!
//! Phase 05 implements deterministic program-state validation, mint/PDA
//! authority policy, transceiver receipt consumption, deposit replay
//! protection, and atomic burn plus withdrawal recording. Mainnet activation
//! remains disabled.

#![allow(unexpected_cfgs)]

use bridge_messages::abi as wire;
use std::collections::{BTreeMap, BTreeSet};

use bridge_messages::{
    BridgeAction, BridgeDirection, CanonicalBridgeMessage, Hash32, PubkeyBytes,
    MAX_DESTINATION_LENGTH,
};
use kingpepe_transceiver::{TransceiverError, TransceiverProgram, VerifiedMessageReceipt};
use solana_program::{
    account_info::AccountInfo,
    declare_id,
    entrypoint::ProgramResult,
    program::invoke,
    program::invoke_signed,
    program_error::ProgramError,
    program_option::COption,
    program_pack::Pack,
    pubkey::Pubkey,
    sysvar::{clock::Clock, rent::Rent, Sysvar},
};
use solana_system_interface::{instruction as system_instruction, program as system_program};
use spl_token::state::{Account as TokenAccount, Mint as TokenMint};
use spl_token_interface as spl_token;
use thiserror::Error;

declare_id!("EfoRF4BDDspsi53XYL62mCyhCtf3FceV5LpRkRdwYqKM");

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

pub const PROGRAM_NAME: &str = "kingpepe_bridge";
pub const LOCALNET_PROGRAM_ID_BASE58: &str = "EfoRF4BDDspsi53XYL62mCyhCtf3FceV5LpRkRdwYqKM";
pub const PROGRAM_ABI_STATUS: &str = "ECONOMIC_ABI_ENABLED";
pub const BRIDGE_INSTRUCTION_INITIALIZE: u8 = 1;
pub const BRIDGE_INSTRUCTION_ACCEPT_DEPOSIT_CLAIM: u8 = 2;
pub const BRIDGE_INSTRUCTION_RECORD_WITHDRAWAL_REQUEST: u8 = 3;
// Initialization omits the mandatory None freeze authority and zero premine.
// Persisted state keeps its existing full, validated configuration layout.
pub const BRIDGE_CONFIG_INSTRUCTION_LENGTH: usize = 207;
pub const BRIDGE_CONFIG_STATE_LENGTH: usize = 256;
pub const BURN_CHECKED_INSTRUCTION_LENGTH: usize = 105;
pub const BRIDGE_STATE_PDA_SEED_PREFIX: &[u8] = b"kingpepe-bridge-state";
pub const DEPOSIT_CLAIM_PDA_SEED_PREFIX: &[u8] = b"kingpepe-deposit-claim";
pub const DEPOSIT_BACKING_PDA_SEED_PREFIX: &[u8] = b"kingpepe-deposit-backing";
pub const DEPOSIT_BACKING_MARKER_LENGTH: usize = 8 + 1 + 32 + 32;
pub const MINT_AUTHORITY_PDA_SEED_PREFIX: &[u8] = b"kingpepe-mint-authority";
pub const WITHDRAWAL_RECORD_PDA_SEED_PREFIX: &[u8] = b"kingpepe-withdrawal-record";
pub const BRIDGE_ACCOUNT_VERSION: u8 = 1;
pub const BRIDGE_STATE_ACCOUNT_MAGIC: [u8; 8] = *b"KPBSTAT1";
pub const DEPOSIT_CLAIM_ACCOUNT_MAGIC: [u8; 8] = *b"KPBCLM01";
pub const WITHDRAWAL_RECORD_ACCOUNT_MAGIC: [u8; 8] = *b"KPBWDR01";
pub const BRIDGE_STATE_ACCOUNT_LENGTH: usize = 8 + 1 + 1 + BRIDGE_CONFIG_STATE_LENGTH + 16 + 16;
pub const DEPOSIT_CLAIM_ACCOUNT_LENGTH: usize = 8 + 1 + 32 + 32 + 8 + 2 + MAX_DESTINATION_LENGTH;
pub const WITHDRAWAL_RECORD_ACCOUNT_LENGTH: usize =
    8 + 1 + 32 + 32 + 32 + 8 + 8 + 2 + MAX_DESTINATION_LENGTH + 32;
pub const KPEPE_SYMBOL: &str = "KPEPE";
pub const KPEPE_NAME: &str = "KingPepe";
pub const EXPECTED_INITIAL_SUPPLY: u128 = 0;
pub const PROJECT_BRIDGE_FEE_ATOMIC: u64 = 0;

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    process_instruction_accounts(program_id, accounts, instruction_data).map_err(ProgramError::from)
}

pub fn process_instruction_boundary(instruction_data: &[u8]) -> Result<(), EntrypointError> {
    let _instruction = decode_bridge_instruction(instruction_data)?;
    Ok(())
}

pub fn process_instruction_accounts(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> Result<(), EntrypointError> {
    process_instruction_accounts_with_token_cpi(
        program_id,
        accounts,
        instruction_data,
        TokenCpiMode::Invoke,
    )
}

pub fn decode_bridge_instruction(data: &[u8]) -> Result<BridgeInstruction, EntrypointError> {
    let tag = *data.first().ok_or(EntrypointError::EmptyInstruction)?;
    let expected = match tag {
        BRIDGE_INSTRUCTION_INITIALIZE => 1 + BRIDGE_CONFIG_INSTRUCTION_LENGTH,
        BRIDGE_INSTRUCTION_ACCEPT_DEPOSIT_CLAIM => 1 + bridge_messages::MESSAGE_LENGTH,
        BRIDGE_INSTRUCTION_RECORD_WITHDRAWAL_REQUEST => {
            1 + bridge_messages::MESSAGE_LENGTH + BURN_CHECKED_INSTRUCTION_LENGTH
        }
        other => return Err(EntrypointError::UnsupportedInstructionTag(other)),
    };
    if data.len() != expected {
        return Err(EntrypointError::InvalidInstructionLength {
            expected,
            found: data.len(),
        });
    }
    match tag {
        BRIDGE_INSTRUCTION_INITIALIZE => {
            let value: wire::BridgeInitializeWire =
                borsh::from_slice(data).map_err(|_| EntrypointError::InvalidInstructionEncoding)?;
            Ok(BridgeInstruction::Initialize(bridge_config_from_wire(
                wire::BridgeConfigWire {
                    binding: value.binding,
                    freeze_tag: 0,
                    freeze_key: [0; 32],
                    initial_supply: 0,
                    policy: value.policy,
                },
            )?))
        }
        BRIDGE_INSTRUCTION_ACCEPT_DEPOSIT_CLAIM => {
            let value: wire::AcceptDepositClaimWire =
                borsh::from_slice(data).map_err(|_| EntrypointError::InvalidInstructionEncoding)?;
            let message = CanonicalBridgeMessage::decode(&value.message)
                .map_err(|_| EntrypointError::InvalidCanonicalMessage)?;
            Ok(BridgeInstruction::AcceptDepositClaim(Box::new(message)))
        }
        BRIDGE_INSTRUCTION_RECORD_WITHDRAWAL_REQUEST => {
            let value: wire::RecordWithdrawalWire =
                borsh::from_slice(data).map_err(|_| EntrypointError::InvalidInstructionEncoding)?;
            let message = CanonicalBridgeMessage::decode(&value.message)
                .map_err(|_| EntrypointError::InvalidCanonicalMessage)?;
            Ok(BridgeInstruction::RecordWithdrawalRequest {
                message: Box::new(message),
                burn: burn_from_wire(value.burn),
            })
        }
        _ => unreachable!("instruction tag checked"),
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
        let encoded = match self {
            Self::Initialize(config) => {
                if config.mint_binding.freeze_authority.is_some()
                    || config.mint_binding.initial_supply != 0
                {
                    return Err(EntrypointError::InvalidInstructionEncoding);
                }
                let config = bridge_config_wire(config);
                borsh::to_vec(&wire::BridgeInitializeWire {
                    tag: BRIDGE_INSTRUCTION_INITIALIZE,
                    binding: config.binding,
                    policy: config.policy,
                })
            }
            Self::AcceptDepositClaim(message) => borsh::to_vec(&wire::AcceptDepositClaimWire {
                tag: BRIDGE_INSTRUCTION_ACCEPT_DEPOSIT_CLAIM,
                message: message
                    .encode()
                    .map_err(|_| EntrypointError::InvalidCanonicalMessage)?
                    .try_into()
                    .map_err(|_| EntrypointError::InvalidCanonicalMessage)?,
            }),
            Self::RecordWithdrawalRequest { message, burn } => {
                borsh::to_vec(&wire::RecordWithdrawalWire {
                    tag: BRIDGE_INSTRUCTION_RECORD_WITHDRAWAL_REQUEST,
                    message: message
                        .encode()
                        .map_err(|_| EntrypointError::InvalidCanonicalMessage)?
                        .try_into()
                        .map_err(|_| EntrypointError::InvalidCanonicalMessage)?,
                    burn: burn_wire(burn),
                })
            }
        };
        encoded.map_err(|_| EntrypointError::InvalidInstructionEncoding)
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

fn bridge_config_wire(config: &BridgeConfig) -> wire::BridgeConfigWire {
    let mint = &config.mint_binding;
    wire::BridgeConfigWire {
        binding: wire::BridgeBindingWire {
            environment: encode_bridge_environment(&config.environment),
            manager_program_id: config.manager_program_id,
            transceiver_program_id: config.transceiver_program_id,
            solana_deployment: config.solana_deployment,
            mint: mint.mint,
            token_program_id: mint.token_program_id,
            mint_authority_pda: mint.mint_authority_pda,
            decimals: mint.decimals,
            native_decimals: mint.native_decimals,
        },
        freeze_tag: u8::from(mint.freeze_authority.is_some()),
        freeze_key: mint.freeze_authority.unwrap_or([0; 32]),
        initial_supply: mint.initial_supply,
        policy: wire::BridgePolicyWire {
            policy_epoch: config.policy_epoch,
            key_epoch: config.key_epoch,
            deposits_paused: config.deposits_paused,
            withdrawals_paused: config.withdrawals_paused,
            hard_stop: config.hard_stop,
            mainnet_activation_enabled: config.mainnet_activation_enabled,
        },
    }
}

fn bridge_config_from_wire(value: wire::BridgeConfigWire) -> Result<BridgeConfig, EntrypointError> {
    let b = value.binding;
    let p = value.policy;
    let freeze_authority = match value.freeze_tag {
        0 if value.freeze_key == [0; 32] => None,
        1 => Some(value.freeze_key),
        _ => return Err(EntrypointError::InvalidInstructionEncoding),
    };
    Ok(BridgeConfig {
        environment: decode_bridge_environment(b.environment)?,
        manager_program_id: b.manager_program_id,
        transceiver_program_id: b.transceiver_program_id,
        solana_deployment: b.solana_deployment,
        mint_binding: MintBinding {
            mint: b.mint,
            token_program_id: b.token_program_id,
            mint_authority_pda: b.mint_authority_pda,
            decimals: b.decimals,
            native_decimals: b.native_decimals,
            freeze_authority,
            initial_supply: value.initial_supply,
        },
        policy_epoch: p.policy_epoch,
        key_epoch: p.key_epoch,
        deposits_paused: p.deposits_paused,
        withdrawals_paused: p.withdrawals_paused,
        hard_stop: p.hard_stop,
        mainnet_activation_enabled: p.mainnet_activation_enabled,
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
    /// Bridge-issued units minus bridge-recorded burns, not live SPL supply.
    /// Direct SPL burns do not erase the separately reconciled difference.
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
    consumed_deposit_backing: BTreeSet<PubkeyBytes>,
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
        let backing = derive_deposit_backing_pda(message);
        if self.deposit_claims.contains_key(&message.operation_id)
            || self.consumed_deposit_backing.contains(&backing)
        {
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

        let minted_supply = self
            .minted_supply
            .checked_add(message.amount_atomic as u128)
            .ok_or(BridgeError::ArithmeticOverflow)?;
        transceiver
            .consume_receipt(&digest)
            .map_err(BridgeError::Transceiver)?;
        let record = DepositClaimRecord {
            operation_id: message.operation_id,
            message_digest: digest,
            amount_atomic: message.amount_atomic,
            recipient: message.destination.clone(),
        };
        self.minted_supply = minted_supply;
        self.deposit_claims
            .insert(message.operation_id, record.clone());
        self.consumed_receipts.insert(digest);
        self.consumed_deposit_backing.insert(backing);
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

        let supply_after_burn = self
            .minted_supply
            .checked_sub(message.amount_atomic as u128)
            .ok_or(BridgeError::BurnMismatch)?;
        let unpaid_after_burn = self
            .burned_unpaid_withdrawals
            .checked_add(message.amount_atomic as u128)
            .ok_or(BridgeError::ArithmeticOverflow)?;

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
        self.burned_unpaid_withdrawals = unpaid_after_burn;
        self.minted_supply = supply_after_burn;
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
        require_ready_for_action(&self.state, config, true)?;
        Ok(config)
    }

    fn require_ready_for_withdrawals(&self) -> Result<&BridgeConfig, BridgeError> {
        let config = self.config.as_ref().ok_or(BridgeError::Uninitialized)?;
        require_ready_for_action(&self.state, config, false)?;
        Ok(config)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TokenCpiMode {
    Invoke,
    #[cfg(test)]
    SkipForTest,
}

fn require_ready_for_action(
    state: &ProgramState,
    config: &BridgeConfig,
    deposit: bool,
) -> Result<(), BridgeError> {
    if *state != ProgramState::LocalnetTesting
        || config.environment != BridgeEnvironment::Localnet
        || config.mainnet_activation_enabled
    {
        return Err(BridgeError::ActivationDisabled);
    }
    if config.hard_stop
        || (deposit && config.deposits_paused)
        || (!deposit && config.withdrawals_paused)
    {
        return Err(BridgeError::PausedOrHardStopped);
    }
    Ok(())
}

fn validate_message_time(message: &CanonicalBridgeMessage, now: u64) -> Result<(), BridgeError> {
    if now < message.valid_from || now > message.valid_until {
        return Err(BridgeError::MessageValidityWindow);
    }
    Ok(())
}

fn validate_onchain_message_time(
    message: &CanonicalBridgeMessage,
    mode: TokenCpiMode,
) -> Result<(), EntrypointError> {
    #[cfg(test)]
    if mode == TokenCpiMode::SkipForTest {
        // Account-model unit tests have no runtime sysvars. The real entrypoint
        // always uses Invoke, and this variant does not exist in the SBF binary.
        return validate_message_time(message, 1).map_err(Into::into);
    }
    let _ = mode;
    let now = Clock::get()
        .map_err(|_| EntrypointError::InvalidAccountData)?
        .unix_timestamp;
    let now = u64::try_from(now).map_err(|_| EntrypointError::InvalidAccountData)?;
    validate_message_time(message, now).map_err(Into::into)
}

fn process_instruction_accounts_with_token_cpi(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
    token_cpi_mode: TokenCpiMode,
) -> Result<(), EntrypointError> {
    match decode_bridge_instruction(instruction_data)? {
        BridgeInstruction::Initialize(config) => {
            process_initialize_accounts(program_id, accounts, config)
        }
        BridgeInstruction::AcceptDepositClaim(message) => {
            process_accept_deposit_claim_accounts(program_id, accounts, *message, token_cpi_mode)
        }
        BridgeInstruction::RecordWithdrawalRequest { message, burn } => {
            process_record_withdrawal_accounts(program_id, accounts, *message, burn, token_cpi_mode)
        }
    }
}

fn process_initialize_accounts(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    config: BridgeConfig,
) -> Result<(), EntrypointError> {
    validate_config(&config)?;
    if config.manager_program_id != program_id.to_bytes() {
        return Err(EntrypointError::AccountKeyMismatch);
    }

    let mut account_iter = accounts.iter();
    let bridge_state = next_required_account(&mut account_iter)?;
    let mint = next_required_account(&mut account_iter)?;
    let token_program = next_required_account(&mut account_iter)?;
    let (payer, system_program_account) = optional_payer_and_system(&mut account_iter)?;

    // Initial enrollment requires the exact Mint account to sign. An arbitrary
    // fee payer cannot seize configuration for a Mint already chosen by users.
    // SPL mint authority remains the bridge PDA, not this enrollment key.
    require_account_key(mint, &config.mint_binding.mint)?;
    require_signer(mint)?;
    require_writable(bridge_state)?;
    let bridge_state_pda =
        derive_bridge_state_pda(&config.manager_program_id, &config.mint_binding.mint);
    let mint_pubkey = Pubkey::new_from_array(config.mint_binding.mint);
    let (_bridge_state_pda_with_bump, bridge_state_bump) = Pubkey::find_program_address(
        &[BRIDGE_STATE_PDA_SEED_PREFIX, mint_pubkey.as_ref()],
        program_id,
    );
    ensure_program_pda_account(
        bridge_state,
        payer,
        system_program_account,
        program_id,
        &bridge_state_pda,
        &[
            BRIDGE_STATE_PDA_SEED_PREFIX,
            mint_pubkey.as_ref(),
            &[bridge_state_bump],
        ],
        BRIDGE_STATE_ACCOUNT_LENGTH,
    )?;
    require_zeroed_account(bridge_state)?;
    require_account_key(token_program, &config.mint_binding.token_program_id)?;
    validate_mint_account(mint, &config)?;

    let mut bridge = BridgeProgram::new();
    bridge.initialize(config.clone())?;
    let state = BridgeStateAccount {
        state: bridge.state().clone(),
        config,
        minted_supply: bridge.minted_supply(),
        burned_unpaid_withdrawals: bridge.burned_unpaid_withdrawals(),
    };
    write_account_data(bridge_state, &encode_bridge_state_account(&state)?)?;
    Ok(())
}

fn process_accept_deposit_claim_accounts(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    message: CanonicalBridgeMessage,
    token_cpi_mode: TokenCpiMode,
) -> Result<(), EntrypointError> {
    let mut account_iter = accounts.iter();
    let bridge_state = next_required_account(&mut account_iter)?;
    let deposit_claim = next_required_account(&mut account_iter)?;
    let receipt_account = next_required_account(&mut account_iter)?;
    let mint = next_required_account(&mut account_iter)?;
    let recipient_token_account = next_required_account(&mut account_iter)?;
    let mint_authority_pda = next_required_account(&mut account_iter)?;
    let token_program = next_required_account(&mut account_iter)?;
    let transceiver_program = next_required_account(&mut account_iter)?;
    let backing_marker = next_required_account(&mut account_iter)?;
    let (payer, system_program_account) = optional_payer_and_system(&mut account_iter)?;

    require_writable(bridge_state)?;
    require_writable(deposit_claim)?;
    require_writable(mint)?;
    require_writable(recipient_token_account)?;
    require_writable(backing_marker)?;
    require_account_owner(bridge_state, program_id)?;
    require_account_len(bridge_state, BRIDGE_STATE_ACCOUNT_LENGTH)?;

    let mut state = read_bridge_state_account(bridge_state)?;
    require_ready_for_action(&state.state, &state.config, true)?;
    validate_onchain_message_time(&message, token_cpi_mode)?;
    if state.config.manager_program_id != program_id.to_bytes() {
        return Err(EntrypointError::AccountKeyMismatch);
    }
    let config = state.config.clone();
    validate_message_domain(&config, &message)?;
    if message.direction != BridgeDirection::NativeToSolana
        || message.action != BridgeAction::DepositClaim
    {
        return Err(BridgeError::WrongMessageKind.into());
    }
    require_account_key(
        bridge_state,
        &derive_bridge_state_pda(&config.manager_program_id, &config.mint_binding.mint),
    )?;
    let deposit_claim_pda =
        derive_deposit_claim_pda(&config.manager_program_id, &message.operation_id);
    require_account_key(deposit_claim, &deposit_claim_pda)?;
    let operation_id_pubkey = Pubkey::new_from_array(message.operation_id);
    let (_deposit_claim_pda_with_bump, deposit_claim_bump) = Pubkey::find_program_address(
        &[DEPOSIT_CLAIM_PDA_SEED_PREFIX, operation_id_pubkey.as_ref()],
        program_id,
    );
    ensure_program_pda_account(
        deposit_claim,
        payer,
        system_program_account,
        program_id,
        &deposit_claim_pda,
        &[
            DEPOSIT_CLAIM_PDA_SEED_PREFIX,
            operation_id_pubkey.as_ref(),
            &[deposit_claim_bump],
        ],
        DEPOSIT_CLAIM_ACCOUNT_LENGTH,
    )?;
    require_zeroed_account(deposit_claim)?;
    // This PDA deliberately excludes nonce, validity, evidence and epochs.
    // A new authorization envelope can never credit the same Native outpoint
    // twice for this Mint. There is no instruction which closes this marker.
    let output_index = message.deposit_outpoint.vout.to_le_bytes();
    let backing_seeds: &[&[u8]] = &[
        DEPOSIT_BACKING_PDA_SEED_PREFIX,
        &message.deployment.mint,
        &message.deployment.native_genesis,
        &message.deposit_outpoint.txid,
        &output_index,
    ];
    let (backing_pda, backing_bump) = Pubkey::find_program_address(backing_seeds, program_id);
    ensure_program_pda_account(
        backing_marker,
        payer,
        system_program_account,
        program_id,
        &backing_pda.to_bytes(),
        &[
            DEPOSIT_BACKING_PDA_SEED_PREFIX,
            &message.deployment.mint,
            &message.deployment.native_genesis,
            &message.deposit_outpoint.txid,
            &output_index,
            &[backing_bump],
        ],
        DEPOSIT_BACKING_MARKER_LENGTH,
    )?;
    require_zeroed_account(backing_marker)?;
    require_account_key(transceiver_program, &config.transceiver_program_id)?;
    require_account_owner(
        receipt_account,
        &Pubkey::new_from_array(config.transceiver_program_id),
    )?;
    require_account_key(
        receipt_account,
        &kingpepe_transceiver::derive_verified_receipt_pda(
            &config.transceiver_program_id,
            &message
                .message_digest()
                .map_err(|_| BridgeError::InvalidMessage)?,
        ),
    )?;

    let account_context = account_context_from_infos(
        &config,
        program_id,
        mint,
        mint_authority_pda.key.to_bytes(),
        token_program,
        &[
            bridge_state,
            deposit_claim,
            backing_marker,
            recipient_token_account,
        ],
    )?;
    validate_accounts(&config, &account_context)?;
    let digest = message
        .message_digest()
        .map_err(|_| BridgeError::InvalidMessage)?;
    let receipt = read_verified_receipt_account(receipt_account)?.receipt;
    validate_receipt(&config, &receipt, &message, digest)?;
    if message.destination.as_slice() != recipient_token_account.key.as_ref() {
        return Err(BridgeError::AccountMismatch.into());
    }
    validate_recipient_token_account(recipient_token_account, mint.key)?;

    let issued_after_mint = checked_issued_after_mint(
        state.minted_supply,
        unpack_mint(mint)?.supply,
        message.amount_atomic,
    )?;

    invoke_mint_to_checked_if_enabled(
        &config,
        mint,
        recipient_token_account,
        mint_authority_pda,
        token_program,
        message.amount_atomic,
        token_cpi_mode,
    )?;

    state.minted_supply = issued_after_mint;
    let record = DepositClaimRecord {
        operation_id: message.operation_id,
        message_digest: digest,
        amount_atomic: message.amount_atomic,
        recipient: message.destination,
    };
    write_account_data(deposit_claim, &encode_deposit_claim_account(&record)?)?;
    let backing_data = borsh::to_vec(&wire::DepositBackingWire {
        magic: *b"KPBBAK01",
        version: BRIDGE_ACCOUNT_VERSION,
        operation_id: message.operation_id,
        message_digest: digest,
    })
    .map_err(|_| EntrypointError::InvalidInstructionEncoding)?;
    write_account_data(backing_marker, &backing_data)?;
    write_account_data(bridge_state, &encode_bridge_state_account(&state)?)?;
    Ok(())
}

fn process_record_withdrawal_accounts(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    message: CanonicalBridgeMessage,
    burn: BurnChecked,
    token_cpi_mode: TokenCpiMode,
) -> Result<(), EntrypointError> {
    let mut account_iter = accounts.iter();
    let bridge_state = next_required_account(&mut account_iter)?;
    let withdrawal_record = next_required_account(&mut account_iter)?;
    let source_token_account = next_required_account(&mut account_iter)?;
    let mint = next_required_account(&mut account_iter)?;
    let burn_authority = next_required_account(&mut account_iter)?;
    let token_program = next_required_account(&mut account_iter)?;
    let transceiver_config = next_required_account(&mut account_iter)?;
    let payer = next_required_account(&mut account_iter)?;
    let system_program_account = next_required_account(&mut account_iter)?;
    require_no_extra_accounts(&mut account_iter)?;

    require_writable(bridge_state)?;
    require_writable(withdrawal_record)?;
    require_writable(source_token_account)?;
    require_writable(mint)?;
    require_signer(burn_authority)?;
    require_account_owner(bridge_state, program_id)?;
    require_account_len(bridge_state, BRIDGE_STATE_ACCOUNT_LENGTH)?;
    require_signer(payer)?;
    require_writable(payer)?;
    require_account_key(system_program_account, &system_program::id().to_bytes())?;
    // The user's signer may also pay rent; no economic account may be a payer.
    for account in [
        bridge_state,
        withdrawal_record,
        source_token_account,
        mint,
        token_program,
        transceiver_config,
        system_program_account,
    ] {
        if payer.key == account.key || burn_authority.key == account.key {
            return Err(BridgeError::AccountAliasing.into());
        }
    }

    let mut state = read_bridge_state_account(bridge_state)?;
    require_ready_for_action(&state.state, &state.config, false)?;
    validate_onchain_message_time(&message, token_cpi_mode)?;
    if state.config.manager_program_id != program_id.to_bytes() {
        return Err(EntrypointError::AccountKeyMismatch);
    }
    let config = state.config.clone();
    require_account_key(
        bridge_state,
        &derive_bridge_state_pda(&config.manager_program_id, &config.mint_binding.mint),
    )?;
    require_account_key(
        withdrawal_record,
        &derive_withdrawal_record_pda(&config.manager_program_id, &message.withdrawal_id),
    )?;
    require_account_key(token_program, &config.mint_binding.token_program_id)?;
    require_account_key(mint, &config.mint_binding.mint)?;
    require_account_key(burn_authority, &burn.authority)?;

    let account_context = account_context_from_infos(
        &config,
        program_id,
        mint,
        config.mint_binding.mint_authority_pda,
        token_program,
        &[bridge_state, withdrawal_record, source_token_account],
    )?;
    validate_accounts(&config, &account_context)?;
    validate_message_domain(&config, &message)?;
    if message.direction != BridgeDirection::SolanaToNative
        || message.action != BridgeAction::WithdrawalRequest
    {
        return Err(BridgeError::WrongMessageKind.into());
    }
    validate_burn(&config, &message, &burn)?;
    validate_withdrawal_native_domain(&config, &message, transceiver_config)?;
    validate_source_token_account(
        source_token_account,
        mint.key,
        burn_authority.key,
        burn.amount_atomic,
    )?;

    // Do all accounting arithmetic before either CPI. The runtime also
    // rolls back allocation, rent, burn and these writes on ANY later failure.
    let new_unpaid = state
        .burned_unpaid_withdrawals
        .checked_add(message.amount_atomic as u128)
        .ok_or(BridgeError::ArithmeticOverflow)?;
    let issued_after_burn = checked_issued_after_burn(
        state.minted_supply,
        unpack_mint(mint)?.supply,
        burn.amount_atomic,
    )?;
    let (_, bump) = Pubkey::find_program_address(
        &[WITHDRAWAL_RECORD_PDA_SEED_PREFIX, &message.withdrawal_id],
        program_id,
    );
    ensure_program_pda_account(
        withdrawal_record,
        Some(payer),
        Some(system_program_account),
        program_id,
        &derive_withdrawal_record_pda(&config.manager_program_id, &message.withdrawal_id),
        &[
            WITHDRAWAL_RECORD_PDA_SEED_PREFIX,
            &message.withdrawal_id,
            &[bump],
        ],
        WITHDRAWAL_RECORD_ACCOUNT_LENGTH,
    )?;
    require_zeroed_account(withdrawal_record)?;

    invoke_burn_checked_if_enabled(
        source_token_account,
        mint,
        burn_authority,
        token_program,
        burn.amount_atomic,
        burn.decimals,
        token_cpi_mode,
    )?;

    let digest = message
        .message_digest()
        .map_err(|_| BridgeError::InvalidMessage)?;
    let record = WithdrawalRecord {
        withdrawal_id: message.withdrawal_id,
        operation_id: message.operation_id,
        message_digest: digest,
        gross_amount_atomic: message.amount_atomic,
        fee_atomic: message.fee_atomic,
        native_destination: message.destination,
        burn_authority: burn.authority,
    };
    state.burned_unpaid_withdrawals = new_unpaid;
    // A bridge burn changes liability form. Preserve the separately reconciled
    // direct-SPL-burn difference; it never authorizes reserve extraction.
    state.minted_supply = issued_after_burn;
    write_account_data(
        withdrawal_record,
        &encode_withdrawal_record_account(&record)?,
    )?;
    write_account_data(bridge_state, &encode_bridge_state_account(&state)?)?;
    Ok(())
}

fn checked_issued_after_mint(
    issued: u128,
    live_supply: u64,
    amount: u64,
) -> Result<u128, BridgeError> {
    if u128::from(live_supply) > issued {
        return Err(BridgeError::AccountMismatch);
    }
    live_supply
        .checked_add(amount)
        .ok_or(BridgeError::ArithmeticOverflow)?;
    issued
        .checked_add(u128::from(amount))
        .ok_or(BridgeError::ArithmeticOverflow)
}

fn checked_issued_after_burn(
    issued: u128,
    live_supply: u64,
    amount: u64,
) -> Result<u128, BridgeError> {
    if u128::from(live_supply) > issued {
        return Err(BridgeError::AccountMismatch);
    }
    live_supply
        .checked_sub(amount)
        .ok_or(BridgeError::BurnMismatch)?;
    issued
        .checked_sub(u128::from(amount))
        .ok_or(BridgeError::BurnMismatch)
}

fn validate_withdrawal_native_domain(
    config: &BridgeConfig,
    message: &CanonicalBridgeMessage,
    account: &AccountInfo,
) -> Result<(), EntrypointError> {
    require_account_owner(
        account,
        &Pubkey::new_from_array(config.transceiver_program_id),
    )?;
    require_account_key(
        account,
        &kingpepe_transceiver::derive_transceiver_config_pda(
            &config.transceiver_program_id,
            &config.mint_binding.mint,
        ),
    )?;
    let data = account
        .try_borrow_data()
        .map_err(|_| EntrypointError::AccountBorrowFailed)?;
    let transceiver = kingpepe_transceiver::decode_transceiver_config_account(&data)
        .map_err(|_| EntrypointError::InvalidAccountData)?
        .config;
    if !transceiver.active
        || transceiver.manager_program_id != config.manager_program_id
        || transceiver.transceiver_program_id != config.transceiver_program_id
        || transceiver.mint != config.mint_binding.mint
        || transceiver.solana_deployment != config.solana_deployment
        || transceiver.key_epoch != config.key_epoch
        || transceiver.protocol_id != message.deployment.protocol_id
        || transceiver.native_network != message.deployment.native_network
        || transceiver.native_genesis != message.deployment.native_genesis
    {
        return Err(BridgeError::MessageDomainMismatch.into());
    }
    Ok(())
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

pub fn derive_bridge_state_pda(
    manager_program_id: &PubkeyBytes,
    mint: &PubkeyBytes,
) -> PubkeyBytes {
    let manager_program_id = Pubkey::new_from_array(*manager_program_id);
    let mint = Pubkey::new_from_array(*mint);
    Pubkey::find_program_address(
        &[BRIDGE_STATE_PDA_SEED_PREFIX, mint.as_ref()],
        &manager_program_id,
    )
    .0
    .to_bytes()
}

pub fn derive_deposit_claim_pda(
    manager_program_id: &PubkeyBytes,
    operation_id: &Hash32,
) -> PubkeyBytes {
    let manager_program_id = Pubkey::new_from_array(*manager_program_id);
    Pubkey::find_program_address(
        &[DEPOSIT_CLAIM_PDA_SEED_PREFIX, operation_id],
        &manager_program_id,
    )
    .0
    .to_bytes()
}

pub fn derive_deposit_backing_pda(message: &CanonicalBridgeMessage) -> PubkeyBytes {
    Pubkey::find_program_address(
        &[
            DEPOSIT_BACKING_PDA_SEED_PREFIX,
            &message.deployment.mint,
            &message.deployment.native_genesis,
            &message.deposit_outpoint.txid,
            &message.deposit_outpoint.vout.to_le_bytes(),
        ],
        &Pubkey::new_from_array(message.deployment.manager_program_id),
    )
    .0
    .to_bytes()
}

pub fn derive_withdrawal_record_pda(
    manager_program_id: &PubkeyBytes,
    withdrawal_id: &Hash32,
) -> PubkeyBytes {
    let manager_program_id = Pubkey::new_from_array(*manager_program_id);
    Pubkey::find_program_address(
        &[WITHDRAWAL_RECORD_PDA_SEED_PREFIX, withdrawal_id],
        &manager_program_id,
    )
    .0
    .to_bytes()
}

fn account_context_from_infos(
    config: &BridgeConfig,
    program_id: &Pubkey,
    mint: &AccountInfo,
    mint_authority_pda: PubkeyBytes,
    token_program: &AccountInfo,
    writable_accounts: &[&AccountInfo],
) -> Result<AccountContext, EntrypointError> {
    let mint_state = unpack_mint(mint)?;
    let freeze_authority = match mint_state.freeze_authority {
        COption::Some(authority) => Some(authority.to_bytes()),
        COption::None => None,
    };
    if mint_state.mint_authority != COption::Some(Pubkey::new_from_array(mint_authority_pda)) {
        return Err(BridgeError::MintAuthorityMismatch.into());
    }
    if token_program.key.to_bytes() != config.mint_binding.token_program_id {
        return Err(BridgeError::AccountMismatch.into());
    }
    Ok(AccountContext {
        manager_program_id: program_id.to_bytes(),
        transceiver_program_id: config.transceiver_program_id,
        token_program_id: token_program.key.to_bytes(),
        mint: mint.key.to_bytes(),
        mint_authority_pda,
        mint_decimals: mint_state.decimals,
        freeze_authority,
        writable_accounts: writable_accounts
            .iter()
            .map(|account| account.key.to_bytes())
            .collect(),
    })
}

fn read_bridge_state_account(account: &AccountInfo) -> Result<BridgeStateAccount, EntrypointError> {
    require_account_len(account, BRIDGE_STATE_ACCOUNT_LENGTH)?;
    let data = account
        .try_borrow_data()
        .map_err(|_| EntrypointError::AccountBorrowFailed)?;
    Ok(decode_bridge_state_account(&data)?)
}

fn read_verified_receipt_account(
    account: &AccountInfo,
) -> Result<kingpepe_transceiver::VerifiedReceiptAccount, EntrypointError> {
    let data = account
        .try_borrow_data()
        .map_err(|_| EntrypointError::AccountBorrowFailed)?;
    Ok(kingpepe_transceiver::decode_verified_receipt_account(
        &data,
    )?)
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
    require_account_owner(payer, &system_program::id())?;
    if payer.key == account.key || payer.data_len() != 0 {
        return Err(EntrypointError::InvalidAccountData);
    }
    if system_program_account.key != &system_program::id() {
        return Err(EntrypointError::AccountKeyMismatch);
    }

    let space = u64::try_from(expected_len).map_err(|_| EntrypointError::InvalidAccountData)?;
    let lamports = Rent::get()
        .map_err(|_| EntrypointError::RentUnavailable)?
        .minimum_balance(expected_len);
    if account.lamports() == 0 {
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
    } else {
        // Anyone can send lamports to a PDA. Only an empty System account at
        // the exact derived key can take this path; occupied data never can.
        let missing = lamports.saturating_sub(account.lamports());
        if missing > 0 {
            invoke(
                &system_instruction::transfer(payer.key, account.key, missing),
                &[
                    payer.clone(),
                    account.clone(),
                    system_program_account.clone(),
                ],
            )
            .map_err(|_| EntrypointError::SystemCpiFailed)?;
        }
        invoke_signed(
            &system_instruction::allocate(account.key, space),
            &[account.clone(), system_program_account.clone()],
            &[signer_seeds],
        )
        .map_err(|_| EntrypointError::SystemCpiFailed)?;
        invoke_signed(
            &system_instruction::assign(account.key, program_id),
            &[account.clone(), system_program_account.clone()],
            &[signer_seeds],
        )
        .map_err(|_| EntrypointError::SystemCpiFailed)?;
    }
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

fn validate_mint_account(mint: &AccountInfo, config: &BridgeConfig) -> Result<(), EntrypointError> {
    require_account_owner(mint, &spl_token::id())?;
    let mint_state = unpack_mint(mint)?;
    if mint_state.supply != 0
        || mint_state.decimals != config.mint_binding.decimals
        || mint_state.freeze_authority != COption::None
        || mint_state.mint_authority
            != COption::Some(Pubkey::new_from_array(
                config.mint_binding.mint_authority_pda,
            ))
    {
        return Err(EntrypointError::InvalidAccountData);
    }
    Ok(())
}

fn validate_recipient_token_account(
    token_account: &AccountInfo,
    expected_mint: &Pubkey,
) -> Result<(), EntrypointError> {
    require_account_owner(token_account, &spl_token::id())?;
    let token_state = unpack_token_account(token_account)?;
    if token_state.mint != *expected_mint {
        return Err(BridgeError::AccountMismatch.into());
    }
    Ok(())
}

fn validate_source_token_account(
    token_account: &AccountInfo,
    expected_mint: &Pubkey,
    expected_authority: &Pubkey,
    amount_atomic: u64,
) -> Result<(), EntrypointError> {
    require_account_owner(token_account, &spl_token::id())?;
    let token_state = unpack_token_account(token_account)?;
    if token_state.mint != *expected_mint
        || token_state.owner != *expected_authority
        || token_state.amount < amount_atomic
    {
        return Err(BridgeError::BurnMismatch.into());
    }
    Ok(())
}

fn unpack_mint(mint: &AccountInfo) -> Result<TokenMint, EntrypointError> {
    let data = mint
        .try_borrow_data()
        .map_err(|_| EntrypointError::AccountBorrowFailed)?;
    TokenMint::unpack(&data).map_err(|_| EntrypointError::InvalidAccountData)
}

fn unpack_token_account(token_account: &AccountInfo) -> Result<TokenAccount, EntrypointError> {
    let data = token_account
        .try_borrow_data()
        .map_err(|_| EntrypointError::AccountBorrowFailed)?;
    TokenAccount::unpack(&data).map_err(|_| EntrypointError::InvalidAccountData)
}

fn invoke_mint_to_checked_if_enabled<'a>(
    config: &BridgeConfig,
    mint: &AccountInfo<'a>,
    recipient_token_account: &AccountInfo<'a>,
    mint_authority_pda: &AccountInfo<'a>,
    token_program: &AccountInfo<'a>,
    amount_atomic: u64,
    token_cpi_mode: TokenCpiMode,
) -> Result<(), EntrypointError> {
    require_account_key(mint, &config.mint_binding.mint)?;
    require_account_key(mint_authority_pda, &config.mint_binding.mint_authority_pda)?;
    require_account_key(token_program, &config.mint_binding.token_program_id)?;
    #[cfg(test)]
    if token_cpi_mode == TokenCpiMode::SkipForTest {
        return Ok(());
    }
    let _ = token_cpi_mode;
    let instruction = spl_token::instruction::mint_to_checked(
        token_program.key,
        mint.key,
        recipient_token_account.key,
        mint_authority_pda.key,
        &[],
        amount_atomic,
        config.mint_binding.decimals,
    )
    .map_err(|_| EntrypointError::TokenCpiFailed)?;
    let mint_pubkey = Pubkey::new_from_array(config.mint_binding.mint);
    let (_pda, bump) =
        derive_mint_authority_pda_with_bump(&config.manager_program_id, &config.mint_binding.mint);
    let signer_seeds: &[&[u8]] = &[
        MINT_AUTHORITY_PDA_SEED_PREFIX,
        mint_pubkey.as_ref(),
        &[bump],
    ];
    invoke_signed(
        &instruction,
        &[
            mint.clone(),
            recipient_token_account.clone(),
            mint_authority_pda.clone(),
            token_program.clone(),
        ],
        &[signer_seeds],
    )
    .map_err(|_| EntrypointError::TokenCpiFailed)
}

fn invoke_burn_checked_if_enabled<'a>(
    source_token_account: &AccountInfo<'a>,
    mint: &AccountInfo<'a>,
    burn_authority: &AccountInfo<'a>,
    token_program: &AccountInfo<'a>,
    amount_atomic: u64,
    decimals: u8,
    token_cpi_mode: TokenCpiMode,
) -> Result<(), EntrypointError> {
    #[cfg(test)]
    if token_cpi_mode == TokenCpiMode::SkipForTest {
        return Ok(());
    }
    let _ = token_cpi_mode;
    let instruction = spl_token::instruction::burn_checked(
        token_program.key,
        source_token_account.key,
        mint.key,
        burn_authority.key,
        &[],
        amount_atomic,
        decimals,
    )
    .map_err(|_| EntrypointError::TokenCpiFailed)?;
    invoke(
        &instruction,
        &[
            source_token_account.clone(),
            mint.clone(),
            burn_authority.clone(),
            token_program.clone(),
        ],
    )
    .map_err(|_| EntrypointError::TokenCpiFailed)
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
    if mint.mint == [0u8; 32] || mint.token_program_id != spl_token::id().to_bytes() {
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
    // The implemented Native transaction path supports P2TR outputs only.
    // An arbitrary nonempty byte string is not a supported payment script.
    if message.destination.len() != 34
        || message.destination[..2] != [0x51, 0x20]
        || message.destination[2..].iter().all(|byte| *byte == 0)
        || message.fee_atomic >= message.amount_atomic
    {
        return Err(BridgeError::BurnMismatch);
    }
    Ok(())
}

pub fn encode_bridge_state_account(
    state: &BridgeStateAccount,
) -> Result<Vec<u8>, AccountCodecError> {
    validate_config(&state.config)?;
    borsh::to_vec(&wire::BridgeStateWire {
        magic: BRIDGE_STATE_ACCOUNT_MAGIC,
        version: BRIDGE_ACCOUNT_VERSION,
        state: program_state_to_u8(&state.state),
        config: bridge_config_wire(&state.config),
        minted_supply: state.minted_supply,
        burned_unpaid_withdrawals: state.burned_unpaid_withdrawals,
    })
    .map_err(|_| AccountCodecError::InvalidEncoding)
}

fn check_account_header(
    data: &[u8],
    length: usize,
    magic: [u8; 8],
) -> Result<(), AccountCodecError> {
    if data.len() != length {
        return Err(AccountCodecError::InvalidAccountLength {
            expected: length,
            found: data.len(),
        });
    }
    if data[..8] != magic {
        return Err(AccountCodecError::InvalidMagic);
    }
    if data[8] != BRIDGE_ACCOUNT_VERSION {
        return Err(AccountCodecError::UnsupportedVersion);
    }
    Ok(())
}

pub fn decode_bridge_state_account(data: &[u8]) -> Result<BridgeStateAccount, AccountCodecError> {
    check_account_header(
        data,
        BRIDGE_STATE_ACCOUNT_LENGTH,
        BRIDGE_STATE_ACCOUNT_MAGIC,
    )?;
    let value: wire::BridgeStateWire =
        borsh::from_slice(data).map_err(|_| AccountCodecError::InvalidEncoding)?;
    let config =
        bridge_config_from_wire(value.config).map_err(|_| AccountCodecError::InvalidEncoding)?;
    validate_config(&config)?;
    Ok(BridgeStateAccount {
        state: program_state_from_u8(value.state)?,
        config,
        minted_supply: value.minted_supply,
        burned_unpaid_withdrawals: value.burned_unpaid_withdrawals,
    })
}

pub fn encode_deposit_claim_account(
    record: &DepositClaimRecord,
) -> Result<Vec<u8>, AccountCodecError> {
    borsh::to_vec(&wire::DepositClaimWire {
        magic: DEPOSIT_CLAIM_ACCOUNT_MAGIC,
        version: BRIDGE_ACCOUNT_VERSION,
        operation_id: record.operation_id,
        message_digest: record.message_digest,
        amount_atomic: record.amount_atomic,
        recipient: destination_wire(&record.recipient)?,
    })
    .map_err(|_| AccountCodecError::InvalidEncoding)
}

pub fn decode_deposit_claim_account(data: &[u8]) -> Result<DepositClaimAccount, AccountCodecError> {
    check_account_header(
        data,
        DEPOSIT_CLAIM_ACCOUNT_LENGTH,
        DEPOSIT_CLAIM_ACCOUNT_MAGIC,
    )?;
    let value: wire::DepositClaimWire =
        borsh::from_slice(data).map_err(|_| AccountCodecError::InvalidEncoding)?;
    Ok(DepositClaimAccount {
        record: DepositClaimRecord {
            operation_id: value.operation_id,
            message_digest: value.message_digest,
            amount_atomic: value.amount_atomic,
            recipient: destination_from_wire(value.recipient)?,
        },
    })
}

pub fn encode_withdrawal_record_account(
    record: &WithdrawalRecord,
) -> Result<Vec<u8>, AccountCodecError> {
    borsh::to_vec(&wire::WithdrawalRecordWire {
        magic: WITHDRAWAL_RECORD_ACCOUNT_MAGIC,
        version: BRIDGE_ACCOUNT_VERSION,
        withdrawal_id: record.withdrawal_id,
        operation_id: record.operation_id,
        message_digest: record.message_digest,
        gross_amount_atomic: record.gross_amount_atomic,
        fee_atomic: record.fee_atomic,
        native_destination: destination_wire(&record.native_destination)?,
        burn_authority: record.burn_authority,
    })
    .map_err(|_| AccountCodecError::InvalidEncoding)
}

pub fn decode_withdrawal_record_account(
    data: &[u8],
) -> Result<WithdrawalRecordAccount, AccountCodecError> {
    check_account_header(
        data,
        WITHDRAWAL_RECORD_ACCOUNT_LENGTH,
        WITHDRAWAL_RECORD_ACCOUNT_MAGIC,
    )?;
    let value: wire::WithdrawalRecordWire =
        borsh::from_slice(data).map_err(|_| AccountCodecError::InvalidEncoding)?;
    Ok(WithdrawalRecordAccount {
        record: WithdrawalRecord {
            withdrawal_id: value.withdrawal_id,
            operation_id: value.operation_id,
            message_digest: value.message_digest,
            gross_amount_atomic: value.gross_amount_atomic,
            fee_atomic: value.fee_atomic,
            native_destination: destination_from_wire(value.native_destination)?,
            burn_authority: value.burn_authority,
        },
    })
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

fn destination_wire(value: &[u8]) -> Result<wire::DestinationWire, AccountCodecError> {
    if value.is_empty() || value.len() > MAX_DESTINATION_LENGTH {
        return Err(AccountCodecError::InvalidEncoding);
    }
    let mut padded = [0; MAX_DESTINATION_LENGTH];
    padded[..value.len()].copy_from_slice(value);
    Ok(wire::DestinationWire {
        length: value.len() as u16,
        padded,
    })
}

fn destination_from_wire(value: wire::DestinationWire) -> Result<Vec<u8>, AccountCodecError> {
    let len = usize::from(value.length);
    if len == 0 || len > MAX_DESTINATION_LENGTH || value.padded[len..].iter().any(|byte| *byte != 0)
    {
        return Err(AccountCodecError::InvalidEncoding);
    }
    Ok(value.padded[..len].to_vec())
}

fn burn_wire(value: &BurnChecked) -> wire::BurnCheckedWire {
    wire::BurnCheckedWire {
        token_program_id: value.token_program_id,
        mint: value.mint,
        authority: value.authority,
        amount_atomic: value.amount_atomic,
        decimals: value.decimals,
    }
}

fn burn_from_wire(value: wire::BurnCheckedWire) -> BurnChecked {
    BurnChecked {
        token_program_id: value.token_program_id,
        mint: value.mint,
        authority: value.authority,
        amount_atomic: value.amount_atomic,
        decimals: value.decimals,
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
    #[error("SPL Token CPI failed")]
    TokenCpiFailed,
    #[error("bridge account codec error: {0}")]
    AccountCodec(#[from] AccountCodecError),
    #[error("bridge error: {0}")]
    Bridge(#[from] BridgeError),
    #[error("transceiver account codec error: {0}")]
    TransceiverAccountCodec(#[from] kingpepe_transceiver::AccountCodecError),
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
            EntrypointError::MissingRequiredSignature => ProgramError::MissingRequiredSignature,
            EntrypointError::AccountOwnerMismatch => ProgramError::IllegalOwner,
            EntrypointError::UnexpectedAdditionalAccounts
            | EntrypointError::AccountNotWritable
            | EntrypointError::AccountKeyMismatch
            | EntrypointError::AccountAlreadyInitialized
            | EntrypointError::InvalidAccountData
            | EntrypointError::AccountBorrowFailed
            | EntrypointError::RentUnavailable
            | EntrypointError::SystemCpiFailed
            | EntrypointError::TokenCpiFailed
            | EntrypointError::AccountCodec(_)
            | EntrypointError::Bridge(_)
            | EntrypointError::TransceiverAccountCodec(_) => ProgramError::InvalidAccountData,
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
    #[error("message is outside its validity window")]
    MessageValidityWindow,
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
    use spl_token::state::AccountState;

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
                token_program_id: spl_token::id().to_bytes(),
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

    fn account_execution_config() -> BridgeConfig {
        let mut config = base_config();
        config.manager_program_id = id().to_bytes();
        config.mint_binding.mint_authority_pda =
            derive_mint_authority_pda(&config.manager_program_id, &config.mint_binding.mint);
        config
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
            native_destination: [&[0x51, 0x20][..], &h(0xAB)].concat(),
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
            protocol_id: 1,
            native_network: 2,
            native_genesis: h(8),
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

    fn mint_account_data(config: &BridgeConfig, supply: u64) -> Vec<u8> {
        let mut data = vec![0; TokenMint::LEN];
        TokenMint {
            mint_authority: COption::Some(Pubkey::new_from_array(
                config.mint_binding.mint_authority_pda,
            )),
            supply,
            decimals: config.mint_binding.decimals,
            is_initialized: true,
            freeze_authority: COption::None,
        }
        .pack_into_slice(&mut data);
        data
    }

    fn token_account_data(mint: Pubkey, token_account_owner: Pubkey, amount: u64) -> Vec<u8> {
        let mut data = vec![0; TokenAccount::LEN];
        TokenAccount {
            mint,
            owner: token_account_owner,
            amount,
            delegate: COption::None,
            state: AccountState::Initialized,
            is_native: COption::None,
            delegated_amount: 0,
            close_authority: COption::None,
        }
        .pack_into_slice(&mut data);
        data
    }

    fn encoded_state_account(config: &BridgeConfig) -> Vec<u8> {
        encode_bridge_state_account(&BridgeStateAccount {
            state: ProgramState::LocalnetTesting,
            config: config.clone(),
            minted_supply: 0,
            burned_unpaid_withdrawals: 0,
        })
        .unwrap()
    }

    #[test]
    fn bridge_starts_uninitialized() {
        let program = BridgeProgram::default();
        assert!(!program.is_operational());
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
    fn compact_initialization_rejects_premine_freeze_and_old_serialization() {
        let config = base_config();
        for frozen in [false, true] {
            let mut invalid = config.clone();
            if frozen {
                invalid.mint_binding.freeze_authority = Some(h(99));
            } else {
                invalid.mint_binding.initial_supply = 1;
            }
            assert_eq!(
                BridgeInstruction::Initialize(invalid).encode(),
                Err(EntrypointError::InvalidInstructionEncoding)
            );
        }
        let mut legacy = vec![BRIDGE_INSTRUCTION_INITIALIZE];
        legacy.extend(borsh::to_vec(&bridge_config_wire(&config)).unwrap());
        assert!(matches!(
            decode_bridge_instruction(&legacy),
            Err(EntrypointError::InvalidInstructionLength { .. })
        ));
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
        assert_eq!(process_instruction_boundary(&deposit_bytes), Ok(()));

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
    fn bridge_account_execution_initializes_state_from_spl_mint() {
        let config = account_execution_config();
        let state_key = Pubkey::new_from_array(derive_bridge_state_pda(
            &config.manager_program_id,
            &config.mint_binding.mint,
        ));
        let state_account = test_account(
            state_key,
            id(),
            vec![0; BRIDGE_STATE_ACCOUNT_LENGTH],
            false,
            true,
        );
        let mint_account = test_account(
            Pubkey::new_from_array(config.mint_binding.mint),
            spl_token::id(),
            mint_account_data(&config, 0),
            false,
            false,
        );
        let token_program = test_account(
            spl_token::id(),
            Pubkey::new_unique(),
            Vec::new(),
            false,
            false,
        );
        let initialize = BridgeInstruction::Initialize(config.clone())
            .encode()
            .unwrap();

        assert_eq!(
            process_instruction_accounts(
                &id(),
                &[
                    state_account.clone(),
                    mint_account.clone(),
                    token_program.clone()
                ],
                &initialize
            ),
            Err(EntrypointError::MissingRequiredSignature)
        );
        assert!(state_account.data.borrow().iter().all(|byte| *byte == 0));
        let mut mint_account = mint_account;
        mint_account.is_signer = true;
        let wrong_mint = test_account(
            Pubkey::new_unique(),
            spl_token::id(),
            mint_account_data(&config, 0),
            true,
            false,
        );
        assert_eq!(
            process_instruction_accounts(
                &id(),
                &[state_account.clone(), wrong_mint, token_program.clone()],
                &initialize
            ),
            Err(EntrypointError::AccountKeyMismatch)
        );
        assert!(state_account.data.borrow().iter().all(|byte| *byte == 0));
        process_instruction_accounts(
            &id(),
            &[
                state_account.clone(),
                mint_account.clone(),
                token_program.clone(),
            ],
            &initialize,
        )
        .unwrap();
        let state = read_bridge_state_account(&state_account).unwrap();
        assert_eq!(state.state, ProgramState::LocalnetTesting);
        assert_eq!(state.config, config);
        assert_eq!(state.minted_supply, 0);
        assert_eq!(state.burned_unpaid_withdrawals, 0);
        assert_eq!(
            process_instruction_accounts(
                &id(),
                &[state_account, mint_account, token_program],
                &initialize
            ),
            Err(EntrypointError::AccountAlreadyInitialized)
        );
    }

    #[test]
    fn bridge_account_execution_mints_once_from_verified_receipt() {
        account_model_mint_with_direct_burn_difference(0);
    }

    #[test]
    fn bridge_account_model_mint_preserves_direct_burn_difference() {
        account_model_mint_with_direct_burn_difference(20);
    }

    fn account_model_mint_with_direct_burn_difference(direct_burn: u128) {
        let config = account_execution_config();
        let message = deposit_message(&config);
        let digest = message.message_digest().unwrap();
        let receipt = VerifiedMessageReceipt {
            message_digest: digest,
            operation_id: message.operation_id,
            transceiver_program_id: config.transceiver_program_id,
            manager_program_id: config.manager_program_id,
            mint: config.mint_binding.mint,
            direction: message.direction,
            action: message.action,
            key_epoch: message.key_epoch,
            attesters: [h(21), h(22)],
            consumed: false,
        };
        let state_account = test_account(
            Pubkey::new_from_array(derive_bridge_state_pda(
                &config.manager_program_id,
                &config.mint_binding.mint,
            )),
            id(),
            encoded_state_account(&config),
            false,
            true,
        );
        let claim_account = test_account(
            Pubkey::new_from_array(derive_deposit_claim_pda(
                &config.manager_program_id,
                &message.operation_id,
            )),
            id(),
            vec![0; DEPOSIT_CLAIM_ACCOUNT_LENGTH],
            false,
            true,
        );
        let receipt_account = test_account(
            Pubkey::new_from_array(kingpepe_transceiver::derive_verified_receipt_pda(
                &config.transceiver_program_id,
                &digest,
            )),
            Pubkey::new_from_array(config.transceiver_program_id),
            kingpepe_transceiver::encode_verified_receipt_account(&receipt),
            false,
            false,
        );
        let mint_pubkey = Pubkey::new_from_array(config.mint_binding.mint);
        let mint_account = test_account(
            mint_pubkey,
            spl_token::id(),
            mint_account_data(&config, 0),
            false,
            true,
        );
        let recipient = test_account(
            Pubkey::new_from_array(message.destination.clone().try_into().unwrap()),
            spl_token::id(),
            token_account_data(mint_pubkey, Pubkey::new_unique(), 0),
            false,
            true,
        );
        let mint_authority = test_account(
            Pubkey::new_from_array(config.mint_binding.mint_authority_pda),
            id(),
            Vec::new(),
            false,
            false,
        );
        let token_program = test_account(
            spl_token::id(),
            Pubkey::new_unique(),
            Vec::new(),
            false,
            false,
        );
        let transceiver_program = test_account(
            Pubkey::new_from_array(config.transceiver_program_id),
            Pubkey::new_unique(),
            Vec::new(),
            false,
            false,
        );
        let deposit = BridgeInstruction::AcceptDepositClaim(Box::new(message.clone()))
            .encode()
            .unwrap();

        let accounts = [
            state_account.clone(),
            claim_account.clone(),
            receipt_account,
            mint_account,
            recipient,
            mint_authority,
            token_program,
            transceiver_program,
            test_account(
                Pubkey::new_from_array(derive_deposit_backing_pda(&message)),
                id(),
                vec![0; DEPOSIT_BACKING_MARKER_LENGTH],
                false,
                true,
            ),
        ];
        let mut substituted = accounts.clone();
        substituted[4] = test_account(
            Pubkey::new_unique(),
            spl_token::id(),
            token_account_data(mint_pubkey, Pubkey::new_unique(), 0),
            false,
            true,
        );
        assert_eq!(
            process_instruction_accounts_with_token_cpi(
                &id(),
                &substituted,
                &deposit,
                TokenCpiMode::SkipForTest
            ),
            Err(BridgeError::AccountMismatch.into())
        );
        let mut paused = config.clone();
        paused.deposits_paused = true;
        state_account
            .data
            .borrow_mut()
            .copy_from_slice(&encoded_state_account(&paused));
        assert!(process_instruction_accounts_with_token_cpi(
            &id(),
            &accounts,
            &deposit,
            TokenCpiMode::SkipForTest
        )
        .is_err());
        assert_eq!(
            read_bridge_state_account(&state_account)
                .unwrap()
                .minted_supply,
            0
        );
        assert!(claim_account.data.borrow().iter().all(|byte| *byte == 0));
        state_account
            .data
            .borrow_mut()
            .copy_from_slice(&encoded_state_account(&config));

        let mut prior_state = read_bridge_state_account(&state_account).unwrap();
        prior_state.minted_supply = direct_burn;
        write_account_data(
            &state_account,
            &encode_bridge_state_account(&prior_state).unwrap(),
        )
        .unwrap();

        process_instruction_accounts_with_token_cpi(
            &id(),
            &accounts,
            &deposit,
            TokenCpiMode::SkipForTest,
        )
        .unwrap();
        let state = read_bridge_state_account(&state_account).unwrap();
        assert_eq!(
            state.minted_supply,
            direct_burn + u128::from(message.amount_atomic)
        );
        let claim = decode_deposit_claim_account(&claim_account.data.borrow()).unwrap();
        assert_eq!(claim.record.operation_id, message.operation_id);
        assert_eq!(claim.record.message_digest, digest);
        assert_eq!(claim.record.amount_atomic, message.amount_atomic);
        assert_eq!(&accounts[8].data.borrow()[9..41], &message.operation_id);
        // Even a new operation ID, nonce and evidence cannot reuse the backing.
        let mut replay = message.clone();
        replay.nonce = h(94);
        replay.evidence_digest = h(95);
        replay.operation_id = replay.derive_operation_id().unwrap();
        let mut replay_accounts = accounts.clone();
        replay_accounts[1] = test_account(
            Pubkey::new_from_array(derive_deposit_claim_pda(
                &config.manager_program_id,
                &replay.operation_id,
            )),
            id(),
            vec![0; DEPOSIT_CLAIM_ACCOUNT_LENGTH],
            false,
            true,
        );
        assert_eq!(
            process_instruction_accounts_with_token_cpi(
                &id(),
                &replay_accounts,
                &BridgeInstruction::AcceptDepositClaim(Box::new(replay))
                    .encode()
                    .unwrap(),
                TokenCpiMode::SkipForTest
            ),
            Err(EntrypointError::AccountAlreadyInitialized)
        );
        assert_eq!(
            read_bridge_state_account(&state_account)
                .unwrap()
                .minted_supply,
            direct_burn + u128::from(message.amount_atomic)
        );

        assert_eq!(
            process_instruction_accounts_with_token_cpi(
                &id(),
                &[state_account, claim_account],
                &deposit,
                TokenCpiMode::SkipForTest,
            ),
            Err(EntrypointError::NotEnoughAccounts)
        );
    }

    #[test]
    fn issued_counter_preserves_direct_burn_difference_and_exact_boundaries() {
        for difference in [0, 1, u128::from(u64::MAX)] {
            let issued = 100 + difference;
            assert_eq!(checked_issued_after_mint(issued, 100, 20), Ok(issued + 20));
            assert_eq!(checked_issued_after_burn(issued, 100, 20), Ok(issued - 20));
            assert_eq!(checked_issued_after_burn(issued, 100, 100), Ok(difference));
        }
        assert_eq!(
            checked_issued_after_mint(u128::MAX, 0, 1),
            Err(BridgeError::ArithmeticOverflow)
        );
        assert_eq!(
            checked_issued_after_mint(u128::from(u64::MAX), u64::MAX, 1),
            Err(BridgeError::ArithmeticOverflow)
        );
        assert_eq!(
            checked_issued_after_burn(100, 90, 91),
            Err(BridgeError::BurnMismatch)
        );
        assert_eq!(
            checked_issued_after_burn(0, 0, 1),
            Err(BridgeError::BurnMismatch)
        );
    }

    #[test]
    fn issued_counter_rejects_unaccounted_live_supply_before_either_cpi() {
        for (issued, live) in [(0, 1), (99, 100), (u128::from(u64::MAX) - 1, u64::MAX)] {
            assert_eq!(
                checked_issued_after_mint(issued, live, 1),
                Err(BridgeError::AccountMismatch)
            );
            assert_eq!(
                checked_issued_after_burn(issued, live, 1),
                Err(BridgeError::AccountMismatch)
            );
        }
    }

    #[test]
    fn economic_action_gates_reject_pause_hard_stop_and_environment_bypass() {
        let config = base_config();
        let ready = ProgramState::LocalnetTesting;
        for deposit in [true, false] {
            assert_eq!(require_ready_for_action(&ready, &config, deposit), Ok(()));
            assert!(
                require_ready_for_action(&ProgramState::Phase0Disabled, &config, deposit).is_err()
            );
            for environment in [BridgeEnvironment::Devnet, BridgeEnvironment::Mainnet] {
                let mut disabled = config.clone();
                disabled.environment = environment;
                assert!(require_ready_for_action(&ready, &disabled, deposit).is_err());
            }
            let mut stopped = config.clone();
            stopped.hard_stop = true;
            assert!(require_ready_for_action(&ready, &stopped, deposit).is_err());
            let mut paused = config.clone();
            paused.deposits_paused = deposit;
            paused.withdrawals_paused = !deposit;
            assert!(require_ready_for_action(&ready, &paused, deposit).is_err());
        }
    }

    #[test]
    fn economic_message_window_matches_attester_inclusive_bounds() {
        let message = deposit_message(&base_config());
        assert!(validate_message_time(&message, 0).is_err());
        assert_eq!(validate_message_time(&message, 1), Ok(()));
        assert_eq!(validate_message_time(&message, 2), Ok(()));
        assert!(validate_message_time(&message, 3).is_err());
        assert!(validate_message_time(&message, u64::MAX).is_err());
    }

    #[test]
    fn bridge_account_model_updates_preallocated_withdrawal_without_token_cpi() {
        account_model_withdrawal_with_direct_burn_difference(0);
    }

    #[test]
    fn bridge_account_model_withdrawal_preserves_direct_burn_difference() {
        account_model_withdrawal_with_direct_burn_difference(20);
    }

    fn account_model_withdrawal_with_direct_burn_difference(direct_burn: u128) {
        let config = account_execution_config();
        let message = withdrawal_message(&config);
        let burn_authority_key = Pubkey::new_unique();
        let burn = BurnChecked {
            token_program_id: config.mint_binding.token_program_id,
            mint: config.mint_binding.mint,
            authority: burn_authority_key.to_bytes(),
            amount_atomic: message.amount_atomic,
            decimals: config.mint_binding.decimals,
        };
        let state_account = test_account(
            Pubkey::new_from_array(derive_bridge_state_pda(
                &config.manager_program_id,
                &config.mint_binding.mint,
            )),
            id(),
            encoded_state_account(&config),
            false,
            true,
        );
        let record_account = test_account(
            Pubkey::new_from_array(derive_withdrawal_record_pda(
                &config.manager_program_id,
                &message.withdrawal_id,
            )),
            id(),
            vec![0; WITHDRAWAL_RECORD_ACCOUNT_LENGTH],
            false,
            true,
        );
        let mint_pubkey = Pubkey::new_from_array(config.mint_binding.mint);
        let source_token = test_account(
            Pubkey::new_unique(),
            spl_token::id(),
            token_account_data(mint_pubkey, burn_authority_key, message.amount_atomic),
            false,
            true,
        );
        let mint_account = test_account(
            mint_pubkey,
            spl_token::id(),
            mint_account_data(&config, message.amount_atomic),
            false,
            true,
        );
        let burn_authority = test_account(
            burn_authority_key,
            Pubkey::new_unique(),
            Vec::new(),
            true,
            false,
        );
        let token_program = test_account(
            spl_token::id(),
            Pubkey::new_unique(),
            Vec::new(),
            false,
            false,
        );
        let withdrawal = BridgeInstruction::RecordWithdrawalRequest {
            message: Box::new(message.clone()),
            burn,
        }
        .encode()
        .unwrap();

        // The fixture must represent previously issued bridge units, not an
        // impossible zero-issued bridge with a nonzero live SPL supply.
        let mut prior_state = read_bridge_state_account(&state_account).unwrap();
        prior_state.minted_supply = u128::from(message.amount_atomic) + direct_burn;
        write_account_data(
            &state_account,
            &encode_bridge_state_account(&prior_state).unwrap(),
        )
        .unwrap();

        process_instruction_accounts_with_token_cpi(
            &id(),
            &[
                state_account.clone(),
                record_account.clone(),
                source_token,
                mint_account,
                burn_authority,
                token_program,
                test_account(
                    Pubkey::new_from_array(kingpepe_transceiver::derive_transceiver_config_pda(
                        &config.transceiver_program_id,
                        &config.mint_binding.mint,
                    )),
                    Pubkey::new_from_array(config.transceiver_program_id),
                    kingpepe_transceiver::encode_transceiver_config_account(
                        transceiver(&config).config(),
                    ),
                    false,
                    false,
                ),
                test_account(
                    Pubkey::new_unique(),
                    system_program::id(),
                    Vec::new(),
                    true,
                    true,
                ),
                test_account(
                    system_program::id(),
                    Pubkey::new_unique(),
                    Vec::new(),
                    false,
                    false,
                ),
            ],
            &withdrawal,
            TokenCpiMode::SkipForTest,
        )
        .unwrap();
        let state = read_bridge_state_account(&state_account).unwrap();
        assert_eq!(state.minted_supply, direct_burn);
        assert_eq!(
            state.burned_unpaid_withdrawals,
            message.amount_atomic as u128
        );
        let record = decode_withdrawal_record_account(&record_account.data.borrow()).unwrap();
        assert_eq!(record.record.withdrawal_id, message.withdrawal_id);
        assert_eq!(record.record.gross_amount_atomic, message.amount_atomic);
        assert_eq!(record.record.fee_atomic, message.fee_atomic);
        assert_eq!(record.record.native_destination, message.destination);
    }

    #[test]
    fn withdrawal_rejects_unsupported_native_scripts_and_zero_net() {
        let config = base_config();
        let valid = withdrawal_message(&config);
        let burn = BurnChecked {
            token_program_id: config.mint_binding.token_program_id,
            mint: config.mint_binding.mint,
            authority: h(42),
            amount_atomic: valid.amount_atomic,
            decimals: config.mint_binding.decimals,
        };
        for script in [
            vec![0x51],
            vec![0x51, 0x20, 0xab],
            vec![0x6a],
            [&[0x51, 0x20][..], &[0u8; 32]].concat(),
        ] {
            let mut invalid = valid.clone();
            invalid.destination = script;
            assert_eq!(
                validate_burn(&config, &invalid, &burn),
                Err(BridgeError::BurnMismatch)
            );
        }
        let mut invalid = valid.clone();
        invalid.fee_atomic = invalid.amount_atomic;
        assert_eq!(
            validate_burn(&config, &invalid, &burn),
            Err(BridgeError::BurnMismatch)
        );
        assert_eq!(validate_burn(&config, &valid, &burn), Ok(()));
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
        bridge.minted_supply = 4_000; // Aggregate host-model fixture only.
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
        assert_eq!(bridge.minted_supply(), 0);
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
        let mut rotated_message = message.clone();
        rotated_message.policy_epoch = 8;
        rotated_message.key_epoch = 9;
        rotated_message.nonce = h(90);
        rotated_message.valid_until += 10;
        rotated_message.operation_id = rotated_message.derive_operation_id().unwrap();
        assert_ne!(rotated_message.operation_id, message.operation_id);
        assert_eq!(
            derive_deposit_backing_pda(&rotated_message),
            derive_deposit_backing_pda(&message)
        );
        let rotated_config = bridge.config().unwrap().clone();
        let mut rotated_transceiver = super::tests::transceiver(&rotated_config);
        let digest = rotated_message.message_digest().unwrap();
        rotated_transceiver
            .verify_message(&rotated_message, &observations(&rotated_config, digest))
            .unwrap();
        assert_eq!(
            bridge.accept_deposit_claim(&mut rotated_transceiver, &rotated_message, &accounts),
            Err(BridgeError::Replay)
        );
        assert_eq!(bridge.deposit_claim_count(), 1);
        assert_eq!(bridge.minted_supply(), 5_000);
    }
}
