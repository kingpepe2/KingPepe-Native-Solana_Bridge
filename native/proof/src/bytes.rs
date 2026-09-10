use std::cmp::Ordering;
use std::fmt::Write;

use sha2::{Digest, Sha256};

use crate::NativeProofError;

pub fn parse_hex_fixed<const N: usize>(
    value: &str,
    label: &str,
) -> Result<[u8; N], NativeProofError> {
    if value.len() != N * 2 {
        return Err(NativeProofError::InvalidLength(label.to_owned()));
    }
    let bytes = parse_hex(value, Some(N), label)?;
    bytes
        .try_into()
        .map_err(|_| NativeProofError::InvalidLength(label.to_owned()))
}

pub fn parse_hex(
    value: &str,
    expected_bytes: Option<usize>,
    label: &str,
) -> Result<Vec<u8>, NativeProofError> {
    if value.len() % 2 != 0 || !value.is_ascii() {
        return Err(NativeProofError::InvalidHex(label.to_owned()));
    }
    if let Some(expected) = expected_bytes {
        if value.len() != expected * 2 {
            return Err(NativeProofError::InvalidLength(label.to_owned()));
        }
    }
    let mut out = Vec::with_capacity(value.len() / 2);
    for index in (0..value.len()).step_by(2) {
        let byte = u8::from_str_radix(&value[index..index + 2], 16)
            .map_err(|_| NativeProofError::InvalidHex(label.to_owned()))?;
        out.push(byte);
    }
    Ok(out)
}

pub fn to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(&mut out, "{byte:02x}").expect("writing to a string cannot fail");
    }
    out
}

pub fn reverse_32(value: &[u8; 32]) -> [u8; 32] {
    let mut reversed = *value;
    reversed.reverse();
    reversed
}

pub fn reverse_slice_32(value: &[u8]) -> Result<[u8; 32], NativeProofError> {
    if value.len() != 32 {
        return Err(NativeProofError::InvalidLength("hash".to_owned()));
    }
    let mut out = [0_u8; 32];
    out.copy_from_slice(value);
    out.reverse();
    Ok(out)
}

pub fn sha256(bytes: &[u8]) -> [u8; 32] {
    let digest = Sha256::digest(bytes);
    digest.into()
}

pub fn sha256d(bytes: &[u8]) -> [u8; 32] {
    sha256(&sha256(bytes))
}

pub fn digest_to_display_hash(digest: &[u8; 32]) -> [u8; 32] {
    reverse_32(digest)
}

pub fn cmp_32_be(left: &[u8; 32], right: &[u8; 32]) -> Ordering {
    left.cmp(right)
}
