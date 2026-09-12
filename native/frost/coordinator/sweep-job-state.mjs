// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Durable work identity, not Native evidence or an economic authorization.
import { createHash } from "node:crypto";
import { bridgeInputDigest } from "../../../shared/protocol/bridge-inputs.mjs";
import { canonicalJson, nativeSigningIntentDigest, validateNativeSigningIntent } from "../policy/native-signing-policy.mjs";
import { validateDepositOperationPolicy, depositOperationPolicyDigest, MAX_DEPOSIT_INPUTS } from "../../../services/bridge-validator/deposit-operation-state.mjs";

export const SWEEP_JOB_PROTOCOL = "KINGPEPE_PROTECTED_SWEEP_JOBS_V1";
export const MAX_SWEEP_JOBS = 256;
export const MAX_SWEEP_JOB_ATTEMPTS = 32;
const check = (value, code = "SweepJobStateRejected") => { if (!value) throw new Error(code); };
const fields = (v, names) => check(v && !Array.isArray(v) && Object.keys(v).sort().join() === [...names].sort().join());
export const sweepJobDigest = value => createHash("sha256").update(canonicalJson(value)).digest("hex");
export function validateSweepJobIntent(input, policy) {
  const p = validateDepositOperationPolicy(policy), intent = validateNativeSigningIntent(input);
  check(canonicalJson(input) === canonicalJson(intent), "SweepJobNoncanonicalIntent");
  const expected = { purpose: "RESERVE_SWEEP", nativeNetwork: "regtest", nativeGenesisHash: p.nativeGenesis,
    solanaDeployment: p.solanaDeployment, bridgeProgramId: p.managerProgramId, transceiverProgramId: p.transceiverProgramId,
    mint: p.mint, keyEpoch: p.keyEpoch, withdrawalId: "00".repeat(32), recipientScriptPubKeyHex: "5120" + p.frostPublicKeyHex,
    changeScriptPubKeyHex: "5120" + p.frostPublicKeyHex, changeAtomic: "0", pauseWithdrawals: false, hardStop: false };
  for (const [name, value] of Object.entries(expected)) check(intent[name] === value, "SweepJobContextRejected");
  check(intent.inputOutpoints.length <= MAX_DEPOSIT_INPUTS && intent.outputCommitments.length === 1 &&
    BigInt(intent.amountAtomic) <= BigInt(p.maximumAmountAtomic) && BigInt(intent.feeAtomic) <= BigInt(p.maximumFeeAtomic), "SweepJobLimitsRejected");
  check(Buffer.byteLength(JSON.stringify(intent)) <= 16384, "SweepJobSizeRejected");
  return intent;
}
export function sweepJobId(intent, policy) {
  const i = validateSweepJobIntent(intent, policy);
  return bridgeInputDigest("SweepJobIdentity", { protocol: SWEEP_JOB_PROTOCOL, policyDigest: depositOperationPolicyDigest(policy),
    signingRequestId: i.signingRequestId, intentDigest: nativeSigningIntentDigest(i) });
}
export function initialSweepJobState(policy) {
  return Buffer.from(JSON.stringify({ protocol: SWEEP_JOB_PROTOCOL, policyDigest: depositOperationPolicyDigest(policy), lastTimeMs: 0, jobs: [] }));
}
export function decodeSweepJobState(bytes, policy, now = Date.now()) {
  check(bytes instanceof Uint8Array && bytes.length <= 900000);
  const text = Buffer.from(bytes).toString("utf8"), v = JSON.parse(text); check(JSON.stringify(v) === text);
  fields(v, ["protocol", "policyDigest", "lastTimeMs", "jobs"]);
  check(v.protocol === SWEEP_JOB_PROTOCOL && v.policyDigest === depositOperationPolicyDigest(policy));
  check(Number.isSafeInteger(now) && now > 0 && Number.isSafeInteger(v.lastTimeMs) && v.lastTimeMs >= 0 && v.lastTimeMs <= now);
  check(Array.isArray(v.jobs) && v.jobs.length <= MAX_SWEEP_JOBS);
  const ids = new Set(), requests = new Set(), inputs = new Set(), operations = new Map();
  for (const job of v.jobs) {
    fields(job, ["jobId", "intent", "attempts", "lastAttemptAt", "retryAfter", "completed"]);
    const i = validateSweepJobIntent(job.intent, policy);
    check(job.jobId === sweepJobId(i, policy) && !ids.has(job.jobId) && !requests.has(i.signingRequestId));
    ids.add(job.jobId); requests.add(i.signingRequestId);
    const input = i.inputOutpoints[i.signingInputIndex]; check(!inputs.has(input), "SweepJobInputAlreadyBound"); inputs.add(input);
    const binding = canonicalJson([i.unsignedNativeTransactionId, i.inputOutpoints, i.outputCommitments, i.amountAtomic, i.feeAtomic, i.proofFingerprint]);
    check(!operations.has(i.operationId) || operations.get(i.operationId) === binding, "SweepJobOperationChanged"); operations.set(i.operationId, binding);
    check(Number.isInteger(job.attempts) && job.attempts >= 0 && job.attempts <= MAX_SWEEP_JOB_ATTEMPTS && typeof job.completed === "boolean");
    check(Number.isSafeInteger(job.lastAttemptAt) && job.lastAttemptAt >= 0 && job.lastAttemptAt <= v.lastTimeMs);
    check(Number.isSafeInteger(job.retryAfter) && job.retryAfter >= job.lastAttemptAt && job.retryAfter <= job.lastAttemptAt + 30000);
    check(job.attempts === 0 ? job.lastAttemptAt === 0 && job.retryAfter === 0 && !job.completed : job.lastAttemptAt > 0);
  }
  return v;
}
