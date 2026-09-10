use num_bigint::BigUint;

use crate::bytes::{parse_hex_fixed, to_hex};
use crate::difficulty::{
    expected_next_work_required, validate_compact_target, DifficultyNode, PowParameters,
};
use crate::header::{
    block_proof, parse_header, serialize_header, uint256_max, verify_proof_of_work, ParsedHeader,
};
use crate::NativeProofError;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeNetwork {
    Mainnet,
    Regtest,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NativeChainParams {
    pub network: NativeNetwork,
    pub chain_name: &'static str,
    pub genesis_hash_hex: &'static str,
    pub genesis_merkle_root_hex: &'static str,
    pub genesis_time: u32,
    pub genesis_nonce: u32,
    pub genesis_bits: u32,
    pub genesis_version: i32,
    pub pow_limit_hex: &'static str,
    pub target_spacing_seconds: u32,
    pub target_timespan_seconds: u32,
    pub allow_minimum_difficulty_blocks: bool,
    pub no_retargeting: bool,
    pub enforce_bip94: bool,
    pub bip34_height: u32,
    pub bip65_height: u32,
    pub bip66_height: u32,
    pub csv_height: u32,
    pub segwit_height: u32,
    pub taproot_always_active: bool,
    pub decimals: u8,
    pub coin_atomic_units: u64,
    pub max_money_atomic_units: u64,
    pub p2tr_dust_threshold_atomic_units: u64,
    pub bech32_hrp: &'static str,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HeaderMeta {
    pub height: u32,
    pub hash: [u8; 32],
    pub merkle_root: [u8; 32],
    pub time: u32,
    pub bits: u32,
    pub chainwork: BigUint,
}

#[derive(Clone, Debug)]
pub struct HeaderChain {
    params: NativeChainParams,
    headers: Vec<HeaderMeta>,
}

impl NativeChainParams {
    pub fn mainnet() -> Self {
        Self {
            network: NativeNetwork::Mainnet,
            chain_name: "main",
            genesis_hash_hex: "00000a00a75c7ed12c71b9a8b73c01576009d62a0a606c0a1ef37b043c520fb2",
            genesis_merkle_root_hex:
                "45319425eda8b91d62440dd4372699f35509076c592e1f8ea707780335e60e89",
            genesis_time: 1_749_678_364,
            genesis_nonce: 835_537,
            genesis_bits: 0x1e0f_fff0,
            genesis_version: 1,
            pow_limit_hex: "00000fffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            target_spacing_seconds: 60,
            target_timespan_seconds: 7_200,
            allow_minimum_difficulty_blocks: false,
            no_retargeting: false,
            enforce_bip94: false,
            bip34_height: 0,
            bip65_height: 0,
            bip66_height: 0,
            csv_height: 0,
            segwit_height: 0,
            taproot_always_active: true,
            decimals: 8,
            coin_atomic_units: 100_000_000,
            max_money_atomic_units: 2_100_000_000_000_000,
            p2tr_dust_threshold_atomic_units: 330,
            bech32_hrp: "kpepe",
        }
    }

    pub fn regtest() -> Self {
        Self {
            network: NativeNetwork::Regtest,
            chain_name: "regtest",
            genesis_hash_hex: "352a1a62f7880d325da6d3fe2e62272cd0ce735a7ba003eae4fb59d2a175a8b9",
            genesis_merkle_root_hex:
                "45319425eda8b91d62440dd4372699f35509076c592e1f8ea707780335e60e89",
            genesis_time: 1_749_678_369,
            genesis_nonce: 5,
            genesis_bits: 0x207f_ffff,
            genesis_version: 1,
            pow_limit_hex: "7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            target_spacing_seconds: 60,
            target_timespan_seconds: 7_200,
            allow_minimum_difficulty_blocks: true,
            no_retargeting: true,
            enforce_bip94: false,
            bip34_height: 1,
            bip65_height: 1,
            bip66_height: 1,
            csv_height: 1,
            segwit_height: 0,
            taproot_always_active: true,
            decimals: 8,
            coin_atomic_units: 100_000_000,
            max_money_atomic_units: 2_100_000_000_000_000,
            p2tr_dust_threshold_atomic_units: 330,
            bech32_hrp: "rkpepe",
        }
    }

    pub fn genesis_hash(&self) -> [u8; 32] {
        parse_hex_fixed(self.genesis_hash_hex, "Native genesis hash")
            .expect("compiled Native genesis hash is valid")
    }

    pub fn genesis_merkle_root(&self) -> [u8; 32] {
        parse_hex_fixed(self.genesis_merkle_root_hex, "Native genesis merkle root")
            .expect("compiled Native genesis merkle root is valid")
    }

    pub fn pow_limit(&self) -> BigUint {
        BigUint::parse_bytes(self.pow_limit_hex.as_bytes(), 16)
            .expect("compiled Native pow limit is valid")
    }

    pub fn pow_parameters(&self) -> PowParameters {
        PowParameters {
            pow_limit: self.pow_limit(),
            target_spacing_seconds: self.target_spacing_seconds,
            target_timespan_seconds: self.target_timespan_seconds,
            allow_minimum_difficulty_blocks: self.allow_minimum_difficulty_blocks,
            no_retargeting: self.no_retargeting,
            enforce_bip94: self.enforce_bip94,
        }
    }

    pub fn genesis_header_bytes(&self) -> [u8; 80] {
        serialize_header(
            self.genesis_version,
            [0_u8; 32],
            self.genesis_merkle_root(),
            self.genesis_time,
            self.genesis_bits,
            self.genesis_nonce,
        )
    }
}

impl HeaderChain {
    pub fn from_genesis(params: NativeChainParams) -> Result<Self, NativeProofError> {
        let genesis = parse_header(&params.genesis_header_bytes())?;
        if genesis.hash != params.genesis_hash() {
            return Err(NativeProofError::WrongNetworkOrGenesis);
        }
        validate_compact_target(genesis.bits, &params.pow_parameters())?;
        if !verify_proof_of_work(&genesis, &params.pow_limit()) {
            return Err(NativeProofError::InvalidProofOfWork);
        }
        let chainwork = block_proof(genesis.bits, &params.pow_limit())?;
        Ok(Self {
            params,
            headers: vec![HeaderMeta {
                height: 0,
                hash: genesis.hash,
                merkle_root: genesis.merkle_root,
                time: genesis.time,
                bits: genesis.bits,
                chainwork,
            }],
        })
    }

    pub fn params(&self) -> NativeChainParams {
        self.params
    }

    pub fn tip(&self) -> &HeaderMeta {
        self.headers.last().expect("chain always has genesis")
    }

    pub fn headers(&self) -> &[HeaderMeta] {
        &self.headers
    }

    pub fn connect_header(&mut self, raw: &[u8]) -> Result<HeaderMeta, NativeProofError> {
        let parsed = parse_header(raw)?;
        let last = self.tip();
        if parsed.previous_hash != last.hash {
            return Err(NativeProofError::HeaderParentMismatch);
        }
        let next_height = last
            .height
            .checked_add(1)
            .ok_or_else(|| NativeProofError::ResourceLimit("header height".to_owned()))?;
        let mut recent_times: Vec<u32> =
            self.headers.iter().rev().take(11).map(|h| h.time).collect();
        recent_times.sort_unstable();
        if parsed.time <= recent_times[recent_times.len() / 2] {
            return Err(NativeProofError::InvalidHeaderTime);
        }
        assert_contextual_header_version(parsed.version, next_height, self.params)?;
        let expected = expected_next_work_required(
            &self.difficulty_nodes(),
            parsed.time,
            &self.params.pow_parameters(),
        )?;
        if parsed.bits != expected {
            return Err(NativeProofError::BadDifficulty);
        }
        validate_compact_target(parsed.bits, &self.params.pow_parameters())?;
        if !verify_proof_of_work(&parsed, &self.params.pow_limit()) {
            return Err(NativeProofError::InvalidProofOfWork);
        }
        let chainwork =
            last.chainwork.clone() + block_proof(parsed.bits, &self.params.pow_limit())?;
        if chainwork > uint256_max() {
            return Err(NativeProofError::ChainworkOverflow);
        }
        let meta = HeaderMeta {
            height: next_height,
            hash: parsed.hash,
            merkle_root: parsed.merkle_root,
            time: parsed.time,
            bits: parsed.bits,
            chainwork,
        };
        self.headers.push(meta.clone());
        Ok(meta)
    }

    fn difficulty_nodes(&self) -> Vec<DifficultyNode> {
        self.headers
            .iter()
            .map(|header| DifficultyNode {
                height: header.height,
                time: header.time,
                bits: header.bits,
            })
            .collect()
    }
}

pub fn assert_contextual_header_version(
    version: i32,
    height: u32,
    params: NativeChainParams,
) -> Result<(), NativeProofError> {
    if height == 0 {
        return Ok(());
    }
    if (version < 2 && height >= params.bip34_height)
        || (version < 3 && height >= params.bip66_height)
        || (version < 4 && height >= params.bip65_height)
    {
        return Err(NativeProofError::OutdatedBlockVersion);
    }
    Ok(())
}

pub fn confirmations_at_tip(block_height: u32, tip_height: u32) -> Option<u32> {
    tip_height
        .checked_sub(block_height)
        .and_then(|depth| depth.checked_add(1))
}

pub fn assert_finality(
    block: &HeaderMeta,
    tip: &HeaderMeta,
    minimum_confirmations: u32,
) -> Result<(), NativeProofError> {
    if tip.height < block.height || tip.chainwork < block.chainwork {
        return Err(NativeProofError::FinalityNotSatisfied);
    }
    let confirmations = confirmations_at_tip(block.height, tip.height)
        .ok_or(NativeProofError::FinalityNotSatisfied)?;
    if confirmations < minimum_confirmations {
        return Err(NativeProofError::FinalityNotSatisfied);
    }
    Ok(())
}

pub fn parsed_header_hash_hex(header: &ParsedHeader) -> String {
    to_hex(&header.hash)
}

#[cfg(test)]
mod tests {
    use num_bigint::BigUint;

    use super::*;
    use crate::bytes::{parse_hex, parse_hex_fixed};
    use crate::difficulty::{
        calculate_next_work_required, expected_next_work_required, DifficultyNode,
    };
    use crate::header::{decode_compact, encode_compact, target_from_bits};

    #[test]
    fn genesis_headers_hash_and_satisfy_pow() {
        for params in [NativeChainParams::mainnet(), NativeChainParams::regtest()] {
            let header = parse_header(&params.genesis_header_bytes()).unwrap();
            assert_eq!(header.hash, params.genesis_hash());
            assert_eq!(header.merkle_root, params.genesis_merkle_root());
            assert_eq!(header.bits, params.genesis_bits);
            assert!(verify_proof_of_work(&header, &params.pow_limit()));
            assert!(block_proof(header.bits, &params.pow_limit()).unwrap() > BigUint::from(0_u8));
        }
    }

    #[test]
    fn compact_targets_match_signed_overflow_and_roundtrip_rules() {
        let decoded = decode_compact(0x1d00_ffff);
        assert_eq!(decoded.target, BigUint::from(0xffff_u32) << 208_u32);
        assert!(decode_compact(0x1d80_ffff).negative);
        assert!(decode_compact(0x2300_0001).overflow);
        assert!(!decode_compact(0).valid);
        for bits in [
            0x0101_0000,
            0x1d00_ffff,
            0x1e0f_fff0,
            0x1f00_ffff,
            0x207f_ffff,
        ] {
            let target = decode_compact(bits).target;
            assert_eq!(encode_compact(&target, false).unwrap(), bits);
        }
    }

    #[test]
    fn mainnet_difficulty_retargets_at_120_block_interval() {
        let params = NativeChainParams::mainnet().pow_parameters();
        let bits = 0x1e0f_fff0;
        let nodes = linked_timeline(120, 1_700_000_000, 60, bits);
        assert_eq!(
            expected_next_work_required(&nodes[..119], nodes[118].time + 60, &params).unwrap(),
            bits
        );
        let next = expected_next_work_required(&nodes, nodes[119].time + 60, &params).unwrap();
        let old_target = target_from_bits(bits, &params.pow_limit).unwrap();
        assert_eq!(
            next,
            encode_compact(&((old_target * 7_140_u32) / 7_200_u32), false).unwrap()
        );
    }

    #[test]
    fn retarget_clamps_and_regtest_does_not_retarget() {
        let mainnet = NativeChainParams::mainnet().pow_parameters();
        let bits = 0x1e0f_fff0;
        let target = target_from_bits(bits, &mainnet.pow_limit).unwrap();
        assert_eq!(
            calculate_next_work_required(bits, 10_000, 10_000, &mainnet).unwrap(),
            encode_compact(&(target / 4_u32), false).unwrap()
        );
        assert_eq!(
            calculate_next_work_required(bits, 110_000, 10_000, &mainnet).unwrap(),
            encode_compact(&mainnet.pow_limit, false).unwrap()
        );

        let regtest = NativeChainParams::regtest().pow_parameters();
        let nodes = linked_timeline(240, 1_700_000_000, 600, 0x207f_ffff);
        assert_eq!(
            expected_next_work_required(&nodes[..120], nodes[119].time + 10_000, &regtest).unwrap(),
            0x207f_ffff
        );
        assert_eq!(
            expected_next_work_required(&nodes, nodes[239].time + 10_000, &regtest).unwrap(),
            0x207f_ffff
        );
    }

    #[test]
    fn genesis_transaction_serializes_to_pinned_merkle_root() {
        let timestamp = b"Pow are stronger than fiat";
        let public_key = parse_hex(
            "0497da2bffaf2c7fee8c80b91fcfa6562eb6d8c757d2d04fdeba7fe97cb3d7e7d6b9ccd3d2a4f938fe7cd05bf5c3eaa30ccc8ade3fec0b51bf6f110f16fab0bba0",
            Some(65),
            "genesis public key",
        )
        .unwrap();
        let mut raw = Vec::new();
        raw.extend(parse_hex("01000000", Some(4), "version").unwrap());
        raw.push(1);
        raw.extend([0_u8; 32]);
        raw.extend(parse_hex("ffffffff", Some(4), "vout").unwrap());
        let mut script_sig = parse_hex("04ffff001d0104", Some(7), "script sig prefix").unwrap();
        script_sig.push(timestamp.len() as u8);
        script_sig.extend(timestamp);
        raw.extend(crate::transaction::encode_varint(script_sig.len() as u64));
        raw.extend(script_sig);
        raw.extend(parse_hex("ffffffff", Some(4), "sequence").unwrap());
        raw.push(1);
        raw.extend(parse_hex("00a3e11100000000", Some(8), "output value").unwrap());
        let mut script_pubkey = Vec::with_capacity(67);
        script_pubkey.push(0x41);
        script_pubkey.extend(public_key);
        script_pubkey.push(0xac);
        raw.extend(crate::transaction::encode_varint(script_pubkey.len() as u64));
        raw.extend(script_pubkey);
        raw.extend([0_u8; 4]);

        let transaction = crate::transaction::parse_transaction(&raw).unwrap();
        assert_eq!(
            transaction.txid,
            NativeChainParams::mainnet().genesis_merkle_root()
        );
        assert_eq!(transaction.wtxid, transaction.txid);
        assert_eq!(transaction.outputs[0].value_atomic, 300_000_000);
        assert_eq!(transaction.inputs[0].previous_txid, [0_u8; 32]);
        assert_eq!(
            parse_hex_fixed::<32>(
                "45319425eda8b91d62440dd4372699f35509076c592e1f8ea707780335e60e89",
                "root"
            )
            .unwrap(),
            transaction.txid
        );
    }

    fn linked_timeline(count: u32, start: u32, spacing: u32, bits: u32) -> Vec<DifficultyNode> {
        (0..count)
            .map(|height| DifficultyNode {
                height,
                time: start + height * spacing,
                bits,
            })
            .collect()
    }
}
