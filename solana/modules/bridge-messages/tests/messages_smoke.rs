use bridge_messages::{
    BridgeAction, BridgeDirection, BridgeOperationState, BridgeStateEvent, CanonicalBridgeMessage, DeploymentIdentity,
    LedgerError, LedgerState, MessageDecodeError, MESSAGE_LENGTH, MESSAGE_VERSION,
};

fn sample_message() -> CanonicalBridgeMessage {
    CanonicalBridgeMessage {
        version: MESSAGE_VERSION,
        direction: BridgeDirection::NativeToSolana,
        action: BridgeAction::DepositClaim,
        protocol_version: 1,
        deployment: DeploymentIdentity {
            protocol_id: 1,
            native_chain_id: 8_000_111,
            native_genesis: [1u8; 32],
            solana_cluster: [2u8; 32],
            manager_program_id: [3u8; 32],
            transceiver_program_id: [4u8; 32],
            mint: [5u8; 32],
        },
        operation_id: [6u8; 32],
        native_reference: [7u8; 32],
        recipient: [8u8; 32],
        amount: 12_345,
        fee: 3,
        policy_epoch: 1,
        nonce: 42,
        evidence_valid_until: 1_700_000_000,
        validity_window: 1200,
        evidence_digest: [9u8; 32],
    }
}

#[test]
fn canonical_encoding_round_trip() {
    let message = sample_message();
    let encoded = message.encode().expect("canonical encoding");
    assert_eq!(encoded.len(), MESSAGE_LENGTH);
    let decoded = CanonicalBridgeMessage::decode(&encoded).expect("decode");
    assert_eq!(decoded, message);
}

#[test]
fn decoding_rejects_wrong_direction_byte() {
    let mut encoded = sample_message().encode().expect("encode");
    encoded[1] = 0xFF;
    assert!(matches!(
        CanonicalBridgeMessage::decode(&encoded),
        Err(MessageDecodeError::InvalidDirection(0xFF))
    ));
}

#[test]
fn decoding_rejects_wrong_length() {
    let mut encoded = sample_message().encode().expect("encode");
    encoded.pop();
    assert!(matches!(
        CanonicalBridgeMessage::decode(&encoded),
        Err(MessageDecodeError::InvalidLength { .. })
    ));
}

#[test]
fn state_machine_allows_expected_transitions() {
    let mut state = BridgeOperationState::WAITING_FOR_FINALITY;
    state = state
        .transition(BridgeStateEvent::ObservedFinality)
        .expect("transition 1");
    state = state
        .transition(BridgeStateEvent::QueueByLimit)
        .expect("transition 2");
    state = state
        .transition(BridgeStateEvent::DependencySatisfied)
        .expect("transition 3");
    state = state
        .transition(BridgeStateEvent::Complete)
        .expect("transition 4");

    assert!(state.is_terminal());
}

#[test]
fn ledger_enforces_coverage_and_checked_arithmetic() {
    let mut ledger = LedgerState::new();
    ledger
        .record_validated_deposit(10_000, 20)
        .expect("deposit");
    ledger
        .record_burn_request(1_000, 5)
        .expect("burn request");
    assert!(matches!(
        ledger.record_payout_settlement(20_000),
        Err(LedgerError::InsufficientFunds)
    ));

    ledger
        .record_mint(12_345, 0)
        .expect_err("mint greater than pending liability");

    ledger
        .record_payout_settlement(1_000)
        .expect("payout settles");
}
