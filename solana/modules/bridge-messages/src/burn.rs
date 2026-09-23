//! Canonical one-way finalized Native burn evidence and Borsh V4 message.
//! Raw Native inclusion/finality is checked by the attesters. On-chain users
//! verify the signed context, exact amount, identities and replay state.
use borsh::{BorshDeserialize, BorshSerialize};
use serde::{Deserialize, Serialize};

pub const BURN_CONFIRMATIONS: u32 = 12;
pub const MAX_SUPPLY_ATOMIC: u64 = 21_000_000 * 100_000_000;
pub const BURN_MESSAGE_LENGTH: usize = 563;
pub const BURN_BINDING_LENGTH: usize = 305;
pub const BURN_EVIDENCE_LENGTH: usize = 530;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct BurnBinding {
    pub domain: [u8; 8],
    pub version: u8,
    pub protocol_id: u32,
    pub native_network: u32,
    pub native_genesis: [u8; 32],
    pub solana_genesis: [u8; 32],
    pub solana_deployment: [u8; 32],
    pub bridge_program: [u8; 32],
    pub transceiver_program: [u8; 32],
    pub mint: [u8; 32],
    pub destination: [u8; 32],
    pub burn_public_key: [u8; 32],
    pub nonce: [u8; 32],
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct BurnOutpoint {
    pub txid: [u8; 32],
    pub vout: u32,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct FinalizedBurnEvidence {
    pub domain: [u8; 8],
    pub version: u8,
    pub binding: BurnBinding,
    pub operation_id: [u8; 32],
    pub deposit: BurnOutpoint,
    pub deposit_block_hash: [u8; 32],
    pub deposit_height: u32,
    pub burn: BurnOutpoint,
    pub burn_block_hash: [u8; 32],
    pub burn_height: u32,
    pub amount_atomic: u64,
    pub burn_commitment: [u8; 32],
}
#[derive(Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct CanonicalBurnMessage {
    pub magic: [u8; 8],
    pub version: u8,
    pub evidence: FinalizedBurnEvidence,
    pub policy_epoch: u32,
    pub key_epoch: u32,
    pub valid_from: u64,
    pub valid_until: u64,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BurnMessageError {
    Encoding,
    Domain,
    Identity,
    Amount,
    Finality,
    Operation,
    Commitment,
    Epoch,
    Validity,
}
fn hash(bytes: &[u8]) -> [u8; 32] {
    // Same SHA-256 bytes on host and chain. SBF uses the supported runtime
    // syscall instead of repeatedly interpreting SHA-256 compression rounds.
    solana_sha256_hasher::hash(bytes).to_bytes()
}
impl BurnBinding {
    pub fn validate(&self) -> Result<(), BurnMessageError> {
        if self.domain != *b"KPBOPR01"
            || self.version != 1
            || self.protocol_id == 0
            || self.native_network == 0
        {
            return Err(BurnMessageError::Domain);
        }
        if [
            self.native_genesis,
            self.solana_genesis,
            self.solana_deployment,
            self.bridge_program,
            self.transceiver_program,
            self.mint,
            self.destination,
            self.burn_public_key,
            self.nonce,
        ]
        .contains(&[0; 32])
        {
            return Err(BurnMessageError::Identity);
        }
        let roles = [
            self.burn_public_key,
            self.bridge_program,
            self.transceiver_program,
            self.mint,
        ];
        for (index, role) in roles.iter().enumerate() {
            if roles[..index].contains(role) {
                return Err(BurnMessageError::Identity);
            }
        }
        Ok(())
    }
    pub fn operation_id(&self) -> Result<[u8; 32], BurnMessageError> {
        Ok(hash(&self.to_bytes()?))
    }
    pub fn to_bytes(&self) -> Result<[u8; BURN_BINDING_LENGTH], BurnMessageError> {
        self.validate()?;
        let mut bytes = [0u8; BURN_BINDING_LENGTH];
        borsh::to_writer(&mut bytes[..], self).map_err(|_| BurnMessageError::Encoding)?;
        Ok(bytes)
    }
}
impl FinalizedBurnEvidence {
    pub fn expected_commitment(&self) -> Result<[u8; 32], BurnMessageError> {
        let mut encoded = [0u8; 85];
        borsh::to_writer(
            &mut encoded[..],
            &(
                *b"KPBCOM01",
                1u8,
                self.operation_id,
                &self.deposit,
                self.amount_atomic,
            ),
        )
        .map_err(|_| BurnMessageError::Encoding)?;
        Ok(hash(&encoded))
    }
    pub fn validate(&self) -> Result<(), BurnMessageError> {
        self.binding.validate()?;
        if self.domain != *b"KPBURN01" || self.version != 1 {
            return Err(BurnMessageError::Domain);
        }
        if self.operation_id != self.binding.operation_id()? {
            return Err(BurnMessageError::Operation);
        }
        if self.amount_atomic == 0 || self.amount_atomic > MAX_SUPPLY_ATOMIC {
            return Err(BurnMessageError::Amount);
        }
        if [
            self.deposit.txid,
            self.burn.txid,
            self.deposit_block_hash,
            self.burn_block_hash,
        ]
        .contains(&[0; 32])
        {
            return Err(BurnMessageError::Identity);
        }
        if self.burn.vout != 0
            || self.deposit_height == 0
            || self.burn_height
                < self
                    .deposit_height
                    .checked_add(BURN_CONFIRMATIONS)
                    .ok_or(BurnMessageError::Finality)?
        {
            return Err(BurnMessageError::Finality);
        }
        if self.burn_commitment != self.expected_commitment()? {
            return Err(BurnMessageError::Commitment);
        }
        Ok(())
    }
    pub fn burn_script(&self) -> Result<Vec<u8>, BurnMessageError> {
        self.validate()?;
        let mut script = vec![0x6a, 0x37];
        script.extend_from_slice(b"KINGPEPE_BRIDGE_BURN_V1");
        script.extend_from_slice(&self.burn_commitment);
        Ok(script)
    }
    pub fn encode(&self) -> Result<Vec<u8>, BurnMessageError> {
        Ok(self.to_bytes()?.to_vec())
    }
    pub fn to_bytes(&self) -> Result<[u8; BURN_EVIDENCE_LENGTH], BurnMessageError> {
        self.validate()?;
        let mut bytes = [0u8; BURN_EVIDENCE_LENGTH];
        borsh::to_writer(&mut bytes[..], self).map_err(|_| BurnMessageError::Encoding)?;
        Ok(bytes)
    }
}
impl CanonicalBurnMessage {
    pub fn validate(&self) -> Result<(), BurnMessageError> {
        if self.magic != *b"KPBRMSG4" || self.version != 4 {
            return Err(BurnMessageError::Domain);
        }
        self.evidence.validate()?;
        if self.policy_epoch == 0 || self.key_epoch == 0 {
            return Err(BurnMessageError::Epoch);
        }
        if self.valid_until <= self.valid_from {
            return Err(BurnMessageError::Validity);
        }
        Ok(())
    }
    pub fn encode(&self) -> Result<Vec<u8>, BurnMessageError> {
        Ok(self.to_bytes()?.to_vec())
    }
    pub fn to_bytes(&self) -> Result<[u8; BURN_MESSAGE_LENGTH], BurnMessageError> {
        self.validate()?;
        let mut bytes = [0u8; BURN_MESSAGE_LENGTH];
        borsh::to_writer(&mut bytes[..], self).map_err(|_| BurnMessageError::Encoding)?;
        Ok(bytes)
    }
    pub fn decode(bytes: &[u8]) -> Result<Self, BurnMessageError> {
        if bytes.len() != BURN_MESSAGE_LENGTH {
            return Err(BurnMessageError::Encoding);
        }
        let message: Self = borsh::from_slice(bytes).map_err(|_| BurnMessageError::Encoding)?;
        message.validate()?;
        if message.to_bytes()? != bytes {
            return Err(BurnMessageError::Encoding);
        }
        Ok(message)
    }
    pub fn digest(&self) -> Result<[u8; 32], BurnMessageError> {
        Ok(hash(&self.to_bytes()?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn unhex(input: &str) -> Vec<u8> {
        input
            .as_bytes()
            .chunks_exact(2)
            .map(|part| u8::from_str_radix(std::str::from_utf8(part).unwrap(), 16).unwrap())
            .collect()
    }
    #[test]
    fn native_burn_rust_typescript_exact_borsh() {
        let vectors: serde_json::Value =
            serde_json::from_str(include_str!("../vectors/burn-borsh-v4.json")).unwrap();
        let bytes = unhex(vectors["messageHex"].as_str().unwrap());
        let message = CanonicalBurnMessage::decode(&bytes).unwrap();
        assert_eq!(message.encode().unwrap(), bytes);
        assert_eq!(
            message.evidence.encode().unwrap(),
            unhex(vectors["evidenceHex"].as_str().unwrap())
        );
        assert_eq!(
            message.evidence.binding.operation_id().unwrap().as_slice(),
            unhex(vectors["operationId"].as_str().unwrap())
        );
        assert_eq!(
            message.evidence.burn_script().unwrap(),
            unhex(vectors["burnScript"].as_str().unwrap())
        );
        assert_eq!(
            message.digest().unwrap().as_slice(),
            unhex(vectors["messageDigest"].as_str().unwrap())
        );
        let mut changed = message.clone();
        changed.evidence.binding.destination[0] ^= 1;
        assert_eq!(changed.validate(), Err(BurnMessageError::Operation));
        let mut changed = message.clone();
        changed.evidence.amount_atomic += 1;
        assert_eq!(changed.validate(), Err(BurnMessageError::Commitment));
        let mut changed = message.clone();
        changed.evidence.burn_height = changed.evidence.deposit_height + 11;
        assert_eq!(changed.validate(), Err(BurnMessageError::Finality));
        let mut changed = message.clone();
        changed.evidence.amount_atomic = MAX_SUPPLY_ATOMIC + 1;
        assert_eq!(changed.validate(), Err(BurnMessageError::Amount));
        for amount in [MAX_SUPPLY_ATOMIC - 1, MAX_SUPPLY_ATOMIC] {
            let mut changed = message.clone();
            changed.evidence.amount_atomic = amount;
            changed.evidence.burn_commitment = changed.evidence.expected_commitment().unwrap();
            assert!(changed.validate().is_ok());
        }
        let mut trailing = bytes.clone();
        trailing.push(0);
        assert!(CanonicalBurnMessage::decode(&trailing).is_err());
        assert!(CanonicalBurnMessage::decode(&bytes[..bytes.len() - 1]).is_err());
        let mut old_version = bytes;
        old_version[8] = 3;
        assert_eq!(
            CanonicalBurnMessage::decode(&old_version),
            Err(BurnMessageError::Domain)
        );
    }
}
