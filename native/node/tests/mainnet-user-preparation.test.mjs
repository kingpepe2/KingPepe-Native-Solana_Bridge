// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Public format fixtures only; no wallet keys, network submissions or approval.
import test from "node:test";
import assert from "node:assert/strict";
import { base58 } from "@scure/base";
import { NATIVE_MAINNET_GENESIS, NATIVE_MAINNET_DOMAIN, SOLANA_MAINNET_GENESIS, SOLANA_DEVNET_GENESIS,
  mainnetDeploymentIdentity } from "../../../shared/network-identity.mjs";
import { createNativeDepositRequest, createMainnetNativeDepositRequest } from "../../../solana/ts/sdk/bridge.mjs";
import { prepareMainnetRecoveryPsbt, prepareRegtestRecoveryPsbt, inspectUnsignedMainnetRecoveryPsbt,
  inspectUnsignedRecoveryPsbt } from "../../recovery/recovery-psbt.mjs";
import { createUnsignedNativeTransaction, parseNativeTransactionHex } from "../native-taproot-transaction.mjs";
import { scriptFromWitnessAddress } from "../witness-address.mjs";
import { decodeBridgeAbi } from "../../../shared/protocol/solana-bridge-abi.mjs";
import { createMainnetModeInstruction } from "../../../solana/ts/sdk/mainnet-control.mjs";
import { NativeRpcClient } from "../native-rpc-client.mjs";
import { LocalNativeEvidenceVerifier } from "../native-raw-evidence.mjs";
import { NativeDepositObserver } from "../../../services/bridge-validator/native-deposit-observer.mjs";

const hash = n => n.toString(16).padStart(2, "0").repeat(32);
const key = n => base58.encode(Buffer.from(hash(n), "hex"));
const frost = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const recovery = "c6047f9441ed7d6d3045406e95c07cd85a961ae58cd9ee37abac09b95c709ee5";
const policy = { environment: "mainnet", nativeGenesis: NATIVE_MAINNET_GENESIS,
  solanaDeployment: mainnetDeploymentIdentity({ manager: key(4), transceiver: key(5), mint: key(6) }),
  solanaGenesis: SOLANA_MAINNET_GENESIS, minimumSolanaSlot: "0", managerProgramId: hash(4), transceiverProgramId: hash(5),
  mint: hash(6), protocolId: 1, nativeNetwork: NATIVE_MAINNET_DOMAIN, policyEpoch: 1, keyEpoch: 1, frostPublicKeyHex: frost,
  csvDelayBlocks: 1440, minimumConfirmations: 12, maximumAmountAtomic: "18446744073709551615", maximumFeeAtomic: "10000" };
const deposit = { amountAtomic: "100000", recipient: key(7), userRecoveryPublicKeyHex: recovery, nonceHex: hash(8) };
test("Mainnet control preparation has only the exact config and enrollment signer; it cannot construct a transfer", () => {
  // Same fixed public commitment checked by the Rust Mainnet identity test.
  assert.equal(mainnetDeploymentIdentity({ manager: key(1), transceiver: key(2), mint: key(3) }),
    "f468d52edb30158677499d8258218786c1e5883777bf584f1a43b3b148e9b997");
  for (const [mode, value] of [["PAUSED", 0], ["CONTROLLED", 1], ["ACTIVE", 2]]) {
    const instruction = createMainnetModeInstruction({ deployment: policy, mode });
    assert.equal(instruction.program, key(4)); assert.equal(instruction.accounts.length, 2);
    assert.deepEqual(instruction.accounts.filter(a => a.signer), [{ key: key(6), writable: false, signer: true }]);
    assert.equal(instruction.data.toString("hex"), "04" + value.toString(16).padStart(2, "0"));
    assert.deepEqual(decodeBridgeAbi("MainnetMode", instruction.data), { tag: 4, mode: value });
  }
  for (const mode of [undefined, "ENABLED", "mainnet", 1]) assert.throws(() => createMainnetModeInstruction({ deployment: policy, mode }));
  assert.throws(() => createMainnetModeInstruction({ deployment: { ...policy, nativeNetwork: 8000111 }, mode: "CONTROLLED" }));
  assert.throws(() => createMainnetModeInstruction({ deployment: { ...policy, mint: hash(13) }, mode: "ACTIVE" }));
});

