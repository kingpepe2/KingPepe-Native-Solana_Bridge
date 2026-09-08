use crate::bytes::{digest_to_display_hash, reverse_32, sha256d};
use crate::NativeProofError;

pub const MAX_NATIVE_MERKLE_BRANCH_DEPTH: usize = 32;
pub const MAX_NATIVE_MERKLE_TREE_LEAVES: usize = 1_000_000;

pub fn reconstruct_merkle_root(
    txid: [u8; 32],
    branch: &[[u8; 32]],
    index: u32,
) -> Result<[u8; 32], NativeProofError> {
    if branch.len() > MAX_NATIVE_MERKLE_BRANCH_DEPTH {
        return Err(NativeProofError::ResourceLimit("merkle branch".to_owned()));
    }
    let mut hash = txid;
    let mut cursor = index;
    for sibling in branch {
        hash = if cursor & 1 == 0 {
            parent_hash(hash, *sibling)
        } else {
            parent_hash(*sibling, hash)
        };
        cursor /= 2;
    }
    if cursor != 0 {
        return Err(NativeProofError::InvalidMerkleProof);
    }
    Ok(hash)
}

pub fn verify_merkle_proof(
    txid: [u8; 32],
    branch: &[[u8; 32]],
    index: u32,
    expected_root: [u8; 32],
) -> bool {
    reconstruct_merkle_root(txid, branch, index) == Ok(expected_root)
}

pub fn build_merkle_branch(
    txids: &[[u8; 32]],
    index: usize,
) -> Result<([u8; 32], Vec<[u8; 32]>), NativeProofError> {
    if txids.is_empty() || txids.len() > MAX_NATIVE_MERKLE_TREE_LEAVES || index >= txids.len() {
        return Err(NativeProofError::ResourceLimit("merkle tree".to_owned()));
    }
    let mut layer = txids.to_vec();
    let mut cursor = index;
    let mut branch = Vec::new();
    while layer.len() > 1 {
        let sibling = cursor ^ 1;
        branch.push(*layer.get(sibling).unwrap_or(&layer[cursor]));
        let mut next = Vec::with_capacity(layer.len().div_ceil(2));
        for pair in layer.chunks(2) {
            next.push(parent_hash(pair[0], *pair.get(1).unwrap_or(&pair[0])));
        }
        cursor /= 2;
        layer = next;
    }
    Ok((layer[0], branch))
}

fn parent_hash(left_display: [u8; 32], right_display: [u8; 32]) -> [u8; 32] {
    let mut bytes = Vec::with_capacity(64);
    bytes.extend(reverse_32(&left_display));
    bytes.extend(reverse_32(&right_display));
    digest_to_display_hash(&sha256d(&bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn branches_reconstruct_roots_for_even_and_odd_counts() {
        let txids: Vec<[u8; 32]> = (1..=5).map(|value| [value; 32]).collect();
        for index in 0..txids.len() {
            let (root, branch) = build_merkle_branch(&txids, index).unwrap();
            assert_eq!(
                reconstruct_merkle_root(txids[index], &branch, index as u32).unwrap(),
                root
            );
            assert!(verify_merkle_proof(
                txids[index],
                &branch,
                index as u32,
                root
            ));
            let mut altered = branch;
            altered[0] = [0xff; 32];
            assert!(!verify_merkle_proof(
                txids[index],
                &altered,
                index as u32,
                root
            ));
        }
        assert_eq!(
            reconstruct_merkle_root(txids[0], &[], 1).unwrap_err(),
            NativeProofError::InvalidMerkleProof
        );
    }
}
