// Synthetic finalized-burn evidence for program tests only. No chain proof or
// production mint authorization is conferred by this fixture.
use bridge_messages::{burn::{BurnBinding, BurnOutpoint, FinalizedBurnEvidence}, CanonicalBridgeMessage,
    DeploymentIdentity, MessageEpochs, NativeOutpoint, ValidityWindow};

pub struct TestBurnFields {
    pub deployment: DeploymentIdentity,
    pub deposit_outpoint: NativeOutpoint,
    pub amount_atomic: u64,
    pub solana_recipient: [u8;32],
    pub epochs: MessageEpochs,
    pub nonce: [u8;32],
    pub validity: ValidityWindow,
    pub evidence_digest: [u8;32],
}
pub fn burn_message(f: TestBurnFields) -> Result<CanonicalBridgeMessage,bridge_messages::MessageEncodeError> {
    let binding=BurnBinding {domain:*b"KPBOPR01",version:1,protocol_id:f.deployment.protocol_id,
        native_network:f.deployment.native_network,native_genesis:f.deployment.native_genesis,
        solana_genesis:if f.deployment.is_mainnet_bound(){bridge_messages::SOLANA_MAINNET_GENESIS}else{[242;32]},
        solana_deployment:f.deployment.solana_deployment,bridge_program:f.deployment.manager_program_id,
        transceiver_program:f.deployment.transceiver_program_id,mint:f.deployment.mint,
        destination:f.solana_recipient,burn_public_key:[241;32],nonce:f.nonce};
    let mut evidence=FinalizedBurnEvidence {domain:*b"KPBURN01",version:1,operation_id:binding.operation_id().unwrap(),binding,
        deposit:BurnOutpoint{txid:f.deposit_outpoint.txid,vout:f.deposit_outpoint.vout},deposit_block_hash:[243;32],deposit_height:10,
        burn:BurnOutpoint{txid:f.evidence_digest,vout:0},burn_block_hash:[244;32],burn_height:22,
        amount_atomic:f.amount_atomic,burn_commitment:[0;32]};
    evidence.burn_commitment=evidence.expected_commitment().unwrap();
    CanonicalBridgeMessage::new_deposit_claim(bridge_messages::DepositClaimFields {evidence,epochs:f.epochs,validity:f.validity})
}

#[allow(dead_code)]
pub fn rebind_burn_fixture(message: &mut CanonicalBridgeMessage) {
    let mut e=message.burn_evidence.clone();
    e.binding.protocol_id=message.deployment.protocol_id;
    e.binding.native_network=message.deployment.native_network;
    e.binding.native_genesis=message.deployment.native_genesis;
    e.binding.solana_deployment=message.deployment.solana_deployment;
    e.binding.bridge_program=message.deployment.manager_program_id;
    e.binding.transceiver_program=message.deployment.transceiver_program_id;
    e.binding.mint=message.deployment.mint;
    e.binding.destination=message.destination.clone().try_into().unwrap();
    e.binding.nonce=message.nonce;
    e.operation_id=e.binding.operation_id().unwrap();
    e.deposit=BurnOutpoint{txid:message.deposit_outpoint.txid,vout:message.deposit_outpoint.vout};
    e.amount_atomic=message.amount_atomic;
    e.burn_commitment=e.expected_commitment().unwrap();
    *message=CanonicalBridgeMessage::new_deposit_claim(bridge_messages::DepositClaimFields {
        evidence:e,epochs:MessageEpochs{policy_epoch:message.policy_epoch,key_epoch:message.key_epoch},
        validity:ValidityWindow{valid_from:message.valid_from,valid_until:message.valid_until}}).unwrap();
}