function observerFixture({ feeAtomic = "212", estimate = '"feerate":0.00001000,"blocks":3',
  finality = true, ready = true } = {}) {
  const quote = createMainnetNativeDepositRequest({ policy, ...deposit });
  const raw = createUnsignedNativeTransaction({ inputs: [{ txid: hash(12), vout: 0 }],
    outputs: [{ amountAtomic: deposit.amountAtomic, scriptPubKeyHex: quote.scriptPubKeyHex }] });
  const request = { operationId: quote.operationId, depositIntent: quote.depositIntent,
    userRecoveryPublicKeyHex: recovery, depositTxidHex: parseNativeTransactionHex(raw).txidHex,
    depositVout: 0, feeFundingInputs: [{ txid: hash(13), vout: 0, amountAtomic: feeAtomic,
      scriptPubKeyHex: "5120" + frost, minimumConfirmations: 12 }] };
  const calls = [], rpc = new NativeRpcClient({ endpoint: "http://127.0.0.1:18443", fetchFn: () => { throw new Error("UNEXPECTED_NETWORK_CALL"); } });
  rpc.getSourceSnapshot = async value => {
    assert.deepEqual(value, { expectedNetwork: "main", expectedGenesisHash: NATIVE_MAINNET_GENESIS });
    calls.push("identity"); return { state: ready ? "READY" : "REJECTED", bestHash: hash(21) };
  };
  rpc.locateMainnetTransaction = async () => ({ state: "OBSERVED", rawTransactionHex: raw, sourceTipHash: hash(21) });
  rpc.getUtxoObservation = async () => ({ unspent: true, valueAtomic: deposit.amountAtomic,
    scriptPubKeyHex: quote.scriptPubKeyHex, bestBlockHash: hash(21) });
  rpc.call = async (method, params) => {
    calls.push(method); if (method === "estimatesmartfee") assert.deepEqual(params, [3, "ECONOMICAL"]);
    const fields = { estimatesmartfee: estimate, getnetworkinfo: '"relayfee":0.00001000', getmempoolinfo: '"mempoolminfee":0.00001000' };
    assert(Object.hasOwn(fields, method), "No economic RPC is permitted by this observation fixture");
    return { raw: '{"result":{' + fields[method] + '},"error":null,"id":1}' };
  };
  const verifier = LocalNativeEvidenceVerifier.createMainnet({ rpc, executable: "/unused-unit-fixture" });
  verifier.verifyInputs = async value => {
    calls.push("independent-finality"); assert.equal(value.minimumConfirmations, 12);
    if (!finality) throw new Error("BELOW_NATIVE_FINALITY");
    return { digestHex: hash(22), acceptedCheckpoint: { protocol: "KINGPEPE_MAINNET_ACCEPTANCE_CHECKPOINT_V2",
      genesis: NATIVE_MAINNET_GENESIS, tipHash: hash(21), tipHeight: 100, chainworkHex: hash(23),
      minimumConfirmations: 1, transactionBlockHints: Object.fromEntries(value.inputs.map(i => [i.txid, hash(24)])), evidenceDigestHex: hash(22) } };
  };
  const options = { nativeRpc: rpc, nativeVerifier: verifier, policy,
    nativeFeePolicy: { policy: "DYNAMIC_NODE_ESTIMATE_WITH_CAP", minimumRelayAtomicPerKvB: "1000",
      maximumAtomicPerKvB: "10000", maximumFeeAtomic: policy.maximumFeeAtomic } };
  return { options, request, calls };
}

test("Mainnet observer explicitly binds source identity, twelve-confirmation evidence and exact operator-funded sweep fee", async () => {
  const f = observerFixture(), observer = NativeDepositObserver.createMainnet(f.options);
  assert.throws(() => new NativeDepositObserver(f.options));
  assert.throws(() => NativeDepositObserver.createMainnet({ ...f.options,
    nativeVerifier: new LocalNativeEvidenceVerifier({ rpc: f.options.nativeRpc, executable: "/unused-unit-fixture" }) }));
  assert.throws(() => NativeDepositObserver.createMainnet({ ...f.options, policy: { ...policy, csvDelayBlocks: 144 } }));
  const plan = await observer.observe(f.request);
  assert.equal(plan.inputs.length, 2); assert.equal(parseNativeTransactionHex(plan.unsignedTransactionHex).outputs[0].amountAtomic, deposit.amountAtomic);
  assert(plan.signingIntents.every(i => i.nativeNetwork === "mainnet" && i.nativeGenesisHash === NATIVE_MAINNET_GENESIS &&
    i.feeAtomic === "212" && i.purpose === "RESERVE_SWEEP" && i.amountAtomic === deposit.amountAtomic));
  assert.deepEqual(f.calls, ["identity", "independent-finality", "estimatesmartfee", "getnetworkinfo", "getmempoolinfo"]);
});

