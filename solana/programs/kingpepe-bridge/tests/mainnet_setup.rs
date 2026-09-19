// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Synthetic public configuration: no Mainnet account, signature or submission.
use bridge_messages::{mainnet_deployment_identity, NATIVE_MAINNET_DOMAIN, NATIVE_MAINNET_GENESIS};
use kingpepe_bridge::{
    decode_bridge_instruction, derive_mint_authority_pda, BridgeEnvironment, BridgeInstruction,
    BridgeProgram, MainnetMode, ProgramState,
};
use kingpepe_transceiver::{
    decode_transceiver_instruction, TransceiverInstruction, TransceiverProgram,
};

fn vectors() -> Vec<Vec<u8>> {
    include_str!("../../../modules/bridge-messages/vectors/mainnet-setup-v1.txt")
        .lines()
        .map(|line| {
            assert_eq!(line.len() % 2, 0);
            (0..line.len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&line[i..i + 2], 16).unwrap())
                .collect()
        })
        .collect()
}

#[test]
fn typescript_mainnet_setup_initializes_real_programs_paused_with_zero_supply() {
    let v = vectors();
    assert_eq!(v.len(), 5);
    let instruction = decode_bridge_instruction(&v[0]).unwrap();
    assert_eq!(instruction.encode().unwrap(), v[0]);
    let BridgeInstruction::Initialize(config) = instruction else {
        panic!("setup must initialize the bridge");
    };
    let transceiver = decode_transceiver_instruction(&v[1]).unwrap();
    assert_eq!(transceiver.encode().unwrap(), v[1]);
    let TransceiverInstruction::Initialize(receiver) = transceiver else {
        panic!("setup must initialize the transceiver");
    };
    assert_eq!(config.environment, BridgeEnvironment::Mainnet);
    assert_eq!(receiver.native_network, NATIVE_MAINNET_DOMAIN);
    assert_eq!(receiver.native_genesis, NATIVE_MAINNET_GENESIS);
    assert_eq!(receiver.protocol_id, 1);
    assert_eq!(receiver.manager_program_id, config.manager_program_id);
    assert_eq!(
        receiver.transceiver_program_id,
        config.transceiver_program_id
    );
    assert_eq!(receiver.mint, config.mint_binding.mint);
    assert_eq!(receiver.solana_deployment, config.solana_deployment);
    assert_eq!(
        Some(config.solana_deployment),
        mainnet_deployment_identity(
            &config.manager_program_id,
            &config.transceiver_program_id,
            &config.mint_binding.mint
        )
    );
    assert_eq!(config.mint_binding.decimals, 8);
    assert_eq!(config.mint_binding.native_decimals, 8);
    assert_eq!(config.mint_binding.initial_supply, 0);
    assert_eq!(config.mint_binding.freeze_authority, None);
    assert_eq!(
        config.mint_binding.mint_authority_pda,
        derive_mint_authority_pda(&config.manager_program_id, &config.mint_binding.mint)
    );
    assert_eq!(config.key_epoch, receiver.key_epoch);
    assert!(config.deposits_paused);
    assert!(!config.mainnet_activation_enabled);
    assert!(!config.hard_stop);
    assert!(receiver.active);
    let mut bridge = BridgeProgram::new();
    bridge.initialize(*config.clone()).unwrap();
    assert_eq!(bridge.state(), &ProgramState::Phase0Disabled);
    assert!(!bridge.is_operational());
    let initialized_receiver = TransceiverProgram::initialize(*receiver).unwrap();
    assert_eq!(initialized_receiver.config().mint, config.mint_binding.mint);

    let mut unsafe_config = *config.clone();
    unsafe_config.deposits_paused = false;
    assert!(BridgeProgram::new().initialize(unsafe_config).is_err());
    let mut unsafe_config = *config;
    unsafe_config.mainnet_activation_enabled = true;
    assert!(BridgeProgram::new().initialize(unsafe_config).is_err());
}

#[test]
fn typescript_mainnet_mode_bytes_decode_to_only_the_existing_mode_instruction() {
    let v = vectors();
    for (bytes, mode) in v[2..].iter().zip([
        MainnetMode::Paused,
        MainnetMode::Controlled,
        MainnetMode::Active,
    ]) {
        let instruction = decode_bridge_instruction(bytes).unwrap();
        assert_eq!(instruction, BridgeInstruction::SetMainnetMode(mode));
        assert_eq!(instruction.encode().unwrap(), *bytes);
        let mut trailing = bytes.clone();
        trailing.push(0);
        assert!(decode_bridge_instruction(&trailing).is_err());
    }
}
