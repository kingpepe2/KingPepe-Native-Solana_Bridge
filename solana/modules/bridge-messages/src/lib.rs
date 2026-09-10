//! Canonical bridge message definitions, deterministic binary encoding,
//! operation identity derivation, lifecycle states, and exact accounting
//! primitives for the KingPepe Native - Solana bridge.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const PROTOCOL_MAGIC: [u8; 8] = *b"KPEPBRG1";
pub const MESSAGE_VERSION: u8 = 1;
pub const DEPLOYMENT_IDENTITY_LENGTH: usize = 168;
pub const NATIVE_OUTPOINT_LENGTH: usize = 36;
pub const MAX_DESTINATION_LENGTH: usize = 128;
pub const MESSAGE_LENGTH: usize = 514;

pub type Hash32 = [u8; 32];
pub type PubkeyBytes = [u8; 32];

#[derive(Debug, Copy, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[repr(u8)]
pub enum BridgeDirection {
    NativeToSolana = 0,
    SolanaToNative = 1,
}

impl TryFrom<u8> for BridgeDirection {
    type Error = MessageDecodeError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::NativeToSolana),
            1 => Ok(Self::SolanaToNative),
            _ => Err(MessageDecodeError::InvalidDirection(value)),
        }
    }
}

impl From<BridgeDirection> for u8 {
    fn from(value: BridgeDirection) -> Self {
        value as u8
    }
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[repr(u8)]
pub enum BridgeAction {
    DepositClaim = 0,
    WithdrawalRequest = 1,
}

impl TryFrom<u8> for BridgeAction {
    type Error = MessageDecodeError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::DepositClaim),
            1 => Ok(Self::WithdrawalRequest),
            _ => Err(MessageDecodeError::InvalidAction(value)),
        }
    }
}

impl From<BridgeAction> for u8 {
    fn from(value: BridgeAction) -> Self {
        value as u8
    }
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[repr(u8)]
pub enum BridgeOperationState {
    Observed = 0,
    WaitingForFinality = 1,
    WaitingForDependency = 2,
    QueuedByLimit = 3,
    VerifiedReady = 4,
    Signing = 5,
    Broadcast = 6,
    WaitingSettlement = 7,
    Completed = 8,
    Rejected = 9,
    HardStop = 10,
}

impl BridgeOperationState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Observed => "OBSERVED",
            Self::WaitingForFinality => "WAITING_FOR_FINALITY",
            Self::WaitingForDependency => "WAITING_FOR_DEPENDENCY",
            Self::QueuedByLimit => "QUEUED_BY_LIMIT",
            Self::VerifiedReady => "VERIFIED_READY",
            Self::Signing => "SIGNING",
            Self::Broadcast => "BROADCAST",
            Self::WaitingSettlement => "WAITING_SETTLEMENT",
            Self::Completed => "COMPLETED",
            Self::Rejected => "REJECTED",
            Self::HardStop => "HARD_STOP",
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Completed | Self::Rejected | Self::HardStop)
    }

    pub fn transition(self, event: BridgeStateEvent) -> Result<Self, BridgeStateTransitionError> {
        use BridgeOperationState as S;
        use BridgeStateEvent as E;

        if self.is_terminal() {
            return Err(BridgeStateTransitionError::TerminalState);
        }

        match (self, event) {
            (_, E::Reject) => Ok(S::Rejected),
            (_, E::EnterHardStop) => Ok(S::HardStop),
            (S::Observed, E::ObservationAccepted) => Ok(S::WaitingForFinality),
            (S::WaitingForFinality, E::FinalityReached) => Ok(S::WaitingForDependency),
            (S::WaitingForDependency, E::QueueByLimit) => Ok(S::QueuedByLimit),
            (S::WaitingForDependency, E::DependencySatisfied) => Ok(S::VerifiedReady),
            (S::QueuedByLimit, E::DependencySatisfied) => Ok(S::VerifiedReady),
            (S::VerifiedReady, E::BeginSigning) => Ok(S::Signing),
            (S::Signing, E::BroadcastSubmitted) => Ok(S::Broadcast),
            (S::Broadcast, E::BroadcastObserved) => Ok(S::WaitingSettlement),
            (S::WaitingSettlement, E::SettlementFinalized) => Ok(S::Completed),
            _ => Err(BridgeStateTransitionError::InvalidTransition),
        }
    }
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Serialize, Deserialize)]
pub enum BridgeStateEvent {
    ObservationAccepted,
    FinalityReached,
    DependencySatisfied,
    QueueByLimit,
    BeginSigning,
    BroadcastSubmitted,
    BroadcastObserved,
    SettlementFinalized,
    Reject,
    EnterHardStop,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
pub struct DeploymentIdentity {
    pub protocol_id: u32,
    pub native_network: u32,
    pub native_genesis: Hash32,
    pub solana_deployment: Hash32,
    pub manager_program_id: PubkeyBytes,
    pub transceiver_program_id: PubkeyBytes,
    pub mint: PubkeyBytes,
}

impl DeploymentIdentity {
    pub fn to_bytes(&self) -> [u8; DEPLOYMENT_IDENTITY_LENGTH] {
        let mut out = [0u8; DEPLOYMENT_IDENTITY_LENGTH];
        let mut cursor = 0usize;
        write_fixed(&mut out, &mut cursor, &self.protocol_id.to_le_bytes());
        write_fixed(&mut out, &mut cursor, &self.native_network.to_le_bytes());
        write_fixed(&mut out, &mut cursor, &self.native_genesis);
        write_fixed(&mut out, &mut cursor, &self.solana_deployment);
        write_fixed(&mut out, &mut cursor, &self.manager_program_id);
        write_fixed(&mut out, &mut cursor, &self.transceiver_program_id);
        write_fixed(&mut out, &mut cursor, &self.mint);
        debug_assert_eq!(cursor, DEPLOYMENT_IDENTITY_LENGTH);
        out
    }
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Serialize, Deserialize)]
pub struct NativeOutpoint {
    pub txid: Hash32,
    pub vout: u32,
}

