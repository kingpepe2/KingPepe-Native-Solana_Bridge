// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Disposable local-validator deployment/upgrade checks, never Phase 09 payouts.
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { withLocalE2eInfrastructure } from "../../scripts/local-e2e-bootstrap.mjs";
import { createLocalE2ePlan } from "../../scripts/local-e2e-orchestrator.mjs";
import { createLocalSolanaSetupContext, createNativeToSolanaFlowConfig, executeNativeDepositObservationFlow,
  submitLocalnetSolanaSetup, submitLocalnetSolanaDepositClaim } from "../../scripts/local-e2e-native-to-solana.mjs";
import { base58Decode, base58Encode, findProgramAddress } from "../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { SPL_TOKEN_PROGRAM_ID_BASE58 as TOKEN } from "../../services/bridge-validator/localnet-solana-setup-plan.mjs";
import { DEPLOYMENT_MONITOR_PROTOCOL, UPGRADEABLE_LOADER, LocalDeploymentRpc, deploymentDigest,
  validateDeploymentManifest, verifyDeploymentSnapshot } from "../../services/solana-observer/deployment-integrity.mjs";
import { validateRuntimeFile } from "../../shared/runtime-path-boundary.mjs";
import { packet } from "./local-transaction-packet.mjs";

function identity() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const bytes = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  return { publicKeyBase58: base58Encode(bytes), publicKeyHex: bytes.toString("hex"), sign: b => sign(null, b, privateKey),
    writeLocalTest(file) { const seed = privateKey.export({ type: "pkcs8", format: "der" }).subarray(-32);
      const full = Buffer.concat([seed, bytes]); try { writeFileSync(file, JSON.stringify([...full]), { flag: "wx", mode: 0o600 }); } finally { seed.fill(0); full.fill(0); } } };
}
export async function localDeploymentManifest({ context, authority, sourceSha }) {
  const { plan, flowConfig: c, localSolanaSetupContext: setup } = context;
  const rpc = new LocalDeploymentRpc({ endpoint: `http://127.0.0.1:${plan.ports.solanaRpcPort}` });
  const program = (id, file) => {
    const b = readFileSync(file);
    return { id, loader: UPGRADEABLE_LOADER, programData: findProgramAddress([base58Decode(id)], base58Decode(UPGRADEABLE_LOADER)).base58,
      upgradeAuthority: authority, deploymentSlot: "0", binaryLength: b.length, binaryHash: deploymentDigest(b), dataLength: b.length + 45 };
  };
  const pda = (seed, id) => findProgramAddress([Buffer.from(seed), base58Decode(setup.mintBase58)], base58Decode(id)).base58;
  const manager = plan.programIds.kingpepeBridge, transceiver = plan.programIds.kingpepeTransceiver;
  return validateDeploymentManifest({ protocol: DEPLOYMENT_MONITOR_PROTOCOL, environment: "localnet", sourceSha, identityVersion: 1,
    nativeGenesisHex: context.nativeSource.nativeGenesisHash, solanaGenesis: await rpc.genesis(), solanaDeploymentHex: c.solanaDeploymentHex,
    minimumSlot: "0", maximumStallMs: 60000, manager: program(manager, plan.paths.bridgeProgramSo), transceiver: program(transceiver, plan.paths.transceiverProgramSo),
    mint: { id: setup.mintBase58, tokenProgram: TOKEN, authority: pda("kingpepe-mint-authority", manager), decimals: c.nativeDecimals },
    config: { bridgePda: pda("kingpepe-bridge-state", manager), transceiverPda: pda("kingpepe-transceiver-config", transceiver),
      policyEpoch: c.policyEpoch, keyEpoch: c.keyEpoch, protocolId: c.protocolId, nativeNetwork: c.nativeNetwork,
      attesters: setup.attesterPublicKeysHex.map(h => base58Encode(Buffer.from(h, "hex"))), depositsPaused: false, withdrawalsPaused: false, transceiverActive: true } });
}

