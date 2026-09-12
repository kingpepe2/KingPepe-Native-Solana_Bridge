//! Bridge-owned Solana ABI schemas. These fixed Borsh layouts preserve existing
//! account sizes, instruction tags and the canonical-message offset. They are
//! not Solana System, SPL Token or Ed25519 instruction schemas.
use crate::{Hash32, PubkeyBytes, MAX_DESTINATION_LENGTH, MESSAGE_LENGTH};
use borsh::{BorshDeserialize, BorshSerialize};

#[derive(Clone, BorshSerialize, BorshDeserialize)]
pub struct BridgeBindingWire {
    pub environment: u8,
    pub manager_program_id: PubkeyBytes,
    pub transceiver_program_id: PubkeyBytes,
    pub solana_deployment: Hash32,
    pub mint: PubkeyBytes,
    pub token_program_id: PubkeyBytes,
    pub mint_authority_pda: PubkeyBytes,
    pub decimals: u8,
    pub native_decimals: u8,
}

#[derive(Clone, BorshSerialize, BorshDeserialize)]
pub struct BridgePolicyWire {
    pub policy_epoch: u32,
    pub key_epoch: u32,
    pub deposits_paused: bool,
    pub withdrawals_paused: bool,
    pub hard_stop: bool,
    pub mainnet_activation_enabled: bool,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct BridgeConfigWire {
    pub binding: BridgeBindingWire,
    // Fixed padded optional key, not Borsh Option<Pubkey>. A zero tag requires
    // an all-zero key; bridge policy additionally requires None and zero supply.
    pub freeze_tag: u8,
    pub freeze_key: PubkeyBytes,
    pub initial_supply: u128,
    pub policy: BridgePolicyWire,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct BridgeInitializeWire {
    pub tag: u8,
    pub binding: BridgeBindingWire,
    pub policy: BridgePolicyWire,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct BridgeStateWire {
    pub magic: [u8; 8],
    pub version: u8,
    pub state: u8,
    pub config: BridgeConfigWire,
    pub minted_supply: u128,
    pub burned_unpaid_withdrawals: u128,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct DestinationWire {
    pub length: u16,
    pub padded: [u8; MAX_DESTINATION_LENGTH],
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct DepositClaimWire {
    pub magic: [u8; 8],
    pub version: u8,
    pub operation_id: Hash32,
    pub message_digest: Hash32,
    pub amount_atomic: u64,
    pub recipient: DestinationWire,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct WithdrawalRecordWire {
    pub magic: [u8; 8],
    pub version: u8,
    pub withdrawal_id: Hash32,
    pub operation_id: Hash32,
    pub message_digest: Hash32,
    pub gross_amount_atomic: u64,
    pub fee_atomic: u64,
    pub native_destination: DestinationWire,
    pub burn_authority: PubkeyBytes,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct DepositBackingWire {
    pub magic: [u8; 8],
    pub version: u8,
    pub operation_id: Hash32,
    pub message_digest: Hash32,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct BurnCheckedWire {
    pub token_program_id: PubkeyBytes,
    pub mint: PubkeyBytes,
    pub authority: PubkeyBytes,
    pub amount_atomic: u64,
    pub decimals: u8,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct AcceptDepositClaimWire {
    pub tag: u8,
    pub message: [u8; MESSAGE_LENGTH],
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct RecordWithdrawalWire {
    pub tag: u8,
    pub message: [u8; MESSAGE_LENGTH],
    pub burn: BurnCheckedWire,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct TransceiverConfigWire {
    pub transceiver_program_id: PubkeyBytes,
    pub manager_program_id: PubkeyBytes,
    pub mint: PubkeyBytes,
    pub solana_deployment: Hash32,
    pub protocol_id: u32,
    pub native_network: u32,
    pub native_genesis: Hash32,
    pub authorized_attesters: [PubkeyBytes; 2],
    pub active: bool,
    pub key_epoch: u32,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct TransceiverInitializeWire {
    pub tag: u8,
    pub config: TransceiverConfigWire,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct TransceiverStateWire {
    pub magic: [u8; 8],
    pub version: u8,
    pub config: TransceiverConfigWire,
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct VerifyMessageWire {
    pub tag: u8,
    pub message: [u8; MESSAGE_LENGTH],
    pub ed25519_instruction_indexes: [u16; 2],
}

#[derive(BorshSerialize, BorshDeserialize)]
pub struct VerifiedReceiptWire {
    pub magic: [u8; 8],
    pub version: u8,
    pub message_digest: Hash32,
    pub operation_id: Hash32,
    pub transceiver_program_id: PubkeyBytes,
    pub manager_program_id: PubkeyBytes,
    pub mint: PubkeyBytes,
    pub direction: u8,
    pub action: u8,
    pub key_epoch: u32,
    pub attesters: [PubkeyBytes; 2],
    pub consumed: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    fn binding() -> BridgeBindingWire {
        BridgeBindingWire {
            environment: 0,
            manager_program_id: [1; 32],
            transceiver_program_id: [2; 32],
            solana_deployment: [3; 32],
            mint: [4; 32],
            token_program_id: [5; 32],
            mint_authority_pda: [6; 32],
            decimals: 8,
            native_decimals: 8,
        }
    }
    fn policy() -> BridgePolicyWire {
        BridgePolicyWire {
            policy_epoch: 0x01020304,
            key_epoch: u32::MAX,
            deposits_paused: false,
            withdrawals_paused: false,
            hard_stop: false,
            mainnet_activation_enabled: false,
        }
    }
    fn config() -> BridgeConfigWire {
        BridgeConfigWire {
            binding: binding(),
            freeze_tag: 0,
            freeze_key: [0; 32],
            initial_supply: 0,
            policy: policy(),
        }
    }
    fn destination() -> DestinationWire {
        let mut padded = [0; 128];
        padded[..32].fill(10);
        DestinationWire { length: 32, padded }
    }
    fn burn() -> BurnCheckedWire {
        BurnCheckedWire {
            token_program_id: [5; 32],
            mint: [4; 32],
            authority: [14; 32],
            amount_atomic: u64::MAX,
            decimals: 8,
        }
    }
    fn transceiver() -> TransceiverConfigWire {
        TransceiverConfigWire {
            transceiver_program_id: [2; 32],
            manager_program_id: [1; 32],
            mint: [4; 32],
            solana_deployment: [3; 32],
            protocol_id: 1,
            native_network: 8000111,
            native_genesis: [7; 32],
            authorized_attesters: [[8; 32], [9; 32]],
            active: true,
            key_epoch: u32::MAX,
        }
    }
    fn message(index: usize) -> [u8; MESSAGE_LENGTH] {
        let file: serde_json::Value =
            serde_json::from_str(include_str!("../vectors/canonical-borsh-v2.json")).unwrap();
        let bytes = unhex(file["vectors"][index]["encodedHex"].as_str().unwrap());
        crate::CanonicalBridgeMessage::decode(&bytes)
            .unwrap()
            .encode()
            .unwrap()
            .try_into()
            .unwrap()
    }
    fn unhex(text: &str) -> Vec<u8> {
        text.as_bytes()
            .chunks_exact(2)
            .map(|c| u8::from_str_radix(std::str::from_utf8(c).unwrap(), 16).unwrap())
            .collect()
    }
    fn check<T: BorshSerialize + BorshDeserialize>(name: &str, value: T) {
        let file: serde_json::Value =
            serde_json::from_str(include_str!("../vectors/abi-borsh-v2.json")).unwrap();
        let vector = file["vectors"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["name"] == name)
            .unwrap();
        let bytes = borsh::to_vec(&value).unwrap();
        assert_eq!(
            bytes,
            unhex(vector["encodedHex"].as_str().unwrap()),
            "{name}"
        );
        assert_eq!(
            &Sha256::digest(&bytes)[..],
            unhex(vector["sha256"].as_str().unwrap()),
            "{name}"
        );
        assert_eq!(
            borsh::to_vec(&borsh::from_slice::<T>(&bytes).unwrap()).unwrap(),
            bytes
        );
        for length in 0..bytes.len() {
            assert!(
                borsh::from_slice::<T>(&bytes[..length]).is_err(),
                "{name}:{length}"
            );
        }
        let mut trailing = bytes;
        trailing.push(0);
        assert!(
            borsh::from_slice::<T>(&trailing).is_err(),
            "{name}:trailing"
        );
    }

    #[test]
    fn fixed_abi_borsh_vectors_match_typescript_bytes_and_hashes() {
        check("BridgeConfig", config());
        check(
            "BridgeInitialize",
            BridgeInitializeWire {
                tag: 1,
                binding: binding(),
                policy: policy(),
            },
        );
        check(
            "BridgeState",
            BridgeStateWire {
                magic: *b"KPBSTAT1",
                version: 1,
                state: 2,
                config: config(),
                minted_supply: u128::MAX,
                burned_unpaid_withdrawals: 0,
            },
        );
        check(
            "DepositClaim",
            DepositClaimWire {
                magic: *b"KPBCLM01",
                version: 1,
                operation_id: [11; 32],
                message_digest: [12; 32],
                amount_atomic: u64::MAX,
                recipient: destination(),
            },
        );
        check(
            "WithdrawalRecord",
            WithdrawalRecordWire {
                magic: *b"KPBWDR01",
                version: 1,
                withdrawal_id: [13; 32],
                operation_id: [11; 32],
                message_digest: [12; 32],
                gross_amount_atomic: u64::MAX,
                fee_atomic: 1,
                native_destination: destination(),
                burn_authority: [14; 32],
            },
        );
        check(
            "DepositBacking",
            DepositBackingWire {
                magic: *b"KPBBAK01",
                version: 1,
                operation_id: [11; 32],
                message_digest: [12; 32],
            },
        );
        check("BurnChecked", burn());
        let mut zero = burn();
        zero.amount_atomic = 0;
        check("BurnCheckedZero", zero);
        check(
            "AcceptDepositClaim",
            AcceptDepositClaimWire {
                tag: 2,
                message: message(0),
            },
        );
        check(
            "RecordWithdrawal",
            RecordWithdrawalWire {
                tag: 3,
                message: message(1),
                burn: burn(),
            },
        );
        check("TransceiverConfig", transceiver());
        check(
            "TransceiverInitialize",
            TransceiverInitializeWire {
                tag: 1,
                config: transceiver(),
            },
        );
        check(
            "TransceiverState",
            TransceiverStateWire {
                magic: *b"KPTCFG02",
                version: 1,
                config: transceiver(),
            },
        );
        check(
            "VerifyMessage",
            VerifyMessageWire {
                tag: 2,
                message: message(0),
                ed25519_instruction_indexes: [0, 1],
            },
        );
        check(
            "VerifiedReceipt",
            VerifiedReceiptWire {
                magic: *b"KPTRCPT1",
                version: 1,
                message_digest: [12; 32],
                operation_id: [11; 32],
                transceiver_program_id: [2; 32],
                manager_program_id: [1; 32],
                mint: [4; 32],
                direction: 0,
                action: 0,
                key_epoch: u32::MAX,
                attesters: [[8; 32], [9; 32]],
                consumed: true,
            },
        );
    }

    #[test]
    fn borsh_abi_rejects_noncanonical_booleans() {
        let mut bytes = borsh::to_vec(&transceiver()).unwrap();
        bytes[232] = 2;
        assert!(borsh::from_slice::<TransceiverConfigWire>(&bytes).is_err());
        let mut bytes = borsh::to_vec(&config()).unwrap();
        for index in 252..256 {
            bytes[index] = 2;
            assert!(borsh::from_slice::<BridgeConfigWire>(&bytes).is_err());
            bytes[index] = 0;
        }
    }
}
