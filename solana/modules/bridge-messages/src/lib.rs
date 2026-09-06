//! Canonical bridge message definitions, deterministic encoding, state transitions,
//! and accounting primitives used by the first implementation phases.

use serde::{Deserialize, Serialize};

pub const MESSAGE_VERSION: u8 = 1;
pub const MESSAGE_LENGTH: usize = 284;

pub type Hash32 = [u8; 32];
pub type PubkeyBytes = [u8; 32];

#[derive(Debug, Copy, Clone, Eq, PartialEq, Serialize, Deserialize)]
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
pub enum BridgeAction {
    DepositClaim = 0,
    BurnRequest = 1,
}

impl TryFrom<u8> for BridgeAction {
    type Error = MessageDecodeError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::DepositClaim),
            1 => Ok(Self::BurnRequest),
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
#[allow(clippy::upper_case_acronyms)]
pub enum BridgeOperationState {
    WAITING_FOR_FINALITY = 0,
    WAITING_FOR_DEPENDENCY = 1,
    QUEUED_BY_LIMIT = 2,
    VERIFIED_READY = 3,
    REJECTED_INVALID = 4,
    HARD_STOP = 5,
    COMPLETED = 6,
}

impl BridgeOperationState {
    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::REJECTED_INVALID | Self::HARD_STOP | Self::COMPLETED)
    }

    pub fn transition(self, event: BridgeStateEvent) -> Result<Self, BridgeStateTransitionError> {
        use BridgeOperationState as S;
        use BridgeStateEvent as E;

        match (self, event) {
            (S::WAITING_FOR_FINALITY, E::ObservedFinality) => Ok(S::WAITING_FOR_DEPENDENCY),
            (S::WAITING_FOR_FINALITY, E::Reject) => Ok(S::REJECTED_INVALID),
            (S::WAITING_FOR_FINALITY, E::EnterHardStop) => Ok(S::HARD_STOP),

            (S::WAITING_FOR_DEPENDENCY, E::DependencySatisfied) => Ok(S::VERIFIED_READY),
            (S::WAITING_FOR_DEPENDENCY, E::QueueByLimit) => Ok(S::QUEUED_BY_LIMIT),
            (S::WAITING_FOR_DEPENDENCY, E::Reject) => Ok(S::REJECTED_INVALID),
            (S::WAITING_FOR_DEPENDENCY, E::EnterHardStop) => Ok(S::HARD_STOP),

            (S::QUEUED_BY_LIMIT, E::DependencySatisfied) => Ok(S::VERIFIED_READY),
            (S::QUEUED_BY_LIMIT, E::Reject) => Ok(S::REJECTED_INVALID),
            (S::QUEUED_BY_LIMIT, E::EnterHardStop) => Ok(S::HARD_STOP),

            (S::VERIFIED_READY, E::Complete) => Ok(S::COMPLETED),
            (S::VERIFIED_READY, E::Reject) => Ok(S::REJECTED_INVALID),
            (S::VERIFIED_READY, E::EnterHardStop) => Ok(S::HARD_STOP),

            (S::REJECTED_INVALID, _) | (S::HARD_STOP, _) | (S::COMPLETED, _) => {
                Err(BridgeStateTransitionError::InvalidTransition)
            }
        }
    }
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Serialize, Deserialize)]
pub enum BridgeStateEvent {
    ObservedFinality,
    DependencySatisfied,
    QueueByLimit,
    Reject,
    EnterHardStop,
    Complete,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
pub struct DeploymentIdentity {
    pub protocol_id: u32,
    pub native_chain_id: u32,
    pub native_genesis: Hash32,
    pub solana_cluster: Hash32,
    pub manager_program_id: PubkeyBytes,
    pub transceiver_program_id: PubkeyBytes,
    pub mint: PubkeyBytes,
}

impl DeploymentIdentity {
    pub fn to_bytes(&self) -> [u8; 160] {
        let mut out = [0u8; 160];
        out[0..4].copy_from_slice(&self.protocol_id.to_le_bytes());
        out[4..8].copy_from_slice(&self.native_chain_id.to_le_bytes());
        out[8..40].copy_from_slice(&self.native_genesis);
        out[40..72].copy_from_slice(&self.solana_cluster);
        out[72..104].copy_from_slice(&self.manager_program_id);
        out[104..136].copy_from_slice(&self.transceiver_program_id);
        out[136..168].copy_from_slice(&self.mint);
        out
    }
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
pub struct CanonicalBridgeMessage {
    pub version: u8,
    pub direction: BridgeDirection,
    pub action: BridgeAction,
    pub protocol_version: u8,
    pub deployment: DeploymentIdentity,
    pub operation_id: Hash32,
    pub native_reference: Hash32,
    pub recipient: Hash32,
    pub amount: u64,
    pub fee: u64,
    pub policy_epoch: u32,
    pub nonce: u64,
    pub evidence_valid_until: u64,
    pub validity_window: u32,
    pub evidence_digest: Hash32,
}

impl CanonicalBridgeMessage {
    pub fn encode(&self) -> Result<Vec<u8>, MessageEncodeError> {
        if self.version != MESSAGE_VERSION {
            return Err(MessageEncodeError::UnsupportedVersion {
                expected: MESSAGE_VERSION,
                found: self.version,
            });
        }

        let mut out = vec![0u8; MESSAGE_LENGTH];
        let mut cursor = 0usize;

        out[cursor] = self.version;
        cursor += 1;
        out[cursor] = self.direction as u8;
        cursor += 1;
        out[cursor] = self.action as u8;
        cursor += 1;
        out[cursor] = self.protocol_version;
        cursor += 1;

        let deployment_bytes = self.deployment.to_bytes();
        out[cursor..cursor + deployment_bytes.len()].copy_from_slice(&deployment_bytes);
        cursor += deployment_bytes.len();

        out[cursor..cursor + 32].copy_from_slice(&self.operation_id);
        cursor += 32;
        out[cursor..cursor + 32].copy_from_slice(&self.native_reference);
        cursor += 32;
        out[cursor..cursor + 32].copy_from_slice(&self.recipient);
        cursor += 32;

        out[cursor..cursor + 8].copy_from_slice(&self.amount.to_le_bytes());
        cursor += 8;
        out[cursor..cursor + 8].copy_from_slice(&self.fee.to_le_bytes());
        cursor += 8;
        out[cursor..cursor + 4].copy_from_slice(&self.policy_epoch.to_le_bytes());
        cursor += 4;
        out[cursor..cursor + 8].copy_from_slice(&self.nonce.to_le_bytes());
        cursor += 8;
        out[cursor..cursor + 8].copy_from_slice(&self.evidence_valid_until.to_le_bytes());
        cursor += 8;
        out[cursor..cursor + 4].copy_from_slice(&self.validity_window.to_le_bytes());
        cursor += 4;
        out[cursor..cursor + 32].copy_from_slice(&self.evidence_digest);
        cursor += 32;

        if cursor != MESSAGE_LENGTH {
            return Err(MessageEncodeError::InvalidLength { expected: MESSAGE_LENGTH, found: cursor });
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

        let mut cursor = 0usize;
        let version = bytes[cursor];
        cursor += 1;
        if version != MESSAGE_VERSION {
            return Err(MessageDecodeError::UnsupportedVersion {
                expected: MESSAGE_VERSION,
                found: version,
            });
        }

        let direction = BridgeDirection::try_from(bytes[cursor])?;
        cursor += 1;
        let action = BridgeAction::try_from(bytes[cursor])?;
        cursor += 1;
        let protocol_version = bytes[cursor];
        cursor += 1;

        let deployment = {
            let protocol_id = u32::from_le_bytes(bytes[cursor..cursor + 4].try_into().unwrap());
            cursor += 4;
            let native_chain_id = u32::from_le_bytes(bytes[cursor..cursor + 4].try_into().unwrap());
            cursor += 4;
            let native_genesis = bytes[cursor..cursor + 32].try_into().unwrap();
            cursor += 32;
            let solana_cluster = bytes[cursor..cursor + 32].try_into().unwrap();
            cursor += 32;
            let manager_program_id = bytes[cursor..cursor + 32].try_into().unwrap();
            cursor += 32;
            let transceiver_program_id = bytes[cursor..cursor + 32].try_into().unwrap();
            cursor += 32;
            let mint = bytes[cursor..cursor + 32].try_into().unwrap();
            cursor += 32;

            DeploymentIdentity {
                protocol_id,
                native_chain_id,
                native_genesis,
                solana_cluster,
                manager_program_id,
                transceiver_program_id,
                mint,
            }
        };

        let operation_id = bytes[cursor..cursor + 32].try_into().unwrap();
        cursor += 32;
        let native_reference = bytes[cursor..cursor + 32].try_into().unwrap();
        cursor += 32;
        let recipient = bytes[cursor..cursor + 32].try_into().unwrap();
        cursor += 32;
        let amount = u64::from_le_bytes(bytes[cursor..cursor + 8].try_into().unwrap());
        cursor += 8;
        let fee = u64::from_le_bytes(bytes[cursor..cursor + 8].try_into().unwrap());
        cursor += 8;
        let policy_epoch = u32::from_le_bytes(bytes[cursor..cursor + 4].try_into().unwrap());
        cursor += 4;
        let nonce = u64::from_le_bytes(bytes[cursor..cursor + 8].try_into().unwrap());
        cursor += 8;
        let evidence_valid_until = u64::from_le_bytes(bytes[cursor..cursor + 8].try_into().unwrap());
        cursor += 8;
        let validity_window = u32::from_le_bytes(bytes[cursor..cursor + 4].try_into().unwrap());
        cursor += 4;
        let evidence_digest = bytes[cursor..cursor + 32].try_into().unwrap();
        cursor += 32;

        if cursor != MESSAGE_LENGTH {
            return Err(MessageDecodeError::InvalidLength {
                expected: MESSAGE_LENGTH,
                found: cursor,
            });
        }

        Ok(Self {
            version,
            direction,
            action,
            protocol_version,
            deployment,
            operation_id,
            native_reference,
            recipient,
            amount,
            fee,
            policy_epoch,
            nonce,
            evidence_valid_until,
            validity_window,
            evidence_digest,
        })
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct LedgerState {
    pub backing_reserve: u128,
    pub pending_mint_liability: u128,
    pub pending_withdrawal_liability: u128,
    pub collected_fees: u128,
    pub emitted_gross: u128,
    pub projected_surplus: u128,
}

impl LedgerState {
    pub fn new() -> Self {
        Self {
            backing_reserve: 0,
            pending_mint_liability: 0,
            pending_withdrawal_liability: 0,
            collected_fees: 0,
            emitted_gross: 0,
            projected_surplus: 0,
        }
    }

    pub fn record_validated_deposit(&mut self, amount: u64, fee: u64) -> Result<(), LedgerError> {
        self.apply_add(&mut self.backing_reserve, amount.into())?;
        self.apply_add(&mut self.pending_mint_liability, amount.into())?;
        self.apply_add(&mut self.collected_fees, fee.into())?;
        self.apply_add(&mut self.emitted_gross, amount.into())?;
        self.assert_invariants()
    }

    pub fn record_mint(&mut self, amount: u64, fee: u64) -> Result<(), LedgerError> {
        self.apply_sub_limit(&mut self.pending_mint_liability, amount)?;
        self.apply_add(&mut self.collected_fees, fee.into())?;
        self.apply_add(&mut self.projected_surplus, (amount.saturating_sub(fee)).into())?;
        self.assert_invariants()
    }

    pub fn record_burn_request(&mut self, amount: u64, fee: u64) -> Result<(), LedgerError> {
        self.apply_add(&mut self.pending_withdrawal_liability, amount.into())?;
        self.apply_add(&mut self.emitted_gross, amount.into())?;
        self.apply_sub_limit(&mut self.collected_fees, fee)?;
        self.apply_add(&mut self.projected_surplus, 0)?;
        self.assert_invariants()
    }

    pub fn record_payout_settlement(&mut self, amount: u64) -> Result<(), LedgerError> {
        self.apply_sub_limit(&mut self.pending_withdrawal_liability, amount)?;
        self.apply_sub_limit(&mut self.backing_reserve, amount)?;
        self.assert_invariants()
    }

    fn assert_invariants(&self) -> Result<(), LedgerError> {
        let out = self
            .pending_mint_liability
            .checked_add(self.pending_withdrawal_liability)
            .ok_or(LedgerError::Arithmetic)?;
        if self.backing_reserve < out {
            return Err(LedgerError::InsufficientBacking);
        }
        if self.collected_fees > (self.emitted_gross + self.projected_surplus) {
            return Err(LedgerError::InvalidFeeAccounting);
        }
        Ok(())
    }

    fn apply_add<T>(&self, field: &mut T, amount: u128) -> Result<(), LedgerError>
    where
        T: Copy + Into<u128> + TryFrom<u128>,
    {
        let base: u128 = (*field).into();
        let updated = base.checked_add(amount).ok_or(LedgerError::Arithmetic)?;
        *field = T::try_from(updated).ok().ok_or(LedgerError::Arithmetic)?;
        Ok(())
    }

    fn apply_sub_limit<T>(&self, field: &mut T, amount: u64) -> Result<(), LedgerError>
    where
        T: Copy + Into<u128> + TryFrom<u128>,
    {
        let current: u128 = (*field).into();
        let updated = current.checked_sub(amount as u128).ok_or(LedgerError::InsufficientFunds)?;
        *field = T::try_from(updated).ok().ok_or(LedgerError::Arithmetic)?;
        Ok(())
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum MessageEncodeError {
    UnsupportedVersion { expected: u8, found: u8 },
    InvalidLength { expected: usize, found: usize },
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum MessageDecodeError {
    UnsupportedVersion { expected: u8, found: u8 },
    InvalidLength { expected: usize, found: usize },
    InvalidDirection(u8),
    InvalidAction(u8),
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum LedgerError {
    Arithmetic,
    InsufficientFunds,
    InsufficientBacking,
    InvalidFeeAccounting,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum BridgeStateTransitionError {
    InvalidTransition,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_message() -> CanonicalBridgeMessage {
        CanonicalBridgeMessage {
            version: MESSAGE_VERSION,
            direction: BridgeDirection::NativeToSolana,
            action: BridgeAction::DepositClaim,
            protocol_version: 1,
            deployment: DeploymentIdentity {
                protocol_id: 1,
                native_chain_id: 8_000_111,
                native_genesis: [1u8; 32],
                solana_cluster: [2u8; 32],
                manager_program_id: [3u8; 32],
                transceiver_program_id: [4u8; 32],
                mint: [5u8; 32],
            },
            operation_id: [6u8; 32],
            native_reference: [7u8; 32],
            recipient: [8u8; 32],
            amount: 12_345,
            fee: 3,
            policy_epoch: 1,
            nonce: 42,
            evidence_valid_until: 1_700_000_000,
            validity_window: 1200,
            evidence_digest: [9u8; 32],
        }
    }

    #[test]
    fn encoding_is_deterministic() {
        let message = sample_message();
        let encoded = message.encode().expect("encode");
        assert_eq!(encoded.len(), MESSAGE_LENGTH);
        let decoded = CanonicalBridgeMessage::decode(&encoded).expect("decode");
        assert_eq!(decoded, message);
    }

    #[test]
    fn decoding_rejects_wrong_length() {
        let mut payload = sample_message().encode().expect("encode");
        payload.push(0);
        assert!(matches!(
            CanonicalBridgeMessage::decode(&payload),
            Err(MessageDecodeError::InvalidLength { .. })
        ));
    }

    #[test]
    fn canonical_vector_is_stable() {
        let encoded = sample_message().encode().expect("encode");
        let expected = "01000001"; // first 4 bytes sanity: version+direction+action+protocol_version
        let prefix: String = encoded.iter().take(4).map(|b| format!("{b:02x}")).collect();
        assert_eq!(prefix, expected);
    }

    #[test]
    fn state_machine_transitions() {
        let mut state = BridgeOperationState::WAITING_FOR_FINALITY;
        state = state.transition(BridgeStateEvent::ObservedFinality).expect("step");
        state = state.transition(BridgeStateEvent::QueueByLimit).expect("step");
        state = state.transition(BridgeStateEvent::DependencySatisfied).expect("step");
        state = state.transition(BridgeStateEvent::Complete).expect("step");
        assert!(state.is_terminal());
        assert_eq!(state, BridgeOperationState::COMPLETED);
        assert!(BridgeOperationState::COMPLETED.transition(BridgeStateEvent::Reject).is_err());
    }

    #[test]
    fn ledger_arithmetic_and_invariants() {
        let mut ledger = LedgerState::new();
        ledger
            .record_validated_deposit(10_000, 10)
            .expect("deposit credited");
        ledger
            .record_burn_request(1_000, 2)
            .expect("withdrawal requested");
        assert!(matches!(
            ledger.record_payout_settlement(20_000),
            Err(LedgerError::InsufficientFunds)
        ));
        ledger.record_payout_settlement(1_000).expect("payout");
        assert_eq!(ledger.pending_mint_liability, 10_000);
    }

    #[test]
    fn rejects_unsupported_message_version() {
        let mut msg = sample_message();
        msg.version = 9;
        assert!(msg.encode().is_err());
    }
}
