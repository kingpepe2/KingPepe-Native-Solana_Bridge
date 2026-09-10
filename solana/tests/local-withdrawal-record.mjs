// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Phase 08.5 prerequisite ONLY: actual local-validator burn/record execution.
// No withdrawal observation, Native payout, funded wallet or production endpoint.
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { withLocalE2eInfrastructure } from "../../scripts/local-e2e-bootstrap.mjs";
import { createLocalSolanaSetupContext, createNativeToSolanaFlowConfig,
  executeNativeDepositObservationFlow, submitLocalnetSolanaDepositClaim } from "../../scripts/local-e2e-native-to-solana.mjs";
import { base58Decode, base58Encode, findProgramAddress, shortvecEncode } from "../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { decodeCanonicalBridgeMessage, encodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";
import { SPL_TOKEN_PROGRAM_ID_BASE58 as TOKEN, SYSTEM_PROGRAM_ID_BASE58 as SYSTEM } from "../../services/bridge-validator/localnet-solana-setup-plan.mjs";
import { deriveWithdrawalRecordPdaHex } from "../../services/solana-observer/solana-withdrawal-observer.mjs";

function ephemeralUser() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const bytes = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  return { publicKeyBase58: base58Encode(bytes), publicKeyHex: bytes.toString("hex"),
    sign: bytesToSign => sign(null, bytesToSign, privateKey) };
}
const u64 = value => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b; };
const u32 = value => { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; };
const meta = (key, writable = false, signer = false) => ({ key, writable, signer });

// Intentionally test-only transaction compiler: allows malformed account/data
// substitutions to reach the real runtime. It is not a production withdrawal SDK.
async function packet(payer, signers, blockhash, instructions) {
  const merged = new Map([[payer.publicKeyBase58, meta(payer.publicKeyBase58, true, true)]]);
  for (const ix of instructions) for (const a of [...ix.accounts, meta(ix.program)]) {
    const old = merged.get(a.key);
    merged.set(a.key, { key: a.key, writable: a.writable || old?.writable || false, signer: a.signer || old?.signer || false });
  }
  const rank = a => a.key === payer.publicKeyBase58 ? -1 : a.signer ? (a.writable ? 0 : 1) : (a.writable ? 2 : 3);
  const keys = [...merged.values()].sort((a, b) => rank(a) - rank(b));
  const signing = keys.filter(a => a.signer);
  const message = Buffer.concat([Buffer.from([signing.length, signing.filter(a => !a.writable).length,
    keys.filter(a => !a.signer && !a.writable).length]), shortvecEncode(keys.length),
  ...keys.map(a => base58Decode(a.key)), base58Decode(blockhash), shortvecEncode(instructions.length),
  ...instructions.map(ix => Buffer.concat([Buffer.from([keys.findIndex(a => a.key === ix.program)]),
    shortvecEncode(ix.accounts.length), Buffer.from(ix.accounts.map(a => keys.findIndex(k => k.key === a.key))),
    shortvecEncode(ix.data.length), ix.data]))]);
  const signatures = await Promise.all(signing.map(a => {
    const signer = [payer, ...signers].find(s => s.publicKeyBase58 === a.key);
    assert.ok(signer, "LOCAL_TEST_SIGNATURE_REQUIRED");
    return signer.sign(message);
  }));
  const bytes = Buffer.concat([shortvecEncode(signatures.length), ...signatures, message]);
  assert.ok(bytes.length <= 1232, "LOCAL_TEST_TRANSACTION_TOO_LARGE");
  return bytes.toString("base64");
}

