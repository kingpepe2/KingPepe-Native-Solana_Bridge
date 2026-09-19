// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
use std::io::{self, Read, Write};
use std::time::{SystemTime, UNIX_EPOCH};

use kingpepe_native_proof::evidence::{
    verify_mainnet_evidence, verify_regtest_evidence, MAX_EVIDENCE_BYTES,
    MAX_MAINNET_EVIDENCE_BYTES,
};

fn run() -> Result<(), ()> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let mainnet = match args.as_slice() {
        [arg] if arg == "--regtest-verify" => false,
        [arg] if arg == "--mainnet-verify" => true,
        _ => return Err(()),
    };
    let maximum = if mainnet {
        MAX_MAINNET_EVIDENCE_BYTES
    } else {
        MAX_EVIDENCE_BYTES
    };
    let mut packet = Vec::new();
    io::stdin()
        .lock()
        .take(maximum as u64 + 1)
        .read_to_end(&mut packet)
        .map_err(|_| ())?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ())?
        .as_secs();
    let result = if mainnet {
        verify_mainnet_evidence(&packet, now)
    } else {
        verify_regtest_evidence(&packet, now)
    }
    .map_err(|_| ())?;
    // Fixed Borsh public digests/counts only. Never echo input, paths or errors.
    io::stdout()
        .lock()
        .write_all(&result.encode_response().map_err(|_| ())?)
        .map_err(|_| ())?;
    Ok(())
}

fn main() {
    if run().is_err() {
        eprintln!("NATIVE_RAW_EVIDENCE_REJECTED");
        std::process::exit(1);
    }
}