for (const [name, options, expected] of [
  ["wrong Native identity", { ready: false }, /NativeDepositRequestRejected/],
  ["eleven or fewer confirmations", { finality: false }, /BELOW_NATIVE_FINALITY/],
  ["missing normal estimate", { estimate: '"errors":["Insufficient data"],"blocks":0' }, /NativeFeeEstimateUnavailable/],
  ["excessive normal estimate", { estimate: '"feerate":0.00010001,"blocks":3' }, /NativeFeeOperatorReviewRequired/],
  ["underfunded operator fee", { feeAtomic: "211" }, /NativeSweepFeeFundingReviewRequired/],
  ["overfunded operator fee", { feeAtomic: "213" }, /NativeSweepFeeFundingReviewRequired/],
]) test("Mainnet sweep preparation holds safely on " + name, async () => {
  const f = observerFixture(options), observer = NativeDepositObserver.createMainnet(f.options);
  await assert.rejects(observer.observe(f.request), expected);
  assert(!f.calls.includes("sendrawtransaction"));
  if (options.ready === false || options.finality === false) assert(!f.calls.includes("estimatesmartfee"));
});

test("explicit Mainnet deposit request uses the approved CSV window and distinct Native address network", () => {
  const request = createMainnetNativeDepositRequest({ policy, ...deposit });
  assert.equal(request.recovery.csvDelayBlocks, 1440);
  assert.equal(request.minimumConfirmations, 12);
  assert(request.recovery.recovery.scriptHex.startsWith("02a005b269"));
  assert.equal(scriptFromWitnessAddress(request.depositAddress, "kpepe"), request.scriptPubKeyHex);
  assert.throws(() => scriptFromWitnessAddress(request.depositAddress));
  assert.throws(() => createNativeDepositRequest({ policy, ...deposit }));
  assert.deepEqual(createMainnetNativeDepositRequest({ policy, ...deposit }), request);
  for (const change of [{ amountAtomic: "99999" }, { recipient: key(9) }, { nonceHex: hash(9) }]) {
    assert.notEqual(createMainnetNativeDepositRequest({ policy, ...deposit, ...change }).operationId, request.operationId);
  }
  for (const change of [{ environment: "devnet" }, { solanaGenesis: SOLANA_DEVNET_GENESIS }, { mint: hash(10) },
    { nativeNetwork: 8000111 }, { minimumConfirmations: 11 }]) {
    assert.throws(() => createMainnetNativeDepositRequest({ policy: { ...policy, ...change }, ...deposit }));
  }
});

test("Mainnet recovery PSBT preserves the 1440-block sequence, user leaf and explicit network domain without signing", () => {
  const request = createMainnetNativeDepositRequest({ policy, ...deposit });
  const fundingTransactionHex = createUnsignedNativeTransaction({ inputs: [{ txid: hash(12), vout: 0 }],
    outputs: [{ amountAtomic: deposit.amountAtomic, scriptPubKeyHex: request.scriptPubKeyHex }] });
  const options = { depositPolicy: request.recovery, fundingTransactionHex, outputIndex: 0, amountAtomic: deposit.amountAtomic,
    destinationScriptPubKeyHex: "5120" + recovery, feeAtomic: "1000", maximumFeeAtomic: "1000",
    userKeyOrigin: { masterFingerprintHex: "01020304", derivationPath: "m/86'/0'/0'/0/3" } };
  const prepared = prepareMainnetRecoveryPsbt(options);
  const decoded = inspectUnsignedMainnetRecoveryPsbt(prepared.psbtBase64);
  const transaction = parseNativeTransactionHex(decoded.global["00"]);
  assert.equal(transaction.version, 2); assert.equal(transaction.inputs[0].sequence, 1440);
  assert.equal(transaction.outputs[0].amountAtomic, "99000");
  assert.equal(decoded.input["15" + request.recovery.recovery.controlBlockHex], request.recovery.recovery.scriptHex + "c0");
  assert.equal(decoded.input["15" + request.recovery.sweep.controlBlockHex], undefined);
  assert.equal(prepared.signingAuthorized, false); assert.equal(prepared.broadcastAuthorized, false);
  assert.equal(prepared.productionReady, false); assert.equal(prepared.walletSigningCompatibility, "NOT_VERIFIED");
  assert.throws(() => inspectUnsignedRecoveryPsbt(prepared.psbtBase64));
  assert.throws(() => prepareRegtestRecoveryPsbt(options));
  assert.throws(() => prepareMainnetRecoveryPsbt({ ...options, feeAtomic: "1001" }));
});
