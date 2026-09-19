// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { base58 } from "@scure/base";
import { nativeIdentity, isMainnetBinding, NATIVE_MAINNET_GENESIS, NATIVE_MAINNET_DOMAIN,
  NATIVE_REGTEST_GENESIS, SOLANA_MAINNET_GENESIS, SOLANA_DEVNET_GENESIS, mainnetRpcEndpoint, assertMainnetSolanaGenesis, mainnetDeploymentIdentity } from "../../../shared/network-identity.mjs";
import { readNativeFeeObservation, quoteNativeMinerFee, nativeTransactionWeight, validateNativeFeePolicy, nativePlannedTransactionWeight, verifyNativeTransactionFee } from "../native-fee-policy.mjs";
import { createUnsignedNativeTransaction, attachTaprootWitnesses } from "../native-taproot-transaction.mjs";
import { deriveRegtestDepositCommitment, deriveMainnetDepositCommitment, buildRegtestRecoverableDeposit,
  buildMainnetRecoverableDeposit, validateMainnetRecoverableDepositIntent } from "../../recovery/taproot-deposit.mjs";
import { validateDepositOperationPolicy } from "../../../services/bridge-validator/deposit-operation-state.mjs";

test("production identity binds actual Native and Solana genesis, never labels alone", () => {
  const binding = { environment: "mainnet", nativeGenesis: NATIVE_MAINNET_GENESIS, nativeNetwork: NATIVE_MAINNET_DOMAIN, solanaGenesis: SOLANA_MAINNET_GENESIS };
  assert(isMainnetBinding(binding));
  for (const mutation of [{ environment: "devnet" }, { nativeGenesis: NATIVE_REGTEST_GENESIS }, { nativeNetwork: 8000111 }, { solanaGenesis: SOLANA_DEVNET_GENESIS }]) assert(!isMainnetBinding({ ...binding, ...mutation }));
  assert.equal(nativeIdentity("mainnet").hrp, "kpepe"); assert.equal(nativeIdentity("devnet").hrp, "rkpepe");
  assert.throws(() => nativeIdentity(undefined)); assert.throws(() => nativeIdentity("mainnet-beta"));
  assert.equal(mainnetRpcEndpoint("https://example.invalid/rpc", SOLANA_MAINNET_GENESIS), "https://example.invalid/rpc");
  assert.throws(() => mainnetRpcEndpoint("http://example.invalid/rpc", SOLANA_MAINNET_GENESIS));
  assert.throws(() => mainnetRpcEndpoint("https://example.invalid/rpc", SOLANA_DEVNET_GENESIS));
  assert.throws(() => assertMainnetSolanaGenesis(SOLANA_DEVNET_GENESIS));
});

