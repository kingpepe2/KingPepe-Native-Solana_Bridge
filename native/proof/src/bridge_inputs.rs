// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
//! Borsh preimages owned by the bridge. Native consensus bytes are opaque.

pub fn deposit_evidence(
    transaction: &[u8],
    block_hash: [u8; 32],
    output_index: u32,
    amount: u64,
) -> Result<Vec<u8>, crate::NativeProofError> {
    if transaction.len() > 4_000_000 {
        return Err(crate::NativeProofError::ResourceLimit(
            "deposit evidence transaction".into(),
        ));
    }
    borsh::to_vec(&(transaction, block_hash, output_index, amount))
        .map_err(|_| crate::NativeProofError::InvalidEvidence)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bytes::{parse_hex, sha256d};
    use sha2::{Digest, Sha256};

    #[test]
    fn native_borsh_hash_inputs_match_typescript_vectors() {
        let fixtures: serde_json::Value =
            serde_json::from_str(include_str!("../vectors/inputs-borsh-v2.json")).unwrap();
        let bytes = |v: &serde_json::Value| parse_hex(v.as_str().unwrap(), None, "vector").unwrap();
        let hash = |v: &serde_json::Value| -> [u8; 32] { bytes(v).try_into().unwrap() };
        let number = |v: &serde_json::Value| -> u32 { v.as_u64().unwrap().try_into().unwrap() };
        for vector in fixtures["vectors"].as_array().unwrap() {
            let input = &vector["input"];
            let amount = input["amountAtomic"]
                .as_str()
                .unwrap()
                .parse::<u64>()
                .unwrap();
            let encoded = match vector["type"].as_str().unwrap() {
                "DepositEvidence" => deposit_evidence(
                    &bytes(&input["transaction"]),
                    hash(&input["blockHash"]),
                    number(&input["outputIndex"]),
                    amount,
                )
                .unwrap(),
                _ => panic!("unknown Native input vector"),
            };
            assert_eq!(encoded, bytes(&vector["encodedHex"]));
            assert_eq!(
                Sha256::digest(&encoded).as_slice(),
                bytes(&vector["sha256"])
            );
            assert_eq!(sha256d(&encoded), hash(&vector["sha256d"]));
        }
    }
}
