use kingpepe_bridge::BridgeProgram;

#[test]
fn bridge_program_can_initialize() {
    let mut program = BridgeProgram::new();
    assert!(!program.is_operational());
    program.initialize();
    assert!(program.is_operational());
}