export async function runLocalDeploymentIntegrity(repoRoot, sourceSha) {
  const user = identity(), authority = identity(), nextAuthority = identity(), passed = [];
  const original = createLocalE2ePlan({ repoRoot, runRoot: process.env.KINGPEPE_LOCAL_E2E_ROOT });
  // Build this upgrade probe explicitly for SBPF v3 with the existing pinned
  // compiler, and load both programs via the real upgradeable loader with a
  // newly generated disposable authority. No validator feature is disabled.
  const commands = original.commands.map(c => {
    if (c.step.startsWith("BUILD_SBF_")) { const args = [...c.args]; args.splice(args.indexOf("--"), 0, "--arch", "v3"); return { ...c, args }; }
    if (c.step !== "START_SOLANA_LOCAL_VALIDATOR") return c;
    const args = []; for (let i = 0; i < c.args.length; i++) {
      if (c.args[i] === "--bpf-program") { args.push("--upgradeable-program", c.args[++i], c.args[++i], authority.publicKeyBase58); }
      else args.push(c.args[i]);
    }
    return { ...c, args };
  });
  const plan = { ...original, commands };
  let manifest, rpc, failure, upgradeStage;
  const result = await withLocalE2eInfrastructure({ repoRoot, plan }, async context => {
    try {
    const generated = createLocalSolanaSetupContext();
    const setup = { ...generated, recipientTokenAccountOwnerBase58: user.publicKeyBase58, recipientTokenAccountOwnerHex: user.publicKeyHex };
    const config = createNativeToSolanaFlowConfig({ plan, repoRoot, mintHex: setup.mintHex, keyEpoch: setup.keyEpoch, policyEpoch: setup.policyEpoch });
    const flow = await executeNativeDepositObservationFlow({ ...context, flowConfig: config, localSolanaSetupContext: setup,
      solanaSetup: async input => {
        const created = await submitLocalnetSolanaSetup(input);
        assert.equal(created.state, "COMPLETED", "MonitorSetupMustActuallyFinalize");
        manifest = await localDeploymentManifest({ context: input, authority: authority.publicKeyBase58, sourceSha });
        rpc = new LocalDeploymentRpc({ endpoint: `http://127.0.0.1:${plan.ports.solanaRpcPort}` });
        const observed = verifyDeploymentSnapshot(manifest, await rpc.snapshot(manifest));
        assert.equal(observed.mintSupplyAtomic, "0"); passed.push("FRESH_UPGRADEABLE_PROGRAMDATA_CONFIG_ZERO_SUPPLY_VERIFIED");
        return created;
      },
      solanaDepositClaim: async input => {
        verifyDeploymentSnapshot(manifest, await rpc.snapshot(manifest));
        return submitLocalnetSolanaDepositClaim(input);
      } });
    assert.equal(flow.state, "COMPLETED", "MonitorTestDepositMustComplete");
    const live = verifyDeploymentSnapshot(manifest, await rpc.snapshot(manifest));
    assert.equal(live.mintSupplyAtomic, config.amountAtomic); assert.equal(live.managerMintedAtomic, config.amountAtomic);
    passed.push("FINALIZED_MINT_OBSERVED_WITH_MATCHING_EXECUTABLES");
    const liveSnapshot = await rpc.snapshot(manifest);
    // Reject configuration/PDA aliases at manifest admission, never query them
    // as an implicitly approved new deployment.
    for (const [label, mutation] of [
      ["MANAGER_SUBSTITUTION_REJECTED", m => { m.manager.id = nextAuthority.publicKeyBase58; }],
      ["TRANSCEIVER_SUBSTITUTION_REJECTED", m => { m.transceiver.id = nextAuthority.publicKeyBase58; }],
      ["PROGRAMDATA_SUBSTITUTION_REJECTED", m => { m.manager.programData = nextAuthority.publicKeyBase58; }],
      ["MINT_SUBSTITUTION_REJECTED", m => { m.mint.id = nextAuthority.publicKeyBase58; }],
      ["TOKEN_PROGRAM_SUBSTITUTION_REJECTED", m => { m.mint.tokenProgram = nextAuthority.publicKeyBase58; }],
      ["BRIDGE_PDA_SUBSTITUTION_REJECTED", m => { m.config.bridgePda = nextAuthority.publicKeyBase58; }],
      ["TRANSCEIVER_PDA_SUBSTITUTION_REJECTED", m => { m.config.transceiverPda = nextAuthority.publicKeyBase58; }],
    ]) { const wrong = structuredClone(manifest); mutation(wrong); assert.throws(() => verifyDeploymentSnapshot(wrong, liveSnapshot)); passed.push(label); }
    for (const [label, mutation] of [
      ["GENESIS_MISMATCH_FROM_LIVE_RPC", m => { m.solanaGenesis = nextAuthority.publicKeyBase58; }],
      ["BYTECODE_HASH_MISMATCH_FROM_LIVE_PROGRAMDATA", m => { m.manager.binaryHash = "ff".repeat(32); }],
      ["UPGRADE_AUTHORITY_MISMATCH_FROM_LIVE_PROGRAMDATA", m => { m.manager.upgradeAuthority = nextAuthority.publicKeyBase58; }],
      ["DEPLOYMENT_SLOT_MISMATCH_FROM_LIVE_PROGRAMDATA", m => { m.manager.deploymentSlot = "1"; }],
      ["ATTESTER_IDENTITY_MISMATCH_FROM_LIVE_CONFIG", m => { m.config.attesters[0] = nextAuthority.publicKeyBase58; }],
      ["CONFIG_EPOCH_MISMATCH_FROM_LIVE_CONFIG", m => { m.config.keyEpoch++; }],
    ]) {
      const wrong = structuredClone(manifest); mutation(wrong);
      // Fetch again: mismatched expectations must be compared to real bank data.
      const snapshot = await rpc.snapshot(wrong);
      assert.throws(() => verifyDeploymentSnapshot(wrong, snapshot), e => ["SOLANA_DEPLOYMENT_CHANGED", "SOLANA_GENESIS_CHANGED"].includes(e.integrityCode));
      passed.push(label);
    }
    // Create a separate, actually finalized mint with the expected PDA mint
    // authority but an unauthorized freeze authority. Never mutate the valid
    // bridge mint or mint test supply.
    const badMint = identity(), funding = setup.feePayerSigner, u64 = v => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
    const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; }, meta = (key, writable, signer = false) => ({ key, writable, signer });
    let rpcId = 0;
    const call = async (method, params) => {
      const r = await fetch(`http://127.0.0.1:${plan.ports.solanaRpcPort}`, { method: "POST", signal: AbortSignal.timeout(10000),
        headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) });
      const v = await r.json(); if (v.error) {
        const fault = v.error.data?.err?.InstructionError;
        const reason = typeof fault?.[1] === "string" && ["InvalidAccountData", "InvalidInstructionData", "InsufficientFunds", "AccountDataTooSmall", "IncorrectProgramId", "InvalidArgument", "AccountNotRentExempt"].includes(fault[1]) ? fault[1] : undefined;
        throw Object.assign(new Error("SOLANA_LOCAL_MONITOR_RPC_FAILED"), { rpcCode: Number.isSafeInteger(v.error.code) ? v.error.code : undefined,
          instructionIndex: Number.isSafeInteger(fault?.[0]) ? fault[0] : undefined, instructionReason: reason,
          customCode: Number.isSafeInteger(fault?.[1]?.Custom) ? fault[1].Custom : undefined,
          loaderDiagnostic: ["Program was deployed in this block already", "Buffer account not writeable", "Program account not writeable", "Program account not executable", "ProgramData account not large enough", "Invalid Buffer account", "Program account not owned by loader"].find(s => v.error.data?.logs?.some(line => typeof line === "string" && line.includes(s))) });
      } return v.result;
    };
    const rent = await call("getMinimumBalanceForRentExemption", [82]), latest = (await call("getLatestBlockhash", [{ commitment: "finalized" }])).value;
    const transaction = await packet(funding, [badMint], latest.blockhash, [
      { program: "11111111111111111111111111111111", accounts: [meta(funding.publicKeyBase58, true, true), meta(badMint.publicKeyBase58, true, true)],
        data: Buffer.concat([u32(0), u64(rent), u64(82), base58Decode(TOKEN)]) },
      { program: TOKEN, accounts: [meta(badMint.publicKeyBase58, true)], data: Buffer.concat([Buffer.from([20, config.nativeDecimals]),
        findProgramAddress([Buffer.from("kingpepe-mint-authority"), base58Decode(badMint.publicKeyBase58)], base58Decode(manifest.manager.id)).bytes,
        Buffer.from([1]), base58Decode(authority.publicKeyBase58)]) },
    ]);
    const sig = await call("sendTransaction", [transaction, { encoding: "base64", skipPreflight: false }]);
    let settled = false;
    for (let n = 0; n < 60; n++) { const status = (await call("getSignatureStatuses", [[sig], { searchTransactionHistory: true }])).value[0];
      if (status?.confirmationStatus === "finalized") { assert.equal(status.err, null); settled = true; break; } await delay(250); }
    assert.equal(settled, true);
    const wrongMint = structuredClone(manifest); wrongMint.mint.id = badMint.publicKeyBase58;
    const derive = (seed, program) => findProgramAddress([Buffer.from(seed), base58Decode(wrongMint.mint.id)], base58Decode(program)).base58;
    wrongMint.mint.authority = derive("kingpepe-mint-authority", wrongMint.manager.id);
    wrongMint.config.bridgePda = derive("kingpepe-bridge-state", wrongMint.manager.id);
    wrongMint.config.transceiverPda = derive("kingpepe-transceiver-config", wrongMint.transceiver.id);
    const wrongSnapshot = await rpc.snapshot(wrongMint);
    assert.throws(() => verifyDeploymentSnapshot(wrongMint, wrongSnapshot), e => e.integrityCode === "SOLANA_DEPLOYMENT_CHANGED" && e.violation === "FREEZE_AUTHORITY");
    assert.equal(Buffer.from(wrongSnapshot.accounts[2].data[0], "base64").readUInt32LE(46), 1);
    passed.push("FINALIZED_UNAPPROVED_MINT_WITH_FREEZE_AUTHORITY_REJECTED");
    const authorityFile = validateRuntimeFile(path.join(plan.runRoot, "disposable-upgrade-authority.json"), repoRoot);
    authority.writeLocalTest(authorityFile);
    // Fund only this disposable local-validator key; no CLI default endpoint.
    const cli = async (step, args) => {
      try { return await context.executor.runOneShot({ step, executable: context.commandPaths.get("solana"),
        args: ["--url", `http://127.0.0.1:${plan.ports.solanaRpcPort}`, "--commitment", "finalized", "--keypair", authorityFile, ...args], cwd: repoRoot, timeoutMs: 120000 }); }
      catch (error) {
        // Only predefined classes may leave this boundary. CLI diagnostics may
        // contain temporary key-recovery text; never retain or echo that output.
        const diagnostics = [ [/insufficient|balance/iu, "INSUFFICIENT_LOCAL_FEE_BALANCE"], [/maxBuffer/iu, "CLI_CAPTURE_LIMIT"],
          [/timed out|timeout|killed/iu, "CLI_TIMEOUT"], [/ELF|syscall|verification/iu, "ELF_VERIFICATION_REJECTED"],
          [/Write transactions failed/iu, "PROGRAM_WRITE_TRANSACTIONS_FAILED"], [/authority/iu, "PROGRAM_AUTHORITY_REJECTED"],
          [/not found|No such file/iu, "LOCAL_INPUT_UNAVAILABLE"], [/RPC|connection/iu, "LOCAL_RPC_REJECTED"],
          [/blockhash/iu, "BLOCKHASH_REJECTED"], [/simulation|InstructionError/iu, "LOCAL_SIMULATION_REJECTED"],
          [/buffer/iu, "BUFFER_REJECTED"], [/Found argument|Invalid value|unexpected argument/iu, "CLI_ARGUMENT_REJECTED"],
          [/account data/iu, "ACCOUNT_DATA_REJECTED"] ];
        const code = diagnostics.find(([pattern]) => pattern.test(error.message))?.[1] ?? "LOCAL_COMMAND_REJECTED";
        throw Object.assign(new Error("SOLANA_" + code), { step });
      }
    };
    await cli("MONITOR_LOCAL_AIRDROP", ["airdrop", "5", authority.publicKeyBase58]);
    await cli("MONITOR_LOCAL_AUTHORITY_MUTATION", ["program", "set-upgrade-authority", manifest.manager.id, "--new-upgrade-authority", nextAuthority.publicKeyBase58, "--skip-new-upgrade-authority-signer-check"]);
    let changed = false;
    for (let n = 0; n < 30; n++) {
      try { verifyDeploymentSnapshot(manifest, await rpc.snapshot(manifest)); }
      catch (e) { if (e.integrityCode === "SOLANA_DEPLOYMENT_CHANGED") { changed = true; break; } throw e; }
      await delay(500);
    }
    assert.equal(changed, true); passed.push("ACTUAL_FINALIZED_UPGRADE_AUTHORITY_CHANGE_DETECTED");
    // Submit real loader instructions directly, retaining bounded test writes
    // and explicit signers. No CLI-generated recovery material or default RPC.
    const bufferSigner = identity(), replacement = readFileSync(plan.paths.transceiverProgramSo);
    const bufferRent = await call("getMinimumBalanceForRentExemption", [37 + replacement.length]);
    const submit = async (instructions, signers = []) => {
      const block = (await call("getLatestBlockhash", [{ commitment: "finalized" }])).value;
      const raw = await packet(funding, signers, block.blockhash, instructions);
      return call("sendTransaction", [raw, { encoding: "base64", skipPreflight: false, maxRetries: 3 }]);
    };
    const confirmed = async signatures => {
      for (let attempt = 0; attempt < 120; attempt++) {
        let complete = true;
        for (let i = 0; i < signatures.length; i += 100) {
          const status = (await call("getSignatureStatuses", [signatures.slice(i, i + 100), { searchTransactionHistory: true }])).value;
          for (const v of status) { if (v?.err) throw new Error("SOLANA_LOCAL_LOADER_TRANSACTION_FAILED"); if (v?.confirmationStatus !== "finalized") complete = false; }
        }
        if (complete) return; await delay(250);
      }
      throw new Error("SOLANA_LOCAL_LOADER_FINALITY_TIMEOUT");
    };
    upgradeStage = "INITIALIZE_BUFFER";
    await confirmed([await submit([
      { program: "11111111111111111111111111111111", accounts: [meta(funding.publicKeyBase58, true, true), meta(bufferSigner.publicKeyBase58, true, true)],
        data: Buffer.concat([u32(0), u64(bufferRent), u64(37 + replacement.length), base58Decode(UPGRADEABLE_LOADER)]) },
      { program: UPGRADEABLE_LOADER, accounts: [meta(bufferSigner.publicKeyBase58, true), meta(nextAuthority.publicKeyBase58, false)], data: u32(0) },
    ], [bufferSigner])]);
    const writes = [];
    for (let offset = 0; offset < replacement.length; offset += 800) writes.push({ program: UPGRADEABLE_LOADER,
      accounts: [meta(bufferSigner.publicKeyBase58, true), meta(nextAuthority.publicKeyBase58, false, true)],
      data: Buffer.concat([u32(1), u32(offset), u64(Math.min(800, replacement.length - offset)), replacement.subarray(offset, offset + 800)]) });
    const signatures = [];
    upgradeStage = "WRITE_BUFFER";
    for (let i = 0; i < writes.length; i += 8) signatures.push(...await Promise.all(writes.slice(i, i + 8).map(ix => submit([ix], [nextAuthority]))));
    await confirmed(signatures);
    if (replacement.length + 45 > manifest.manager.dataLength) {
      upgradeStage = "EXTEND_PROGRAM";
      // Agave 4.2.2 enforces a minimum extension of 10 KiB (SIMD-0431).
      await confirmed([await submit([{ program: UPGRADEABLE_LOADER, accounts: [meta(manifest.manager.programData, true), meta(manifest.manager.id, true),
        meta("11111111111111111111111111111111", false), meta(funding.publicKeyBase58, true, true)],
        data: Buffer.concat([u32(6), u32(Math.max(10240, replacement.length + 45 - manifest.manager.dataLength))]) }])]);
    }
    // ExtendProgram advances ProgramData's deployment slot. A simulation in
    // that same finalized bank correctly rejects another upgrade. Wait for a
    // strictly later finalized bank rather than disabling preflight/finality.
    const extended = await rpc.snapshot(manifest);
    const extensionSlot = Buffer.from(extended.accounts[5].data[0], "base64").readBigUInt64LE(4);
    let laterBank = false;
    for (let n = 0; n < 120; n++) {
      const slot = await call("getSlot", [{ commitment: "finalized" }]);
      if (Number.isSafeInteger(slot) && BigInt(slot) > extensionSlot) { laterBank = true; break; }
      await delay(250);
    }
    assert.equal(laterBank, true, "LocalUpgradeRequiresLaterFinalizedBank");
    upgradeStage = "UPGRADE_PROGRAM";
    await confirmed([await submit([
      { program: "ComputeBudget111111111111111111111111111111", accounts: [], data: Buffer.concat([Buffer.from([2]), u32(600000)]) },
      { program: UPGRADEABLE_LOADER, accounts: [meta(manifest.manager.programData, true), meta(manifest.manager.id, true),
        meta(bufferSigner.publicKeyBase58, true), meta(funding.publicKeyBase58, true), meta("SysvarRent111111111111111111111111111111111", false),
        meta("SysvarC1ock11111111111111111111111111111111", false), meta(nextAuthority.publicKeyBase58, false, true)], data: u32(3) },
    ], [nextAuthority])]);
    let byteChange = false;
    for (let n = 0; n < 30; n++) {
      const snapshot = await rpc.snapshot(manifest), data = Buffer.from(snapshot.accounts[5].data[0], "base64");
      if (deploymentDigest(data.subarray(45, 45 + manifest.manager.binaryLength)) !== manifest.manager.binaryHash) {
        // Test-only metadata normalization isolates executable mismatch from
        // the already-tested authority/slot checks. It does NOT approve this code.
        const expected = structuredClone(manifest); expected.manager.upgradeAuthority = nextAuthority.publicKeyBase58;
        expected.manager.deploymentSlot = data.readBigUInt64LE(4).toString(); expected.manager.dataLength = data.length;
        assert.throws(() => verifyDeploymentSnapshot(expected, snapshot), e => e.integrityCode === "SOLANA_DEPLOYMENT_CHANGED");
        byteChange = true; break;
      }
      await delay(500);
    }
    assert.equal(byteChange, true); passed.push("ACTUAL_FINALIZED_WRONG_PROGRAM_BYTECODE_DETECTED");
    return { sourceScope: "PHASE_08_5", fullNativeToSolanaE2e: flow.state, deploymentIntegrity: { pass: passed.length, fail: 0, passed }, phase09: "NOT_STARTED" };
    } catch (error) {
      failure = { code: /^(?:Deployment[A-Za-z]+|SOLANA_[A-Z_]+)$/u.test(error?.message ?? "") ? error.message : "LOCAL_MONITOR_CHECK_FAILED",
        testLine: Number(error.stack?.match(/local-deployment-integrity\.mjs:(\d+):/u)?.[1]) || undefined, passed: passed.length,
        rpcCode: error.rpcCode, instructionIndex: error.instructionIndex, instructionReason: error.instructionReason, customCode: error.customCode,
        upgradeStage, loaderDiagnostic: error.loaderDiagnostic };
      throw error;
    }
  });
  return { ...result, ...(failure ? { failure } : {}) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runLocalDeploymentIntegrity(path.resolve(import.meta.dirname, "../.."), process.env.KINGPEPE_TEST_SOURCE_SHA);
  console.log(JSON.stringify(result)); if (result.state !== "LOCAL_E2E_BOOTSTRAP_READY") process.exitCode = 1;
}
