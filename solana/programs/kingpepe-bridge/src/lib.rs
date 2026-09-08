//! KingPepe bridge manager boundary model.
//!
//! Phase 05 implements deterministic program-state validation, mint/PDA
//! authority policy, transceiver receipt consumption, deposit replay
//! protection, and atomic burn plus withdrawal recording. Mainnet activation
//! remains disabled.

use std::collections::{BTreeMap, BTreeSet};

use bridge_messages::{BridgeAction, BridgeDirection, CanonicalBridgeMessage, Hash32, PubkeyBytes};
use kingpepe_transceiver::{TransceiverError, TransceiverProgram, VerifiedMessageReceipt};
use sha2::{Digest, Sha256};
use thiserror::Error;

pub const PROGRAM_NAME: &str = "kingpepe_bridge";
pub const KPEPE_SYMBOL: &str = "KPEPE";
pub const KPEPE_NAME: &str = "KingPepe";
pub const EXPECTED_INITIAL_SUPPLY: u128 = 0;
pub const PROJECT_BRIDGE_FEE_ATOMIC: u64 = 0;

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
        if message.direction != BridgeDirection::NativeToSolana || message.action != BridgeAction::DepositClaim {
            return Err(BridgeError::WrongMessageKind);
        }
        if self.deposit_claims.contains_key(&message.operation_id) {
            return Err(BridgeError::Replay);
        }
        let digest = message.message_digest().map_err(|_| BridgeError::InvalidMessage)?;
        let receipt = transceiver.receipt(&digest).ok_or(BridgeError::MissingReceipt)?;
        validate_receipt(config, receipt, message, digest)?;
        if self.consumed_receipts.contains(&digest) {
            return Err(BridgeError::Replay);
        }

        transceiver.consume_receipt(&digest).map_err(BridgeError::Transceiver)?;
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
        self.deposit_claims.insert(message.operation_id, record.clone());
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
        if message.direction != BridgeDirection::SolanaToNative || message.action != BridgeAction::WithdrawalRequest {
            return Err(BridgeError::WrongMessageKind);
        }
        if self.withdrawal_records.contains_key(&message.withdrawal_id) {
            return Err(BridgeError::Replay);
        }
        validate_burn(config, message, burn)?;

        let digest = message.message_digest().map_err(|_| BridgeError::InvalidMessage)?;
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

    pub fn rotate_epochs_for_test(&mut self, policy_epoch: u32, key_epoch: u32) -> Result<(), BridgeError> {
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

pub fn derive_mint_authority_pda(manager_program_id: &PubkeyBytes, mint: &PubkeyBytes) -> PubkeyBytes {
    let mut digest = Sha256::new();
    digest.update(b"KINGPEPE_BRIDGE_MINT_AUTHORITY_PDA_V1");
    digest.update(manager_program_id);
    digest.update(mint);
    digest.finalize().into()
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
    if matches!(config.environment, BridgeEnvironment::Mainnet) && config.mainnet_activation_enabled {
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
    if mint.mint_authority_pda != derive_mint_authority_pda(&config.manager_program_id, &mint.mint) {
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

fn validate_message_domain(config: &BridgeConfig, message: &CanonicalBridgeMessage) -> Result<(), BridgeError> {
    message.validate().map_err(|_| BridgeError::InvalidMessage)?;
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

fn validate_burn(config: &BridgeConfig, message: &CanonicalBridgeMessage, burn: &BurnChecked) -> Result<(), BridgeError> {
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
    use bridge_messages::{DeploymentIdentity, MessageEpochs, NativeOutpoint, ValidityWindow};
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
        CanonicalBridgeMessage::new_deposit_claim(
            deployment(config),
            NativeOutpoint { txid: h(9), vout: 1 },
            5_000,
            h(10),
            MessageEpochs {
                policy_epoch: config.policy_epoch,
                key_epoch: config.key_epoch,
            },
            h(11),
            ValidityWindow {
                valid_from: 1,
                valid_until: 2,
            },
            h(12),
        )
        .unwrap()
    }

    fn withdrawal_message(config: &BridgeConfig) -> CanonicalBridgeMessage {
        CanonicalBridgeMessage::new_withdrawal_request(
            deployment(config),
            h(13),
            4_000,
            25,
            vec![0x51, 0x20, 0xAB],
            MessageEpochs {
                policy_epoch: config.policy_epoch,
                key_epoch: config.key_epoch,
            },
            h(14),
            ValidityWindow {
                valid_from: 1,
                valid_until: 2,
            },
            h(15),
        )
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
    fn initialization_enforces_zero_supply_pda_and_no_freeze_authority() {
        let mut program = BridgeProgram::new();
        let mut config = base_config();
        config.mint_binding.initial_supply = 1;
        assert_eq!(program.initialize(config), Err(BridgeError::InitialSupplyMustBeZero));

        let mut program = BridgeProgram::new();
        let mut config = base_config();
        config.mint_binding.freeze_authority = Some(h(99));
        assert_eq!(program.initialize(config), Err(BridgeError::FreezeAuthorityMustBeNone));

        let mut program = BridgeProgram::new();
        let mut config = base_config();
        config.mint_binding.mint_authority_pda = h(98);
        assert_eq!(program.initialize(config), Err(BridgeError::MintAuthorityMismatch));
    }

    #[test]
    fn initialization_rejects_reinitialization_and_keeps_mainnet_disabled() {
        let mut program = BridgeProgram::new();
        let config = base_config();
        program.initialize(config.clone()).unwrap();
        assert_eq!(program.initialize(config), Err(BridgeError::AlreadyInitialized));

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
        mainnet_program.initialize(disabled_mainnet.clone()).unwrap();
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
        assert_eq!(validate_accounts(&config, &bad_accounts), Err(BridgeError::AccountMismatch));

        let mut alias = accounts(&config);
        alias.writable_accounts.push(config.manager_program_id);
        assert_eq!(validate_accounts(&config, &alias), Err(BridgeError::AccountAliasing));
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
