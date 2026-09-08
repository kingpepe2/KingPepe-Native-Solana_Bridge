use crate::bytes::{digest_to_display_hash, reverse_slice_32, sha256d};
use crate::NativeProofError;

pub const MAX_NATIVE_TRANSACTION_BYTES: usize = 4_000_000;
pub const MAX_NATIVE_TRANSACTION_INPUTS: u64 = 100_000;
pub const MAX_NATIVE_TRANSACTION_OUTPUTS: u64 = 500_000;
pub const MAX_NATIVE_TRANSACTION_WITNESS_ITEMS: u64 = 100_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct OutPoint {
    pub txid: [u8; 32],
    pub vout: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TransactionInput {
    pub previous_txid: [u8; 32],
    pub previous_vout: u32,
    pub script_sig: Vec<u8>,
    pub sequence: u32,
    pub witness: Vec<Vec<u8>>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TransactionOutput {
    pub value_atomic: u64,
    pub script_pubkey: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedTransaction {
    pub raw: Vec<u8>,
    pub version: i32,
    pub has_witness: bool,
    pub inputs: Vec<TransactionInput>,
    pub outputs: Vec<TransactionOutput>,
    pub lock_time: u32,
    pub stripped: Vec<u8>,
    pub txid: [u8; 32],
    pub wtxid: [u8; 32],
}

struct Reader<'a> {
    data: &'a [u8],
    offset: usize,
}

impl<'a> Reader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, offset: 0 }
    }

    fn remaining(&self) -> usize {
        self.data.len() - self.offset
    }

    fn read(&mut self, length: usize, label: &str) -> Result<&'a [u8], NativeProofError> {
        if length > self.remaining() {
            return Err(NativeProofError::BufferUnderflow(label.to_owned()));
        }
        let start = self.offset;
        self.offset += length;
        Ok(&self.data[start..start + length])
    }

    fn u8(&mut self, label: &str) -> Result<u8, NativeProofError> {
        Ok(self.read(1, label)?[0])
    }

    fn u32(&mut self, label: &str) -> Result<u32, NativeProofError> {
        let bytes = self.read(4, label)?;
        Ok(u32::from_le_bytes(
            bytes.try_into().expect("slice length checked"),
        ))
    }

    fn i32(&mut self, label: &str) -> Result<i32, NativeProofError> {
        let bytes = self.read(4, label)?;
        Ok(i32::from_le_bytes(
            bytes.try_into().expect("slice length checked"),
        ))
    }

    fn u64(&mut self, label: &str) -> Result<u64, NativeProofError> {
        let bytes = self.read(8, label)?;
        Ok(u64::from_le_bytes(
            bytes.try_into().expect("slice length checked"),
        ))
    }
}

pub fn encode_varint(value: u64) -> Vec<u8> {
    if value < 0xfd {
        vec![value as u8]
    } else if value <= 0xffff {
        let mut out = vec![0xfd];
        out.extend((value as u16).to_le_bytes());
        out
    } else if value <= 0xffff_ffff {
        let mut out = vec![0xfe];
        out.extend((value as u32).to_le_bytes());
        out
    } else {
        let mut out = vec![0xff];
        out.extend(value.to_le_bytes());
        out
    }
}