const policy = { policy: "DYNAMIC_NODE_ESTIMATE_WITH_CAP", minimumRelayAtomicPerKvB: "1000", maximumAtomicPerKvB: "10000", maximumFeeAtomic: "5000" };
const raw = fields => '{"result":{' + fields + '},"error":null,"id":1}';
const observation = () => readNativeFeeObservation({ estimateRaw: raw('"feerate":0.00002000,"blocks":3'), networkRaw: raw('"relayfee":0.00001000'), mempoolRaw: raw('"mempoolminfee":0.00001000') });
test("dynamic miner fee uses integer tokens, actual vsize and ceil without a fixed fallback", () => {
  const observed = observation(); assert.equal(observed.estimatedAtomicPerKvB, "2000");
  assert.equal(quoteNativeMinerFee({ policy, observation: observed, virtualBytes: "141" }).feeAtomic, "282");
  assert.equal(quoteNativeMinerFee({ policy, observation: { ...observed, estimatedAtomicPerKvB: "1001" }, virtualBytes: "141" }).feeAtomic, "142");
  assert.equal(quoteNativeMinerFee({ policy, observation: { ...observed, estimatedAtomicPerKvB: "1" }, virtualBytes: "141" }).feeAtomic, "141");
  assert.throws(() => readNativeFeeObservation({ estimateRaw: raw('"errors":["Insufficient data"],"blocks":0'), networkRaw: raw('"relayfee":0.00001000'), mempoolRaw: raw('"mempoolminfee":0.00001000') }), /NativeFeeEstimateUnavailable/);
  assert.throws(() => readNativeFeeObservation({ estimateRaw: raw('"feerate":0.000000001,"blocks":3'), networkRaw: raw('"relayfee":0.00001000'), mempoolRaw: raw('"mempoolminfee":0.00001000') }));
  assert.throws(() => readNativeFeeObservation({ estimateRaw: '{private diagnostic', networkRaw: '{}', mempoolRaw: '{}' }), /^Error: NativeFeeObservationRejected$/);
});
test("excessive estimates, fee totals and malformed policies require review, never overpay", () => {
  assert.throws(() => quoteNativeMinerFee({ policy, observation: { ...observation(), estimatedAtomicPerKvB: "10001" }, virtualBytes: "141" }), /NativeFeeOperatorReviewRequired/);
  assert.throws(() => quoteNativeMinerFee({ policy, observation: observation(), virtualBytes: "2501" }), /NativeFeeOperatorReviewRequired/);
  for (const value of ["1.5", "-1", "01", 1, "18446744073709551616"]) assert.throws(() => validateNativeFeePolicy({ ...policy, maximumFeeAtomic: value }));
  const tx = createUnsignedNativeTransaction({ inputs: [{ txid: "01".repeat(32), vout: 0 }], outputs: [{ amountAtomic: "1", scriptPubKeyHex: "5120" + "02".repeat(32) }] });
  assert.deepEqual(nativeTransactionWeight(tx), { weight: String(tx.length * 2), virtualBytes: String(tx.length / 2) });
});



const h = text => createHash("sha256").update(text).digest("hex");
const point = p => Buffer.from(p.toBytes()).subarray(1).toString("hex");
const frost = point(secp256k1.Point.BASE), recovery = point(secp256k1.Point.BASE.double());
function deployment() {
  const keys = { manager: h("mainnet-public-manager-fixture"), transceiver: h("mainnet-public-transceiver-fixture"), mint: h("mainnet-public-mint-fixture") };
  return { protocolId: 1, nativeNetwork: NATIVE_MAINNET_DOMAIN, nativeGenesis: NATIVE_MAINNET_GENESIS,
    solanaDeployment: mainnetDeploymentIdentity(Object.fromEntries(Object.entries(keys).map(([k,v]) => [k,base58.encode(Buffer.from(v,"hex"))]))),
    managerProgramId: keys.manager, transceiverProgramId: keys.transceiver, mint: keys.mint };
}
function depositIntent() {
  const d = deployment(); return { protocolId: d.protocolId, nativeNetwork: d.nativeNetwork, policyEpoch: 1, keyEpoch: 1,
    nativeGenesisHex: d.nativeGenesis, solanaDeploymentHex: d.solanaDeployment, managerProgramIdHex: d.managerProgramId,
    transceiverProgramIdHex: d.transceiverProgramId, mintHex: d.mint, recipientHex: h("recipient"), nonceHex: h("nonce"), amountAtomic: "100000" };
}
function recoveryPolicy() {
  return buildMainnetRecoverableDeposit({ nativeGenesisHex: NATIVE_MAINNET_GENESIS, depositCommitmentHex: deriveMainnetDepositCommitment(depositIntent()),
    frostPublicKeyHex: frost, userRecoveryPublicKeyHex: recovery, csvDelayBlocks: 144 }); // Isolated fixture, not a production CSV decision.
}

