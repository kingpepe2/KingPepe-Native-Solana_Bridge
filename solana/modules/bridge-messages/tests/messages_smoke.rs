use bridge_messages::{
    BridgeAction, BridgeDirection, BridgeOperationState, BridgeStateEvent, CanonicalBridgeMessage,
    DeploymentIdentity, DepositClaimFields, LedgerError, LedgerState, MessageDecodeError,
    MessageEncodeError, MessageEpochs, NativeOutpoint, ValidityWindow, WithdrawalRequestFields,
    MESSAGE_LENGTH, MESSAGE_VERSION,
};
use serde::Deserialize;
use std::fmt::Write as _;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VectorFile {
    message_length: usize,
    vectors: Vec<VectorCase>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VectorCase {
    name: String,
    action: String,
    direction: String,
    deployment: VectorDeployment,
    deposit_outpoint: VectorOutpoint,
    withdrawal_id: String,
    amount_atomic: String,
    fee_atomic: String,
    destination: String,
    policy_epoch: u32,
    key_epoch: u32,
    nonce: String,
    valid_from: String,
    valid_until: String,
    evidence_digest: String,
    operation_id: String,
    operation_id_inputs_hex: String,
    message_digest: String,
    encoded_hex: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VectorDeployment {
    protocol_id: u32,
    native_network: u32,
    native_genesis: String,
    solana_deployment: String,
    manager_program_id: String,
    transceiver_program_id: String,
    mint: String,
}

#[derive(Debug, Deserialize)]
struct VectorOutpoint {
    txid: String,
    vout: u32,
}

fn deployment() -> DeploymentIdentity {
    DeploymentIdentity {
        protocol_id: 1,
        native_network: 8_000_111,
        native_genesis: [1u8; 32],
        solana_deployment: [2u8; 32],
        manager_program_id: [3u8; 32],
        transceiver_program_id: [4u8; 32],
        mint: [5u8; 32],
    }
}

fn deposit_message() -> CanonicalBridgeMessage {
    CanonicalBridgeMessage::new_deposit_claim(DepositClaimFields {
        deployment: deployment(),
        deposit_outpoint: NativeOutpoint {
            txid: [7u8; 32],
            vout: 2,
        },
        amount_atomic: 12_345,
        solana_recipient: [8u8; 32],
        epochs: MessageEpochs {
            policy_epoch: 1,
            key_epoch: 2,
        },
        nonce: [0x42u8; 32],
        validity: ValidityWindow {
            valid_from: 1_700_000_000,
            valid_until: 1_700_001_200,
        },
        evidence_digest: [9u8; 32],
    })
    .expect("deposit message")
}

fn withdrawal_message() -> CanonicalBridgeMessage {
    CanonicalBridgeMessage::new_withdrawal_request(WithdrawalRequestFields {
        deployment: deployment(),
        withdrawal_id: [0xAAu8; 32],
        gross_amount_atomic: 1_000,
        fee_atomic: 12,
        native_destination: vec![0x51, 0x20, 0x99],
        epochs: MessageEpochs {
            policy_epoch: 1,
            key_epoch: 2,
        },
        nonce: [0x43u8; 32],
        validity: ValidityWindow {
            valid_from: 1_700_000_000,
            valid_until: 1_700_001_200,
        },
        evidence_digest: [0xBBu8; 32],
    })
    .expect("withdrawal message")
}

fn hex_to_bytes(hex: &str) -> Vec<u8> {
    assert_eq!(hex.len() % 2, 0, "hex length must be even");
    (0..hex.len())
        .step_by(2)
        .map(|idx| u8::from_str_radix(&hex[idx..idx + 2], 16).expect("valid hex"))
        .collect()
}

fn hash32(hex: &str) -> [u8; 32] {
    hex_to_bytes(hex).try_into().expect("32-byte hex")
}

fn hex_lower(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(&mut out, "{byte:02x}").expect("write to string");
    }
    out
}

fn vector_deployment(input: &VectorDeployment) -> DeploymentIdentity {
    DeploymentIdentity {
        protocol_id: input.protocol_id,
        native_network: input.native_network,
        native_genesis: hash32(&input.native_genesis),
        solana_deployment: hash32(&input.solana_deployment),
        manager_program_id: hash32(&input.manager_program_id),
        transceiver_program_id: hash32(&input.transceiver_program_id),
        mint: hash32(&input.mint),
    }
}

fn vector_message(input: &VectorCase) -> CanonicalBridgeMessage {
    match (input.action.as_str(), input.direction.as_str()) {
        ("DepositClaim", "NativeToSolana") => {
            CanonicalBridgeMessage::new_deposit_claim(DepositClaimFields {
                deployment: vector_deployment(&input.deployment),
                deposit_outpoint: NativeOutpoint {
                    txid: hash32(&input.deposit_outpoint.txid),
                    vout: input.deposit_outpoint.vout,
                },
                amount_atomic: input.amount_atomic.parse().expect("amount"),
                solana_recipient: hash32(&input.destination),
                epochs: MessageEpochs {
                    policy_epoch: input.policy_epoch,
                    key_epoch: input.key_epoch,
                },
                nonce: hash32(&input.nonce),
                validity: ValidityWindow {
                    valid_from: input.valid_from.parse().expect("valid_from"),
                    valid_until: input.valid_until.parse().expect("valid_until"),
                },
                evidence_digest: hash32(&input.evidence_digest),
            })
            .expect("deposit vector message")
        }
        ("WithdrawalRequest", "SolanaToNative") => {
            CanonicalBridgeMessage::new_withdrawal_request(WithdrawalRequestFields {
                deployment: vector_deployment(&input.deployment),
                withdrawal_id: hash32(&input.withdrawal_id),
                gross_amount_atomic: input.amount_atomic.parse().expect("amount"),
                fee_atomic: input.fee_atomic.parse().expect("fee"),
                native_destination: hex_to_bytes(&input.destination),
                epochs: MessageEpochs {
                    policy_epoch: input.policy_epoch,
                    key_epoch: input.key_epoch,
                },
                nonce: hash32(&input.nonce),
                validity: ValidityWindow {
                    valid_from: input.valid_from.parse().expect("valid_from"),
                    valid_until: input.valid_until.parse().expect("valid_until"),
                },
                evidence_digest: hash32(&input.evidence_digest),
            })
            .expect("withdrawal vector message")
        }
        _ => panic!("unsupported vector case {}", input.name),
    }
}

#[test]
fn canonical_encoding_round_trip() {
    let message = deposit_message();
    let encoded = message.encode().expect("canonical encoding");
    assert_eq!(encoded.len(), MESSAGE_LENGTH);
    let decoded = CanonicalBridgeMessage::decode(&encoded).expect("decode");
    assert_eq!(decoded, message);
}

#[test]
fn shared_golden_vectors_match_rust_encoding() {
    let file: VectorFile = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/vectors/canonical-borsh-v2.json"
    )))
    .expect("parse vector file");
    assert_eq!(file.message_length, MESSAGE_LENGTH);

    for case in file.vectors {
        let message = vector_message(&case);
        let encoded = message.encode().expect("encode vector");
        let message_digest = message.message_digest().expect("message digest");
        let encoded_hex = hex_lower(&encoded);
        let digest_hex = hex_lower(&message_digest);
        let operation_id_hex = hex_lower(&message.operation_id);

        assert_eq!(operation_id_hex, case.operation_id, "{}", case.name);
        assert_eq!(
            hex_lower(
                &message
                    .encode_operation_id_inputs()
                    .expect("Borsh preimage")
            ),
            case.operation_id_inputs_hex,
            "{}",
            case.name
        );
        assert_eq!(digest_hex, case.message_digest, "{}", case.name);
        assert_eq!(encoded_hex, case.encoded_hex, "{}", case.name);
    }
}

