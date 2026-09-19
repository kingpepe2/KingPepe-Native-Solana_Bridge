//! Canonical bridge message definitions, deterministic binary encoding,
//! operation identity derivation, lifecycle states, and exact accounting
//! primitives for the KingPepe Native - Solana bridge.

use borsh::{BorshDeserialize, BorshSerialize};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub mod abi;
pub mod inputs;

pub const PROTOCOL_MAGIC: [u8; 8] = *b"KPEPBRG3";
pub const MESSAGE_VERSION: u8 = 3;
pub const DEPLOYMENT_IDENTITY_LENGTH: usize = 168;
pub const NATIVE_OUTPOINT_LENGTH: usize = 36;
pub const MAX_DESTINATION_LENGTH: usize = 128;
pub const MESSAGE_LENGTH: usize = 482;

pub type Hash32 = [u8; 32];
pub type PubkeyBytes = [u8; 32];

// Pinned KingPepe Native Mainnet consensus identity and Solana Mainnet genesis.
// The RPC clients must also verify the actual cluster: programs cannot query
// getGenesisHash through a Solana sysvar. This commitment prevents substituting
// another deployment's identities inside the canonical signed message.
pub const NATIVE_MAINNET_DOMAIN: u32 = 0x21ce_eaf3;
pub const NATIVE_MAINNET_GENESIS: Hash32 = [
    0x00, 0x00, 0x0a, 0x00, 0xa7, 0x5c, 0x7e, 0xd1, 0x2c, 0x71, 0xb9, 0xa8, 0xb7, 0x3c, 0x01, 0x57,
    0x60, 0x09, 0xd6, 0x2a, 0x0a, 0x60, 0x6c, 0x0a, 0x1e, 0xf3, 0x7b, 0x04, 0x3c, 0x52, 0x0f, 0xb2,
];
pub const SOLANA_MAINNET_GENESIS: Hash32 = [
    0x45, 0x29, 0x69, 0x98, 0xa6, 0xf8, 0xe2, 0xa7, 0x84, 0xdb, 0x5d, 0x9f, 0x95, 0xe1, 0x8f, 0xc2,
    0x3f, 0x70, 0x44, 0x1a, 0x10, 0x39, 0x44, 0x68, 0x01, 0x08, 0x98, 0x79, 0xb0, 0x8c, 0x7e, 0xf0,
];

pub fn mainnet_deployment_identity(
    manager: &PubkeyBytes,
    transceiver: &PubkeyBytes,
    mint: &PubkeyBytes,
) -> Option<Hash32> {
    if [manager, transceiver, mint].contains(&&[0; 32])
        || manager == transceiver
        || manager == mint
        || transceiver == mint
    {
        return None;
    }
    let mut hash = Sha256::new();
    hash.update(b"KINGPEPE_MAINNET_DEPLOYMENT_V1\0");
    hash.update(NATIVE_MAINNET_GENESIS);
    hash.update(SOLANA_MAINNET_GENESIS);
    hash.update(manager);
    hash.update(transceiver);
    hash.update(mint);
    Some(hash.finalize().into())
}

#[cfg(test)]
mod mainnet_identity_tests {
    use super::*;

    #[test]
    fn mainnet_commitment_matches_javascript_and_rejects_substituted_fields() {
        let commitment = mainnet_deployment_identity(&[1; 32], &[2; 32], &[3; 32]).unwrap();
        assert_eq!(
            commitment
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>(),
            "f468d52edb30158677499d8258218786c1e5883777bf584f1a43b3b148e9b997"
        );
        let valid = DeploymentIdentity {
            protocol_id: 1,
            native_network: NATIVE_MAINNET_DOMAIN,
            native_genesis: NATIVE_MAINNET_GENESIS,
            solana_deployment: commitment,
            manager_program_id: [1; 32],
            transceiver_program_id: [2; 32],
            mint: [3; 32],
        };
        assert!(valid.is_mainnet_bound());
        for field in 0..7 {
            let mut changed = valid.clone();
            match field {
                0 => changed.protocol_id = 2,
                1 => changed.native_network = 8_000_111,
                2 => changed.native_genesis[0] ^= 1,
                3 => changed.solana_deployment[0] ^= 1,
                4 => changed.manager_program_id[0] ^= 1,
                5 => changed.transceiver_program_id[0] ^= 1,
                _ => changed.mint[0] ^= 1,
            }
            assert!(!changed.is_mainnet_bound());
        }
        assert_eq!(
            mainnet_deployment_identity(&[0; 32], &[2; 32], &[3; 32]),
            None
        );
        assert_eq!(
            mainnet_deployment_identity(&[1; 32], &[1; 32], &[3; 32]),
            None
        );
    }
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[repr(u8)]
pub enum BridgeDirection {
    NativeToSolana = 0,
}

impl TryFrom<u8> for BridgeDirection {
    type Error = MessageDecodeError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::NativeToSolana),
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
}

