use crate::bytes::sha256d;
use crate::chain::{assert_finality, HeaderMeta, NativeChainParams, NativeNetwork};
use crate::merkle::reconstruct_merkle_root;
use crate::node::{assert_utxo_matches, UtxoMatchInput, UtxoObservation};
use crate::transaction::{output_at, OutPoint, ParsedTransaction};
use crate::NativeProofError;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ValidatedTemporaryDeposit {
    pub network: NativeNetwork,
    pub native_genesis_hash: [u8; 32],
    pub outpoint: OutPoint,
    pub amount_atomic: u64,
    pub script_pubkey: Vec<u8>,
    pub recipient_commitment_script: Option<Vec<u8>>,
    pub block_hash: [u8; 32],
    pub block_height: u32,
    pub evidence_digest: [u8; 32],
}

pub struct DepositValidationInput<'a> {
    pub params: NativeChainParams,
    pub transaction: &'a ParsedTransaction,
    pub output_index: u32,
    pub expected_amount_atomic: u64,
    pub expected_script_pubkey: &'a [u8],
    pub expected_recipient_commitment_script: Option<&'a [u8]>,
    pub merkle_branch: &'a [[u8; 32]],
    pub merkle_index: u32,
    pub containing_block: &'a HeaderMeta,
    pub observed_tip: &'a HeaderMeta,
    pub utxo: &'a UtxoObservation,
    pub minimum_confirmations: u32,
}

pub fn validate_temporary_deposit(
    input: DepositValidationInput<'_>,
) -> Result<ValidatedTemporaryDeposit, NativeProofError> {
    let output = output_at(input.transaction, input.output_index)?;
    if output.value_atomic != input.expected_amount_atomic
        || output.script_pubkey != input.expected_script_pubkey
    {
        return Err(NativeProofError::OutputMismatch);
    }
    if let Some(commitment_script) = input.expected_recipient_commitment_script {
        let contains_commitment = input.transaction.outputs.iter().any(|candidate| {
            candidate.value_atomic == 0 && candidate.script_pubkey == commitment_script
        });
        if !contains_commitment {
            return Err(NativeProofError::MissingDepositCommitment);
        }
    }
    let merkle_root = reconstruct_merkle_root(
        input.transaction.txid,
        input.merkle_branch,
        input.merkle_index,
    )?;
    if merkle_root != input.containing_block.merkle_root {
        return Err(NativeProofError::InvalidMerkleProof);
    }
    assert_finality(
        input.containing_block,
        input.observed_tip,
        input.minimum_confirmations,
    )?;
    let outpoint = OutPoint {
        txid: input.transaction.txid,
        vout: input.output_index,
    };
    assert_utxo_matches(UtxoMatchInput {
        observation: input.utxo,
        outpoint,
        value_atomic: input.expected_amount_atomic,
        script_pubkey: input.expected_script_pubkey,
        minimum_confirmations: input.minimum_confirmations,
    })?;
    let mut digest_input = Vec::new();
    digest_input.extend(&input.transaction.raw);
    digest_input.extend(input.containing_block.hash);
    digest_input.extend(input.output_index.to_le_bytes());
    digest_input.extend(input.expected_amount_atomic.to_le_bytes());
    Ok(ValidatedTemporaryDeposit {
        network: input.params.network,
        native_genesis_hash: input.params.genesis_hash(),
        outpoint,
        amount_atomic: input.expected_amount_atomic,
        script_pubkey: input.expected_script_pubkey.to_vec(),
        recipient_commitment_script: input
            .expected_recipient_commitment_script
            .map(ToOwned::to_owned),
        block_hash: input.containing_block.hash,
        block_height: input.containing_block.height,
        evidence_digest: sha256d(&digest_input),
    })
}

#[cfg(test)]
mod tests {
    use num_bigint::BigUint;

    use super::*;
    use crate::chain::HeaderMeta;
    use crate::merkle::build_merkle_branch;
    use crate::transaction::{encode_varint, parse_transaction};

