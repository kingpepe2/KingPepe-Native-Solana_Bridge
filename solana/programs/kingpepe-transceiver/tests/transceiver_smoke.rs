mod burn_fixture {
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/support/burn-fixture.rs"
    ));
}
use bridge_messages::{DeploymentIdentity, MessageEpochs, NativeOutpoint, ValidityWindow};
use burn_fixture::{burn_message, TestBurnFields};
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
        protocol_id: 1,
        native_network: 2,
        native_genesis: h(8),
        authorized_attesters: [h(5), h(6)],
        active: true,
        key_epoch: 7,
    };
    let message = burn_message(TestBurnFields {
        deployment: DeploymentIdentity {
            protocol_id: 1,
            native_network: 2,
            native_genesis: h(8),
            solana_deployment: config.solana_deployment,
            manager_program_id: config.manager_program_id,
            transceiver_program_id: config.transceiver_program_id,
            mint: config.mint,
        },
        deposit_outpoint: NativeOutpoint {
            txid: h(9),
            vout: 1,
        },
        amount_atomic: 100,
        solana_recipient: h(10),
        epochs: MessageEpochs {
            policy_epoch: 1,
            key_epoch: config.key_epoch,
        },
        nonce: h(11),
        validity: ValidityWindow {
            valid_from: 1,
            valid_until: 2,
        },
        evidence_digest: h(12),
    })
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
