use num_bigint::BigUint;

use crate::header::{decode_compact, encode_compact, target_from_bits};
use crate::NativeProofError;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PowParameters {
    pub pow_limit: BigUint,
    pub target_spacing_seconds: u32,
    pub target_timespan_seconds: u32,
    pub allow_minimum_difficulty_blocks: bool,
    pub no_retargeting: bool,
    pub enforce_bip94: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DifficultyNode {
    pub height: u32,
    pub time: u32,
    pub bits: u32,
}

pub fn difficulty_adjustment_interval(params: &PowParameters) -> Result<u32, NativeProofError> {
    if params.target_spacing_seconds == 0 || params.target_timespan_seconds == 0 {
        return Err(NativeProofError::BadDifficulty);
    }
    let interval = params.target_timespan_seconds / params.target_spacing_seconds;
    if interval == 0 {
        return Err(NativeProofError::BadDifficulty);
    }
    Ok(interval)
}

pub fn calculate_next_work_required(
    last_bits: u32,
    last_time: u32,
    first_time: u32,
    params: &PowParameters,
) -> Result<u32, NativeProofError> {
    if params.no_retargeting {
        return Ok(last_bits);
    }
    let minimum = params.target_timespan_seconds / 4;
    let maximum = params.target_timespan_seconds.saturating_mul(4);
    let elapsed = last_time.saturating_sub(first_time);
    let actual_timespan = elapsed.clamp(minimum, maximum);
    let old_target = target_from_bits(last_bits, &params.pow_limit)?;
    let mut next_target = old_target * BigUint::from(actual_timespan);
    next_target /= BigUint::from(params.target_timespan_seconds);
    if next_target > params.pow_limit {
        next_target = params.pow_limit.clone();
    }
    encode_compact(&next_target, false)
}

pub fn expected_next_work_required(
    headers: &[DifficultyNode],
    new_block_time: u32,
    params: &PowParameters,
) -> Result<u32, NativeProofError> {
    let last = headers.last().ok_or(NativeProofError::BadDifficulty)?;
    let interval = difficulty_adjustment_interval(params)?;
    let next_height = last.height + 1;
    let pow_limit_bits = encode_compact(&params.pow_limit, false)?;

    if next_height % interval != 0 {
        if !params.allow_minimum_difficulty_blocks {
            return Ok(last.bits);
        }
        if new_block_time > last.time.saturating_add(params.target_spacing_seconds * 2) {
            return Ok(pow_limit_bits);
        }
        for cursor in headers.iter().rev() {
            if cursor.height % interval == 0 || cursor.bits != pow_limit_bits {
                return Ok(cursor.bits);
            }
        }
        return Ok(pow_limit_bits);
    }

    let first_height = last
        .height
        .checked_sub(interval - 1)
        .ok_or(NativeProofError::BadDifficulty)?;
    let first = headers
        .iter()
        .find(|node| node.height == first_height)
        .ok_or(NativeProofError::BadDifficulty)?;
    let basis_bits = if params.enforce_bip94 {
        first.bits
    } else {
        last.bits
    };
    calculate_next_work_required(basis_bits, last.time, first.time, params)
}

pub fn validate_compact_target(bits: u32, params: &PowParameters) -> Result<(), NativeProofError> {
    let decoded = decode_compact(bits);
    if !decoded.valid || decoded.target > params.pow_limit {
        return Err(NativeProofError::InvalidCompactTarget);
    }
    Ok(())
}