#[test]
fn canonical_vectors_reject_every_single_bit_corruption() {
    let file: VectorFile =
        serde_json::from_str(include_str!("../vectors/canonical-borsh-v2.json")).unwrap();
    assert!(!file.vectors.is_empty());
    for case in file.vectors {
        let encoded = hex_to_bytes(&case.encoded_hex);
        assert_eq!(encoded.len(), MESSAGE_LENGTH);
        assert_eq!(
            CanonicalBridgeMessage::decode(&encoded).unwrap(),
            vector_message(&case)
        );
        // Corruption without recomputing the operation ID must be rejected.
        // A valid NEW message still needs independent authorization/evidence.
        // A decoder panic fails this test; only an explicit error is accepted.
        for index in 0..encoded.len() {
            for bit in 0..8 {
                let mut corrupted = encoded.clone();
                corrupted[index] ^= 1 << bit;
                assert!(
                    CanonicalBridgeMessage::decode(&corrupted).is_err(),
                    "{}: byte {index}, bit {bit}",
                    case.name
                );
            }
        }
    }
}

#[test]
fn withdrawal_encoding_round_trip() {
    let message = withdrawal_message();
    let encoded = message.encode().expect("canonical encoding");
    assert_eq!(encoded.len(), MESSAGE_LENGTH);
    let decoded = CanonicalBridgeMessage::decode(&encoded).expect("decode");
    assert_eq!(decoded, message);
}