impl NativeOutpoint {
    pub const ZERO: Self = Self {
        txid: [0u8; 32],
        vout: 0,
    };

    pub fn to_bytes(&self) -> [u8; NATIVE_OUTPOINT_LENGTH] {
        let mut out = [0u8; NATIVE_OUTPOINT_LENGTH];
        out[0..32].copy_from_slice(&self.txid);
        out[32..36].copy_from_slice(&self.vout.to_le_bytes());
        out
    }

    pub fn is_zero(&self) -> bool {
        *self == Self::ZERO
    }
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
pub struct CanonicalBridgeMessage {
    pub version: u8,
    pub direction: BridgeDirection,
    pub action: BridgeAction,
    pub deployment: DeploymentIdentity,
    pub operation_id: Hash32,
    pub deposit_outpoint: NativeOutpoint,
    pub withdrawal_id: Hash32,
    pub amount_atomic: u64,
    pub fee_atomic: u64,
    pub destination: Vec<u8>,
    pub policy_epoch: u32,
    pub key_epoch: u32,
    pub nonce: Hash32,
    pub valid_from: u64,
    pub valid_until: u64,
    pub evidence_digest: Hash32,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
pub struct DepositClaimFields {
    pub deployment: DeploymentIdentity,
    pub deposit_outpoint: NativeOutpoint,
    pub amount_atomic: u64,
    pub solana_recipient: PubkeyBytes,
    pub epochs: MessageEpochs,
    pub nonce: Hash32,
    pub validity: ValidityWindow,
    pub evidence_digest: Hash32,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
pub struct WithdrawalRequestFields {
    pub deployment: DeploymentIdentity,
    pub withdrawal_id: Hash32,
    pub gross_amount_atomic: u64,
    pub fee_atomic: u64,
    pub native_destination: Vec<u8>,
    pub epochs: MessageEpochs,
    pub nonce: Hash32,
    pub validity: ValidityWindow,
    pub evidence_digest: Hash32,
}

impl CanonicalBridgeMessage {
    pub fn new_deposit_claim(fields: DepositClaimFields) -> Result<Self, MessageEncodeError> {
        let mut message = Self {
            version: MESSAGE_VERSION,
            direction: BridgeDirection::NativeToSolana,
            action: BridgeAction::DepositClaim,
            deployment: fields.deployment,
            operation_id: [0u8; 32],
            deposit_outpoint: fields.deposit_outpoint,
            withdrawal_id: [0u8; 32],
            amount_atomic: fields.amount_atomic,
            fee_atomic: 0,
            destination: fields.solana_recipient.to_vec(),
            policy_epoch: fields.epochs.policy_epoch,
            key_epoch: fields.epochs.key_epoch,
            nonce: fields.nonce,
            valid_from: fields.validity.valid_from,
            valid_until: fields.validity.valid_until,
            evidence_digest: fields.evidence_digest,
        };
        message.operation_id = message.derive_operation_id()?;
        message.validate()?;
        Ok(message)
    }

    pub fn new_withdrawal_request(
        fields: WithdrawalRequestFields,
    ) -> Result<Self, MessageEncodeError> {
        let mut message = Self {
            version: MESSAGE_VERSION,
            direction: BridgeDirection::SolanaToNative,
            action: BridgeAction::WithdrawalRequest,
            deployment: fields.deployment,
            operation_id: [0u8; 32],
            deposit_outpoint: NativeOutpoint::ZERO,
            withdrawal_id: fields.withdrawal_id,
            amount_atomic: fields.gross_amount_atomic,
            fee_atomic: fields.fee_atomic,
            destination: fields.native_destination,
            policy_epoch: fields.epochs.policy_epoch,
            key_epoch: fields.epochs.key_epoch,
            nonce: fields.nonce,
            valid_from: fields.validity.valid_from,
            valid_until: fields.validity.valid_until,
            evidence_digest: fields.evidence_digest,
        };
        message.operation_id = message.derive_operation_id()?;
        message.validate()?;
        Ok(message)
    }