pub fn parse_transaction(raw: &[u8]) -> Result<ParsedTransaction, NativeProofError> {
    if raw.len() > MAX_NATIVE_TRANSACTION_BYTES {
        return Err(NativeProofError::ResourceLimit(
            "raw transaction".to_owned(),
        ));
    }
    if raw.len() < 10 {
        return Err(NativeProofError::InvalidLength(
            "raw transaction".to_owned(),
        ));
    }

    let mut reader = Reader::new(raw);
    let version = reader.i32("transaction version")?;
    let mut has_witness = false;
    let input_count = if reader.remaining() >= 2
        && reader.data[reader.offset] == 0
        && reader.data[reader.offset + 1] != 0
    {
        let marker = reader.u8("witness marker")?;
        let flags = reader.u8("witness flags")?;
        if marker != 0 || flags != 1 {
            return Err(NativeProofError::UnsupportedWitness);
        }
        has_witness = true;
        read_varint(&mut reader)?
    } else {
        read_varint(&mut reader)?
    };
    if input_count > MAX_NATIVE_TRANSACTION_INPUTS {
        return Err(NativeProofError::ResourceLimit(
            "transaction inputs".to_owned(),
        ));
    }
    let mut inputs = Vec::with_capacity(input_count as usize);
    for _ in 0..input_count {
        let previous_txid = reverse_slice_32(reader.read(32, "previous transaction id")?)?;
        let previous_vout = reader.u32("previous output index")?;
        let script_length = bounded_usize(
            read_varint(&mut reader)?,
            MAX_NATIVE_TRANSACTION_BYTES as u64,
            "scriptSig",
        )?;
        let script_sig = reader.read(script_length, "scriptSig")?.to_vec();
        let sequence = reader.u32("input sequence")?;
        inputs.push(TransactionInput {
            previous_txid,
            previous_vout,
            script_sig,
            sequence,
            witness: Vec::new(),
        });
    }

    let output_count = read_varint(&mut reader)?;
    if output_count > MAX_NATIVE_TRANSACTION_OUTPUTS {
        return Err(NativeProofError::ResourceLimit(
            "transaction outputs".to_owned(),
        ));
    }
    let mut outputs = Vec::with_capacity(output_count as usize);
    for _ in 0..output_count {
        let value_atomic = reader.u64("output value")?;
        if value_atomic > 0x7fff_ffff_ffff_ffff {
            return Err(NativeProofError::ResourceLimit("output value".to_owned()));
        }
        let script_length = bounded_usize(
            read_varint(&mut reader)?,
            MAX_NATIVE_TRANSACTION_BYTES as u64,
            "scriptPubKey",
        )?;
        outputs.push(TransactionOutput {
            value_atomic,
            script_pubkey: reader.read(script_length, "scriptPubKey")?.to_vec(),
        });
    }

    if has_witness {
        let mut witness_items = 0_u64;
        for input in &mut inputs {
            let count = read_varint(&mut reader)?;
            witness_items = witness_items
                .checked_add(count)
                .ok_or_else(|| NativeProofError::ResourceLimit("witness items".to_owned()))?;
            if witness_items > MAX_NATIVE_TRANSACTION_WITNESS_ITEMS {
                return Err(NativeProofError::ResourceLimit("witness items".to_owned()));
            }
            let mut witness = Vec::with_capacity(count as usize);
            for _ in 0..count {
                let length = bounded_usize(
                    read_varint(&mut reader)?,
                    MAX_NATIVE_TRANSACTION_BYTES as u64,
                    "witness item",
                )?;
                witness.push(reader.read(length, "witness item")?.to_vec());
            }
            input.witness = witness;
        }
        if witness_items == 0 {
            return Err(NativeProofError::UnsupportedWitness);
        }
    }

    let lock_time = reader.u32("lock time")?;
    if reader.remaining() != 0 {
        return Err(NativeProofError::TrailingTransactionData);
    }
    let stripped = serialize_stripped(version, &inputs, &outputs, lock_time);
    let txid = digest_to_display_hash(&sha256d(&stripped));
    let wtxid = digest_to_display_hash(&sha256d(raw));
    Ok(ParsedTransaction {
        raw: raw.to_vec(),
        version,
        has_witness,
        inputs,
        outputs,
        lock_time,
        stripped,
        txid,
        wtxid,
    })
}

pub fn output_at(
    transaction: &ParsedTransaction,
    output_index: u32,
) -> Result<&TransactionOutput, NativeProofError> {
    transaction
        .outputs
        .get(output_index as usize)
        .ok_or(NativeProofError::OutputMismatch)
}

pub fn spends_outpoint(transaction: &ParsedTransaction, outpoint: OutPoint) -> bool {
    transaction
        .inputs
        .iter()
        .any(|input| input.previous_txid == outpoint.txid && input.previous_vout == outpoint.vout)
}

fn read_varint(reader: &mut Reader<'_>) -> Result<u64, NativeProofError> {
    let prefix = reader.u8("compact size")?;
    if prefix < 0xfd {
        return Ok(prefix as u64);
    }
    if prefix == 0xfd {
        let bytes = reader.read(2, "compact size")?;
        let value = u16::from_le_bytes(bytes.try_into().expect("slice length checked")) as u64;
        if value < 0xfd {
            return Err(NativeProofError::NonCanonicalCompactSize);
        }
        return Ok(value);
    }
    if prefix == 0xfe {
        let value = reader.u32("compact size")? as u64;
        if value <= 0xffff {
            return Err(NativeProofError::NonCanonicalCompactSize);
        }
        return Ok(value);
    }
    let value = reader.u64("compact size")?;
    if value <= 0xffff_ffff {
        return Err(NativeProofError::NonCanonicalCompactSize);
    }
    Ok(value)
}

fn bounded_usize(value: u64, maximum: u64, label: &str) -> Result<usize, NativeProofError> {
    if value > maximum {
        return Err(NativeProofError::ResourceLimit(label.to_owned()));
    }
    usize::try_from(value).map_err(|_| NativeProofError::ResourceLimit(label.to_owned()))
}

fn serialize_stripped(
    version: i32,
    inputs: &[TransactionInput],
    outputs: &[TransactionOutput],
    lock_time: u32,
) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend(version.to_le_bytes());
    out.extend(encode_varint(inputs.len() as u64));
    for input in inputs {
        let mut previous_txid = input.previous_txid;
        previous_txid.reverse();
        out.extend(previous_txid);
        out.extend(input.previous_vout.to_le_bytes());
        out.extend(encode_varint(input.script_sig.len() as u64));
        out.extend(&input.script_sig);
        out.extend(input.sequence.to_le_bytes());
    }
    out.extend(encode_varint(outputs.len() as u64));
    for output in outputs {
        out.extend(output.value_atomic.to_le_bytes());
        out.extend(encode_varint(output.script_pubkey.len() as u64));
        out.extend(&output.script_pubkey);
    }
    out.extend(lock_time.to_le_bytes());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parser_rejects_noncanonical_and_trailing_transactions() {
        assert_eq!(
            parse_transaction(&[1, 0, 0, 0, 0xfd, 1, 0, 0, 0, 0, 0]).unwrap_err(),
            NativeProofError::NonCanonicalCompactSize
        );
        let trailing = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        assert_eq!(
            parse_transaction(&trailing).unwrap_err(),
            NativeProofError::TrailingTransactionData
        );
    }
}