export async function testWithdrawalRecord(context, user, onCheck = () => {}) {
  const setup = context.localSolanaSetupContext;
  const deposit = decodeCanonicalBridgeMessage(context.depositClaimRequest.request.encodedMessageHex);
  const manager = base58Encode(deposit.deployment.managerProgramId);
  const mint = setup.mintBase58;
  const source = setup.recipientTokenAccountBase58;
  const derive = (seed, value, program = deposit.deployment.managerProgramId) =>
    findProgramAddress([Buffer.from(seed), value], program).base58;
  const state = derive("kingpepe-bridge-state", base58Decode(mint));
  const transceiverConfig = derive("kingpepe-transceiver-config", base58Decode(mint), deposit.deployment.transceiverProgramId);
  const payer = setup.feePayerSigner;
  const passed = [];
  let rpcId = 0;
  async function rpc(method, params) {
    // Endpoint comes only from the isolated bootstrap's loopback port.
    const response = await fetch(`http://127.0.0.1:${context.plan.ports.solanaRpcPort}`, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    });
    assert.equal(response.ok, true, "LOCAL_VALIDATOR_HTTP_FAILURE");
    const envelope = await response.json();
    if (envelope.error) throw new Error("LOCAL_VALIDATOR_RPC_REJECTED", { cause: envelope.error.data?.err });
    assert.ok(Object.hasOwn(envelope, "result"), "LOCAL_VALIDATOR_MALFORMED_RESPONSE");
    return envelope.result;
  }
  const account = async address => (await rpc("getAccountInfo", [address, { encoding: "base64", commitment: "finalized" }])).value;
  const data = a => Buffer.from(a.data[0], "base64");
  async function economicSnapshot(record) {
    const [m, t, s, r] = await Promise.all([account(mint), account(source), account(state), account(record)]);
    return { mintData: m.data, tokenData: t.data, stateData: s.data, record: r };
  }
  async function send(instructions, { extraSigners = [user], failedIndex } = {}) {
    // Measured default-budget failure consumes all 200000 units. Explicit
    // disposable localnet budget, consistent with the deposit harness; no CU
    // price or production limit is selected here.
    instructions = [{ program: "ComputeBudget111111111111111111111111111111", accounts: [],
      data: Buffer.concat([Buffer.from([2]), u32(600_000)]) }, ...instructions];
    if (failedIndex !== undefined) failedIndex += 1;
    const latest = (await rpc("getLatestBlockhash", [{ commitment: "finalized" }])).value;
    const bytes = await packet(payer, extraSigners, latest.blockhash, instructions);
    // Failed regressions execute on chain (not merely preflight simulation).
    const signature = await rpc("sendTransaction", [bytes, { encoding: "base64", skipPreflight: true, maxRetries: 0 }]);
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const status = (await rpc("getSignatureStatuses", [[signature], { searchTransactionHistory: true }])).value[0];
      if (status?.confirmationStatus === "finalized") {
        const transaction = await rpc("getTransaction", [signature, { encoding: "json", commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
        assert.ok(transaction?.meta, "LOCAL_TRANSACTION_META_REQUIRED");
        assert.deepEqual(transaction.meta.err, status.err);
        if (failedIndex === undefined && status.err !== null) {
          const logs = transaction.meta.logMessages ?? [];
          throw new Error("LOCAL_WITHDRAWAL_TRANSACTION_FAILED", { cause: { ...status.err,
            computeUnitsConsumed: transaction.meta.computeUnitsConsumed,
            diagnostic: logs.some(l => /out of memory|memory allocation/u.test(l)) ? "HEAP_EXHAUSTED"
              : logs.some(l => /exceeded CUs|computational budget/u.test(l)) ? "COMPUTE_EXHAUSTED"
                : logs.some(l => /Access violation|stack frame/u.test(l)) ? "MEMORY_ACCESS_VIOLATION" : "RUNTIME_FAILURE" } });
        }
        if (failedIndex !== undefined) assert.equal(status.err?.InstructionError?.[0], failedIndex, "LOCAL_EXPECTED_INSTRUCTION_FAILURE");
        return transaction;
      }
      await delay(250);
    }
    throw new Error("LOCAL_WITHDRAWAL_FINALITY_TIMEOUT");
  }
  function request(patch = {}, accountPatch = {}, burnPatch = {}) {
    const encoded = encodeCanonicalBridgeMessage({ ...deposit, operationId: undefined,
      action: "WithdrawalRequest", direction: "SolanaToNative", depositOutpoint: { txid: new Uint8Array(32), vout: 0 },
      withdrawalId: randomBytes(32), nonce: randomBytes(32), amountAtomic: 1_000_000n, feeAtomic: 1000n,
      destination: Buffer.concat([Buffer.from([0x51, 0x20]), randomBytes(32)]), ...patch });
    const message = decodeCanonicalBridgeMessage(encoded);
    const record = derive("kingpepe-withdrawal-record", message.withdrawalId);
    const keys = { state, record, source, mint, authority: user.publicKeyBase58, token: TOKEN,
      transceiverConfig, payer: payer.publicKeyBase58, system: SYSTEM, ...accountPatch };
    const burn = { token: TOKEN, mint, authority: user.publicKeyBase58, amount: message.amountAtomic, decimals: 8, ...burnPatch };
    return { message, record, instruction: { program: manager, accounts: [
      meta(keys.state, true), meta(keys.record, true), meta(keys.source, true), meta(keys.mint, true),
      meta(keys.authority, false, true), meta(keys.token), meta(keys.transceiverConfig), meta(keys.payer, true, true), meta(keys.system)],
    data: Buffer.concat([Buffer.from([3]), encoded, base58Decode(burn.token), base58Decode(burn.mint),
      base58Decode(burn.authority), u64(burn.amount), Buffer.from([burn.decimals])]) } };
  }
  async function rejection(label, req, additional = [], failedIndex = 0, extraSigners) {
    onCheck(label);
    const before = await economicSnapshot(req.record);
    const payerBefore = (await account(payer.publicKeyBase58)).lamports;
    const failed = await send([req.instruction, ...additional], { failedIndex, extraSigners });
    assert.deepEqual(await economicSnapshot(req.record), before, "FAILED_TRANSACTION_CHANGED_ECONOMIC_STATE");
    const payerAfter = (await account(payer.publicKeyBase58)).lamports;
    assert.ok([payerBefore, payerAfter, failed.meta.fee].every(Number.isSafeInteger), "LOCAL_RENT_BALANCE_PRECISION_REQUIRED");
    // Transaction fees are charged even on failure; record rent must roll back.
    assert.equal(BigInt(payerAfter), BigInt(payerBefore) - BigInt(failed.meta.fee), "FAILED_TRANSACTION_RETAINED_RECORD_RENT");
    passed.push(label);
  }

  const fresh = request();
  onCheck("FRESH_USER_FRESH_PDA_FINALIZED_BURN_AND_RECORD");
  assert.equal(await account(fresh.record), null, "WITHDRAWAL_PDA_NOT_FRESH");
  const before = await economicSnapshot(fresh.record);
  const tx = await send([fresh.instruction]);
  const record = await account(fresh.record);
  assert.equal(record.owner, manager);
  assert.equal(Buffer.from(base58Decode(fresh.record)).toString("hex"), deriveWithdrawalRecordPdaHex(Buffer.from(deposit.deployment.managerProgramId).toString("hex"), fresh.message.withdrawalIdHex));
  assert.equal(record.executable, false);
  const bytes = data(record);
  assert.equal(bytes.length, 283);
  assert.equal(bytes.subarray(0, 8).toString(), "KPBWDR01");
  assert.equal(bytes[8], 1);
  assert.equal(bytes.subarray(9, 41).toString("hex"), fresh.message.withdrawalIdHex);
  assert.equal(bytes.subarray(41, 73).toString("hex"), fresh.message.operationIdHex);
  assert.equal(bytes.subarray(73, 105).toString("hex"), fresh.message.messageDigestHex);
  assert.equal(bytes.readBigUInt64LE(105), fresh.message.amountAtomic);
  assert.equal(bytes.readBigUInt64LE(113), fresh.message.feeAtomic);
  const length = bytes.readUInt16LE(121);
  assert.equal(bytes.subarray(123, 123 + length).toString("hex"), fresh.message.destinationHex);
  assert.ok(bytes.subarray(123 + length, 251).every(b => b === 0));
  assert.equal(bytes.subarray(251).toString("hex"), user.publicKeyHex);
  assert.ok(record.lamports >= await rpc("getMinimumBalanceForRentExemption", [283]));
  const after = await economicSnapshot(fresh.record);
  assert.equal(Buffer.from(after.mintData[0], "base64").readBigUInt64LE(36), Buffer.from(before.mintData[0], "base64").readBigUInt64LE(36) - fresh.message.amountAtomic);
  assert.equal(Buffer.from(after.tokenData[0], "base64").readBigUInt64LE(64), Buffer.from(before.tokenData[0], "base64").readBigUInt64LE(64) - fresh.message.amountAtomic);
  const bridgeBytes = Buffer.from(after.stateData[0], "base64");
  assert.equal(bridgeBytes.readBigUInt64LE(266), Buffer.from(after.mintData[0], "base64").readBigUInt64LE(36));
  assert.equal(bridgeBytes.readBigUInt64LE(282), fresh.message.amountAtomic);
  const inner = tx.meta.innerInstructions.flatMap(i => i.instructions);
  const burnBytes = base58Encode(Buffer.concat([Buffer.from([15]), u64(fresh.message.amountAtomic), Buffer.from([8])]));
  assert.ok(inner.some(i => tx.transaction.message.accountKeys[i.programIdIndex] === TOKEN && i.data === burnBytes
    && JSON.stringify(i.accounts.map(index => tx.transaction.message.accountKeys[index])) === JSON.stringify([source, mint, user.publicKeyBase58])), "REAL_BURN_CHECKED_CPI_MISSING");
  passed.push("FRESH_USER_FRESH_PDA_FINALIZED_BURN_AND_RECORD");

  const duplicate = request({ withdrawalId: fresh.message.withdrawalId });
  await rejection("DUPLICATE_WITHDRAWAL_NEW_NONCE_REJECTED", duplicate);
  await rejection("WRONG_RECORD_PDA_REJECTED", request({}, { record: payer.publicKeyBase58 }));
  await rejection("WRONG_MINT_REJECTED", request({}, { mint: source }));
  await rejection("WRONG_TOKEN_PROGRAM_REJECTED", request({}, { token: SYSTEM }));
  await rejection("WRONG_TRANSCEIVER_CONFIG_REJECTED", request({}, { transceiverConfig: state }));
  await rejection("WRONG_TOKEN_AUTHORITY_REJECTED", request({}, { authority: payer.publicKeyBase58 }, { authority: payer.publicKeyBase58 }));
  const unsignedUser = request(); unsignedUser.instruction.accounts[4].signer = false;
  await rejection("MISSING_USER_SIGNATURE_REJECTED", unsignedUser);
  await rejection("INSUFFICIENT_RECORD_RENT_ROLLS_BACK", request({}, { payer: user.publicKeyBase58 }));
  await rejection("MISMATCHED_BURN_AMOUNT_REJECTED", request({}, {}, { amount: 999_999n }));
  await rejection("MISMATCHED_DECIMALS_REJECTED", request({}, {}, { decimals: 9 }));
  await rejection("TRUNCATED_NATIVE_DESTINATION_REJECTED", request({ destination: Buffer.from([0x51, 0x20, 0xab]) }));
  await rejection("NONSTANDARD_NATIVE_DESTINATION_REJECTED", request({ destination: Buffer.from([0x6a]) }));
  for (const [name, patch] of [["PROTOCOL", { protocolId: 2 }], ["NATIVE_NETWORK", { nativeNetwork: 1 }],
    ["NATIVE_GENESIS", { nativeGenesis: randomBytes(32) }], ["SOLANA_DEPLOYMENT", { solanaDeployment: randomBytes(32) }],
    ["MANAGER", { managerProgramId: randomBytes(32) }], ["TRANSCEIVER", { transceiverProgramId: randomBytes(32) }]]) {
    await rejection(`WRONG_${name}_DOMAIN_REJECTED`, request({ deployment: { ...deposit.deployment, ...patch } }));
  }
  await rejection("WRONG_EPOCH_REJECTED", request({ keyEpoch: deposit.keyEpoch + 1 }));
  await rejection("EXPIRED_WITHDRAWAL_REJECTED", request({ validFrom: 1n, validUntil: 2n }));
  await rejection("INSUFFICIENT_TOKEN_BALANCE_REJECTED", request({ amountAtomic: 100_000_000n }));
  const malformed = request(); malformed.instruction.data = Buffer.concat([malformed.instruction.data, Buffer.from([0])]);
  await rejection("TRAILING_INSTRUCTION_DATA_REJECTED", malformed);
  const rollback = request();
  await rejection("LATER_INSTRUCTION_FAILURE_ROLLS_BACK_BURN_RECORD_AND_RENT", rollback,
    [{ program: SYSTEM, accounts: [], data: Buffer.from([255]) }], 1);

  // Lamport dust cannot permanently occupy an otherwise unallocated PDA.
  // Initialized records are rejected above, never overwritten or closed.
  const prefunded = request();
  onCheck("PREFUNDED_SYSTEM_PDA_SAFELY_INITIALIZED");
  await send([{ program: SYSTEM, accounts: [meta(payer.publicKeyBase58, true, true), meta(prefunded.record, true)],
    data: Buffer.concat([u32(2), u64(1_000_000n)]) }], { extraSigners: [] });
  assert.equal((await account(prefunded.record)).owner, SYSTEM);
  await send([prefunded.instruction]);
  assert.equal((await account(prefunded.record)).owner, manager);
  passed.push("PREFUNDED_SYSTEM_PDA_SAFELY_INITIALIZED");

  const noEntitlement = request();
  onCheck("DIRECT_SPL_BURN_CREATES_NO_WITHDRAWAL_ENTITLEMENT");
  const beforeDirect = await economicSnapshot(noEntitlement.record);
  await send([{ program: TOKEN, accounts: [meta(source, true), meta(mint, true), meta(user.publicKeyBase58, false, true)],
    data: Buffer.concat([Buffer.from([15]), u64(1n), Buffer.from([8])]) }]);
  const afterDirect = await economicSnapshot(noEntitlement.record);
  assert.equal(afterDirect.record, null);
  assert.deepEqual(afterDirect.stateData, beforeDirect.stateData);
  assert.equal(Buffer.from(afterDirect.mintData[0], "base64").readBigUInt64LE(36), Buffer.from(beforeDirect.mintData[0], "base64").readBigUInt64LE(36) - 1n);
  passed.push("DIRECT_SPL_BURN_CREATES_NO_WITHDRAWAL_ENTITLEMENT");

  return { pass: passed.length, fail: 0, passed,
    scope: "Finalized isolated local-validator record prerequisite; no Native withdrawal payout or Phase 09 E2E." };
}

export async function runLocalWithdrawalRecordRegression(repoRoot) {
  let evidence;
  let failure;
  let check;
  const result = await withLocalE2eInfrastructure({ repoRoot }, async context => {
    const user = ephemeralUser();
    const setup = createLocalSolanaSetupContext();
    const localSolanaSetupContext = { ...setup, recipientTokenAccountOwnerBase58: user.publicKeyBase58,
      recipientTokenAccountOwnerHex: user.publicKeyHex };
    const flowConfig = createNativeToSolanaFlowConfig({ plan: context.plan, repoRoot, mintHex: setup.mintHex,
      keyEpoch: setup.keyEpoch, policyEpoch: setup.policyEpoch });
    let claimContext;
    const flow = await executeNativeDepositObservationFlow({ ...context, flowConfig, localSolanaSetupContext,
      solanaDepositClaim: async input => { claimContext = input; return submitLocalnetSolanaDepositClaim(input); } });
    assert.equal(flow.state, "COMPLETED", "FRESH_DEPOSIT_PREREQUISITE_FAILED");
    // The deposit has reconciled BEFORE these separate burn/record probes.
    // They deliberately leave unpaid test withdrawals; no payout is constructed.
    try { evidence = await testWithdrawalRecord(claimContext, user, label => { check = label; }); }
    catch (error) {
      // Emit only symbolic validation errors, never assertions containing keys,
      // account bytes, command output, exception stacks or private paths.
      failure = { check, code: /^[A-Z_]+$/u.test(error.message) ? error.message : "REGRESSION_ASSERTION_FAILED",
        testLine: Number(error.stack?.match(/local-withdrawal-record\.mjs:(\d+):/u)?.[1]) || undefined,
        instructionError: error.cause?.InstructionError, diagnostic: error.cause?.diagnostic,
        computeUnitsConsumed: error.cause?.computeUnitsConsumed };
      throw error;
    }
    return { withdrawalRecord: evidence };
  });
  if (!evidence) throw new Error("WITHDRAWAL_REGRESSION_NOT_COMPLETED", { cause: failure ?? { code: "LOCAL_INFRASTRUCTURE_OR_DEPOSIT_FAILED" } });
  return { sourceScope: "PHASE_08_5", infrastructure: result.state, withdrawalRecord: evidence,
    phase09: "NOT_STARTED", productionReady: false, mainnetActivation: "DISABLED" };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await runLocalWithdrawalRecordRegression(process.argv[2] ?? path.resolve(import.meta.dirname, "../.."))));
  } catch (error) {
    console.error(JSON.stringify({ error: "LOCAL_WITHDRAWAL_RECORD_REGRESSION_FAILED", detail: error.cause }));
    process.exitCode = 1;
  }
}
