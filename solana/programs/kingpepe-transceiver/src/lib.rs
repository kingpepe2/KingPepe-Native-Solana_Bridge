//! KingPepe transceiver boundary model.
//!
//! Phase 05 implements the receipt, replay, and domain-validation logic that
//! the bridge manager consumes. Phase 07 adds attestation service integration
//! and Solana Ed25519 instruction parsing. No caller-provided `proofVerified`
//! style shortcut exists in this boundary.

use std::collections::{BTreeMap, BTreeSet};

use bridge_messages::{BridgeAction, BridgeDirection, CanonicalBridgeMessage, Hash32, PubkeyBytes};
use thiserror::Error;

pub const PROGRAM_NAME: &str = "kingpepe_transceiver";

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

    #[test]
    fn transceiver_default_has_no_verifications() {
        let program = TransceiverProgram::initialize(config()).unwrap();
        assert_eq!(program.verified_messages(), 0);
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
