// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
//! Bounded raw REGTEST header/Merkle evidence. This does not establish UTXO
//! state or validate every transaction script in every block. A separately
//! configured fully validating Native node supplies canonical-chain/UTXO state.

use std::collections::HashSet;

use borsh::{BorshDeserialize, BorshSerialize};
use num_bigint::BigUint;

use crate::bytes::sha256;
use crate::chain::{assert_finality, HeaderChain, NativeChainParams};
use crate::header::parse_header;
use crate::merkle::build_merkle_branch;
use crate::transaction::{parse_transaction, ParsedTransaction, MAX_NATIVE_TRANSACTION_BYTES};
use crate::NativeProofError;

pub const EVIDENCE_MAGIC: &[u8; 8] = b"KPNEVD02";
pub const MAX_EVIDENCE_BYTES: usize = 8_000_000;
pub const MAX_EVIDENCE_HEADERS: usize = 4096;
pub const MAX_EVIDENCE_TRANSACTIONS: usize = 16;
pub const MAX_BLOCK_TRANSACTION_IDS: usize = 65_536;
// Pinned Native source src/chain.h and ContextualCheckBlockHeader.
pub const MAX_FUTURE_BLOCK_SECONDS: u64 = 2 * 60 * 60;

#[derive(Debug)]
pub struct ValidatedRawTransaction {
    pub transaction: ParsedTransaction,
    pub block_height: u32,
    pub block_hash: [u8; 32],
}

#[derive(Debug)]
pub struct ValidatedRegtestEvidence {
    pub digest: [u8; 32],
    pub tip_hash: [u8; 32],
    pub tip_height: u32,
    pub tip_chainwork: BigUint,
    pub transactions: Vec<ValidatedRawTransaction>,
}

impl ValidatedRegtestEvidence {
    /// Fixed Borsh response schema: domain [u8;8], digest and tip [u8;32],
    /// accepted height u32, transaction count u32. No plaintext diagnostic wire.
    pub fn encode_response(&self) -> std::io::Result<Vec<u8>> {
        borsh::to_vec(&(
            *b"KPNEVR02",
            self.digest,
            self.tip_hash,
            self.tip_height,
            self.transactions.len() as u32,
        ))
    }
}

/// Borsh envelope schema. Consensus headers/transactions and big-endian
/// chainwork bytes are opaque arrays, not reserialized consensus objects.
pub struct NativeEvidenceEnvelope {
    pub genesis: [u8; 32],
    pub tip: [u8; 32],
    pub tip_height: u32,
    pub chainwork: [u8; 32],
    pub minimum_confirmations: u32,
    pub headers: Vec<[u8; 80]>,
    pub proofs: Vec<NativeEvidenceTransaction>,
}

pub struct NativeEvidenceTransaction {
    pub transaction: Vec<u8>,
    pub block_height: u32,
    pub transaction_index: u32,
    pub transaction_ids: Vec<[u8; 32]>,
}

impl BorshSerialize for NativeEvidenceEnvelope {
    fn serialize<W: std::io::Write>(&self, writer: &mut W) -> std::io::Result<()> {
        (
            EVIDENCE_MAGIC,
            &self.genesis,
            &self.tip,
            self.tip_height,
            &self.chainwork,
            self.minimum_confirmations,
            &self.headers,
            &self.proofs,
        )
            .serialize(writer)
    }
}

impl BorshSerialize for NativeEvidenceTransaction {
    fn serialize<W: std::io::Write>(&self, writer: &mut W) -> std::io::Result<()> {
        (
            &self.transaction,
            self.block_height,
            self.transaction_index,
            &self.transaction_ids,
        )
            .serialize(writer)
    }
}