test("Mainnet recovery script binds the full deployment and cannot enter retained REGTEST constructors", () => {
  const intent = depositIntent(), p = recoveryPolicy();
  assert.equal(p.environment, "mainnet"); assert.throws(() => deriveRegtestDepositCommitment(intent)); assert.throws(() => buildRegtestRecoverableDeposit(p));
  const options = { intent, policy: p, depositScriptPubKeyHex: p.scriptPubKeyHex, reserveScriptPubKeyHex: p.canonicalReserveScriptPubKeyHex,
    frostPublicKeyHex: frost, userRecoveryPublicKeyHex: recovery, csvDelayBlocks: p.csvDelayBlocks };
  assert.deepEqual(validateMainnetRecoverableDepositIntent(options), p);
  for (const field of ["nativeGenesisHex", "solanaDeploymentHex", "managerProgramIdHex", "transceiverProgramIdHex", "mintHex"])
    assert.throws(() => deriveMainnetDepositCommitment({ ...intent, [field]: h("substitution") }));
  for (const change of [{ amountAtomic: "99999" }, { recipientHex: h("other-recipient") }, { nonceHex: h("other-nonce") }])
    assert.throws(() => validateMainnetRecoverableDepositIntent({ ...options, intent: { ...intent, ...change } }));
  assert.throws(() => validateMainnetRecoverableDepositIntent({ ...options, policy: { ...p, localOnly: true } }));
});

test("Mainnet deposit policy enforces 12 confirmations and the unbounded wire range without importing TEST caps", () => {
  const p = { ...deployment(), environment: "mainnet", solanaGenesis: SOLANA_MAINNET_GENESIS, minimumSolanaSlot: "1", policyEpoch: 1, keyEpoch: 1,
    frostPublicKeyHex: frost, csvDelayBlocks: 144, minimumConfirmations: 12, maximumAmountAtomic: "18446744073709551615", maximumFeeAtomic: "10000" };
  assert.deepEqual(validateDepositOperationPolicy(p), p);
  for (const changes of [{ minimumConfirmations: 11 }, { maximumAmountAtomic: "100000" }, { maximumFeeAtomic: "0" },
    { solanaGenesis: SOLANA_DEVNET_GENESIS }, { nativeNetwork: 8_000_111 }, { mint: h("other-mint") }])
    assert.throws(() => validateDepositOperationPolicy({ ...p, ...changes }));
});



test("sweep fee measurement includes script, public preimage and control block; actual fee must match the quote", () => {
  const p = recoveryPolicy(), spentOutputs = [{ amountAtomic: "100000", scriptPubKeyHex: p.scriptPubKeyHex },
    { amountAtomic: "1000", scriptPubKeyHex: p.canonicalReserveScriptPubKeyHex }];
  const unsignedTransactionHex = createUnsignedNativeTransaction({ inputs: spentOutputs.map((_,vout)=>({txid:h("fee-input"),vout})),
    outputs:[{amountAtomic:"100000",scriptPubKeyHex:p.canonicalReserveScriptPubKeyHex}] });
  const options={unsignedTransactionHex,spentOutputs,tapscriptSpends:[p.sweep,undefined]};
  const projected=nativePlannedTransactionWeight(options);
  const packet=attachTaprootWitnesses({unsignedNativeTransactionHex:unsignedTransactionHex,spentOutputs,tapscriptSpends:options.tapscriptSpends,signatures:["00".repeat(64),"00".repeat(64)]});
  assert.deepEqual(projected,nativeTransactionWeight(packet.rawSignedTransactionHex));
  assert(BigInt(projected.virtualBytes)>BigInt(nativePlannedTransactionWeight({unsignedTransactionHex}).virtualBytes));
  const quote={policy:"DYNAMIC_NODE_ESTIMATE_WITH_CAP",virtualBytes:projected.virtualBytes,feeAtomic:"1000"};
  assert.equal(verifyNativeTransactionFee({signedTransactionHex:packet.rawSignedTransactionHex,inputAmountsAtomic:["100000","1000"],quote}).feeAtomic,"1000");
  for(const mutation of [{feeAtomic:"999"},{virtualBytes:(BigInt(projected.virtualBytes)-1n).toString()}])
    assert.throws(()=>verifyNativeTransactionFee({signedTransactionHex:packet.rawSignedTransactionHex,inputAmountsAtomic:["100000","1000"],quote:{...quote,...mutation}}),/NativeFeeTransactionMismatch/);
});
