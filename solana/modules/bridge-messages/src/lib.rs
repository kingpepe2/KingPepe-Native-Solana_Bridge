//! Canonical bridge message definitions, deterministic binary encoding,
//! operation identity derivation, lifecycle states, and exact accounting
//! primitives for the KingPepe Native - Solana bridge.

use borsh::{BorshDeserialize, BorshSerialize};
use serde::{Deserialize, Serialize};
use solana_sha256_hasher::{hash, hashv};

pub mod abi;
pub mod burn;

pub const PROTOCOL_MAGIC: [u8; 8] = *b"KPBRMSG4";
pub const MESSAGE_VERSION: u8 = 4;
pub const DEPLOYMENT_IDENTITY_LENGTH: usize = 168;
pub const NATIVE_OUTPOINT_LENGTH: usize = 36;
pub const MAX_DESTINATION_LENGTH: usize = 128;
pub const MESSAGE_LENGTH: usize = burn::BURN_MESSAGE_LENGTH;

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
    Some(
        hashv(&[
            b"KINGPEPE_MAINNET_DEPLOYMENT_V1\0",
            &NATIVE_MAINNET_GENESIS,
            &SOLANA_MAINNET_GENESIS,
            manager,
            transceiver,
            mint,
        ])
        .to_bytes(),
    )
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

// The program-facing view is derived entirely from the one accepted V4 burn
// wire format. Redundant fields are checked against that evidence on every use.
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
    pub burn_evidence: burn::FinalizedBurnEvidence,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
pub struct DepositClaimFields {
    pub evidence: burn::FinalizedBurnEvidence,
    pub epochs: MessageEpochs,
    pub validity: ValidityWindow,
}

impl CanonicalBridgeMessage {
    pub fn new_deposit_claim(fields: DepositClaimFields) -> Result<Self, MessageEncodeError> {
        let wire = burn::CanonicalBurnMessage {
            magic: PROTOCOL_MAGIC,
            version: MESSAGE_VERSION,
            evidence: fields.evidence,
            policy_epoch: fields.epochs.policy_epoch,
            key_epoch: fields.epochs.key_epoch,
            valid_from: fields.validity.valid_from,
            valid_until: fields.validity.valid_until,
        };
        wire.validate()
            .map_err(|_| MessageEncodeError::InvalidBurnEvidence)?;
        Self::from_wire(wire)
    }

    fn from_wire(wire: burn::CanonicalBurnMessage) -> Result<Self, MessageEncodeError> {
        let e = &wire.evidence;
        let b = &e.binding;
        Ok(Self {
            version: MESSAGE_VERSION,
            direction: BridgeDirection::NativeToSolana,
            action: BridgeAction::DepositClaim,
            deployment: DeploymentIdentity {
                protocol_id: b.protocol_id,
                native_network: b.native_network,
                native_genesis: b.native_genesis,
                solana_deployment: b.solana_deployment,
                manager_program_id: b.bridge_program,
                transceiver_program_id: b.transceiver_program,
                mint: b.mint,
            },
            operation_id: e.operation_id,
            deposit_outpoint: NativeOutpoint {
                txid: e.deposit.txid,
                vout: e.deposit.vout,
            },
            amount_atomic: e.amount_atomic,
            fee_atomic: 0,
            destination: b.destination.to_vec(),
            policy_epoch: wire.policy_epoch,
            key_epoch: wire.key_epoch,
            nonce: b.nonce,
            valid_from: wire.valid_from,
            valid_until: wire.valid_until,
            evidence_digest: hash(
                &e.to_bytes()
                    .map_err(|_| MessageEncodeError::InvalidBurnEvidence)?,
            )
            .to_bytes(),
            burn_evidence: wire.evidence,
        })
    }

    fn wire(&self) -> burn::CanonicalBurnMessage {
        burn::CanonicalBurnMessage {
            magic: PROTOCOL_MAGIC,
            version: self.version,
            evidence: self.burn_evidence.clone(),
            policy_epoch: self.policy_epoch,
            key_epoch: self.key_epoch,
            valid_from: self.valid_from,
            valid_until: self.valid_until,
        }
    }