    pub fn encode(&self) -> Result<Vec<u8>, MessageEncodeError> {
        self.validate()?;

        let mut out = vec![0u8; MESSAGE_LENGTH];
        let mut cursor = 0usize;

        write_fixed(&mut out, &mut cursor, &PROTOCOL_MAGIC);
        write_fixed(&mut out, &mut cursor, &[self.version]);
        write_fixed(&mut out, &mut cursor, &[self.action as u8]);
        write_fixed(&mut out, &mut cursor, &[self.direction as u8]);
        write_fixed(&mut out, &mut cursor, &[0u8]);
        write_fixed(&mut out, &mut cursor, &self.deployment.to_bytes());
        write_fixed(&mut out, &mut cursor, &self.operation_id);
        write_fixed(&mut out, &mut cursor, &self.deposit_outpoint.to_bytes());
        write_fixed(&mut out, &mut cursor, &self.withdrawal_id);
        write_fixed(&mut out, &mut cursor, &self.amount_atomic.to_le_bytes());
        write_fixed(&mut out, &mut cursor, &self.fee_atomic.to_le_bytes());
        write_fixed(
            &mut out,
            &mut cursor,
            &(self.destination.len() as u16).to_le_bytes(),
        );

        let destination_start = cursor;
        let destination_end = destination_start + self.destination.len();
        out[destination_start..destination_end].copy_from_slice(&self.destination);
        cursor += MAX_DESTINATION_LENGTH;

        write_fixed(&mut out, &mut cursor, &self.policy_epoch.to_le_bytes());
        write_fixed(&mut out, &mut cursor, &self.key_epoch.to_le_bytes());
        write_fixed(&mut out, &mut cursor, &self.nonce);
        write_fixed(&mut out, &mut cursor, &self.valid_from.to_le_bytes());
        write_fixed(&mut out, &mut cursor, &self.valid_until.to_le_bytes());
        write_fixed(&mut out, &mut cursor, &self.evidence_digest);

        if cursor != MESSAGE_LENGTH {
            return Err(MessageEncodeError::InvalidLength {
                expected: MESSAGE_LENGTH,
                found: cursor,
            });
        }

        Ok(out)
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, MessageDecodeError> {
        if bytes.len() != MESSAGE_LENGTH {
            return Err(MessageDecodeError::InvalidLength {
                expected: MESSAGE_LENGTH,
                found: bytes.len(),
            });
        }

        let mut cursor = DecodeCursor::new(bytes);
        let magic = cursor.read_array::<8>()?;
        if magic != PROTOCOL_MAGIC {
            return Err(MessageDecodeError::InvalidMagic);
        }

        let version = cursor.read_u8()?;
        if version != MESSAGE_VERSION {
            return Err(MessageDecodeError::UnsupportedVersion {
                expected: MESSAGE_VERSION,
                found: version,
            });
        }

        let action = BridgeAction::try_from(cursor.read_u8()?)?;
        let direction = BridgeDirection::try_from(cursor.read_u8()?)?;
        let reserved = cursor.read_u8()?;
        if reserved != 0 {
            return Err(MessageDecodeError::NonZeroReservedByte);
        }

        let deployment = DeploymentIdentity {
            protocol_id: cursor.read_u32_le()?,
            native_network: cursor.read_u32_le()?,
            native_genesis: cursor.read_array::<32>()?,
            solana_deployment: cursor.read_array::<32>()?,
            manager_program_id: cursor.read_array::<32>()?,
            transceiver_program_id: cursor.read_array::<32>()?,
            mint: cursor.read_array::<32>()?,
        };
        let operation_id = cursor.read_array::<32>()?;
        let deposit_outpoint = NativeOutpoint {
            txid: cursor.read_array::<32>()?,
            vout: cursor.read_u32_le()?,
        };
        let withdrawal_id = cursor.read_array::<32>()?;
        let amount_atomic = cursor.read_u64_le()?;
        let fee_atomic = cursor.read_u64_le()?;
        let destination_len = cursor.read_u16_le()? as usize;
        if destination_len > MAX_DESTINATION_LENGTH {
            return Err(MessageDecodeError::DestinationTooLong {
                max: MAX_DESTINATION_LENGTH,
                found: destination_len,
            });
        }
        let destination_padded = cursor.read_array::<MAX_DESTINATION_LENGTH>()?;
        let destination = destination_padded[..destination_len].to_vec();
        if destination_padded[destination_len..]
            .iter()
            .any(|byte| *byte != 0)
        {
            return Err(MessageDecodeError::NonZeroDestinationPadding);
        }
        let policy_epoch = cursor.read_u32_le()?;
        let key_epoch = cursor.read_u32_le()?;
        let nonce = cursor.read_array::<32>()?;
        let valid_from = cursor.read_u64_le()?;
        let valid_until = cursor.read_u64_le()?;
        let evidence_digest = cursor.read_array::<32>()?;

        if cursor.position() != MESSAGE_LENGTH {
            return Err(MessageDecodeError::InvalidLength {
                expected: MESSAGE_LENGTH,
                found: cursor.position(),
            });
        }

        let message = Self {
            version,
            direction,
            action,
            deployment,
            operation_id,
            deposit_outpoint,
            withdrawal_id,
            amount_atomic,
            fee_atomic,
            destination,
            policy_epoch,
            key_epoch,
            nonce,
            valid_from,
            valid_until,
            evidence_digest,
        };
        message.validate().map_err(MessageDecodeError::Validation)?;
        Ok(message)
    }

    pub fn derive_operation_id(&self) -> Result<Hash32, MessageEncodeError> {
        validate_destination(&self.destination)?;
        let mut digest = Sha256::new();
        digest.update(PROTOCOL_MAGIC);
        digest.update([MESSAGE_VERSION]);
        digest.update([self.action as u8]);
        digest.update([self.direction as u8]);
        digest.update(self.deployment.to_bytes());
        digest.update(self.deposit_outpoint.to_bytes());
        digest.update(self.withdrawal_id);
        digest.update(self.amount_atomic.to_le_bytes());
        digest.update(self.fee_atomic.to_le_bytes());
        digest.update((self.destination.len() as u16).to_le_bytes());
        digest.update(&self.destination);
        digest.update(self.policy_epoch.to_le_bytes());
        digest.update(self.key_epoch.to_le_bytes());
        digest.update(self.nonce);
        digest.update(self.valid_from.to_le_bytes());
        digest.update(self.valid_until.to_le_bytes());
        digest.update(self.evidence_digest);
        Ok(digest.finalize().into())
    }

    pub fn message_digest(&self) -> Result<Hash32, MessageEncodeError> {
        let encoded = self.encode()?;
        Ok(Sha256::digest(encoded).into())
    }

    pub fn validate(&self) -> Result<(), MessageEncodeError> {
        if self.version != MESSAGE_VERSION {
            return Err(MessageEncodeError::UnsupportedVersion {
                expected: MESSAGE_VERSION,
                found: self.version,
            });
        }
        if self.amount_atomic == 0 {
            return Err(MessageEncodeError::AmountZero);
        }
        if self.fee_atomic > self.amount_atomic {
            return Err(MessageEncodeError::FeeExceedsAmount);
        }
        if self.policy_epoch == 0 || self.key_epoch == 0 {
            return Err(MessageEncodeError::EpochZero);
        }
        if self.valid_until <= self.valid_from {
            return Err(MessageEncodeError::InvalidValidityWindow);
        }
        if is_zero_hash(&self.nonce) {
            return Err(MessageEncodeError::NonceZero);
        }
        if is_zero_hash(&self.evidence_digest) {
            return Err(MessageEncodeError::EvidenceDigestZero);
        }
        validate_destination(&self.destination)?;

        match (self.action, self.direction) {
            (BridgeAction::DepositClaim, BridgeDirection::NativeToSolana) => {
                if self.deposit_outpoint.is_zero() {
                    return Err(MessageEncodeError::MissingDepositOutpoint);
                }
                if !is_zero_hash(&self.withdrawal_id) {
                    return Err(MessageEncodeError::UnexpectedWithdrawalId);
                }
            }
            (BridgeAction::WithdrawalRequest, BridgeDirection::SolanaToNative) => {
                if !self.deposit_outpoint.is_zero() {
                    return Err(MessageEncodeError::UnexpectedDepositOutpoint);
                }
                if is_zero_hash(&self.withdrawal_id) {
                    return Err(MessageEncodeError::MissingWithdrawalId);
                }
            }
            _ => return Err(MessageEncodeError::ActionDirectionMismatch),
        }

        let derived = self.derive_operation_id()?;
        if self.operation_id != derived {
            return Err(MessageEncodeError::OperationIdMismatch);
        }

        Ok(())
    }
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Serialize, Deserialize)]
pub struct MessageEpochs {
    pub policy_epoch: u32,
    pub key_epoch: u32,
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Serialize, Deserialize)]
pub struct ValidityWindow {
    pub valid_from: u64,
    pub valid_until: u64,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct LedgerSnapshot {
    pub canonical_reserve: u128,
    pub minted_supply: u128,
    pub authorized_unminted_credits: u128,
    pub burned_unpaid_withdrawals: u128,
    pub reserved_utxo_liabilities: u128,
    pub broadcast_payout_liabilities: u128,
    pub finalized_payouts: u128,
    pub fees_accrued: u128,
    pub change_reserved: u128,
    pub unsettled_operations: u64,
}

impl Default for LedgerSnapshot {
    fn default() -> Self {
        Self::new()
    }
}

impl LedgerSnapshot {
    pub fn new() -> Self {
        Self {
            canonical_reserve: 0,
            minted_supply: 0,
            authorized_unminted_credits: 0,
            burned_unpaid_withdrawals: 0,
            reserved_utxo_liabilities: 0,
            broadcast_payout_liabilities: 0,
            finalized_payouts: 0,
            fees_accrued: 0,
            change_reserved: 0,
            unsettled_operations: 0,
        }
    }

