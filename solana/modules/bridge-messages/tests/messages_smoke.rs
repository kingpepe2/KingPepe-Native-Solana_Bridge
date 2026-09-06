use bridge_messages::BridgeMessage;

#[test]
fn serialize_roundtrip_message() {
    let msg = BridgeMessage::default();
    let bytes = serde_json::to_vec(&msg).expect("serialize");
    let parsed: BridgeMessage = serde_json::from_slice(&bytes).expect("deserialize");
    assert_eq!(parsed.version, msg.version);
}

