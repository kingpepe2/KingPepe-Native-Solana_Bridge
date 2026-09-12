// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Observe a user's broadcast transaction for a registered public deposit intent.
// No wallet access, mining, approval queue or duplicate Native proof engine.
import { createHash } from "node:crypto";
import { NativeRpcClient } from "../../native/node/native-rpc-client.mjs";
import { LocalNativeEvidenceVerifier } from "../../native/node/native-raw-evidence.mjs";
import { createUnsignedNativePayout, parseNativeTransactionHex, createLocalTaprootSighashEvidences } from "../../native/node/native-taproot-transaction.mjs";
import { buildRegtestRecoverableDeposit, deriveRegtestDepositCommitment } from "../../native/recovery/taproot-deposit.mjs";
import { validateDepositOperationPolicy, validateDepositOperationPlan } from "./deposit-operation-state.mjs";
import { prepareLocalNativeReserveSweepSigningIntent } from "./native-reserve-sweep-signing-intent.mjs";
const check = v => { if (!v) throw new Error("NativeDepositRequestRejected"); };
const hash = v => typeof v === "string" && /^[0-9a-f]{64}$/u.test(v);
const uint = v => { check(typeof v === "string" && /^(0|[1-9][0-9]{0,19})$/u.test(v) && BigInt(v) <= 0xffffffffffffffffn); return BigInt(v); };
export function validateNativeDepositRequest(input, policy) {
  const p = validateDepositOperationPolicy(policy), r = structuredClone(input);
  check(r && Object.keys(r).sort().join() === "depositIntent,depositTxidHex,depositVout,feeFundingInputs,operationId,userRecoveryPublicKeyHex");
  check(hash(r.operationId) && hash(r.depositTxidHex) && hash(r.userRecoveryPublicKeyHex));
  check(r.depositVout === null || Number.isInteger(r.depositVout) && r.depositVout >= 0 && r.depositVout <= 0xffffffff);
  const d = r.depositIntent;
  check(d && Object.keys(d).sort().join() === "amountAtomic,keyEpoch,managerProgramIdHex,mintHex,nativeGenesisHex,nativeNetwork,nonceHex,policyEpoch,protocolId,recipientHex,solanaDeploymentHex,transceiverProgramIdHex");
  for (const [k, value] of Object.entries({ nativeGenesisHex: p.nativeGenesis, solanaDeploymentHex: p.solanaDeployment,
    managerProgramIdHex: p.managerProgramId, transceiverProgramIdHex: p.transceiverProgramId, mintHex: p.mint,
    nativeNetwork: p.nativeNetwork, protocolId: p.protocolId, policyEpoch: p.policyEpoch, keyEpoch: p.keyEpoch })) check(d[k] === value);
  check(hash(d.nonceHex) && hash(d.recipientHex) && uint(d.amountAtomic) > 0n && uint(d.amountAtomic) <= uint(p.maximumAmountAtomic));
  check(Array.isArray(r.feeFundingInputs) && r.feeFundingInputs.length <= 7);
  let fees = 0n; const outpoints = new Set();
  for (const i of r.feeFundingInputs) {
    check(i && Object.keys(i).sort().join() === "amountAtomic,minimumConfirmations,scriptPubKeyHex,txid,vout");
    check(hash(i.txid) && Number.isInteger(i.vout) && i.vout >= 0 && i.vout <= 0xffffffff &&
      i.scriptPubKeyHex === "5120" + p.frostPublicKeyHex && Number.isInteger(i.minimumConfirmations) && i.minimumConfirmations > 0 && i.minimumConfirmations <= 4096);
    check(uint(i.amountAtomic) > 0n && !outpoints.has(i.txid + ":" + i.vout)); outpoints.add(i.txid + ":" + i.vout); fees += uint(i.amountAtomic);
  }
  check(fees <= uint(p.maximumFeeAtomic));
  // Validate curve points, script commitment and recovery parameters at intake.
  depositPolicy(r, p); return r;
}
function depositPolicy(r, p) { return buildRegtestRecoverableDeposit({ nativeGenesisHex: p.nativeGenesis,
  depositCommitmentHex: deriveRegtestDepositCommitment(r.depositIntent), frostPublicKeyHex: p.frostPublicKeyHex,
  userRecoveryPublicKeyHex: r.userRecoveryPublicKeyHex, csvDelayBlocks: p.csvDelayBlocks }); }

