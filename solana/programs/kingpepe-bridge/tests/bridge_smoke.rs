use kingpepe_bridge::{derive_mint_authority_pda, BridgeConfig, BridgeEnvironment, BridgeProgram, MintBinding};

fn h(byte: u8) -> [u8; 32] {
    [byte; 32]
}

#[test]
fn bridge_program_can_initialize() {
    let manager_program_id = h(1);
    let mint = h(2);
    let config = BridgeConfig {
        environment: BridgeEnvironment::Localnet,
        manager_program_id,
        transceiver_program_id: h(3),
        solana_deployment: h(4),
        mint_binding: MintBinding {
            mint,
            token_program_id: h(5),
            mint_authority_pda: derive_mint_authority_pda(&manager_program_id, &mint),
            decimals: 8,
            native_decimals: 8,
            freeze_authority: None,
            initial_supply: 0,
        },
        policy_epoch: 6,
        key_epoch: 7,
        deposits_paused: false,
        withdrawals_paused: false,
        hard_stop: false,
        mainnet_activation_enabled: false,
    };
    let mut program = BridgeProgram::new();
    assert!(!program.is_operational());
    program.initialize(config).unwrap();
    assert!(program.is_operational());
}