/// The timestamp is supplied by the verifier's clock, never by the packet.
/// Mainnet packets cannot be selected by changing a caller-provided network flag.
pub fn verify_regtest_evidence(
    packet: &[u8],
    verifier_now_unix: u64,
) -> Result<ValidatedRegtestEvidence, NativeProofError> {
    if packet.len() > MAX_EVIDENCE_BYTES {
        return Err(NativeProofError::ResourceLimit("evidence bytes".to_owned()));
    }
    let mut reader = EvidenceReader::new(packet);
    if reader.take(8)? != EVIDENCE_MAGIC {
        return Err(NativeProofError::InvalidEvidence);
    }
    let params = NativeChainParams::regtest();
    if reader.hash()? != params.genesis_hash() {
        return Err(NativeProofError::WrongNetworkOrGenesis);
    }
    let expected_tip_hash = reader.hash()?;
    let expected_tip_height = reader.u32()?;
    let expected_work = BigUint::from_bytes_be(&reader.hash()?);
    let minimum_confirmations = reader.u32()?;
    if minimum_confirmations == 0 || minimum_confirmations > MAX_EVIDENCE_HEADERS as u32 {
        return Err(NativeProofError::FinalityNotSatisfied);
    }
    let header_count = reader.count(MAX_EVIDENCE_HEADERS)?;
    if header_count == 0 || header_count as u32 != expected_tip_height {
        return Err(NativeProofError::EvidenceTipMismatch);
    }
    let mut chain = HeaderChain::from_genesis(params)?;
    for _ in 0..header_count {
        let raw = reader.take(80)?;
        let header = parse_header(raw)?;
        if u64::from(header.time) > verifier_now_unix.saturating_add(MAX_FUTURE_BLOCK_SECONDS) {
            return Err(NativeProofError::InvalidHeaderTime);
        }
        chain.connect_header(raw)?;
    }
    if chain.tip().hash != expected_tip_hash || chain.tip().chainwork != expected_work {
        return Err(NativeProofError::EvidenceTipMismatch);
    }
    let proof_count = reader.count(MAX_EVIDENCE_TRANSACTIONS)?;
    if proof_count == 0 {
        return Err(NativeProofError::InvalidEvidence);
    }
    let mut transactions = Vec::with_capacity(proof_count);
    let mut seen_transactions = HashSet::new();
    for _ in 0..proof_count {
        let raw_length = reader.count(MAX_NATIVE_TRANSACTION_BYTES)?;
        let transaction = parse_transaction(reader.take(raw_length)?)?;
        if transaction.inputs.is_empty()
            || transaction.outputs.is_empty()
            || !seen_transactions.insert(transaction.txid)
        {
            return Err(NativeProofError::InvalidEvidence);
        }
        let block_height = reader.u32()?;
        if block_height == 0 {
            return Err(NativeProofError::InvalidEvidence);
        }
        let containing = chain
            .headers()
            .get(block_height as usize)
            .ok_or(NativeProofError::InvalidEvidence)?;
        let index = reader.u32()? as usize;
        let txid_count = reader.count(MAX_BLOCK_TRANSACTION_IDS)?;
        if txid_count == 0 || index >= txid_count {
            return Err(NativeProofError::InvalidMerkleProof);
        }
        let mut txids = Vec::with_capacity(txid_count);
        let mut distinct = HashSet::new();
        for _ in 0..txid_count {
            let txid = reader.hash()?;
            if !distinct.insert(txid) {
                return Err(NativeProofError::InvalidMerkleProof);
            }
            txids.push(txid);
        }
        if transaction.txid != txids[index] {
            return Err(NativeProofError::InvalidEvidence);
        }
        let (root, _) = build_merkle_branch(&txids, index)?;
        if root != containing.merkle_root {
            return Err(NativeProofError::InvalidMerkleProof);
        }
        assert_finality(containing, chain.tip(), minimum_confirmations)?;
        transactions.push(ValidatedRawTransaction {
            transaction,
            block_height,
            block_hash: containing.hash,
        });
    }
    if !reader.remaining.is_empty() {
        return Err(NativeProofError::InvalidEvidence);
    }
    Ok(ValidatedRegtestEvidence {
        digest: sha256(packet),
        tip_hash: chain.tip().hash,
        tip_height: chain.tip().height,
        tip_chainwork: chain.tip().chainwork.clone(),
        transactions,
    })
}

struct EvidenceReader<'a> {
    remaining: &'a [u8],
}