    pub fn coverage_required(&self) -> Result<u128, LedgerError> {
        checked_sum(&[
            self.minted_supply,
            self.authorized_unminted_credits,
            self.burned_unpaid_withdrawals,
            self.reserved_utxo_liabilities,
            self.broadcast_payout_liabilities,
            self.change_reserved,
        ])
    }

    pub fn surplus(&self) -> Result<u128, LedgerError> {
        self.canonical_reserve
            .checked_sub(self.coverage_required()?)
            .ok_or(LedgerError::InsufficientBacking)
    }

    pub fn assert_invariants(&self) -> Result<(), LedgerError> {
        if self.canonical_reserve < self.coverage_required()? {
            return Err(LedgerError::InsufficientBacking);
        }
        Ok(())
    }

    pub fn record_validated_deposit(
        &mut self,
        gross_amount: u64,
        bridge_fee: u64,
    ) -> Result<(), LedgerError> {
        if bridge_fee > gross_amount {
            return Err(LedgerError::FeeExceedsAmount);
        }
        let net_amount = gross_amount - bridge_fee;
        require_positive_amount(net_amount)?;
        self.apply_transition(|next| {
            next.canonical_reserve = checked_add(next.canonical_reserve, gross_amount as u128)?;
            next.authorized_unminted_credits =
                checked_add(next.authorized_unminted_credits, net_amount as u128)?;
            next.fees_accrued = checked_add(next.fees_accrued, bridge_fee as u128)?;
            next.unsettled_operations = next
                .unsettled_operations
                .checked_add(1)
                .ok_or(LedgerError::Arithmetic)?;
            Ok(())
        })
    }

