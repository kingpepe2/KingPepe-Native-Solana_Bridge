use bridge_messages::{CanonicalBridgeMessage, DeploymentIdentity, MessageEpochs, NativeOutpoint, ValidityWindow};
use kingpepe_transceiver::{AttestationObservation, TransceiverConfig, TransceiverProgram};

fn h(byte: u8) -> [u8; 32] {
    [byte; 32]
}

#[test]
fn transceiver_can_record_verification() {
    let config = TransceiverConfig {
        transceiver_program_id: h(1),
        manager_program_id: h(2),
        mint: h(3),
        solana_deployment: h(4),
        authorized_attesters: [h(5), h(6)],
        active: true,
        key_epoch: 7,
    };
    let message = CanonicalBridgeMessage::new_deposit_claim(
        DeploymentIdentity {
            protocol_id: 1,
            native_network: 2,
            native_genesis: h(8),
            solana_deployment: config.solana_deployment,
            manager_program_id: config.manager_program_id,
            transceiver_program_id: config.transceiver_program_id,
            mint: config.mint,
        },
        NativeOutpoint { txid: h(9), vout: 1 },
        100,
        h(10),
        MessageEpochs {
            policy_epoch: 1,
            key_epoch: config.key_epoch,
        },
        h(11),
        ValidityWindow {
            valid_from: 1,
            valid_until: 2,
        },
        h(12),
    )
    .unwrap();
    let digest = message.message_digest().unwrap();
    let observations = vec![
        AttestationObservation {
            attester: config.authorized_attesters[0],
            message_digest: digest,
            key_epoch: config.key_epoch,
            instruction_index: 0,
        },
        AttestationObservation {
            attester: config.authorized_attesters[1],
            message_digest: digest,
            key_epoch: config.key_epoch,
            instruction_index: 1,
        },
    ];
    let mut transceiver = TransceiverProgram::initialize(config).unwrap();
    transceiver.verify_message(&message, &observations).unwrap();
    assert_eq!(transceiver.verified_messages(), 1);
}
