use kingpepe_transceiver::TransceiverState;

#[test]
fn transceiver_can_record_verification() {
    let mut state = TransceiverState::new();
    state.record_message();
    assert_eq!(state.verified_messages, 1);
}

