// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Isolated REGTEST-only competing spends/reorganizations. Separate test funds;
// no Solana mint is requested for these operations and no live chain is changed.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { buildRegtestCliArguments } from "../../scripts/local-e2e-orchestrator.mjs";
import { createLocalFrostTaprootCustodyContext, draftLocalReserveSweep, signLocalReserveSweepWithFrost,
  taprootAddressFromXOnlyPublicKey } from "../../scripts/local-e2e-native-to-solana.mjs";
import { createLocalNativeEvidenceVerifier } from "../../scripts/local-native-evidence-verifier.mjs";
import { REGTEST_GENESIS } from "../../native/node/native-raw-evidence.mjs";
import { NativeRpcClient } from "../../native/node/native-rpc-client.mjs";
import { createLocalTaprootSighashEvidences, parseNativeTransactionHex } from "../../native/node/native-taproot-transaction.mjs";
import { buildRegtestRecoverableDeposit, deriveRegtestDepositCommitment,
  validateRegtestRecoverableDepositIntent } from "../../native/recovery/taproot-deposit.mjs";
import { prepareRegtestRecoveryPsbt } from "../../native/recovery/recovery-psbt.mjs";

export async function testLocalRecoveryRaces(context) {
  const { plan, executor, commandPaths, flowConfig: config } = context;
  if (config.nativeChainName !== "regtest") throw new Error("RECOVERY_RACE_TEST_REGTEST_REQUIRED");
  const cli = async ({ command, parameters = [], wallet, json = false }) => {
    const result = await executor.runOneShot({ step: "LOCAL_REGTEST_RECOVERY_RACE_TEST", executable: commandPaths.get("kingpepe-cli"),
      args: buildRegtestCliArguments({ datadir: plan.paths.nativeDatadir, rpcPort: plan.ports.nativeRpcPort,
        command, parameters, wallet }), cwd: plan.repoRoot });
    return json ? JSON.parse(result.output) : String(result.output).trim();
  };
  const call = (command, parameters = [], json = false) => cli({ command, parameters, json });
  const user = (command, parameters = [], json = false) => cli({ command, parameters, json, wallet: config.userWalletName });
  assert.equal(await call("getblockhash", ["0"]), REGTEST_GENESIS);
  const rpc = new NativeRpcClient({ endpoint: `http://127.0.0.1:${plan.ports.nativeRpcPort}`, localOnly: true,
    authCookieFile: path.join(plan.paths.nativeDatadir, "regtest", ".cookie"), repoRoot: plan.repoRoot });
  const verifier = await createLocalNativeEvidenceVerifier({ plan });
  const passed = [];
  const check = async (raw) => (await call("testmempoolaccept", [JSON.stringify([raw])], true))[0];
  for (const sweepFirst of [true, false]) {
    const label = sweepFirst ? "SWEEP_FIRST" : "RECOVERY_FIRST";
    const custody = await createLocalFrostTaprootCustodyContext({ plan,
      flowConfig: { ...config, stateRoot: path.join(config.stateRoot, label.toLowerCase()) } });
    const keyAddress = await user("getnewaddress", ["recovery-race-key", "bech32"]);
    const keyInfo = await user("getaddressinfo", [keyAddress], true);
    assert.equal(keyInfo.ismine, true); assert.match(keyInfo.pubkey, /^(02|03)[0-9a-f]{64}$/u);
    const destination = await user("getnewaddress", ["recovery-race-destination", "bech32m"]);
    const destinationInfo = await user("getaddressinfo", [destination], true);
    assert.equal(destinationInfo.ismine, true); assert.match(destinationInfo.scriptPubKey, /^5120[0-9a-f]{64}$/u);
    const intent = Object.freeze({ ...context.depositIntentContext, amountAtomic: "1000000", nonceHex: randomBytes(32).toString("hex") });
    const policy = buildRegtestRecoverableDeposit({ nativeGenesisHex: REGTEST_GENESIS,
      depositCommitmentHex: deriveRegtestDepositCommitment(intent), frostPublicKeyHex: custody.aggregateTweakedXOnlyPublicKey,
      userRecoveryPublicKeyHex: keyInfo.pubkey.slice(2), csvDelayBlocks: 12 });
    const fundingId = await user("sendtoaddress", [taprootAddressFromXOnlyPublicKey(policy.outputPublicKeyHex, "rkpepe"), "0.01000000"]);
    // Miner fee is separately supplied by this same test user, not another credit.
    const feeFundingId = await user("sendtoaddress", [custody.taprootAddress, "0.00001000"]);
    const miningAddress = await user("getnewaddress");
    const mine = (count) => user("generatetoaddress", [String(count), miningAddress], true);
    await mine(12);
    const fundingRaw = await call("getrawtransaction", [fundingId, "false"]);
    const feeRaw = await call("getrawtransaction", [feeFundingId, "false"]);
    const funding = parseNativeTransactionHex(fundingRaw); const feeFunding = parseNativeTransactionHex(feeRaw);
    const vout = funding.outputs.findIndex((o) => o.scriptPubKeyHex === policy.scriptPubKeyHex && o.amountAtomic === "1000000");
    const feeVout = feeFunding.outputs.findIndex((o) => o.scriptPubKeyHex === custody.taprootScriptPubKeyHex && o.amountAtomic === "1000");
    assert.ok(vout >= 0 && feeVout >= 0);
    const inputs = Object.freeze([
      Object.freeze({ txid: fundingId, vout, amountAtomic: "1000000", scriptPubKeyHex: policy.scriptPubKeyHex }),
      Object.freeze({ txid: feeFundingId, vout: feeVout, amountAtomic: "1000", scriptPubKeyHex: custody.taprootScriptPubKeyHex }),
    ]);
    const proof = await verifier.verifyInputs({ inputs, minimumConfirmations: 6 });
    const draft = await draftLocalReserveSweep({ cli, depositTxidHex: fundingId, depositVout: vout,
      depositAmountAtomic: "1000000", nativeMinerFeeAtomic: "1000", nativeDecimals: 8,
      canonicalReserveAddress: custody.taprootAddress, proofFingerprintHex: proof.digestHex,
      feeFundingInputs: [{ txidHex: feeFundingId, vout: feeVout, amountAtomic: "1000" }] });
    const spentOutputs = inputs.map(({ amountAtomic, scriptPubKeyHex }) => Object.freeze({ amountAtomic, scriptPubKeyHex }));
    const tapscriptSpends = Object.freeze([policy.sweep, undefined]);
    const evidences = createLocalTaprootSighashEvidences({ unsignedNativeTransactionHex: draft.unsignedNativeTransactionHex,
      spentOutputs, tapscriptSpends, proofFingerprintHex: proof.digestHex, reserveAmountAtomic: "1000000", nativeMinerFeeAtomic: "1000",
      expectedRecipientScriptPubKeyHex: custody.taprootScriptPubKeyHex, expectedChangeScriptPubKeyHex: custody.taprootScriptPubKeyHex });
    const signed = await signLocalReserveSweepWithFrost({ plan, flowConfig: config, frostCustody: custody,
      nativeSource: { nativeGenesisHash: REGTEST_GENESIS }, reserveSweepDraft: draft, taprootSighashEvidences: evidences,
      operationIdHex: randomBytes(32).toString("hex"), spentOutputs, tapscriptSpends,
      deposit: { txidHex: fundingId, vout, amountAtomic: "1000000", proofFingerprintHex: proof.digestHex,
        finalitySatisfied: true, utxoUnspent: true, noPriorConsumption: true },
      nativeEvidenceValidator: async (signingIntent) => {
        validateRegtestRecoverableDepositIntent({ intent, policy, depositScriptPubKeyHex: inputs[0].scriptPubKeyHex,
          reserveScriptPubKeyHex: custody.taprootScriptPubKeyHex, frostPublicKeyHex: custody.aggregateTweakedXOnlyPublicKey,
          userRecoveryPublicKeyHex: keyInfo.pubkey.slice(2), csvDelayBlocks: 12 });
        return verifier.verifySweepSigning({ inputs, minimumConfirmations: 6, unsignedTransactionHex: draft.unsignedNativeTransactionHex,
          reserveAmountAtomic: "1000000", feeAtomic: "1000", reserveScriptHex: custody.taprootScriptPubKeyHex,
          intent: signingIntent, tapscriptSpends });
      } });
    assert.equal(signed.frostResults.length, 2);
    for (const result of signed.frostResults) assert.deepEqual(result.signerIds, ["KINGPEPE_FROST_A", "KINGPEPE_FROST_B"]);
    assert.equal(new Set(signed.nativeRawEvidence.map((e) => e.signerId)).size, 2);
    const recovery = prepareRegtestRecoveryPsbt({ depositPolicy: policy, fundingTransactionHex: fundingRaw, outputIndex: vout,
      amountAtomic: "1000000", destinationScriptPubKeyHex: destinationInfo.scriptPubKey, feeAtomic: "1000", maximumFeeAtomic: "1000",
      userKeyOrigin: { masterFingerprintHex: keyInfo.hdmasterfingerprint, derivationPath: keyInfo.hdkeypath } });
    const walletSigned = await user("walletprocesspsbt", [recovery.psbtBase64, "true", "DEFAULT", "true", "true"], true);
    assert.equal(walletSigned.complete, true);
    const finalized = await call("finalizepsbt", [walletSigned.psbt, "true"], true);
    assert.equal(finalized.complete, true);
    assert.equal((await check(signed.signedNativeTransactionHex)).allowed, true);
    assert.equal((await check(finalized.hex)).allowed, true);
    passed.push(`${label}_REAL_FROST_AND_USER_WALLET_CANDIDATES_VALID`);

    const winner = sweepFirst ? signed.signedNativeTransactionHex : finalized.hex;
    const loser = sweepFirst ? finalized.hex : signed.signedNativeTransactionHex;
    const winnerId = parseNativeTransactionHex(winner).txidHex; const loserId = parseNativeTransactionHex(loser).txidHex;
    const priorHeight = (await rpc.getBlockchainInfo()).blocks;
    assert.equal(await call("sendrawtransaction", [winner]), winnerId);
    assert.equal((await check(loser)).allowed, false);
    passed.push(`${label}_EQUAL_FEE_CONFLICT_REJECTED_IN_MEMPOOL`);
    const blocks = await mine(6);
    assert.equal((await call("getrawtransaction", [winnerId, "true"], true)).confirmations, 6);
    assert.equal((await check(loser)).allowed, false);
    assert.equal((await rpc.getUtxoObservation({ txid: fundingId, vout, includeMempool: true })).unspent, false);
    const reserveEvidence = { deposit: inputs[0], feeInputs: inputs.slice(1), sweepTxid: signed.nativeSweepTxidHex,
      reserveVout: 0, reserveScriptHex: custody.taprootScriptPubKeyHex, feeAtomic: "1000", minimumConfirmations: 6, tapscriptSpends };
    // An infrastructure failure is NOT a passing economic-rejection test.
    const rejectsNoncanonicalReserve = () => assert.rejects(() => verifier.verifyReserve(reserveEvidence),
      (error) => ["RAW_NATIVE_TRANSACTION_UNCONFIRMED", "RAW_NATIVE_BLOCK_SUBSTITUTED",
        "NativeRpcRejected:getrawtransaction:-5"].includes(error?.message));
    if (sweepFirst) await verifier.verifyReserve(reserveEvidence);
    else await rejectsNoncanonicalReserve();
    passed.push(`${label}_FINALIZED_WINNER_EXCLUDES_OTHER_SPEND_AND_UNBACKED_CREDIT`);

    // Only the six blocks just mined for this separate test are disconnected.
    // Neither main-flow backing nor production data is part of this fork.
    await call("invalidateblock", [blocks[0]]);
    assert.equal((await rpc.getBlockchainInfo()).blocks, priorHeight);
    await rejectsNoncanonicalReserve();
    passed.push(`${label}_DISCONNECTED_RESERVE_NOT_MINT_ELIGIBLE`);
    // Pinned Native generateblock validates an explicitly selected transaction
    // against the new tip, regardless of the previously selected mempool spend.
    await call("generateblock", [miningAddress, JSON.stringify([loser])], true);
    await mine(5);
    assert.equal((await call("getrawtransaction", [loserId, "true"], true)).confirmations, 6);
    assert.equal((await check(winner)).allowed, false);
    assert.equal((await rpc.getUtxoObservation({ txid: fundingId, vout, includeMempool: true })).unspent, false);
    if (sweepFirst) await rejectsNoncanonicalReserve();
    else await verifier.verifyReserve(reserveEvidence);
    passed.push(`${label}_REORG_ALTERNATIVE_WINS_OLD_SPEND_REJECTED`);
  }
  return Object.freeze({ pass: passed.length, fail: 0, passed: Object.freeze(passed),
    scope: "Real REGTEST competing FROST/user-wallet spends and forced pre-mint forks; not post-mint deep-reorg compensation, production finality or a general RBF policy." });
}
