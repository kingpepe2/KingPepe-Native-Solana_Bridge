// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
use std::io::{self, Read};
use std::time::{SystemTime, UNIX_EPOCH};

use kingpepe_native_proof::bytes::to_hex;
use kingpepe_native_proof::evidence::{verify_regtest_evidence, MAX_EVIDENCE_BYTES};

fn run() -> Result<(), ()> {
    if std::env::args().skip(1).collect::<Vec<_>>() != ["--regtest-verify"] {
        return Err(());
    }
    let mut packet = Vec::new();
    io::stdin()
        .lock()
        .take(MAX_EVIDENCE_BYTES as u64 + 1)
        .read_to_end(&mut packet)
        .map_err(|_| ())?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ())?
        .as_secs();
    let result = verify_regtest_evidence(&packet, now).map_err(|_| ())?;
    // Fixed-shape public digests/counts only. Never echo raw packets, paths or errors.
    println!(
        "KPNEV_OK_V1 {} {} {} {}",
        to_hex(&result.digest),
        to_hex(&result.tip_hash),
        result.tip_height,
        result.transactions.len()
    );
    Ok(())
}

fn main() {
    if run().is_err() {
        eprintln!("NATIVE_RAW_EVIDENCE_REJECTED");
        std::process::exit(1);
    }
}
