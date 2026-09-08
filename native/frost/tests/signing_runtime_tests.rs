use std::collections::BTreeMap;

use frost_runtime::{
    AggregateSignature, DomainBinding, ParticipantPublicKey, Signer, SignerRole, SignerState,
    SigningPolicy, SigningRequest, SigningSessionInput,
};
use frost_runtime::{SigningCoordinator, SigningRecord};

fn policy() -> (SigningPolicy, DomainBinding) {
    let binding = DomainBinding {
        native_chain_id: 100,
        solana_chain_id: 200,
        native_genesis: [0x11u8; 32],
        solana_cluster: [0x22u8; 32],
        manager_program_id: [0x33u8; 32],
        transceiver_program_id: [0x44u8; 32],
    };
    (
        SigningPolicy {
            deployment_epoch: 7,
            max_fee: 500,
            max_amount: 10_000_000,
            expected_domains: binding,
        },
        binding,
    )
}

fn signers_and_keys() -> (Signer, Signer, BTreeMap<SignerRole, ParticipantPublicKey>) {
    let signer_a = Signer::from_seed(SignerRole::A, [0xA5u8; 32]);
    let signer_b = Signer::from_seed(SignerRole::B, [0xB5u8; 32]);
    let mut keys = BTreeMap::new();
    keys.insert(signer_a.role, signer_a.public_key());
    keys.insert(signer_b.role, signer_b.public_key());
    (signer_a, signer_b, keys)
}

fn request_from(record: &SigningRecord) -> SigningRequest {
    SigningRequest {
        request_id: record.request_id,
        digest: record.digest,
        operation_id: record.operation_id,
        nonce: record.nonce,
        epoch: record.epoch,
        amount: record.amount,
        fee: record.fee,
    }
}

fn completed_signature(signatures: &AggregateSignature) -> Vec<SignerRole> {
    let mut roles = signatures
        .shares
        .iter()
        .map(|share| share.signer_role)
        .collect::<Vec<_>>();
    roles.sort_unstable();
    roles
}

#[test]
fn coordinator_requires_both_participants_for_finalize() {
    let (policy, binding) = policy();
    let (signer_a, signer_b, keys) = signers_and_keys();
    let mut coordinator = SigningCoordinator::new(policy, 7, keys);
    let record = coordinator
        .start_session(SigningSessionInput {
            request_id: [1u8; 32],
            operation_id: [2u8; 32],
            digest: [3u8; 32],
            amount: 1000,
            fee: 42,
            domains: binding,
            nonce: [9u8; 32],
        })
        .expect("start_session");
    let request = request_from(&record);
    let a = signer_a
        .sign(&request, &SignerState::default())
        .expect("sign a");
    coordinator.consume_signature(record.request_id, a).unwrap();
    assert!(coordinator.finalize(record.request_id).is_err());

    let b_request = request_from(&record);
    let b = signer_b
        .sign(&b_request, &SignerState::default())
        .expect("sign b");
    coordinator.consume_signature(record.request_id, b).unwrap();

    let aggregate = coordinator.finalize(record.request_id).expect("finalized");
    assert_eq!(aggregate.shares.len(), 2);
    assert_eq!(
        completed_signature(aggregate),
        vec![SignerRole::A, SignerRole::B]
    );
}

#[test]
fn coordinator_rejects_duplicate_role_share() {
    let (policy, binding) = policy();
    let (signer_a, _, keys) = signers_and_keys();
    let mut coordinator = SigningCoordinator::new(policy, 7, keys);
    let record = coordinator
        .start_session(SigningSessionInput {
            request_id: [7u8; 32],
            operation_id: [8u8; 32],
            digest: [9u8; 32],
            amount: 2000,
            fee: 10,
            domains: binding,
            nonce: [5u8; 32],
        })
        .expect("start_session");
    let request = request_from(&record);
    let share = signer_a
        .sign(&request, &SignerState::default())
        .expect("sign a");
    coordinator
        .consume_signature(record.request_id, share.clone())
        .unwrap();
    let err = coordinator
        .consume_signature(record.request_id, share)
        .unwrap_err();
    assert!(matches!(
        err,
        frost_runtime::CoordinatorError::DuplicateShare
    ));
}

