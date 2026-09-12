// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Durable-state validation, not a Native proof or a signing/minting authority.
import { createHash } from "node:crypto";
import { canonicalJson, canonicalUintDecimal, validateNativeSigningIntent } from "../../native/frost/policy/native-signing-policy.mjs";
import { REGTEST_GENESIS, verifyRegtestSweepSignatures } from "../../native/node/native-raw-evidence.mjs";
import { parseNativeTransactionHex, createLocalTaprootSighashEvidences } from "../../native/node/native-taproot-transaction.mjs";
import { validateRegtestRecoverableDepositIntent } from "../../native/recovery/taproot-deposit.mjs";
import { decodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";
import { ExactDepositLedger } from "./automatic-deposit-pipeline.mjs";
import { base58Decode, base58Encode } from "./solana-deposit-claim-transaction-plan.mjs";

export const DEPOSIT_OPERATION_PROTOCOL = "KINGPEPE_DEPOSIT_OPERATIONS_V1";
export const MAX_DEPOSIT_OPERATIONS = 64;
export const MAX_DEPOSIT_JOURNAL_BYTES = 900_000;
// The bounded Native evidence packet admits sixteen transactions, including
// the sweep itself. Reserve one slot before any input plan can be signed.
export const MAX_DEPOSIT_INPUTS = 15;
const HASH = /^[0-9a-f]{64}$/u, HEX = /^(?:[0-9a-f]{2})+$/u;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const check = (v, code = "DepositOperationRejected") => { if (!v) throw new Error(code); };
const fields = (v, names) => check(v && !Array.isArray(v) && Object.keys(v).sort().join() === [...names].sort().join());
const hash = v => { check(typeof v === "string" && HASH.test(v)); return v; };
const positive = (v, maximum = 0xffff_ffff) => { check(Number.isInteger(v) && v > 0 && v <= maximum); return v; };
const uint = v => BigInt(canonicalUintDecimal(v, "deposit operation atomic amount"));
function immutable(v) { for (const child of Object.values(v)) if (child && typeof child === "object") immutable(child); return Object.freeze(v); }

export function validateDepositOperationPolicy(input) {
  const p = structuredClone(input);
  fields(p, ["environment", "nativeGenesis", "solanaDeployment", "solanaGenesis", "minimumSolanaSlot", "managerProgramId", "transceiverProgramId", "mint", "protocolId",
    "nativeNetwork", "policyEpoch", "keyEpoch", "frostPublicKeyHex", "csvDelayBlocks", "minimumConfirmations", "maximumAmountAtomic", "maximumFeeAtomic"]);
  check(p.environment === "localnet" && p.nativeGenesis === REGTEST_GENESIS, "DepositOperationLocalnetOnly");
  check(typeof p.solanaGenesis === "string" && base58Decode(p.solanaGenesis).length === 32 && base58Encode(base58Decode(p.solanaGenesis)) === p.solanaGenesis);
  uint(p.minimumSolanaSlot);
  for (const k of ["solanaDeployment", "managerProgramId", "transceiverProgramId", "mint", "frostPublicKeyHex"]) hash(p[k]);
  for (const k of ["protocolId", "nativeNetwork", "policyEpoch", "keyEpoch"]) positive(p[k]);
  positive(p.csvDelayBlocks, 0xffff); positive(p.minimumConfirmations, 4096);
  check(uint(p.maximumAmountAtomic) > 0n); uint(p.maximumFeeAtomic);
  return immutable(p);
}
export function depositOperationPolicyDigest(policy) { return digest(canonicalJson(validateDepositOperationPolicy(policy))); }
function checkpoint(c) {
  fields(c, ["protocol", "genesis", "tipHash", "tipHeight", "chainworkHex", "minimumConfirmations", "evidenceDigestHex"]);
  check(c.protocol === "KINGPEPE_REGTEST_ACCEPTANCE_CHECKPOINT_V1" && c.genesis === REGTEST_GENESIS);
  positive(c.tipHeight, 4096); positive(c.minimumConfirmations, 4096); hash(c.tipHash); hash(c.chainworkHex); hash(c.evidenceDigestHex);
  check(BigInt("0x" + c.chainworkHex) > 0n);
}
export function validateDepositOperationPlan(input, policy) {
  const p = validateDepositOperationPolicy(policy), v = structuredClone(input);
  fields(v, ["operationId", "depositIntent", "depositPolicy", "inputs", "acceptedCheckpoint", "unsignedTransactionHex", "signingIntents"]);
  hash(v.operationId); checkpoint(v.acceptedCheckpoint);
  fields(v.depositIntent, ["nativeGenesisHex", "solanaDeploymentHex", "managerProgramIdHex", "transceiverProgramIdHex", "mintHex",
    "recipientHex", "nonceHex", "amountAtomic", "protocolId", "nativeNetwork", "policyEpoch", "keyEpoch"]);
  const d = v.depositIntent;
  for (const [field, expected] of Object.entries({ nativeGenesisHex: p.nativeGenesis, solanaDeploymentHex: p.solanaDeployment,
    managerProgramIdHex: p.managerProgramId, transceiverProgramIdHex: p.transceiverProgramId, mintHex: p.mint,
    protocolId: p.protocolId, nativeNetwork: p.nativeNetwork, policyEpoch: p.policyEpoch, keyEpoch: p.keyEpoch })) check(d[field] === expected);
  hash(d.recipientHex); hash(d.nonceHex); check(uint(d.amountAtomic) > 0n && uint(d.amountAtomic) <= uint(p.maximumAmountAtomic));
  check(Array.isArray(v.inputs) && v.inputs.length > 0 && v.inputs.length <= MAX_DEPOSIT_INPUTS, "DepositInputEvidenceCapacity");
  const reserveScript = "5120" + p.frostPublicKeyHex;
  let total = 0n;
  for (const [index, i] of v.inputs.entries()) {
    fields(i, ["txid", "vout", "amountAtomic", "scriptPubKeyHex", "minimumConfirmations"]); hash(i.txid);
    check(Number.isInteger(i.vout) && i.vout >= 0 && i.vout <= 0xffff_ffff); check(uint(i.amountAtomic) > 0n);
    positive(i.minimumConfirmations, 4096); check(typeof i.scriptPubKeyHex === "string" && /^5120[0-9a-f]{64}$/u.test(i.scriptPubKeyHex));
    if (index === 0) check(i.amountAtomic === d.amountAtomic && i.minimumConfirmations >= p.minimumConfirmations);
    else check(i.scriptPubKeyHex === reserveScript);
    total += uint(i.amountAtomic);
  }
  const depositPolicy = validateRegtestRecoverableDepositIntent({ intent: d, policy: v.depositPolicy,
    depositScriptPubKeyHex: v.inputs[0].scriptPubKeyHex, reserveScriptPubKeyHex: reserveScript,
    frostPublicKeyHex: p.frostPublicKeyHex, userRecoveryPublicKeyHex: v.depositPolicy.userRecoveryPublicKeyHex, csvDelayBlocks: p.csvDelayBlocks });
  // Reject extra/script metadata rather than retaining an unvalidated alternate.
  check(canonicalJson(depositPolicy) === canonicalJson(v.depositPolicy));
  const ids = v.inputs.map(i => i.txid + ":" + i.vout); check(new Set(ids).size === ids.length);
  check(typeof v.unsignedTransactionHex === "string" && HEX.test(v.unsignedTransactionHex) && v.unsignedTransactionHex.length <= 32_768);
  const tx = parseNativeTransactionHex(v.unsignedTransactionHex);
  check(tx.strippedHex === v.unsignedTransactionHex && tx.inputs.length === ids.length && tx.inputs.every((i, n) => i.outpoint === ids[n]));
  check(tx.inputs.every(i => i.scriptSigHex === "" && i.sequence >= 0xffff_fffe), "DepositSweepReplacementDisabled");
  check(tx.outputs.length === 1 && tx.outputs[0].scriptPubKeyHex === reserveScript && tx.outputs[0].amountAtomic === d.amountAtomic);
  const fee = total - uint(d.amountAtomic); check(fee >= 0n && fee <= uint(p.maximumFeeAtomic));
  const evidence = createLocalTaprootSighashEvidences({ unsignedNativeTransactionHex: v.unsignedTransactionHex,
    spentOutputs: v.inputs.map(i => ({ amountAtomic: i.amountAtomic, scriptPubKeyHex: i.scriptPubKeyHex })),
    tapscriptSpends: [depositPolicy.sweep, ...v.inputs.slice(1).map(() => undefined)], proofFingerprintHex: v.acceptedCheckpoint.evidenceDigestHex,
    reserveAmountAtomic: d.amountAtomic, nativeMinerFeeAtomic: fee.toString(), expectedRecipientScriptPubKeyHex: reserveScript, expectedChangeScriptPubKeyHex: reserveScript });
  check(Array.isArray(v.signingIntents) && v.signingIntents.length === ids.length);
  const requests = new Set();
  v.signingIntents = v.signingIntents.map((inputIntent, index) => {
    const i = validateNativeSigningIntent(inputIntent), e = evidence[index];
    check(!requests.has(i.signingRequestId)); requests.add(i.signingRequestId);
    for (const [field, expected] of Object.entries({ purpose: "RESERVE_SWEEP", nativeNetwork: "regtest", nativeGenesisHash: p.nativeGenesis,
      solanaDeployment: p.solanaDeployment, bridgeProgramId: p.managerProgramId, transceiverProgramId: p.transceiverProgramId, mint: p.mint,
      keyEpoch: p.keyEpoch, operationId: v.operationId, withdrawalId: "00".repeat(32), proofFingerprint: v.acceptedCheckpoint.evidenceDigestHex,
      unsignedNativeTransactionId: tx.txidHex, signingInputIndex: index, taprootSighashHex: e.taprootSighashHex, transactionCommitment: e.transactionCommitment,
      amountAtomic: d.amountAtomic, feeAtomic: fee.toString(), recipientScriptPubKeyHex: reserveScript, changeAtomic: "0", changeScriptPubKeyHex: reserveScript,
      reserveCommitment: e.reserveCommitment, pauseWithdrawals: false, hardStop: false })) check(i[field] === expected, "DepositSigningPlanSubstituted");
    check(canonicalJson(i.inputOutpoints) === canonicalJson(ids) && canonicalJson(i.outputCommitments) === canonicalJson(e.outputCommitments));
    return i;
  });
  return immutable(v);
}
function validateSigned(plan, signed) {
  check(typeof signed === "string" && HEX.test(signed) && signed.length <= 65_536);
  const tx = parseNativeTransactionHex(signed); check(tx.strippedHex === plan.unsignedTransactionHex, "DepositSignedTransactionChanged");
  verifyRegtestSweepSignatures({ sweep: tx, inputs: plan.inputs, tapscriptSpends: [plan.depositPolicy.sweep, ...plan.inputs.slice(1).map(() => undefined)],
    reserveScriptHex: plan.depositPolicy.canonicalReserveScriptPubKeyHex });
}
function validateFinalized(plan, fact, policy) {
  fields(fact, ["acceptedCheckpoint", "reserveBasis", "encodedMessageHex", "reserveAllocationIdHex"]);
  checkpoint(fact.acceptedCheckpoint); hash(fact.reserveAllocationIdHex);
  const b = fact.reserveBasis, tx = parseNativeTransactionHex(plan.unsignedTransactionHex);
  fields(b, ["genesis", "chainworkHex", "deposit", "sweep", "amountAtomic", "reserveScriptHex"]);
  check(b.genesis === REGTEST_GENESIS && b.amountAtomic === plan.depositIntent.amountAtomic && b.reserveScriptHex === plan.depositPolicy.canonicalReserveScriptPubKeyHex); hash(b.chainworkHex);
  for (const value of [b.deposit, b.sweep]) {
    fields(value, ["txid", "height", "blockHash", "vout"]); hash(value.txid); hash(value.blockHash); positive(value.height, 4096);
    check(Number.isInteger(value.vout) && value.vout >= 0 && value.vout <= 0xffff_ffff);
    check(fact.acceptedCheckpoint.tipHeight - value.height + 1 >= policy.minimumConfirmations);
  }
  check(b.deposit.txid === plan.inputs[0].txid && b.deposit.vout === plan.inputs[0].vout && b.sweep.txid === tx.txidHex && b.sweep.vout === 0 && b.sweep.height >= b.deposit.height);
  check(typeof fact.encodedMessageHex === "string" && /^[0-9a-f]{1028}$/u.test(fact.encodedMessageHex));
  const m = decodeCanonicalBridgeMessage(Buffer.from(fact.encodedMessageHex, "hex")), d = plan.depositIntent;
  check(m.action === "DepositClaim" && m.direction === "NativeToSolana" && m.amountAtomic.toString() === d.amountAtomic && m.feeAtomic === 0n &&
    m.depositOutpointText === plan.inputs[0].txid + ":" + plan.inputs[0].vout && m.destinationHex === d.recipientHex && m.policyEpoch === policy.policyEpoch && m.keyEpoch === policy.keyEpoch);
  for (const [field, expected] of Object.entries({ nativeGenesis: policy.nativeGenesis, solanaDeployment: policy.solanaDeployment,
    managerProgramId: policy.managerProgramId, transceiverProgramId: policy.transceiverProgramId, mint: policy.mint })) check(Buffer.from(m.deployment[field]).toString("hex") === expected);
  check(m.deployment.protocolId === policy.protocolId && m.deployment.nativeNetwork === policy.nativeNetwork);
}
function validateMintReceipt(plan, credit, receipt, policy) {
  fields(receipt, ["signature", "slot", "rootSlot", "genesis", "operationId", "messageDigest", "amountAtomic", "recipientHex", "mint"]);
  check(typeof receipt.signature === "string" && base58Decode(receipt.signature).length === 64 && base58Encode(base58Decode(receipt.signature)) === receipt.signature);
  check(uint(receipt.slot) >= uint(policy.minimumSolanaSlot) && uint(receipt.rootSlot) >= uint(receipt.slot) && receipt.genesis === policy.solanaGenesis);
  const m = decodeCanonicalBridgeMessage(Buffer.from(credit.encodedMessageHex, "hex"));
  check(receipt.operationId === m.operationIdHex && receipt.messageDigest === m.messageDigestHex && receipt.amountAtomic === plan.depositIntent.amountAtomic &&
    receipt.recipientHex === plan.depositIntent.recipientHex && receipt.mint === policy.mint);
}
export function initialDepositOperationState(policy) {
  return Buffer.from(JSON.stringify({ protocol: DEPOSIT_OPERATION_PROTOCOL, policyDigest: depositOperationPolicyDigest(policy), operations: [] }));
}
export function decodeDepositOperationState(bytes, policy) {
  const p = validateDepositOperationPolicy(policy); check(bytes instanceof Uint8Array && bytes.length <= MAX_DEPOSIT_JOURNAL_BYTES);
  const text = Buffer.from(bytes).toString("utf8"), state = JSON.parse(text); check(JSON.stringify(state) === text);
  fields(state, ["protocol", "policyDigest", "operations"]);
  check(state.protocol === DEPOSIT_OPERATION_PROTOCOL && state.policyDigest === depositOperationPolicyDigest(p));
  check(Array.isArray(state.operations) && state.operations.length <= MAX_DEPOSIT_OPERATIONS);
  const ids = new Set(), outpoints = new Set(), requests = new Set(), reserveOutputs = new Set(), ledger = new ExactDepositLedger();
  for (const record of state.operations) {
    fields(record, ["plan", "signedTransactionHex", "broadcastAttempted", "broadcastAccepted", "finalizedCredit", "mintReceipt"]);
    const plan = validateDepositOperationPlan(record.plan, p); check(!ids.has(plan.operationId)); ids.add(plan.operationId);
    for (const input of plan.inputs) { const id = input.txid + ":" + input.vout; check(!outpoints.has(id), "DepositInputAlreadyReserved"); outpoints.add(id); }
    const reserveOutput = parseNativeTransactionHex(plan.unsignedTransactionHex).txidHex + ":0";
    check(!reserveOutputs.has(reserveOutput), "DepositReserveAllocationReused"); reserveOutputs.add(reserveOutput);
    for (const intent of plan.signingIntents) { check(!requests.has(intent.signingRequestId)); requests.add(intent.signingRequestId); }
    for (const name of ["broadcastAttempted", "broadcastAccepted"]) check(typeof record[name] === "boolean");
    if (record.signedTransactionHex !== null) validateSigned(plan, record.signedTransactionHex);
    check(!record.broadcastAttempted || record.signedTransactionHex !== null);
    check(!record.broadcastAccepted || record.broadcastAttempted);
    if (record.finalizedCredit !== null) {
      check(record.broadcastAttempted); validateFinalized(plan, record.finalizedCredit, p);
      ledger.recordValidatedDeposit(record.finalizedCredit);
      if (record.mintReceipt !== null) { validateMintReceipt(plan, record.finalizedCredit, record.mintReceipt, p);
        ledger.recordMint({ ...record.finalizedCredit, mintedAmountAtomic: plan.depositIntent.amountAtomic }); }
    } else check(record.mintReceipt === null);
  }
  // Prior/current bridge backing is never a subsequent user's miner-fee input.
  // Check after collecting all operations so record ordering cannot evade it.
  check([...outpoints].every(id => !reserveOutputs.has(id)), "DepositBackingCannotFundFees");
  return state;
}
export function depositOperationAccounting(state, policy) {
  const v = decodeDepositOperationState(Buffer.from(JSON.stringify(state)), policy), ledger = new ExactDepositLedger();
  let encumbered = 0n;
  for (const op of v.operations) {
    if (op.finalizedCredit !== null) {
      ledger.recordValidatedDeposit(op.finalizedCredit);
      if (op.mintReceipt !== null) ledger.recordMint({ ...op.finalizedCredit, mintedAmountAtomic: op.plan.depositIntent.amountAtomic });
    } else if (op.signedTransactionHex !== null) encumbered += uint(op.plan.depositIntent.amountAtomic);
  }
  // Encumbered, unresolved sweeps are NOT free surplus or mint authorization.
  // Actual on-chain snapshots and outcome catch-up are required for reconciliation.
  return Object.freeze({ ...ledger.snapshot(), unresolvedSignedSweepAmount: encumbered.toString(),
    reservedInputCount: v.operations.reduce((n, op) => n + op.plan.inputs.length, 0) });
}