impl TryFrom<u8> for BridgeAction {
    type Error = MessageDecodeError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::DepositClaim),
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

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
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
    pub fn is_mainnet_bound(&self) -> bool {
        self.protocol_id == 1
            && self.native_network == NATIVE_MAINNET_DOMAIN
            && self.native_genesis == NATIVE_MAINNET_GENESIS
            && mainnet_deployment_identity(
                &self.manager_program_id,
                &self.transceiver_program_id,
                &self.mint,
            ) == Some(self.solana_deployment)
    }

    pub fn to_bytes(&self) -> [u8; DEPLOYMENT_IDENTITY_LENGTH] {
        let mut out = [0u8; DEPLOYMENT_IDENTITY_LENGTH];
        borsh::to_writer(&mut out[..], self).expect("fixed deployment schema length");
        out
    }
}

#[derive(
    Debug, Copy, Clone, Eq, PartialEq, Serialize, Deserialize, BorshSerialize, BorshDeserialize,
)]
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
        borsh::to_writer(&mut out[..], self).expect("fixed outpoint schema length");
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

// These are the sole Borsh wire schemas; CanonicalBridgeMessage remains the
// economic model. Destination length + fixed storage is deliberate: bounded
// Solana instruction sizes, with exactly one accepted zero-padded encoding.
#[derive(BorshSerialize, BorshDeserialize)]
struct BorshBridgeMessage {
    magic: [u8; 8],
    version: u8,
    action: u8,
    direction: u8,
    reserved: u8,
    deployment: DeploymentIdentity,
    operation_id: Hash32,
    deposit_outpoint: NativeOutpoint,
    amount_atomic: u64,
    fee_atomic: u64,
    destination_length: u16,
    destination_padded: [u8; MAX_DESTINATION_LENGTH],
    policy_epoch: u32,
    key_epoch: u32,
    nonce: Hash32,
    valid_from: u64,
    valid_until: u64,
    evidence_digest: Hash32,
}

