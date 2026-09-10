// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Tests only the isolated Native user wallet. No private key leaves that wallet.
import assert from "node:assert/strict";
import { buildRegtestCliArguments } from "../../scripts/local-e2e-orchestrator.mjs";
import { taprootAddressFromXOnlyPublicKey } from "../../scripts/local-e2e-native-to-solana.mjs";
import { buildRegtestRecoverableDeposit } from "../../native/recovery/taproot-deposit.mjs";
import { prepareRegtestRecoveryPsbt } from "../../native/recovery/recovery-psbt.mjs";
import { parseNativeTransactionHex } from "../../native/node/native-taproot-transaction.mjs";
import { REGTEST_GENESIS } from "../../native/node/native-raw-evidence.mjs";

export async function testRecoveryPsbtWithNativeWallet(context) {
  const { plan, executor, commandPaths, flowConfig: config } = context;
  if (config.nativeChainName !== "regtest") throw new Error("RECOVERY_PSBT_TEST_REGTEST_REQUIRED");
  const cli = async (command, parameters = [], json = false, wallet = undefined) => {
    const result = await executor.runOneShot({ step: "LOCAL_REGTEST_RECOVERY_PSBT_TEST", executable: commandPaths.get("kingpepe-cli"),
      args: buildRegtestCliArguments({ datadir: plan.paths.nativeDatadir, rpcPort: plan.ports.nativeRpcPort,
        command, parameters, wallet }), cwd: plan.repoRoot });
    return json ? JSON.parse(result.output) : String(result.output).trim();
  };
  assert.equal(await cli("getblockhash", ["0"]), REGTEST_GENESIS);
  const userCli = (command, parameters = [], json = false) => cli(command, parameters, json, config.userWalletName);
  const keyAddress = await userCli("getnewaddress", ["recovery-psbt", "bech32"]);
  const keyInfo = await userCli("getaddressinfo", [keyAddress], true);
  assert.equal(keyInfo.ismine, true); assert.match(keyInfo.pubkey, /^(02|03)[0-9a-f]{64}$/u);
  const userPublicKey = keyInfo.pubkey.slice(2);
  const destinationAddress = await userCli("getnewaddress", ["recovery-destination", "bech32m"]);
  const destinationInfo = await userCli("getaddressinfo", [destinationAddress], true);
  assert.equal(destinationInfo.ismine, true);
  assert.match(destinationInfo.scriptPubKey, /^5120[0-9a-f]{64}$/u);
  const policy = buildRegtestRecoverableDeposit({ ...context.depositPolicy, userRecoveryPublicKeyHex: userPublicKey, csvDelayBlocks: 12 });
  const address = taprootAddressFromXOnlyPublicKey(policy.outputPublicKeyHex, "rkpepe");
  const fundingId = await userCli("sendtoaddress", [address, "0.01000000"]);
  const miningAddress = await userCli("getnewaddress");
  await userCli("generatetoaddress", ["12", miningAddress]);
  const raw = await cli("getrawtransaction", [fundingId, "false"]);
  const funding = parseNativeTransactionHex(raw);
  const outputIndex = funding.outputs.findIndex((output) => output.scriptPubKeyHex === policy.scriptPubKeyHex && output.amountAtomic === "1000000");
  assert.ok(outputIndex >= 0);
  const prepared = prepareRegtestRecoveryPsbt({ depositPolicy: policy, fundingTransactionHex: raw, outputIndex,
    amountAtomic: "1000000", destinationScriptPubKeyHex: destinationInfo.scriptPubKey, feeAtomic: "1000", maximumFeeAtomic: "1000",
    userKeyOrigin: { masterFingerprintHex: keyInfo.hdmasterfingerprint, derivationPath: keyInfo.hdkeypath } });
  const decoded = await cli("decodepsbt", [prepared.psbtBase64], true);
  assert.equal(decoded.tx.txid, parseNativeTransactionHex(prepared.unsignedTransactionHex).txidHex);
  assert.equal(decoded.inputs.length, 1); assert.equal(decoded.inputs[0].witness_utxo.scriptPubKey.hex, policy.scriptPubKeyHex);
  const signed = await userCli("walletprocesspsbt", [prepared.psbtBase64, "true", "DEFAULT", "true", "true"], true);
  assert.equal(signed.complete, true, "NATIVE_WALLET_CANNOT_SIGN_RECOVERY_SCRIPT");
  const finalized = await cli("finalizepsbt", [signed.psbt, "true"], true);
  assert.equal(finalized.complete, true);
  const payout = parseNativeTransactionHex(finalized.hex);
  assert.equal(payout.txidHex, parseNativeTransactionHex(prepared.unsignedTransactionHex).txidHex);
  assert.equal(payout.outputs[0].amountAtomic, "999000");
  assert.equal(payout.outputs[0].scriptPubKeyHex, destinationInfo.scriptPubKey);
  assert.equal((await cli("testmempoolaccept", [JSON.stringify([finalized.hex])], true))[0].allowed, true);
  assert.equal(await cli("sendrawtransaction", [finalized.hex]), payout.txidHex);
  await userCli("generatetoaddress", ["1", miningAddress]);
  const received = await userCli("gettransaction", [payout.txidHex], true);
  assert.equal(received.txid, payout.txidHex); assert.equal(received.confirmations, 1);
  assert.ok(received.details.some((detail) => detail.category === "receive" && detail.address === destinationAddress && detail.vout === 0));
  assert.equal((await cli("testmempoolaccept", [JSON.stringify([finalized.hex])], true))[0].allowed, false);
  return Object.freeze({ pass: 4, fail: 0, checks: ["NATIVE_PSBT_DECODE_MATCHES_UNSIGNED_RECOVERY",
    "NATIVE_USER_WALLET_SIGNS_WITHOUT_KEY_EXPORT", "PSBT_PAYOUT_RECOGNIZED_BY_USER_WALLET",
    "PSBT_RECOVERY_BROADCAST_FINALITY_AND_REPLAY"],
    scope: "Pinned isolated Native wallet only; no production wallet or general wallet compatibility claim." });
}