impl<'a> EvidenceReader<'a> {
    fn new(remaining: &'a [u8]) -> Self {
        Self { remaining }
    }
    fn take(&mut self, count: usize) -> Result<&'a [u8], NativeProofError> {
        if count > self.remaining.len() {
            return Err(NativeProofError::InvalidEvidence);
        }
        let (value, rest) = self.remaining.split_at(count);
        self.remaining = rest;
        Ok(value)
    }
    fn hash(&mut self) -> Result<[u8; 32], NativeProofError> {
        BorshDeserialize::deserialize(&mut self.remaining)
            .map_err(|_| NativeProofError::InvalidEvidence)
    }
    fn u32(&mut self) -> Result<u32, NativeProofError> {
        BorshDeserialize::deserialize(&mut self.remaining)
            .map_err(|_| NativeProofError::InvalidEvidence)
    }
    fn count(&mut self, maximum: usize) -> Result<usize, NativeProofError> {
        let count = self.u32()? as usize;
        if count > maximum {
            return Err(NativeProofError::ResourceLimit("evidence count".to_owned()));
        }
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::header::{serialize_header, verify_proof_of_work};

    #[test]
    fn borsh_envelope_and_response_match_shared_vectors() {
        let vector: serde_json::Value =
            serde_json::from_str(include_str!("../vectors/borsh-v2.json")).unwrap();
        let input = &vector["input"];
        let bytes = |v: &serde_json::Value| {
            crate::bytes::parse_hex(v.as_str().unwrap(), None, "vector").unwrap()
        };
        let hash = |v: &serde_json::Value| -> [u8; 32] { bytes(v).try_into().unwrap() };
        let number = |v: &serde_json::Value| -> u32 { v.as_u64().unwrap().try_into().unwrap() };
        let wire = NativeEvidenceEnvelope {
            genesis: hash(&input["genesisHash"]),
            tip: hash(&input["tipHash"]),
            tip_height: number(&input["tipHeight"]),
            chainwork: hash(&input["chainworkHex"]),
            minimum_confirmations: number(&input["minimumConfirmations"]),
            headers: input["headers"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| bytes(v).try_into().unwrap())
                .collect(),
            proofs: input["proofs"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| NativeEvidenceTransaction {
                    transaction: bytes(&v["rawTransactionHex"]),
                    block_height: number(&v["blockHeight"]),
                    transaction_index: number(&v["transactionIndex"]),
                    transaction_ids: v["transactionIds"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(hash)
                        .collect(),
                })
                .collect(),
        };
        let encoded = borsh::to_vec(&wire).unwrap();
        assert_eq!(encoded, bytes(&vector["encodedHex"]));
        assert_eq!(sha256(&encoded), hash(&vector["digest"]));
        // Vector tests do not certify this deliberately invalid header as a chain.
        assert!(verify_regtest_evidence(&encoded, u64::MAX).is_err());
        let result = ValidatedRegtestEvidence {
            digest: sha256(&encoded),
            tip_hash: wire.tip,
            tip_height: wire.tip_height,
            tip_chainwork: BigUint::from(0u8),
            transactions: vec![ValidatedRawTransaction {
                transaction: parse_transaction(&wire.proofs[0].transaction).unwrap(),
                block_height: 1,
                block_hash: wire.tip,
            }],
        };
        let response = result.encode_response().unwrap();
        assert_eq!(response, bytes(&vector["responseHex"]));
        assert_eq!(sha256(&response), hash(&vector["responseDigest"]));
    }

    // Header/Merkle fixture only, NOT a full consensus-valid block fixture.
    fn fixture() -> Vec<u8> {
        let params = NativeChainParams::regtest();
        let mut tx = Vec::new();
        tx.extend(2_i32.to_le_bytes());
        tx.push(1);
        tx.extend([7; 32]);
        tx.extend(0_u32.to_le_bytes());
        tx.push(0);
        tx.extend(u32::MAX.to_le_bytes());
        tx.push(1);
        tx.extend(5_000_u64.to_le_bytes());
        tx.extend([1, 0x51]);
        tx.extend([0; 4]);
        let parsed = parse_transaction(&tx).unwrap();
        let mut chain = HeaderChain::from_genesis(params).unwrap();
        let mut headers = Vec::new();
        for height in 1..=3 {
            let header = (0..100_000)
                .find_map(|nonce| {
                    let raw = serialize_header(
                        4,
                        chain.tip().hash,
                        parsed.txid,
                        params.genesis_time + height,
                        params.genesis_bits,
                        nonce,
                    );
                    verify_proof_of_work(&parse_header(&raw).unwrap(), &params.pow_limit())
                        .then_some(raw)
                })
                .unwrap();
            chain.connect_header(&header).unwrap();
            headers.push(header);
        }
        let work = chain.tip().chainwork.to_bytes_be();
        let mut chainwork = [0; 32];
        chainwork[32 - work.len()..].copy_from_slice(&work);
        borsh::to_vec(&NativeEvidenceEnvelope {
            genesis: params.genesis_hash(),
            tip: chain.tip().hash,
            tip_height: 3,
            chainwork,
            minimum_confirmations: 3,
            headers,
            proofs: vec![NativeEvidenceTransaction {
                transaction: tx,
                block_height: 1,
                transaction_index: 0,
                transaction_ids: vec![parsed.txid],
            }],
        })
        .unwrap()
    }

    #[test]
    fn verifies_raw_headers_pow_chainwork_and_transaction_membership() {
        let packet = fixture();
        let result = verify_regtest_evidence(
            &packet,
            u64::from(NativeChainParams::regtest().genesis_time) + 10,
        )
        .unwrap();
        assert_eq!(result.tip_height, 3);
        assert_eq!(result.transactions.len(), 1);
        assert_eq!(
            result.transactions[0].transaction.outputs[0].value_atomic,
            5_000
        );
        assert_eq!(result.digest, sha256(&packet));
    }

    #[test]
    fn packet_rejects_wrong_genesis_tip_work_merkle_and_finality() {
        let packet = fixture();
        for offset in [8, 40, 80, packet.len() - 1] {
            let mut changed = packet.clone();
            changed[offset] ^= 1;
            assert!(verify_regtest_evidence(&changed, u64::MAX).is_err());
        }
        let mut finality = packet.clone();
        finality[108..112].copy_from_slice(&4_u32.to_le_bytes());
        assert_eq!(
            verify_regtest_evidence(&finality, u64::MAX).unwrap_err(),
            NativeProofError::FinalityNotSatisfied
        );
    }

    #[test]
    fn packet_bounds_truncation_and_trailing_data_fail_closed() {
        let packet = fixture();
        for length in 0..packet.len() {
            assert!(verify_regtest_evidence(&packet[..length], u64::MAX).is_err());
        }
        let mut extra = packet.clone();
        extra.push(0);
        assert!(verify_regtest_evidence(&extra, u64::MAX).is_err());
        let header_count = u32::from_le_bytes(packet[112..116].try_into().unwrap()) as usize;
        let proof_count_offset = 116 + header_count * 80;
        let transaction_length_offset = proof_count_offset + 4;
        let transaction_length = u32::from_le_bytes(
            packet[transaction_length_offset..transaction_length_offset + 4]
                .try_into()
                .unwrap(),
        ) as usize;
        let txid_count_offset = transaction_length_offset + 4 + transaction_length + 8;
        for offset in [
            112,
            proof_count_offset,
            transaction_length_offset,
            txid_count_offset,
        ] {
            let mut excessive = packet.clone();
            excessive[offset..offset + 4].copy_from_slice(&u32::MAX.to_le_bytes());
            assert!(matches!(
                verify_regtest_evidence(&excessive, u64::MAX),
                Err(NativeProofError::ResourceLimit(_))
            ));
        }
    }

    #[test]
    fn header_time_and_hex_unicode_cannot_bypass_or_panic() {
        let packet = fixture();
        assert_eq!(
            verify_regtest_evidence(&packet, 0).unwrap_err(),
            NativeProofError::InvalidHeaderTime
        );
        let params = NativeChainParams::regtest();
        let mut chain = HeaderChain::from_genesis(params).unwrap();
        let old = serialize_header(
            4,
            chain.tip().hash,
            [7; 32],
            params.genesis_time,
            params.genesis_bits,
            0,
        );
        assert_eq!(
            chain.connect_header(&old).unwrap_err(),
            NativeProofError::InvalidHeaderTime
        );
        for invalid in ["aéz", "🦀", "éé", "0z"] {
            assert!(crate::bytes::parse_hex(invalid, None, "test hex").is_err());
        }
        assert_eq!(crate::chain::confirmations_at_tip(0, u32::MAX), None);
    }
}
