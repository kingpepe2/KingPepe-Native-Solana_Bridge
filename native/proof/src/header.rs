use num_bigint::BigUint;
use num_traits::{One, ToPrimitive, Zero};

use crate::bytes::{cmp_32_be, digest_to_display_hash, reverse_32, sha256d};
use crate::NativeProofError;

pub const BLOCK_HEADER_BYTES: usize = 80;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompactTarget {
    pub bits: u32,
    pub size: u32,
    pub significand: u32,
    pub target: BigUint,
    pub negative: bool,
    pub overflow: bool,
    pub valid: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedHeader {
    pub raw: [u8; BLOCK_HEADER_BYTES],
    pub version: i32,
    pub previous_hash: [u8; 32],
    pub merkle_root: [u8; 32],
    pub time: u32,
    pub bits: u32,
    pub nonce: u32,
    pub digest: [u8; 32],
    pub hash: [u8; 32],
    pub hash_value: BigUint,
}

pub fn uint256_max() -> BigUint {
    (BigUint::one() << 256_u32) - BigUint::one()
}

pub fn decode_compact(bits: u32) -> CompactTarget {
    let size = bits >> 24;
    let word = bits & 0x007f_ffff;
    let target = if size <= 3 {
        BigUint::from(word >> (8 * (3 - size)))
    } else {
        BigUint::from(word) << (8 * (size - 3))
    };
    let negative = word != 0 && (bits & 0x0080_0000) != 0;
    let overflow =
        word != 0 && (size > 34 || (word > 0xff && size > 33) || (word > 0xffff && size > 32));
    let valid = !negative && !overflow && !target.is_zero() && target <= uint256_max();
    CompactTarget {
        bits,
        size,
        significand: word,
        target,
        negative,
        overflow,
        valid,
    }
}

pub fn encode_compact(target: &BigUint, negative: bool) -> Result<u32, NativeProofError> {
    if target > &uint256_max() {
        return Err(NativeProofError::InvalidCompactTarget);
    }
    if target.is_zero() {
        return Ok(0);
    }

    let bytes = target.to_bytes_be();
    let mut size = bytes.len() as u32;
    let mut compact = if size <= 3 {
        let value = target
            .to_u32()
            .ok_or(NativeProofError::InvalidCompactTarget)?;
        value << (8 * (3 - size))
    } else {
        ((bytes[0] as u32) << 16) | ((bytes[1] as u32) << 8) | bytes[2] as u32
    };

    if (compact & 0x0080_0000) != 0 {
        compact >>= 8;
        size += 1;
    }
    compact |= size << 24;
    if negative && (compact & 0x007f_ffff) != 0 {
        compact |= 0x0080_0000;
    }
    Ok(compact)
}

pub fn target_from_bits(bits: u32, pow_limit: &BigUint) -> Result<BigUint, NativeProofError> {
    let compact = decode_compact(bits);
    if !compact.valid || compact.target > *pow_limit {
        return Err(NativeProofError::InvalidCompactTarget);
    }
    Ok(compact.target)
}

pub fn block_proof_from_target(target: &BigUint) -> Result<BigUint, NativeProofError> {
    if target > &uint256_max() {
        return Err(NativeProofError::InvalidCompactTarget);
    }
    Ok((uint256_max() - target) / (target + BigUint::one()) + BigUint::one())
}

pub fn block_proof(bits: u32, pow_limit: &BigUint) -> Result<BigUint, NativeProofError> {
    let target = target_from_bits(bits, pow_limit)?;
    block_proof_from_target(&target)
}

pub fn parse_header(raw: &[u8]) -> Result<ParsedHeader, NativeProofError> {
    if raw.len() != BLOCK_HEADER_BYTES {
        return Err(NativeProofError::InvalidLength("block header".to_owned()));
    }
    let mut fixed = [0_u8; BLOCK_HEADER_BYTES];
    fixed.copy_from_slice(raw);
    let version = i32::from_le_bytes(fixed[0..4].try_into().expect("slice length checked"));
    let mut previous_internal = [0_u8; 32];
    previous_internal.copy_from_slice(&fixed[4..36]);
    let previous_hash = reverse_32(&previous_internal);
    let mut merkle_internal = [0_u8; 32];
    merkle_internal.copy_from_slice(&fixed[36..68]);
    let merkle_root = reverse_32(&merkle_internal);
    let time = u32::from_le_bytes(fixed[68..72].try_into().expect("slice length checked"));
    let bits = u32::from_le_bytes(fixed[72..76].try_into().expect("slice length checked"));
    let nonce = u32::from_le_bytes(fixed[76..80].try_into().expect("slice length checked"));
    let digest = sha256d(&fixed);
    let hash = digest_to_display_hash(&digest);
    let hash_value = BigUint::from_bytes_be(&hash);
    Ok(ParsedHeader {
        raw: fixed,
        version,
        previous_hash,
        merkle_root,
        time,
        bits,
        nonce,
        digest,
        hash,
        hash_value,
    })
}

pub fn serialize_header(
    version: i32,
    previous_hash: [u8; 32],
    merkle_root: [u8; 32],
    time: u32,
    bits: u32,
    nonce: u32,
) -> [u8; BLOCK_HEADER_BYTES] {
    let mut out = [0_u8; BLOCK_HEADER_BYTES];
    out[0..4].copy_from_slice(&version.to_le_bytes());
    out[4..36].copy_from_slice(&reverse_32(&previous_hash));
    out[36..68].copy_from_slice(&reverse_32(&merkle_root));
    out[68..72].copy_from_slice(&time.to_le_bytes());
    out[72..76].copy_from_slice(&bits.to_le_bytes());
    out[76..80].copy_from_slice(&nonce.to_le_bytes());
    out
}

pub fn verify_proof_of_work(header: &ParsedHeader, pow_limit: &BigUint) -> bool {
    match target_from_bits(header.bits, pow_limit) {
        Ok(target) => {
            cmp_32_be(&header.hash, &target_to_32_be(&target)) != std::cmp::Ordering::Greater
        }
        Err(_) => false,
    }
}

pub fn target_to_32_be(target: &BigUint) -> [u8; 32] {
    let bytes = target.to_bytes_be();
    let mut out = [0_u8; 32];
    let start = 32 - bytes.len();
    out[start..].copy_from_slice(&bytes);
    out
}