    pub fn encode(&self) -> Result<Vec<u8>, MessageEncodeError> {
        self.validate()?;
        self.wire()
            .encode()
            .map_err(|_| MessageEncodeError::InvalidBurnEvidence)
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, MessageDecodeError> {
        if bytes.len() != MESSAGE_LENGTH {
            return Err(MessageDecodeError::InvalidLength {
                expected: MESSAGE_LENGTH,
                found: bytes.len(),
            });
        }
        if bytes[..8] != PROTOCOL_MAGIC {
            return Err(MessageDecodeError::InvalidMagic);
        }
        if bytes[8] != MESSAGE_VERSION {
            return Err(MessageDecodeError::UnsupportedVersion {
                expected: MESSAGE_VERSION,
                found: bytes[8],
            });
        }
        let wire = burn::CanonicalBurnMessage::decode(bytes)
            .map_err(|_| MessageDecodeError::InvalidBorsh)?;
        Self::from_wire(wire).map_err(MessageDecodeError::Validation)
    }

    // Operation identity is bound BEFORE address issuance. Epoch/expiry changes
    // never create another operation; deposit and burn replay markers are also
    // independent of operation IDs and authorization envelopes.
    pub fn encode_operation_id_inputs(&self) -> Result<Vec<u8>, MessageEncodeError> {
        if self.version != MESSAGE_VERSION {
            return Err(MessageEncodeError::UnsupportedVersion {
                expected: MESSAGE_VERSION,
                found: self.version,
            });
        }
        self.burn_evidence
            .binding
            .validate()
            .map_err(|_| MessageEncodeError::InvalidBurnEvidence)?;
        Ok(self
            .burn_evidence
            .binding
            .to_bytes()
            .map_err(|_| MessageEncodeError::BorshEncoding)?
            .to_vec())
    }
    pub fn derive_operation_id(&self) -> Result<Hash32, MessageEncodeError> {
        if self.version != MESSAGE_VERSION {
            return Err(MessageEncodeError::UnsupportedVersion {
                expected: MESSAGE_VERSION,
                found: self.version,
            });
        }
        self.burn_evidence
            .binding
            .operation_id()
            .map_err(|_| MessageEncodeError::InvalidBurnEvidence)
    }
    pub fn message_digest(&self) -> Result<Hash32, MessageEncodeError> {
        self.validate()?;
        self.wire()
            .digest()
            .map_err(|_| MessageEncodeError::InvalidBurnEvidence)
    }
    pub fn validate(&self) -> Result<(), MessageEncodeError> {
        if self.version != MESSAGE_VERSION {
            return Err(MessageEncodeError::UnsupportedVersion {
                expected: MESSAGE_VERSION,
                found: self.version,
            });
        }
        if self.fee_atomic != 0 {
            return Err(MessageEncodeError::FeeExceedsAmount);
        }
        if self.amount_atomic == 0 {
            return Err(MessageEncodeError::AmountZero);
        }
        if self.policy_epoch == 0 || self.key_epoch == 0 {
            return Err(MessageEncodeError::EpochZero);
        }
        if self.valid_until <= self.valid_from {
            return Err(MessageEncodeError::InvalidValidityWindow);
        }
        if self.operation_id != self.derive_operation_id()? {
            return Err(MessageEncodeError::OperationIdMismatch);
        }
        self.wire()
            .validate()
            .map_err(|_| MessageEncodeError::InvalidBurnEvidence)?;
        if Self::from_wire(self.wire())? != *self {
            return Err(MessageEncodeError::BurnEvidenceBindingMismatch);
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
pub enum MessageEncodeError {
    InvalidBurnEvidence,
    BurnEvidenceBindingMismatch,
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

#[cfg(test)]
mod tests {
    mod burn_fixture {
        use crate as bridge_messages;
        include!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/support/burn-fixture.rs"
        ));
    }
    use burn_fixture::{burn_message, TestBurnFields};

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
        burn_message(TestBurnFields {
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
    fn finalized_evidence_and_projection_cannot_disagree() {
        let mut message = sample_deposit_message();
        message.destination[0] ^= 1;
        assert_eq!(
            message.encode(),
            Err(MessageEncodeError::BurnEvidenceBindingMismatch)
        );
        let mut message = sample_deposit_message();
        message.burn_evidence.burn_height = message.burn_evidence.deposit_height + 11;
        assert_eq!(
            message.encode(),
            Err(MessageEncodeError::InvalidBurnEvidence)
        );
    }

    #[test]
    fn canonical_vector_prefix_is_stable() {
        let encoded = sample_deposit_message().encode().expect("encode");
        let prefix = hex_lower(&encoded[..9]);
        assert_eq!(prefix, "4b5042524d53473404");
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
    fn only_burn_message_domain_is_decodable() {
        let encoded = sample_deposit_message().encode().unwrap();
        for index in 0..9 {
            let mut wrong = encoded.clone();
            wrong[index] ^= 1;
            assert!(CanonicalBridgeMessage::decode(&wrong).is_err());
        }
        assert!(CanonicalBridgeMessage::decode(&vec![0; 482]).is_err());
    }
}
