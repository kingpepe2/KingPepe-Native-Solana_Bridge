// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Read-only Phase 08 reconciliation. Results are observations, not permission
// to sign, mint, change balances, clear a stop, or withdraw apparent surplus.
import { createHash } from "node:crypto";
import { canonicalJson, canonicalUintDecimal } from "../../native/frost/policy/native-signing-policy.mjs";
import { LocalNativeEvidenceVerifier, requireVerifiedRegtestChain, requireVerifiedRegtestReserve, verifiedReserveChain, observedSpentRegtestReserve } from "../../native/node/native-raw-evidence.mjs";
import { decodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";
import { validateDepositOperationPolicy, decodeDepositOperationState, depositOperationAccounting, depositOperationPolicyDigest, DEPOSIT_OPERATION_PROTOCOL } from "../bridge-validator/deposit-operation-state.mjs";
import { base58Decode, findProgramAddress, DEPOSIT_CLAIM_PDA_SEED_PREFIX } from "../bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { LocalDeploymentRpc, validateDeploymentManifest, verifyDeploymentSnapshot, deploymentAddresses, deploymentManifestDigest } from "../solana-observer/deployment-integrity.mjs";
import { decodeDepositClaimAccountBase64 } from "../solana-observer/solana-deposit-claim-observer.mjs";

export const DEPOSIT_RECONCILIATION_PROTOCOL = "KINGPEPE_DEPOSIT_RECONCILIATION_V1";
const check = (ok, code = "ReconciliationInputRejected") => { if (!ok) throw new Error(code); };
const digest = value => createHash("sha256").update(canonicalJson(value)).digest("hex");
const uint = value => BigInt(canonicalUintDecimal(value, "reconciliation amount"));
function u128(value) { check(typeof value === "string" && /^(0|[1-9][0-9]{0,38})$/u.test(value) && BigInt(value) <= (1n << 128n) - 1n); return BigInt(value); }
function contradiction(reason, evidence, affectedOperations = [], affectedReserveAtomic = "0") {
  const error = new Error("ReconciliationConfirmedContradiction");
  error.incident = Object.freeze({ reason, evidenceDigest: digest(evidence), affectedOperations: Object.freeze([...affectedOperations]), affectedReserveAtomic });
  throw error;
}

// Pure exact arithmetic. The service must obtain coherent independently
// observed inputs before calling this helper; these arguments are NOT proofs.
export function compareDepositAccounting(journal, observed) {
  const reserve = u128(journal.canonicalReserve), pending = u128(journal.authorizedUnmintedCredits), issued = u128(journal.mintedSupply);
  const actualReserve = u128(observed.canonicalReserve), supply = uint(observed.mintSupplyAtomic), manager = u128(observed.managerMintedAtomic), unpaid = u128(observed.burnedUnpaidAtomic);
  if (reserve !== pending + issued || actualReserve !== reserve || manager + unpaid !== issued || supply > manager)
    contradiction("ECONOMIC_SNAPSHOT_CONTRADICTION", { journal, observed });
  const required = supply + unpaid + pending;
  if (required > actualReserve) contradiction("RESERVE_DEFICIT", { journal, observed });
  // Direct SPL burns may lower supply without creating payout rights. Their
  // accounting difference is retained and is never operator-withdrawable here.
  const unclaimedBurnDifference = manager - supply;
  check(actualReserve - required === unclaimedBurnDifference);
  return Object.freeze({ canonicalReserve: actualReserve.toString(), mintedSupply: supply.toString(),
    authorizedUnmintedCredits: pending.toString(), burnedUnpaidWithdrawals: unpaid.toString(),
    coverageRequired: required.toString(), unclaimedDirectBurnDifference: unclaimedBurnDifference.toString(),
    operatorWithdrawalAuthorized: false });
}

export function validateReconciliationBinding(policy, manifest) {
  const p = validateDepositOperationPolicy(policy), m = validateDeploymentManifest(manifest);
  const h = value => Buffer.from(base58Decode(value)).toString("hex");
  check(p.nativeGenesis === m.nativeGenesisHex && p.solanaDeployment === m.solanaDeploymentHex && p.solanaGenesis === m.solanaGenesis &&
    p.managerProgramId === h(m.manager.id) && p.transceiverProgramId === h(m.transceiver.id) && p.mint === h(m.mint.id) &&
    p.policyEpoch === m.config.policyEpoch && p.keyEpoch === m.config.keyEpoch && p.protocolId === m.config.protocolId && p.nativeNetwork === m.config.nativeNetwork &&
    BigInt(p.minimumSolanaSlot) >= BigInt(m.minimumSlot) && m.mint.decimals === 8, "ReconciliationDeploymentBindingRejected");
  return { policy: p, manifest: m };
}
export function depositReconciliationClaimAddresses(operations, managerProgramId) {
  return operations.filter(op => op.finalizedCredit !== null).map(op => {
    const message = decodeCanonicalBridgeMessage(Buffer.from(op.finalizedCredit.encodedMessageHex, "hex"));
    return findProgramAddress([Buffer.from(DEPOSIT_CLAIM_PDA_SEED_PREFIX), Buffer.from(message.operationIdHex, "hex")], Buffer.from(managerProgramId, "hex")).base58;
  });
}

// One Solana bank must include Mint, counters, configuration and every claim.
// An already minted claim absent from the journal is catch-up work, NOT surplus
// or proof of an economic contradiction caused by a lost submission response.
export function verifyDepositClaimSnapshot(operations, policy, snapshot, manifest) {
  const { policy: p, manifest: m } = validateReconciliationBinding(policy, manifest);
  const credited = operations.filter(op => op.finalizedCredit !== null), count = deploymentAddresses(m).length;
  check(snapshot && Array.isArray(snapshot.accounts) && snapshot.accounts.length === count + credited.length, "ReconciliationSnapshotMalformed");
  const deployment = verifyDeploymentSnapshot(m, { ...snapshot, accounts: snapshot.accounts.slice(0, count) });
  // An old bank can predate a legitimate mint. Reject its age BEFORE treating
  // an absent account as loss; stale source data is not a confirmed deficit.
  check(BigInt(deployment.slot) >= BigInt(p.minimumSolanaSlot) && credited.every(op => op.mintReceipt === null ||
    BigInt(deployment.slot) >= BigInt(op.mintReceipt.rootSlot)), "ReconciliationSolanaSnapshotStale");
  let needsCatchup = false;
  for (const [index, op] of credited.entries()) {
    const account = snapshot.accounts[count + index], message = decodeCanonicalBridgeMessage(Buffer.from(op.finalizedCredit.encodedMessageHex, "hex"));
    if (account === null) {
      if (op.mintReceipt !== null) contradiction("FINALIZED_CLAIM_DISAPPEARED", { operationId: op.plan.operationId, slot: deployment.slot }, [op.plan.operationId], op.plan.depositIntent.amountAtomic);
      continue;
    }
    if (account.owner !== m.manager.id || account.executable !== false) contradiction("CLAIM_ACCOUNT_SUBSTITUTION", account, [op.plan.operationId]);
    check(Array.isArray(account.data) && account.data.length === 2 && account.data[1] === "base64", "ReconciliationClaimMalformed");
    const claim = decodeDepositClaimAccountBase64(account.data[0]);
    if (claim.operationIdHex !== message.operationIdHex || claim.messageDigestHex !== message.messageDigestHex ||
      claim.amountAtomic !== message.amountAtomic.toString() || claim.solanaRecipientHex !== message.destinationHex)
      contradiction("CLAIM_FACT_CHANGED", { claim, expected: op.finalizedCredit }, [op.plan.operationId], op.plan.depositIntent.amountAtomic);
    if (op.mintReceipt === null) needsCatchup = true;
  }
  return { deployment, needsCatchup };
}

// This reader performs real RPC + bounded Rust Native verification. It has no
// signing key, state mutation, transaction submission or integrity-clear path.
// The protected supervisor wrapper is responsible for durable stop reporting.
export async function readDepositReconciliation({ policy, manifest, operations, nativeVerifier, solanaRpc, minimumSlot }) {
  const { policy: p, manifest: m } = validateReconciliationBinding(policy, manifest);
  check(nativeVerifier instanceof LocalNativeEvidenceVerifier && solanaRpc instanceof LocalDeploymentRpc, "ReconciliationLiveSourcesRequired");
  const state = decodeDepositOperationState(Buffer.from(JSON.stringify({ protocol: DEPOSIT_OPERATION_PROTOCOL,
    policyDigest: depositOperationPolicyDigest(p), operations: structuredClone(operations) })), p);
  const before = await nativeVerifier.observeChain(); requireVerifiedRegtestChain(before);
  const affected = state.operations.filter(op => op.finalizedCredit &&
    [op.finalizedCredit.reserveBasis.deposit, op.finalizedCredit.reserveBasis.sweep].some(b => before.headerHashes[b.height] !== b.blockHash));
  if (affected.length) {
    if (affected.some(op => BigInt("0x" + before.chainworkHex) <= BigInt("0x" + op.finalizedCredit.reserveBasis.chainworkHex))) throw new Error("ReconciliationNativeChainChoiceUnresolved");
    contradiction("ACCEPTED_NATIVE_BASIS_INVALIDATED", { tipHash: before.tipHash, chainworkHex: before.chainworkHex, affected: affected.map(op => op.finalizedCredit.reserveBasis) },
      affected.map(op => op.plan.operationId).sort(), affected.reduce((n, op) => n + uint(op.plan.depositIntent.amountAtomic), 0n).toString());
  }
  let reserve = 0n;
  for (const op of state.operations) {
    const plan = op.plan;
    if (op.finalizedCredit === null) {
      // Unbroadcast signed data is still encumbered. Verified unspent inputs
      // permit safe admission; a mempool spend/outage/finality delay suspends it.
      const inputs = await nativeVerifier.verifyInputs({ inputs: plan.inputs, minimumConfirmations: p.minimumConfirmations, acceptedCheckpoint: plan.acceptedCheckpoint });
      check(inputs.currentTipHash === before.tipHash, "ReconciliationNativeSnapshotChanged");
      continue;
    }
    const credited = op.finalizedCredit;
    const receipt = await nativeVerifier.verifyReserve({ deposit: plan.inputs[0], feeInputs: plan.inputs.slice(1),
      sweepTxid: credited.reserveBasis.sweep.txid, reserveVout: 0, reserveScriptHex: credited.reserveBasis.reserveScriptHex,
      feeAtomic: plan.signingIntents[0].feeAtomic, minimumConfirmations: p.minimumConfirmations,
      tapscriptSpends: [plan.depositPolicy.sweep, ...plan.inputs.slice(1).map(() => undefined)], acceptedCheckpoint: credited.acceptedCheckpoint }).catch(error => {
        const spent = observedSpentRegtestReserve(error);
        if (spent !== undefined) {
          requireVerifiedRegtestChain(spent.chain);
          check(spent.chain.tipHash === before.tipHash, "ReconciliationNativeSnapshotChanged");
          check(canonicalJson({ ...spent.reserveBasis, chainworkHex: credited.reserveBasis.chainworkHex }) === canonicalJson(credited.reserveBasis), "ReconciliationReserveBasisChanged");
          contradiction("CANONICAL_RESERVE_SPENT_WITHOUT_SETTLEMENT", spent.reserveBasis, [plan.operationId], plan.depositIntent.amountAtomic);
        }
        throw error;
      });
    requireVerifiedRegtestReserve(receipt);
    check(verifiedReserveChain(receipt).tipHash === before.tipHash, "ReconciliationNativeSnapshotChanged");
    if (canonicalJson({ ...receipt.reserveBasis, chainworkHex: credited.reserveBasis.chainworkHex }) !== canonicalJson(credited.reserveBasis))
      contradiction("NATIVE_RESERVE_FACT_CHANGED", receipt.reserveBasis, [plan.operationId], plan.depositIntent.amountAtomic);
    reserve += uint(receipt.reserveBasis.amountAtomic);
  }
  const claims = depositReconciliationClaimAddresses(state.operations, p.managerProgramId);
  const snapshot = await solanaRpc.snapshotWithAdditionalAccounts(m, claims, minimumSlot ?? p.minimumSolanaSlot);
  const { deployment, needsCatchup } = verifyDepositClaimSnapshot(state.operations, p, snapshot, m);
  const after = await nativeVerifier.observeChain(); requireVerifiedRegtestChain(after);
  check(after.tipHash === before.tipHash && after.chainworkHex === before.chainworkHex, "ReconciliationNativeSnapshotChanged");
  if (needsCatchup) return Object.freeze({ state: "WAITING_FOR_DEPENDENCY", reason: "FINALIZED_MINT_JOURNAL_CATCHUP_REQUIRED" });
  const accounting = compareDepositAccounting(depositOperationAccounting(state, p), { ...deployment, canonicalReserve: reserve.toString() });
  return Object.freeze({ protocol: DEPOSIT_RECONCILIATION_PROTOCOL, state: "OBSERVED_MATCH", trust: "RPC_OBSERVATION_WITH_BOUNDED_NATIVE_HEADER_VALIDATION",
    policyDigest: depositOperationPolicyDigest(p), manifestDigest: deploymentManifestDigest(m), nativeTipHash: before.tipHash,
    nativeHeight: before.tipHeight, nativeChainworkHex: before.chainworkHex, solanaSlot: deployment.slot, solanaSnapshotDigest: deployment.snapshotDigest,
    evidenceDigest: digest({ nativeTip: before.tipHash, journal: state, deployment }), accounting });
}