#[test]
fn decoding_rejects_wrong_direction_byte_and_trailing_data() {
    let mut encoded = deposit_message().encode().expect("encode");
    encoded[10] = 0xFF;
    assert!(matches!(
        CanonicalBridgeMessage::decode(&encoded),
        Err(MessageDecodeError::InvalidDirection(0xFF))
    ));

    let mut trailing = deposit_message().encode().expect("encode");
    trailing.push(0);
    assert!(matches!(
        CanonicalBridgeMessage::decode(&trailing),
        Err(MessageDecodeError::InvalidLength { .. })
    ));
}

#[test]
fn rejects_mutated_operation_id_and_wrong_domain() {
    let mut message = deposit_message();
    message.operation_id[0] ^= 0x80;
    assert!(matches!(
        message.encode(),
        Err(MessageEncodeError::OperationIdMismatch)
    ));

    let mut wrong_domain = deposit_message();
    wrong_domain.deployment.mint = [0x10u8; 32];
    assert!(matches!(
        wrong_domain.encode(),
        Err(MessageEncodeError::OperationIdMismatch)
    ));
}

#[test]
fn rejects_wrong_action_direction_pair() {
    let mut message = deposit_message();
    message.direction = BridgeDirection::SolanaToNative;
    message.operation_id = message.derive_operation_id().expect("derive");
    assert!(matches!(
        message.encode(),
        Err(MessageEncodeError::ActionDirectionMismatch)
    ));

    let mut wrong_action = withdrawal_message();
    wrong_action.action = BridgeAction::DepositClaim;
    wrong_action.operation_id = wrong_action.derive_operation_id().expect("derive");
    assert!(matches!(
        wrong_action.encode(),
        Err(MessageEncodeError::ActionDirectionMismatch)
    ));
}

#[test]
fn state_machine_allows_expected_automatic_transfer_lifecycle() {
    let mut state = BridgeOperationState::Observed;
    state = state
        .transition(BridgeStateEvent::ObservationAccepted)
        .expect("observed");
    state = state
        .transition(BridgeStateEvent::FinalityReached)
        .expect("finality");
    state = state
        .transition(BridgeStateEvent::DependencySatisfied)
        .expect("dependency");
    state = state
        .transition(BridgeStateEvent::BeginSigning)
        .expect("signing");
    state = state
        .transition(BridgeStateEvent::BroadcastSubmitted)
        .expect("broadcast");
    state = state
        .transition(BridgeStateEvent::BroadcastObserved)
        .expect("observed broadcast");
    state = state
        .transition(BridgeStateEvent::SettlementFinalized)
        .expect("settlement");

    assert_eq!(state.as_str(), "COMPLETED");
    assert!(state.is_terminal());
    assert!(state.transition(BridgeStateEvent::Reject).is_err());
}

#[test]
fn ledger_keeps_burned_withdrawal_as_liability_until_payout() {
    let mut ledger = LedgerState::new();
    ledger
        .record_validated_deposit(10_000, 0)
        .expect("reserve credit");
    ledger.record_mint(10_000, 0).expect("mint");
    ledger.record_burn_request(1_000, 0).expect("burn");

    assert_eq!(ledger.minted_supply, 9_000);
    assert_eq!(ledger.burned_unpaid_withdrawals, 1_000);
    assert_eq!(ledger.coverage_required().unwrap(), 10_000);

    ledger
        .reserve_withdrawal_utxos(1_000)
        .expect("reserve utxo");
    ledger.record_payout_broadcast(1_000).expect("broadcast");
    ledger.record_payout_settlement(1_000).expect("settle");

    assert_eq!(ledger.canonical_reserve, 9_000);
    assert_eq!(ledger.minted_supply, 9_000);
    assert_eq!(ledger.coverage_required().unwrap(), 9_000);
    assert_eq!(ledger.unsettled_operations, 0);
}

#[test]
fn ledger_rejects_unbacked_or_imprecise_operations() {
    let mut ledger = LedgerState::new();
    assert!(matches!(
        ledger.record_mint(1, 0),
        Err(LedgerError::InsufficientFunds)
    ));
    assert!(matches!(
        ledger.record_validated_deposit(100, 101),
        Err(LedgerError::FeeExceedsAmount)
    ));

    let mut message = deposit_message();
    message.version = MESSAGE_VERSION + 1;
    assert!(matches!(
        message.encode(),
        Err(MessageEncodeError::UnsupportedVersion { .. })
    ));
}