#[derive(BorshSerialize)]
struct OperationIdInputs<'a> {
    domain: [u8; 8],
    version: u8,
    action: u8,
    direction: u8,
    deployment: &'a DeploymentIdentity,
    deposit_outpoint: &'a NativeOutpoint,
    amount_atomic: u64,
    fee_atomic: u64,
    destination: &'a [u8],
    policy_epoch: u32,
    key_epoch: u32,
    nonce: Hash32,
    valid_from: u64,
    valid_until: u64,
    evidence_digest: Hash32,
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

    pub fn encode(&self) -> Result<Vec<u8>, MessageEncodeError> {
        self.validate()?;
        let mut destination_padded = [0; MAX_DESTINATION_LENGTH];
        destination_padded[..self.destination.len()].copy_from_slice(&self.destination);
        let wire = BorshBridgeMessage {
            magic: PROTOCOL_MAGIC,
            version: self.version,
            action: self.action as u8,
            direction: self.direction as u8,
            reserved: 0,
            deployment: self.deployment.clone(),
            operation_id: self.operation_id,
            deposit_outpoint: self.deposit_outpoint,
            amount_atomic: self.amount_atomic,
            fee_atomic: self.fee_atomic,
            destination_length: self.destination.len() as u16,
            destination_padded,
            policy_epoch: self.policy_epoch,
            key_epoch: self.key_epoch,
            nonce: self.nonce,
            valid_from: self.valid_from,
            valid_until: self.valid_until,
            evidence_digest: self.evidence_digest,
        };
        borsh::to_vec(&wire).map_err(|_| MessageEncodeError::BorshEncoding)
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, MessageDecodeError> {
        if bytes.len() != MESSAGE_LENGTH {
            return Err(MessageDecodeError::InvalidLength {
                expected: MESSAGE_LENGTH,
                found: bytes.len(),
            });
        }
        // from_slice rejects trailing data; no allocation controlled by input.
        let wire: BorshBridgeMessage =
            borsh::from_slice(bytes).map_err(|_| MessageDecodeError::InvalidBorsh)?;
        if wire.magic != PROTOCOL_MAGIC {
            return Err(MessageDecodeError::InvalidMagic);
        }
        if wire.version != MESSAGE_VERSION {
            return Err(MessageDecodeError::UnsupportedVersion {
                expected: MESSAGE_VERSION,
                found: wire.version,
            });
        }
        if wire.reserved != 0 {
            return Err(MessageDecodeError::NonZeroReservedByte);
        }
        let destination_len = usize::from(wire.destination_length);
        if destination_len > MAX_DESTINATION_LENGTH {
            return Err(MessageDecodeError::DestinationTooLong {
                max: MAX_DESTINATION_LENGTH,
                found: destination_len,
            });
        }
        if wire.destination_padded[destination_len..]
            .iter()
            .any(|byte| *byte != 0)
        {
            return Err(MessageDecodeError::NonZeroDestinationPadding);
        }
        let message = Self {
            version: wire.version,
            action: BridgeAction::try_from(wire.action)?,
            direction: BridgeDirection::try_from(wire.direction)?,
            deployment: wire.deployment,
            operation_id: wire.operation_id,
            deposit_outpoint: wire.deposit_outpoint,
            amount_atomic: wire.amount_atomic,
            fee_atomic: wire.fee_atomic,
            destination: wire.destination_padded[..destination_len].to_vec(),
            policy_epoch: wire.policy_epoch,
            key_epoch: wire.key_epoch,
            nonce: wire.nonce,
            valid_from: wire.valid_from,
            valid_until: wire.valid_until,
            evidence_digest: wire.evidence_digest,
        };
        message.validate().map_err(MessageDecodeError::Validation)?;
        Ok(message)
    }

    pub fn encode_operation_id_inputs(&self) -> Result<Vec<u8>, MessageEncodeError> {
        if self.version != MESSAGE_VERSION {
            return Err(MessageEncodeError::UnsupportedVersion {
                expected: MESSAGE_VERSION,
                found: self.version,
            });
        }
        validate_destination(&self.destination)?;
        let inputs = OperationIdInputs {
            domain: *b"KPEPID03",
            version: MESSAGE_VERSION,
            action: self.action as u8,
            direction: self.direction as u8,
            deployment: &self.deployment,
            deposit_outpoint: &self.deposit_outpoint,
            amount_atomic: self.amount_atomic,
            fee_atomic: self.fee_atomic,
            destination: &self.destination,
            policy_epoch: self.policy_epoch,
            key_epoch: self.key_epoch,
            nonce: self.nonce,
            valid_from: self.valid_from,
            valid_until: self.valid_until,
            evidence_digest: self.evidence_digest,
        };
        borsh::to_vec(&inputs).map_err(|_| MessageEncodeError::BorshEncoding)
    }

    pub fn derive_operation_id(&self) -> Result<Hash32, MessageEncodeError> {
        Ok(Sha256::digest(self.encode_operation_id_inputs()?).into())
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

        if self.deposit_outpoint.is_zero() {
            return Err(MessageEncodeError::MissingDepositOutpoint);
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
    pub fees_accrued: u128,
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
            fees_accrued: 0,
            unsettled_operations: 0,
        }
    }

    pub fn coverage_required(&self) -> Result<u128, LedgerError> {
        checked_sum(&[self.minted_supply, self.authorized_unminted_credits])
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

    pub fn record_reserve_donation(&mut self, amount: u64) -> Result<(), LedgerError> {
        require_positive_amount(amount)?;
        self.apply_transition(|next| {
            next.canonical_reserve = checked_add(next.canonical_reserve, amount as u128)?;
            Ok(())
        })
    }

    // A snapshot arithmetic model, not an operation journal or mint authority.
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
    BorshEncoding,
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
    OperationIdMismatch,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum MessageDecodeError {
    InvalidBorsh,
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
    fn operation_id_preimage_rejects_unsupported_version() {
        let mut message = sample_deposit_message();
        message.version = 1;
        assert!(matches!(
            message.encode_operation_id_inputs(),
            Err(MessageEncodeError::UnsupportedVersion {
                expected: MESSAGE_VERSION,
                found: 1
            })
        ));
        assert!(matches!(
            message.derive_operation_id(),
            Err(MessageEncodeError::UnsupportedVersion {
                expected: MESSAGE_VERSION,
                found: 1
            })
        ));
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
            12 + DEPLOYMENT_IDENTITY_LENGTH + 32 + NATIVE_OUTPOINT_LENGTH + 8 + 8 + 2 + 32;
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
        assert_eq!(prefix, "4b5045504252473303000000");
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
    fn only_forward_direction_and_action_are_decodable() {
        for tag in 1..=u8::MAX {
            let mut encoded = sample_deposit_message().encode().expect("encode");
            encoded[9] = tag;
            assert_eq!(
                CanonicalBridgeMessage::decode(&encoded),
                Err(MessageDecodeError::InvalidAction(tag))
            );
            encoded[9] = 0;
            encoded[10] = tag;
            assert_eq!(
                CanonicalBridgeMessage::decode(&encoded),
                Err(MessageDecodeError::InvalidDirection(tag))
            );
        }
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
    fn invalid_snapshot_cannot_be_silently_repaired_by_any_transition() {
        let inconsistent = LedgerState {
            minted_supply: 100,
            authorized_unminted_credits: 100,
            unsettled_operations: 3,
            ..LedgerState::new()
        };
        for index in 0..4 {
            let mut ledger = inconsistent.clone();
            let result = match index {
                0 => ledger.record_validated_deposit(100, 0),
                1 => ledger.record_mint(100, 0),
                2 => ledger.record_reserve_donation(1_000),
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
            ledger.record_reserve_donation(0),
            Err(LedgerError::AmountZero)
        );
        assert_eq!(ledger, before);
    }
}