export class NativeDepositObserver {
  #rpc; #verifier; #policy;
  constructor({ nativeRpc, nativeVerifier, policy }) {
    check(nativeRpc instanceof NativeRpcClient && nativeVerifier instanceof LocalNativeEvidenceVerifier);
    this.#rpc = nativeRpc; this.#verifier = nativeVerifier; this.#policy = validateDepositOperationPolicy(policy);
  }
  async observe(input) {
    const p = this.#policy, r = validateNativeDepositRequest(input, p), script = depositPolicy(r, p);
    const tx = parseNativeTransactionHex(await this.#rpc.getRawTransaction(r.depositTxidHex, false));
    check(tx.txidHex === r.depositTxidHex);
    const matches = tx.outputs.map((o, vout) => ({ ...o, vout })).filter(o =>
      (r.depositVout === null || r.depositVout === o.vout) && o.amountAtomic === r.depositIntent.amountAtomic && o.scriptPubKeyHex === script.scriptPubKeyHex);
    check(matches.length === 1);
    const inputs = [{ txid: tx.txidHex, vout: matches[0].vout, amountAtomic: r.depositIntent.amountAtomic,
      scriptPubKeyHex: script.scriptPubKeyHex, minimumConfirmations: p.minimumConfirmations }, ...r.feeFundingInputs];
    const evidence = await this.#verifier.verifyInputs({ inputs, minimumConfirmations: p.minimumConfirmations });
    const unsignedTransactionHex = createUnsignedNativePayout({ inputs, outputs: [{ amountAtomic: r.depositIntent.amountAtomic,
      scriptPubKeyHex: script.canonicalReserveScriptPubKeyHex }] });
    const feeAtomic = r.feeFundingInputs.reduce((n, i) => n + BigInt(i.amountAtomic), 0n).toString();
    const sighashes = createLocalTaprootSighashEvidences({ unsignedNativeTransactionHex: unsignedTransactionHex,
      spentOutputs: inputs.map(i => ({ amountAtomic: i.amountAtomic, scriptPubKeyHex: i.scriptPubKeyHex })),
      tapscriptSpends: [script.sweep, ...r.feeFundingInputs.map(() => undefined)], proofFingerprintHex: evidence.digestHex,
      reserveAmountAtomic: r.depositIntent.amountAtomic, nativeMinerFeeAtomic: feeAtomic,
      expectedRecipientScriptPubKeyHex: script.canonicalReserveScriptPubKeyHex, expectedChangeScriptPubKeyHex: script.canonicalReserveScriptPubKeyHex });
    const depositOutpoint = inputs[0].txid + ":" + inputs[0].vout;
    const signingIntents = sighashes.map(nativeSighashEvidence => prepareLocalNativeReserveSweepSigningIntent({ operationIdHex: r.operationId,
      config: { environment: "localnet", nativeNetworkName: "regtest", nativeGenesisHash: p.nativeGenesis, solanaDeployment: p.solanaDeployment,
        bridgeProgramId: p.managerProgramId, transceiverProgramId: p.transceiverProgramId, mint: p.mint, keyEpoch: p.keyEpoch,
        maxAmountAtomic: p.maximumAmountAtomic, maxFeeAtomic: p.maximumFeeAtomic },
      deposit: { depositOutpoint, amountAtomic: r.depositIntent.amountAtomic, proofFingerprintHex: evidence.digestHex, finalitySatisfied: true, utxoUnspent: true },
      reserveSweepDraft: { state: "UNSIGNED_DRAFT_ONLY", signed: false, broadcast: false, depositOutpoint,
        feeFundingOutpoints: r.feeFundingInputs.map(i => i.txid + ":" + i.vout), reserveAmountAtomic: r.depositIntent.amountAtomic,
        nativeMinerFeeAtomic: feeAtomic, unsignedNativeTransactionFingerprintHex: createHash("sha256").update(Buffer.from(unsignedTransactionHex, "hex")).digest("hex"),
        proofFingerprintHex: evidence.digestHex }, nativeSighashEvidence }).signingIntent);
    return validateDepositOperationPlan({ operationId: r.operationId, depositIntent: r.depositIntent, depositPolicy: script,
      inputs, acceptedCheckpoint: evidence.acceptedCheckpoint, unsignedTransactionHex, signingIntents }, p);
  }
}