    pub fn record_mint(&mut self, amount: u64, bridge_fee: u64) -> Result<(), LedgerError> {
        if bridge_fee != 0 {
            return Err(LedgerError::UnexpectedFeeAtMint);
        }
        require_positive_amount(amount)?;
        self.apply_transition(|next| {
            next.authorized_unminted_credits =
                checked_sub(next.authorized_unminted_credits, amount as u128)?;
            next.minted_supply = checked_add(next.minted_supply, amount as u128)?;
            next.unsettled_operations = next
                .unsettled_operations
                .checked_sub(1)
                .ok_or(LedgerError::InvalidOperationCount)?;
            Ok(())
        })
    }

    pub fn record_burn_request(
        &mut self,
        gross_amount: u64,
        fee_amount: u64,
    ) -> Result<(), LedgerError> {
        if fee_amount > gross_amount {
            return Err(LedgerError::FeeExceedsAmount);
        }
        let net_payout = gross_amount - fee_amount;
        require_positive_amount(net_payout)?;
        self.apply_transition(|next| {
            next.minted_supply = checked_sub(next.minted_supply, gross_amount as u128)?;
            next.burned_unpaid_withdrawals =
                checked_add(next.burned_unpaid_withdrawals, net_payout as u128)?;
            next.fees_accrued = checked_add(next.fees_accrued, fee_amount as u128)?;
            next.unsettled_operations = next
                .unsettled_operations
                .checked_add(1)
                .ok_or(LedgerError::Arithmetic)?;
            Ok(())
        })
    }

    pub fn reserve_withdrawal_utxos(&mut self, net_amount: u64) -> Result<(), LedgerError> {
        require_positive_amount(net_amount)?;
        self.apply_transition(|next| {
            next.burned_unpaid_withdrawals =
                checked_sub(next.burned_unpaid_withdrawals, net_amount as u128)?;
            next.reserved_utxo_liabilities =
                checked_add(next.reserved_utxo_liabilities, net_amount as u128)?;
            Ok(())
        })
    }

    pub fn record_payout_broadcast(&mut self, net_amount: u64) -> Result<(), LedgerError> {
        require_positive_amount(net_amount)?;
        self.apply_transition(|next| {
            next.reserved_utxo_liabilities =
                checked_sub(next.reserved_utxo_liabilities, net_amount as u128)?;
            next.broadcast_payout_liabilities =
                checked_add(next.broadcast_payout_liabilities, net_amount as u128)?;
            Ok(())
        })
    }

    pub fn record_payout_settlement(&mut self, net_amount: u64) -> Result<(), LedgerError> {
        require_positive_amount(net_amount)?;
        let net_amount = net_amount as u128;
        self.apply_transition(|next| {
            if next.broadcast_payout_liabilities >= net_amount {
                next.broadcast_payout_liabilities =
                    checked_sub(next.broadcast_payout_liabilities, net_amount)?;
            } else {
                next.burned_unpaid_withdrawals =
                    checked_sub(next.burned_unpaid_withdrawals, net_amount)?;
            }
            next.canonical_reserve = checked_sub(next.canonical_reserve, net_amount)?;
            next.finalized_payouts = checked_add(next.finalized_payouts, net_amount)?;
            next.unsettled_operations = next
                .unsettled_operations
                .checked_sub(1)
                .ok_or(LedgerError::InvalidOperationCount)?;
            Ok(())
        })
    }

    pub fn record_reserve_donation(&mut self, amount: u64) -> Result<(), LedgerError> {
        require_positive_amount(amount)?;
        self.apply_transition(|next| {
            next.canonical_reserve = checked_add(next.canonical_reserve, amount as u128)?;
            Ok(())
        })
    }