    #[test]
    fn deposit_requires_merkle_finality_and_unspent_utxo_state() {
        let params = NativeChainParams::regtest();
        let tx = sample_deposit_transaction(5_000, &[0x51, 0x20, 7], &[0x6a, 0x14, 9]);
        let (root, branch) = build_merkle_branch(&[tx.txid], 0).unwrap();
        let block = HeaderMeta {
            height: 10,
            hash: [3; 32],
            merkle_root: root,
            time: 1,
            bits: params.genesis_bits,
            chainwork: BigUint::from(10_u32),
        };
        let tip = HeaderMeta {
            height: 15,
            chainwork: BigUint::from(20_u32),
            ..block.clone()
        };
        let utxo = UtxoObservation {
            outpoint: OutPoint {
                txid: tx.txid,
                vout: 0,
            },
            value_atomic: 5_000,
            script_pubkey: vec![0x51, 0x20, 7],
            best_block_hash: tip.hash,
            confirmations: 6,
            coinbase: false,
            unspent: true,
        };
        let validated = validate_temporary_deposit(DepositValidationInput {
            params,
            transaction: &tx,
            output_index: 0,
            expected_amount_atomic: 5_000,
            expected_script_pubkey: &[0x51, 0x20, 7],
            expected_recipient_commitment_script: Some(&[0x6a, 0x14, 9]),
            merkle_branch: &branch,
            merkle_index: 0,
            containing_block: &block,
            observed_tip: &tip,
            utxo: &utxo,
            minimum_confirmations: 6,
        })
        .unwrap();
        assert_eq!(validated.amount_atomic, 5_000);

        let mut spent = utxo;
        spent.unspent = false;
        assert_eq!(
            validate_temporary_deposit(DepositValidationInput {
                utxo: &spent,
                ..deposit_input(params, &tx, &branch, &block, &tip)
            })
            .unwrap_err(),
            NativeProofError::UtxoNotUnspent
        );
    }

    fn deposit_input<'a>(
        params: NativeChainParams,
        tx: &'a ParsedTransaction,
        branch: &'a [[u8; 32]],
        block: &'a HeaderMeta,
        tip: &'a HeaderMeta,
    ) -> DepositValidationInput<'a> {
        let utxo = Box::leak(Box::new(UtxoObservation {
            outpoint: OutPoint {
                txid: tx.txid,
                vout: 0,
            },
            value_atomic: 5_000,
            script_pubkey: vec![0x51, 0x20, 7],
            best_block_hash: tip.hash,
            confirmations: 6,
            coinbase: false,
            unspent: true,
        }));
        DepositValidationInput {
            params,
            transaction: tx,
            output_index: 0,
            expected_amount_atomic: 5_000,
            expected_script_pubkey: &[0x51, 0x20, 7],
            expected_recipient_commitment_script: Some(&[0x6a, 0x14, 9]),
            merkle_branch: branch,
            merkle_index: 0,
            containing_block: block,
            observed_tip: tip,
            utxo,
            minimum_confirmations: 6,
        }
    }

    fn sample_deposit_transaction(
        amount: u64,
        script_pubkey: &[u8],
        commitment_script: &[u8],
    ) -> ParsedTransaction {
        let mut raw = Vec::new();
        raw.extend(2_i32.to_le_bytes());
        raw.push(1);
        raw.extend([1_u8; 32]);
        raw.extend(0_u32.to_le_bytes());
        raw.push(0);
        raw.extend(0xffff_fffe_u32.to_le_bytes());
        raw.push(2);
        raw.extend(amount.to_le_bytes());
        raw.extend(encode_varint(script_pubkey.len() as u64));
        raw.extend(script_pubkey);
        raw.extend(0_u64.to_le_bytes());
        raw.extend(encode_varint(commitment_script.len() as u64));
        raw.extend(commitment_script);
        raw.extend(0_u32.to_le_bytes());
        parse_transaction(&raw).unwrap()
    }
}