#[test]
fn coordinator_rejects_domain_mismatch() {
    let (policy, mut binding) = policy();
    let (_, _, keys) = signers_and_keys();
    let mut coordinator = SigningCoordinator::new(policy, 7, keys);
    binding.native_chain_id = 999;
    assert!(matches!(
        coordinator.start_session(SigningSessionInput {
            request_id: [1u8; 32],
            operation_id: [2u8; 32],
            digest: [3u8; 32],
            amount: 1000,
            fee: 1,
            domains: binding,
            nonce: [9u8; 32],
        }),
        Err(frost_runtime::CoordinatorError::DomainMismatch)
    ));
}

#[test]
fn coordinator_rejects_nonce_reuse() {
    let (policy, binding) = policy();
    let (_, _, keys) = signers_and_keys();
    let mut coordinator = SigningCoordinator::new(policy, 7, keys);
    coordinator
        .start_session(SigningSessionInput {
            request_id: [11u8; 32],
            operation_id: [12u8; 32],
            digest: [13u8; 32],
            amount: 100,
            fee: 10,
            domains: binding,
            nonce: [33u8; 32],
        })
        .expect("first session");
    let second = coordinator.start_session(SigningSessionInput {
        request_id: [14u8; 32],
        operation_id: [15u8; 32],
        digest: [16u8; 32],
        amount: 100,
        fee: 10,
        domains: binding,
        nonce: [33u8; 32],
    });
    assert!(matches!(
        second,
        Err(frost_runtime::CoordinatorError::NonceRejected)
    ));
}

#[test]
fn coordinator_rejects_amount_above_policy() {
    let (mut policy, binding) = policy();
    let (_, _, keys) = signers_and_keys();
    policy.max_amount = 99;
    let mut coordinator = SigningCoordinator::new(policy, 7, keys);
    let bad = coordinator.start_session(SigningSessionInput {
        request_id: [11u8; 32],
        operation_id: [12u8; 32],
        digest: [13u8; 32],
        amount: 100,
        fee: 1,
        domains: binding,
        nonce: [44u8; 32],
    });
    assert!(matches!(
        bad,
        Err(frost_runtime::CoordinatorError::PolicyRejected)
    ));
}

#[test]
fn coordinator_rejects_restart_transition_after_completion_guard() {
    let (policy, binding) = policy();
    let (signer_a, signer_b, keys) = signers_and_keys();
    let mut coordinator = SigningCoordinator::new(policy, 7, keys);
    let record = coordinator
        .start_session(SigningSessionInput {
            request_id: [21u8; 32],
            operation_id: [22u8; 32],
            digest: [23u8; 32],
            amount: 500,
            fee: 1,
            domains: binding,
            nonce: [55u8; 32],
        })
        .expect("start_session");
    let request = request_from(&record);
    let a = signer_a.sign(&request, &SignerState::default()).unwrap();
    coordinator.consume_signature(record.request_id, a).unwrap();
    let b = signer_b.sign(&request, &SignerState::default()).unwrap();
    coordinator.consume_signature(record.request_id, b).unwrap();
    coordinator.finalize(record.request_id).unwrap();

    let recovery = coordinator.restart_recovery(&record.nonce);
    assert!(matches!(
        recovery,
        Err(frost_runtime::CoordinatorError::RecoveryFailed)
    ));
}

#[test]
fn signer_validates_own_signature_against_request() {
    let (signer_a, _, _) = signers_and_keys();
    let request = SigningRequest {
        request_id: [2u8; 32],
        digest: [3u8; 32],
        operation_id: [4u8; 32],
        nonce: [5u8; 32],
        epoch: 7,
        amount: 100,
        fee: 5,
    };
    let state = SignerState::default();
    let share = signer_a.sign(&request, &state).expect("sign");
    assert!(signer_a.verify_local(&request, &share).unwrap());
}