    // A snapshot arithmetic model, not an operation journal or payout authority.
    // Never partially update the live snapshot when a later check fails.
    fn apply_transition(
        &mut self,
        transition: impl FnOnce(&mut Self) -> Result<(), LedgerError>,
    ) -> Result<(), LedgerError> {
        self.assert_invariants()?;
        let mut next = self.clone();
        transition(&mut next)?;
        next.assert_invariants()?;
        *self = next;
        Ok(())
    }
}

pub type LedgerState = LedgerSnapshot;

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum MessageEncodeError {
    UnsupportedVersion { expected: u8, found: u8 },
    InvalidLength { expected: usize, found: usize },
    DestinationEmpty,
    DestinationTooLong { max: usize, found: usize },
    AmountZero,
    FeeExceedsAmount,
    EpochZero,
    InvalidValidityWindow,
    NonceZero,
    EvidenceDigestZero,
    MissingDepositOutpoint,
    UnexpectedDepositOutpoint,
    MissingWithdrawalId,
    UnexpectedWithdrawalId,
    ActionDirectionMismatch,
    OperationIdMismatch,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum MessageDecodeError {
    UnsupportedVersion { expected: u8, found: u8 },
    InvalidLength { expected: usize, found: usize },
    InvalidMagic,
    InvalidDirection(u8),
    InvalidAction(u8),
    NonZeroReservedByte,
    NonZeroDestinationPadding,
    DestinationTooLong { max: usize, found: usize },
    Validation(MessageEncodeError),
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum LedgerError {
    AmountZero,
    Arithmetic,
    InsufficientFunds,
    InsufficientBacking,
    FeeExceedsAmount,
    UnexpectedFeeAtMint,
    InvalidOperationCount,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum BridgeStateTransitionError {
    InvalidTransition,
    TerminalState,
}

fn checked_add(left: u128, right: u128) -> Result<u128, LedgerError> {
    left.checked_add(right).ok_or(LedgerError::Arithmetic)
}

fn require_positive_amount(amount: u64) -> Result<(), LedgerError> {
    if amount == 0 {
        return Err(LedgerError::AmountZero);
    }
    Ok(())
}

fn checked_sub(left: u128, right: u128) -> Result<u128, LedgerError> {
    left.checked_sub(right)
        .ok_or(LedgerError::InsufficientFunds)
}

fn checked_sum(values: &[u128]) -> Result<u128, LedgerError> {
    values
        .iter()
        .try_fold(0u128, |acc, value| checked_add(acc, *value))
}

fn validate_destination(destination: &[u8]) -> Result<(), MessageEncodeError> {
    if destination.is_empty() {
        return Err(MessageEncodeError::DestinationEmpty);
    }
    if destination.len() > MAX_DESTINATION_LENGTH {
        return Err(MessageEncodeError::DestinationTooLong {
            max: MAX_DESTINATION_LENGTH,
            found: destination.len(),
        });
    }
    Ok(())
}

fn is_zero_hash(hash: &Hash32) -> bool {
    hash.iter().all(|byte| *byte == 0)
}

fn write_fixed(out: &mut [u8], cursor: &mut usize, bytes: &[u8]) {
    let end = *cursor + bytes.len();
    out[*cursor..end].copy_from_slice(bytes);
    *cursor = end;
}

struct DecodeCursor<'a> {
    bytes: &'a [u8],
    cursor: usize,
}

impl<'a> DecodeCursor<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, cursor: 0 }
    }

    fn position(&self) -> usize {
        self.cursor
    }

    fn read_u8(&mut self) -> Result<u8, MessageDecodeError> {
        Ok(self.read_array::<1>()?[0])
    }

    fn read_u16_le(&mut self) -> Result<u16, MessageDecodeError> {
        Ok(u16::from_le_bytes(self.read_array::<2>()?))
    }

    fn read_u32_le(&mut self) -> Result<u32, MessageDecodeError> {
        Ok(u32::from_le_bytes(self.read_array::<4>()?))
    }

    fn read_u64_le(&mut self) -> Result<u64, MessageDecodeError> {
        Ok(u64::from_le_bytes(self.read_array::<8>()?))
    }

    fn read_array<const N: usize>(&mut self) -> Result<[u8; N], MessageDecodeError> {
        let end = self.cursor + N;
        let bytes = self
            .bytes
            .get(self.cursor..end)
            .ok_or(MessageDecodeError::InvalidLength {
                expected: MESSAGE_LENGTH,
                found: end,
            })?;
        self.cursor = end;
        Ok(bytes.try_into().expect("slice length checked"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fmt::Write as _;

    pub fn sample_deployment() -> DeploymentIdentity {
        DeploymentIdentity {
            protocol_id: 1,
            native_network: 8_000_111,
            native_genesis: [1u8; 32],
            solana_deployment: [2u8; 32],
            manager_program_id: [3u8; 32],
            transceiver_program_id: [4u8; 32],
            mint: [5u8; 32],
        }
    }

    pub fn sample_deposit_message() -> CanonicalBridgeMessage {
        CanonicalBridgeMessage::new_deposit_claim(DepositClaimFields {
            deployment: sample_deployment(),
            deposit_outpoint: NativeOutpoint {
                txid: [7u8; 32],
                vout: 2,
            },
            amount_atomic: 12_345,
            solana_recipient: [8u8; 32],
            epochs: MessageEpochs {
                policy_epoch: 1,
                key_epoch: 2,
            },
            nonce: [0x42u8; 32],
            validity: ValidityWindow {
                valid_from: 1_700_000_000,
                valid_until: 1_700_001_200,
            },
            evidence_digest: [9u8; 32],
        })
        .expect("sample deposit message")
    }

    fn hex_lower(bytes: &[u8]) -> String {
        let mut out = String::with_capacity(bytes.len() * 2);
        for byte in bytes {
            write!(&mut out, "{byte:02x}").expect("write to string");
        }
        out
    }

    #[test]
    fn deployment_identity_length_is_exact() {
        assert_eq!(
            sample_deployment().to_bytes().len(),
            DEPLOYMENT_IDENTITY_LENGTH
        );
    }

    #[test]
    fn encoding_is_deterministic() {
        let message = sample_deposit_message();
        let encoded = message.encode().expect("encode");
        assert_eq!(encoded.len(), MESSAGE_LENGTH);
        let decoded = CanonicalBridgeMessage::decode(&encoded).expect("decode");
        assert_eq!(decoded, message);
    }

    #[test]
    fn decoding_rejects_wrong_length_and_trailing_data() {
        let mut payload = sample_deposit_message().encode().expect("encode");
        payload.push(0);
        assert!(matches!(
            CanonicalBridgeMessage::decode(&payload),
            Err(MessageDecodeError::InvalidLength { .. })
        ));
    }

    #[test]
    fn rejects_alternate_destination_padding() {
        let mut encoded = sample_deposit_message().encode().expect("encode");
        let padding_index =
            12 + DEPLOYMENT_IDENTITY_LENGTH + 32 + NATIVE_OUTPOINT_LENGTH + 32 + 8 + 8 + 2 + 32;
        encoded[padding_index] = 1;
        assert!(matches!(
            CanonicalBridgeMessage::decode(&encoded),
            Err(MessageDecodeError::NonZeroDestinationPadding)
        ));
    }

    #[test]
    fn canonical_vector_prefix_is_stable() {
        let encoded = sample_deposit_message().encode().expect("encode");
        let prefix = hex_lower(&encoded[..12]);
        assert_eq!(prefix, "4b5045504252473101000000");
    }

    #[test]
    fn rejects_mutated_operation_id() {
        let mut message = sample_deposit_message();
        message.operation_id[0] ^= 0xFF;
        assert!(matches!(
            message.encode(),
            Err(MessageEncodeError::OperationIdMismatch)
        ));
    }

    #[test]
    fn rejects_action_direction_mismatch() {
        let mut message = sample_deposit_message();
        message.direction = BridgeDirection::SolanaToNative;
        message.operation_id = message.derive_operation_id().expect("derive");
        assert!(matches!(
            message.encode(),
            Err(MessageEncodeError::ActionDirectionMismatch)
        ));
    }

    #[test]
    fn state_machine_transitions() {
        let mut state = BridgeOperationState::Observed;
        state = state
            .transition(BridgeStateEvent::ObservationAccepted)
            .expect("step");
        state = state
            .transition(BridgeStateEvent::FinalityReached)
            .expect("step");
        state = state
            .transition(BridgeStateEvent::QueueByLimit)
            .expect("step");
        state = state
            .transition(BridgeStateEvent::DependencySatisfied)
            .expect("step");
        state = state
            .transition(BridgeStateEvent::BeginSigning)
            .expect("step");
        state = state
            .transition(BridgeStateEvent::BroadcastSubmitted)
            .expect("step");
        state = state
            .transition(BridgeStateEvent::BroadcastObserved)
            .expect("step");
        state = state
            .transition(BridgeStateEvent::SettlementFinalized)
            .expect("step");
        assert_eq!(state.as_str(), "COMPLETED");
        assert!(state.transition(BridgeStateEvent::Reject).is_err());
    }

    #[test]
    fn ledger_transitions_keep_withdrawal_liability_after_burn() {
        let mut ledger = LedgerState::new();
        ledger.record_validated_deposit(10_000, 0).expect("deposit");
        ledger.record_mint(10_000, 0).expect("mint");
        ledger.record_burn_request(1_000, 5).expect("burn request");
        assert_eq!(ledger.minted_supply, 9_000);
        assert_eq!(ledger.burned_unpaid_withdrawals, 995);
        assert_eq!(ledger.coverage_required().unwrap(), 9_995);
        assert_eq!(ledger.surplus().unwrap(), 5);
    }

    #[test]
    fn ledger_moves_withdrawal_liability_until_finalized_payout() {
        let mut ledger = LedgerState::new();
        ledger.record_validated_deposit(10_000, 0).expect("deposit");
        ledger.record_mint(10_000, 0).expect("mint");
        ledger.record_burn_request(1_000, 0).expect("burn request");
        ledger
            .reserve_withdrawal_utxos(1_000)
            .expect("reserve utxo");
        ledger.record_payout_broadcast(1_000).expect("broadcast");
        ledger.record_payout_settlement(1_000).expect("finalized");
        assert_eq!(ledger.canonical_reserve, 9_000);
        assert_eq!(ledger.minted_supply, 9_000);
        assert_eq!(ledger.broadcast_payout_liabilities, 0);
        assert_eq!(ledger.finalized_payouts, 1_000);
        assert_eq!(ledger.unsettled_operations, 0);
    }

    #[test]
    fn ledger_rejects_unbacked_mint_and_overflow() {
        let mut ledger = LedgerState::new();
        assert!(matches!(
            ledger.record_mint(1, 0),
            Err(LedgerError::InsufficientFunds)
        ));
        ledger.canonical_reserve = u128::MAX;
        assert!(matches!(
            ledger.record_validated_deposit(1, 0),
            Err(LedgerError::Arithmetic)
        ));
    }

    #[test]
    fn failed_credit_overflow_preserves_every_field() {
        for overflow_fee in [false, true] {
            let mut ledger = LedgerState::new();
            if overflow_fee {
                ledger.fees_accrued = u128::MAX;
            } else {
                ledger.unsettled_operations = u64::MAX;
            }
            let before = ledger.clone();
            assert_eq!(
                ledger.record_validated_deposit(100, 1),
                Err(LedgerError::Arithmetic)
            );
            assert_eq!(ledger, before);
        }
    }

    #[test]
    fn failed_mint_operation_count_preserves_credit_and_supply() {
        let mut ledger = LedgerState::new();
        ledger.record_validated_deposit(100, 0).unwrap();
        ledger.unsettled_operations = 0;
        let before = ledger.clone();
        assert_eq!(
            ledger.record_mint(100, 0),
            Err(LedgerError::InvalidOperationCount)
        );
        assert_eq!(ledger, before);
    }

    #[test]
    fn failed_burn_late_overflow_preserves_supply_and_obligations() {
        for overflow_fee in [false, true] {
            let mut ledger = LedgerState::new();
            ledger.record_validated_deposit(100, 0).unwrap();
            ledger.record_mint(100, 0).unwrap();
            if overflow_fee {
                ledger.fees_accrued = u128::MAX;
            } else {
                ledger.unsettled_operations = u64::MAX;
            }
            let before = ledger.clone();
            assert_eq!(
                ledger.record_burn_request(10, 1),
                Err(LedgerError::Arithmetic)
            );
            assert_eq!(ledger, before);
        }
    }

    #[test]
    fn failed_payout_settlement_preserves_broadcast_liability_and_reserve() {
        for overflow_total in [false, true] {
            let mut ledger = LedgerState::new();
            ledger.record_validated_deposit(100, 0).unwrap();
            ledger.record_mint(100, 0).unwrap();
            ledger.record_burn_request(10, 0).unwrap();
            ledger.reserve_withdrawal_utxos(10).unwrap();
            ledger.record_payout_broadcast(10).unwrap();
            let error = if overflow_total {
                ledger.finalized_payouts = u128::MAX;
                LedgerError::Arithmetic
            } else {
                ledger.unsettled_operations = 0;
                LedgerError::InvalidOperationCount
            };
            let before = ledger.clone();
            assert_eq!(ledger.record_payout_settlement(10), Err(error));
            assert_eq!(ledger, before);
        }
    }

    #[test]
    fn invalid_snapshot_cannot_be_silently_repaired_by_any_transition() {
        let inconsistent = LedgerState {
            minted_supply: 100,
            authorized_unminted_credits: 100,
            burned_unpaid_withdrawals: 100,
            reserved_utxo_liabilities: 100,
            broadcast_payout_liabilities: 100,
            unsettled_operations: 3,
            ..LedgerState::new()
        };
        for index in 0..8 {
            let mut ledger = inconsistent.clone();
            let result = match index {
                0 => ledger.record_validated_deposit(100, 0),
                1 => ledger.record_mint(100, 0),
                2 => ledger.record_burn_request(100, 0),
                3 => ledger.reserve_withdrawal_utxos(100),
                4 => ledger.record_payout_broadcast(100),
                5 => ledger.record_payout_settlement(100),
                6 => ledger.record_reserve_donation(1_000),
                _ => ledger.record_reserve_donation(u64::MAX),
            };
            assert_eq!(result, Err(LedgerError::InsufficientBacking));
            assert_eq!(ledger, inconsistent);
        }
    }

    #[test]
    fn zero_and_fee_exhausted_operations_never_change_accounting() {
        let mut ledger = LedgerState::new();
        let before = ledger.clone();
        assert_eq!(
            ledger.record_validated_deposit(0, 0),
            Err(LedgerError::AmountZero)
        );
        assert_eq!(
            ledger.record_validated_deposit(1, 1),
            Err(LedgerError::AmountZero)
        );
        assert_eq!(ledger.record_mint(0, 0), Err(LedgerError::AmountZero));
        assert_eq!(
            ledger.record_burn_request(0, 0),
            Err(LedgerError::AmountZero)
        );
        assert_eq!(
            ledger.record_burn_request(1, 1),
            Err(LedgerError::AmountZero)
        );
        assert_eq!(
            ledger.reserve_withdrawal_utxos(0),
            Err(LedgerError::AmountZero)
        );
        assert_eq!(
            ledger.record_payout_broadcast(0),
            Err(LedgerError::AmountZero)
        );
        assert_eq!(
            ledger.record_payout_settlement(0),
            Err(LedgerError::AmountZero)
        );
        assert_eq!(
            ledger.record_reserve_donation(0),
            Err(LedgerError::AmountZero)
        );
        assert_eq!(ledger, before);
    }
}
