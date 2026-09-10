// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Real isolated REGTEST script tests. The simulated user's recovery secret is
// ephemeral RAM only, never passed to a subprocess, returned, persisted or logged.
import assert from "node:assert/strict";
import path from "node:path";
import { schnorr } from "@noble/curves/secp256k1.js";
import { buildRegtestCliArguments } from "../../scripts/local-e2e-orchestrator.mjs";
import { taprootAddressFromXOnlyPublicKey } from "../../scripts/local-e2e-native-to-solana.mjs";
import { REGTEST_GENESIS } from "../../native/node/native-raw-evidence.mjs";
import { NativeRpcClient } from "../../native/node/native-rpc-client.mjs";
import { buildRegtestRecoverableDeposit, deriveRegtestDepositCommitment, prepareRegtestRecoveryTransaction } from "../../native/recovery/taproot-deposit.mjs";
import { attachTaprootWitnesses, parseNativeTransactionHex, taprootScriptPathSighashDefault } from "../../native/node/native-taproot-transaction.mjs";

export async function testLocalNativeRecovery(context) {
  const { plan, executor, commandPaths, flowConfig, localSolanaSetupContext: setup } = context;
  if (flowConfig.nativeChainName !== "regtest") throw new Error("RECOVERY_TEST_REGTEST_REQUIRED");
  const cli = async (command, parameters = [], wallet = undefined, json = false) => {
    const result = await executor.runOneShot({ step: "LOCAL_REGTEST_RECOVERY_SCRIPT_TEST", executable: commandPaths.get("kingpepe-cli"),
      args: buildRegtestCliArguments({ datadir: plan.paths.nativeDatadir, rpcPort: plan.ports.nativeRpcPort, command, parameters, wallet }), cwd: plan.repoRoot });
    const text = String(result.output ?? "").trim();
    return json ? JSON.parse(text) : text;
  };
  assert.equal(await cli("getblockhash", ["0"]), REGTEST_GENESIS);
  const rpc = new NativeRpcClient({ endpoint: `http://127.0.0.1:${plan.ports.nativeRpcPort}`, localOnly: true,
    authCookieFile: path.join(plan.paths.nativeDatadir, "regtest", ".cookie"), repoRoot: plan.repoRoot });
  const passed = [];
  const userSecret = schnorr.utils.randomSecretKey();
  try {
    const publicKeyHex = Buffer.from(schnorr.getPublicKey(userSecret)).toString("hex");
    const depositCommitmentHex = deriveRegtestDepositCommitment({ nativeGenesisHex: REGTEST_GENESIS,
      solanaDeploymentHex: flowConfig.solanaDeploymentHex, managerProgramIdHex: flowConfig.bridgeProgramIdHex,
      transceiverProgramIdHex: flowConfig.transceiverProgramIdHex, mintHex: flowConfig.mintHex,
      recipientHex: setup.recipientTokenAccountHex, nonceHex: publicKeyHex, amountAtomic: "1000000",
      protocolId: flowConfig.protocolId, nativeNetwork: flowConfig.nativeNetwork, policyEpoch: flowConfig.policyEpoch, keyEpoch: flowConfig.keyEpoch });
    const policy = buildRegtestRecoverableDeposit({ nativeGenesisHex: REGTEST_GENESIS, depositCommitmentHex,
      frostPublicKeyHex: context.signedReserveSweep.frostResults[0].aggregateTweakedXOnlyPublicKey,
      userRecoveryPublicKeyHex: publicKeyHex, csvDelayBlocks: 12 });
    const address = taprootAddressFromXOnlyPublicKey(policy.outputPublicKeyHex, "rkpepe");
    const fundingId = await cli("sendtoaddress", [address, "0.01000000"], flowConfig.userWalletName);
    const miningAddress = await cli("getnewaddress", [], flowConfig.userWalletName);
    const mine = (count) => cli("generatetoaddress", [String(count), miningAddress], flowConfig.userWalletName);
    await mine(1);
    const raw = await cli("getrawtransaction", [fundingId, "false"]);
    const funding = parseNativeTransactionHex(raw);
    const outputIndex = funding.outputs.findIndex((output) => output.scriptPubKeyHex === policy.scriptPubKeyHex && output.amountAtomic === "1000000");
    assert.ok(outputIndex >= 0);
    const recovery = prepareRegtestRecoveryTransaction({ depositPolicy: policy, fundingTransactionHex: raw, outputIndex,
      amountAtomic: "1000000", destinationScriptPubKeyHex: `5120${publicKeyHex}`, feeAtomic: "1000", maximumFeeAtomic: "1000" });
    const sign = (unsignedHex, spentOutputs = recovery.spentOutputs) => {
      const hash = taprootScriptPathSighashDefault({ transaction: unsignedHex, spentOutputs, inputIndex: 0, scriptHex: policy.recovery.scriptHex });
      const signature = schnorr.sign(Buffer.from(hash.sigHashHex, "hex"), userSecret);
      return attachTaprootWitnesses({ unsignedNativeTransactionHex: unsignedHex, spentOutputs: recovery.spentOutputs,
        signatures: [Buffer.from(signature).toString("hex")], tapscriptSpends: recovery.tapscriptSpends }).rawSignedTransactionHex;
    };
    const signed = sign(recovery.unsignedTransactionHex);
    const check = async (rawHex) => (await cli("testmempoolaccept", [JSON.stringify([rawHex])], undefined, true))[0];
    let result = await check(signed);
    assert.equal(result.allowed, false); assert.equal(result["reject-reason"], "non-BIP68-final");
    passed.push("CSV_RECOVERY_BEFORE_MATURITY_REJECTED_BY_NODE");
    await mine(10);
    result = await check(signed);
    assert.equal(result.allowed, false); assert.equal(result["reject-reason"], "non-BIP68-final");
    passed.push("CSV_RECOVERY_ONE_BLOCK_EARLY_REJECTED_BY_NODE");
    await mine(1);
    // At maturity, wrong signing amount still cannot authorize a spend.
    assert.equal((await check(sign(recovery.unsignedTransactionHex,
      [{ ...recovery.spentOutputs[0], amountAtomic: "1000001" }]))).allowed, false);
    passed.push("RECOVERY_WRONG_SIGHASH_AMOUNT_REJECTED_BY_NODE");
    const disabledSequence = Buffer.from(recovery.unsignedTransactionHex, "hex");
    disabledSequence.writeUInt32LE(0xffff_ffff, 42);
    assert.equal((await check(sign(disabledSequence.toString("hex")))).allowed, false);
    passed.push("CSV_DISABLE_FLAG_CANNOT_BYPASS_RECOVERY_SCRIPT");
    assert.equal((await check(signed)).allowed, true);
    const payoutId = await cli("sendrawtransaction", [signed]);
    assert.equal(payoutId, parseNativeTransactionHex(signed).txidHex);
    await mine(1);
    // The pinned CLI suppresses null results; use the bounded JSON-RPC adapter
    // to establish an explicit spent-output observation instead of parsing silence.
    assert.equal((await rpc.getUtxoObservation({ txid: fundingId, vout: outputIndex, includeMempool: true })).unspent, false);
    passed.push("MATURE_USER_RECOVERY_ACCEPTED_AND_SPENT_BY_NODE");
    assert.equal((await check(signed)).allowed, false);
    passed.push("RECOVERY_REPLAY_REJECTED_BY_NODE");
    return Object.freeze({ pass: passed.length, fail: 0, passed: Object.freeze(passed),
      scope: "Real REGTEST user-recovery script semantics; not full recoverable-deposit bridge integration, sweep/recovery reorg race coverage or PSBT wallet integration." });
  } finally { userSecret.fill(0); }
}
