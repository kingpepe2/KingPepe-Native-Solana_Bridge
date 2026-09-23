use bridge_messages::{
    CanonicalBridgeMessage, MessageEncodeError, MESSAGE_LENGTH, MESSAGE_VERSION,
};
fn vector() -> serde_json::Value {
    serde_json::from_str(include_str!("../vectors/burn-borsh-v4.json")).unwrap()
}
fn unhex(s: &str) -> Vec<u8> {
    s.as_bytes()
        .chunks_exact(2)
        .map(|b| u8::from_str_radix(std::str::from_utf8(b).unwrap(), 16).unwrap())
        .collect()
}
fn hex(b: &[u8]) -> String {
    b.iter().map(|v| format!("{v:02x}")).collect()
}
fn deposit_message() -> CanonicalBridgeMessage {
    CanonicalBridgeMessage::decode(&unhex(vector()["messageHex"].as_str().unwrap())).unwrap()
}
#[test]
fn burn_evidence_golden_bytes_and_program_projection_agree() {
    let v = vector();
    let m = deposit_message();
    let bytes = m.encode().unwrap();
    assert_eq!(bytes.len(), MESSAGE_LENGTH);
    assert_eq!(hex(&bytes), v["messageHex"]);
    assert_eq!(hex(&m.message_digest().unwrap()), v["messageDigest"]);
    assert_eq!(hex(&m.burn_evidence.encode().unwrap()), v["evidenceHex"]);
    assert_eq!(
        m.operation_id,
        m.burn_evidence.binding.operation_id().unwrap()
    );
    assert_eq!(m.amount_atomic, m.burn_evidence.amount_atomic);
    assert_eq!(m.destination, m.burn_evidence.binding.destination);
    for length in 0..bytes.len() {
        assert!(CanonicalBridgeMessage::decode(&bytes[..length]).is_err());
    }
    let mut trailing = bytes.clone();
    trailing.push(0);
    assert!(CanonicalBridgeMessage::decode(&trailing).is_err());
    // V3 deposit/reserve authorizations are no longer an accepted message.
    assert!(CanonicalBridgeMessage::decode(&vec![0; 482]).is_err());
}
#[test]
fn domain_mutation_and_inconsistent_economic_projection_are_rejected() {
    let bytes = deposit_message().encode().unwrap();
    for index in 0..9 {
        let mut bad = bytes.clone();
        bad[index] ^= 1;
        assert!(CanonicalBridgeMessage::decode(&bad).is_err());
    }
    for field in 0..5 {
        let mut m = deposit_message();
        match field {
            0 => m.amount_atomic += 1,
            1 => m.destination[0] ^= 1,
            2 => m.deposit_outpoint.txid[0] ^= 1,
            3 => m.deployment.mint[0] ^= 1,
            _ => m.evidence_digest[0] ^= 1,
        }
        assert_eq!(
            m.encode(),
            Err(MessageEncodeError::BurnEvidenceBindingMismatch)
        );
    }
}
#[test]
fn unsupported_version_is_rejected() {
    let mut message = deposit_message();
    message.version = MESSAGE_VERSION + 1;
    assert!(matches!(
        message.encode(),
        Err(MessageEncodeError::UnsupportedVersion { .. })
    ));
}
