import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  bytesToHex,
  decodeCanonicalBridgeMessage,
  DEPLOYMENT_IDENTITY_LENGTH,
  encodeCanonicalBridgeMessage,
  hashJson,
  hexToBytes,
  isHash32Hex,
  MESSAGE_LENGTH,
  normalizeHex,
} from "../../shared/protocol/canonical-message.mjs";
import {
  combineProjectAttestations,
  VERIFIED_READY,
} from "../attesters/attestation-service.mjs";

export const DEPOSIT_PIPELINE_PROTOCOL = "KINGPEPE_NATIVE_SOLANA_BRIDGE/AUTOMATIC_DEPOSIT_PIPELINE/V1";
export const DEPOSIT_EVIDENCE_PROTOCOL = "KINGPEPE_NATIVE_SOLANA_BRIDGE/DEPOSIT_RESERVE_EVIDENCE/V1";
export const DEPOSIT_STATES = Object.freeze({
  OBSERVED: "OBSERVED",
  WAITING_FOR_FINALITY: "WAITING_FOR_FINALITY",
  WAITING_FOR_DEPENDENCY: "WAITING_FOR_DEPENDENCY",
  QUEUED_BY_LIMIT: "QUEUED_BY_LIMIT",
  VERIFIED_READY: "VERIFIED_READY",
  SIGNING: "SIGNING",
  BROADCAST: "BROADCAST",
  WAITING_SETTLEMENT: "WAITING_SETTLEMENT",
  COMPLETED: "COMPLETED",
  REJECTED: "REJECTED",
  HARD_STOP: "HARD_STOP",
});

const UINT_DECIMAL = /^(0|[1-9][0-9]*)$/u;
const ZERO_HASH = "00".repeat(32);

export class AutomaticNativeToSolanaDepositPipeline {
  #config;
  #frostCoordinator;
  #attesters;
  #nativeRelayer;
  #reserveVerifier;
  #solanaBridge;
  #journal;
  #ledger;

  constructor(options) {
    this.#config = normalizePipelineConfig(options.config);
    this.#frostCoordinator = requireObject(options.frostCoordinator, "frostCoordinator");
    this.#attesters = requireTwoAttesters(options.attesters);
    this.#nativeRelayer = requireObject(options.nativeRelayer, "nativeRelayer");
    this.#reserveVerifier = requireObject(options.reserveVerifier, "reserveVerifier");
    this.#solanaBridge = requireObject(options.solanaBridge, "solanaBridge");
    this.#journal = options.journal ?? new InMemoryDepositJournal();
    this.#ledger = options.ledger ?? new ExactDepositLedger();
  }

  ledgerSnapshot() {
    return this.#ledger.snapshot();
  }

  processDeposit(operation, nowUnix = undefined) {
    const normalized = normalizeDepositOperation(operation);
    const { encodedMessageHex, decodedMessage, evidenceDigestHex } = buildDepositClaimMessage(this.#config, normalized);
    const replay = this.#journal.completed(decodedMessage.operationIdHex);
    if (replay !== undefined) {
      this.#journal.assertSameCompleted(decodedMessage.operationIdHex, encodedMessageHex);
      return structuredClone(replay);
    }
    this.#journal.reserveOperation(decodedMessage.operationIdHex, decodedMessage.depositOutpointText, encodedMessageHex);

    const observed = validateObservedDeposit(this.#config, normalized, decodedMessage);
    this.#journal.record(decodedMessage.operationIdHex, DEPOSIT_STATES.OBSERVED, observed.reason);
    if (observed.state !== DEPOSIT_STATES.VERIFIED_READY) {
      return this.#journal.finish(decodedMessage.operationIdHex, observed);
    }

    const preparedSweep = validatePreparedReserveSweep(normalized, decodedMessage);
    this.#journal.record(decodedMessage.operationIdHex, DEPOSIT_STATES.SIGNING, "FROST_A_B_AUTOMATIC_RESERVE_SWEEP");
    const frostResult = this.#frostCoordinator.signAutomatically(preparedSweep.signingIntent);
    if (frostResult.state !== "SIGNED") {
      return this.#journal.finish(
        decodedMessage.operationIdHex,
        flowDecision(DEPOSIT_STATES.WAITING_FOR_DEPENDENCY, "FROST_A_B_NOT_AVAILABLE", decodedMessage, {
          frostState: frostResult.state,
        }),
      );
    }

    this.#journal.record(decodedMessage.operationIdHex, DEPOSIT_STATES.BROADCAST, "PERSISTED_BEFORE_NATIVE_BROADCAST");
    const broadcast = requireMethodResult(
      this.#nativeRelayer.broadcastReserveSweep({
        operationIdHex: decodedMessage.operationIdHex,
        encodedMessageHex,
        reserveSweep: normalized.reserveSweep,
        signedNativeTransactionHex: normalized.reserveSweep.signedNativeTransactionHex,
        signingIntent: preparedSweep.signingIntent,
        frostResult,
      }),
      "nativeRelayer.broadcastReserveSweep",
    );
    if (broadcast.state !== DEPOSIT_STATES.BROADCAST && broadcast.state !== DEPOSIT_STATES.COMPLETED) {
      return this.#journal.finish(
        decodedMessage.operationIdHex,
        flowDecision(DEPOSIT_STATES.WAITING_FOR_DEPENDENCY, "NATIVE_SWEEP_BROADCAST_NOT_CONFIRMED", decodedMessage, {
          nativeBroadcastState: broadcast.state,
        }),
      );
    }

    this.#journal.record(decodedMessage.operationIdHex, DEPOSIT_STATES.WAITING_SETTLEMENT, "WAITING_FOR_SWEEP_FINALITY");
    const reserveEvidence = requireMethodResult(
      this.#reserveVerifier.verifyFinalizedReserveSweep({
        operationIdHex: decodedMessage.operationIdHex,
        encodedMessageHex,
        evidenceDigestHex,
        deposit: normalized.deposit,
        reserveSweep: normalized.reserveSweep,
        broadcast,
      }),
      "reserveVerifier.verifyFinalizedReserveSweep",
    );
    const reserveResult = validateFinalReserveEvidence(this.#config, normalized, decodedMessage, reserveEvidence);
    if (reserveResult.state !== DEPOSIT_STATES.VERIFIED_READY) {
      return this.#journal.finish(decodedMessage.operationIdHex, reserveResult);
    }

    // Finalized backing creates an obligation even if attestation/minting waits.
    const credit = Object.freeze({
      encodedMessageHex,
      reserveAllocationIdHex: normalized.reserveSweep.reserveAllocationIdHex,
    });
    this.#ledger.recordValidatedDeposit(credit);
    const attestationRequest = {
      encodedMessageHex,
      messageDigestHex: decodedMessage.messageDigestHex,
      evidence: reserveResult.attestationEvidence,
    };
    const attestations = this.#attesters.map((attester) => attester.signDepositCredit(attestationRequest, nowUnix));
    const combinedAttestation = combineProjectAttestations({
      attestations,
      encodedMessageHex,
      authorizedAttesterPublicKeys: this.#config.authorizedAttesterPublicKeys,
    });
    if (combinedAttestation.state !== VERIFIED_READY) {
      return this.#journal.finish(
        decodedMessage.operationIdHex,
        flowDecision(DEPOSIT_STATES.REJECTED, "PROJECT_ATTESTATION_THRESHOLD_NOT_MET", decodedMessage),
      );
    }

    const minted = requireMethodResult(
      this.#solanaBridge.submitDepositClaim({
        operationIdHex: decodedMessage.operationIdHex,
        encodedMessageHex,
        messageDigestHex: decodedMessage.messageDigestHex,
        amountAtomic: decodedMessage.amountAtomic.toString(),
        solanaRecipientHex: decodedMessage.destinationHex,
        attestations,
        combinedAttestation,
      }),
      "solanaBridge.submitDepositClaim",
    );
    if (minted.state !== DEPOSIT_STATES.COMPLETED) {
      return this.#journal.finish(
        decodedMessage.operationIdHex,
        flowDecision(DEPOSIT_STATES.WAITING_FOR_DEPENDENCY, "SOLANA_MINT_NOT_COMPLETED", decodedMessage, {
          solanaState: minted.state,
        }),
      );
    }
    if (!isExactMintAmount(minted.mintedAmountAtomic, decodedMessage.amountAtomic)) {
      return this.#journal.finish(
        decodedMessage.operationIdHex,
        flowDecision(DEPOSIT_STATES.HARD_STOP, "SOLANA_MINT_AMOUNT_MISMATCH", decodedMessage),
      );
    }
    this.#ledger.recordMint({ ...credit, mintedAmountAtomic: minted.mintedAmountAtomic });

    return this.#journal.finish(
      decodedMessage.operationIdHex,
      flowDecision(DEPOSIT_STATES.COMPLETED, "ALL_REQUIRED_CHECKS_PASSED", decodedMessage, {
        attestationMode: combinedAttestation.mode,
        threshold: combinedAttestation.threshold,
        signerIds: frostResult.signerIds,
        nativeSweepTxidHex: broadcast.nativeSweepTxidHex,
        reserveAllocationIdHex: reserveEvidence.reserveAllocationIdHex,
        solanaSignature: minted.solanaSignature,
        mintedAmountAtomic: minted.mintedAmountAtomic,
        ledger: this.#ledger.snapshot(),
      }),
    );
  }

  async processDepositAsync(operation, nowUnix = undefined) {
    const normalized = normalizeDepositOperation(operation);
    const { encodedMessageHex, decodedMessage, evidenceDigestHex } = buildDepositClaimMessage(this.#config, normalized);
    const replay = this.#journal.completed(decodedMessage.operationIdHex);
    if (replay !== undefined) {
      this.#journal.assertSameCompleted(decodedMessage.operationIdHex, encodedMessageHex);
      return structuredClone(replay);
    }
    this.#journal.reserveOperation(decodedMessage.operationIdHex, decodedMessage.depositOutpointText, encodedMessageHex);

    const observed = validateObservedDeposit(this.#config, normalized, decodedMessage);
    this.#journal.record(decodedMessage.operationIdHex, DEPOSIT_STATES.OBSERVED, observed.reason);
    if (observed.state !== DEPOSIT_STATES.VERIFIED_READY) {
      return this.#journal.finish(decodedMessage.operationIdHex, observed);
    }

    const preparedSweep = validatePreparedReserveSweep(normalized, decodedMessage);
    this.#journal.record(decodedMessage.operationIdHex, DEPOSIT_STATES.SIGNING, "FROST_A_B_AUTOMATIC_RESERVE_SWEEP");
    const frostResult = this.#frostCoordinator.signAutomatically(preparedSweep.signingIntent);
    if (frostResult.state !== "SIGNED") {
      return this.#journal.finish(
        decodedMessage.operationIdHex,
        flowDecision(DEPOSIT_STATES.WAITING_FOR_DEPENDENCY, "FROST_A_B_NOT_AVAILABLE", decodedMessage, {
          frostState: frostResult.state,
        }),
      );
    }

    this.#journal.record(decodedMessage.operationIdHex, DEPOSIT_STATES.BROADCAST, "PERSISTED_BEFORE_NATIVE_BROADCAST");
    const broadcast = requireMethodResult(
      await this.#nativeRelayer.broadcastReserveSweep({
        operationIdHex: decodedMessage.operationIdHex,
        encodedMessageHex,
        reserveSweep: normalized.reserveSweep,
        signedNativeTransactionHex: normalized.reserveSweep.signedNativeTransactionHex,
        signingIntent: preparedSweep.signingIntent,
        frostResult,
      }),
      "nativeRelayer.broadcastReserveSweep",
    );
    if (broadcast.state !== DEPOSIT_STATES.BROADCAST && broadcast.state !== DEPOSIT_STATES.COMPLETED) {
      return this.#journal.finish(
        decodedMessage.operationIdHex,
        flowDecision(DEPOSIT_STATES.WAITING_FOR_DEPENDENCY, "NATIVE_SWEEP_BROADCAST_NOT_CONFIRMED", decodedMessage, {
          nativeBroadcastState: broadcast.state,
        }),
      );
    }

    this.#journal.record(decodedMessage.operationIdHex, DEPOSIT_STATES.WAITING_SETTLEMENT, "WAITING_FOR_SWEEP_FINALITY");
    const reserveEvidence = requireMethodResult(
      await this.#reserveVerifier.verifyFinalizedReserveSweep({
        operationIdHex: decodedMessage.operationIdHex,
        encodedMessageHex,
        evidenceDigestHex,
        deposit: normalized.deposit,
        reserveSweep: normalized.reserveSweep,
        broadcast,
      }),
      "reserveVerifier.verifyFinalizedReserveSweep",
    );
    const reserveResult = validateFinalReserveEvidence(this.#config, normalized, decodedMessage, reserveEvidence);
    if (reserveResult.state !== DEPOSIT_STATES.VERIFIED_READY) {
      return this.#journal.finish(decodedMessage.operationIdHex, reserveResult);
    }

    const credit = Object.freeze({
      encodedMessageHex,
      reserveAllocationIdHex: normalized.reserveSweep.reserveAllocationIdHex,
    });
    this.#ledger.recordValidatedDeposit(credit);
    const attestationRequest = {
      encodedMessageHex,
      messageDigestHex: decodedMessage.messageDigestHex,
      evidence: reserveResult.attestationEvidence,
    };
    const attestations = this.#attesters.map((attester) => attester.signDepositCredit(attestationRequest, nowUnix));
    const combinedAttestation = combineProjectAttestations({
      attestations,
      encodedMessageHex,
      authorizedAttesterPublicKeys: this.#config.authorizedAttesterPublicKeys,
    });
    if (combinedAttestation.state !== VERIFIED_READY) {
      return this.#journal.finish(
        decodedMessage.operationIdHex,
        flowDecision(DEPOSIT_STATES.REJECTED, "PROJECT_ATTESTATION_THRESHOLD_NOT_MET", decodedMessage),
      );
    }

    const minted = requireMethodResult(
      await this.#solanaBridge.submitDepositClaim({
        operationIdHex: decodedMessage.operationIdHex,
        encodedMessageHex,
        messageDigestHex: decodedMessage.messageDigestHex,
        amountAtomic: decodedMessage.amountAtomic.toString(),
        solanaRecipientHex: decodedMessage.destinationHex,
        attestations,
        combinedAttestation,
      }),
      "solanaBridge.submitDepositClaim",
    );
    if (minted.state !== DEPOSIT_STATES.COMPLETED) {
      return this.#journal.finish(
        decodedMessage.operationIdHex,
        flowDecision(DEPOSIT_STATES.WAITING_FOR_DEPENDENCY, "SOLANA_MINT_NOT_COMPLETED", decodedMessage, {
          solanaState: minted.state,
        }),
      );
    }
    if (!isExactMintAmount(minted.mintedAmountAtomic, decodedMessage.amountAtomic)) {
      return this.#journal.finish(
        decodedMessage.operationIdHex,
        flowDecision(DEPOSIT_STATES.HARD_STOP, "SOLANA_MINT_AMOUNT_MISMATCH", decodedMessage),
      );
    }
    this.#ledger.recordMint({ ...credit, mintedAmountAtomic: minted.mintedAmountAtomic });

    return this.#journal.finish(
      decodedMessage.operationIdHex,
      flowDecision(DEPOSIT_STATES.COMPLETED, "ALL_REQUIRED_CHECKS_PASSED", decodedMessage, {
        attestationMode: combinedAttestation.mode,
        threshold: combinedAttestation.threshold,
        signerIds: frostResult.signerIds,
        nativeSweepTxidHex: broadcast.nativeSweepTxidHex,
        reserveAllocationIdHex: reserveEvidence.reserveAllocationIdHex,
        solanaSignature: minted.solanaSignature,
        mintedAmountAtomic: minted.mintedAmountAtomic,
        ledger: this.#ledger.snapshot(),
      }),
    );
  }
}

export class InMemoryDepositJournal {
  #operations = new Map();
  #outpoints = new Map();

  completed(operationIdHex) {
    const entry = this.#operations.get(operationIdHex);
    return entry?.terminal?.state === DEPOSIT_STATES.COMPLETED ? entry.terminal : undefined;
  }

  reserveOperation(operationIdHex, depositOutpointText, encodedMessageHex) {
    const existing = this.#operations.get(operationIdHex);
    if (existing !== undefined) {
      if (existing.encodedMessageHex !== encodedMessageHex || existing.depositOutpointText !== depositOutpointText) {
        throw new Error("DepositOperationReplayAltered");
      }
      return;
    }
    const previousForOutpoint = this.#outpoints.get(depositOutpointText);
    if (previousForOutpoint !== undefined && previousForOutpoint !== operationIdHex) {
      throw new Error("DepositOutpointAlreadyReserved");
    }
    this.#outpoints.set(depositOutpointText, operationIdHex);
    this.#operations.set(operationIdHex, {
      operationIdHex,
      depositOutpointText,
      encodedMessageHex,
      events: [],
      terminal: undefined,
    });
  }

  record(operationIdHex, state, reason) {
    const entry = this.#requireEntry(operationIdHex);
    entry.events.push({
      state,
      reason,
      sequence: entry.events.length + 1,
    });
  }

  finish(operationIdHex, decision) {
    const entry = this.#requireEntry(operationIdHex);
    entry.terminal = structuredClone(decision);
    this.record(operationIdHex, decision.state, decision.reason);
    return structuredClone(decision);
  }

  assertSameCompleted(operationIdHex, encodedMessageHex) {
    const entry = this.#requireEntry(operationIdHex);
    if (entry.encodedMessageHex !== encodedMessageHex) {
      throw new Error("CompletedDepositReplayAltered");
    }
  }

  #requireEntry(operationIdHex) {
    const entry = this.#operations.get(operationIdHex);
    if (entry === undefined) throw new Error("UnknownDepositOperation");
    return entry;
  }
}

export class FileBackedDepositJournal {
  #root;
  #repoRoot;

  constructor(options) {
    const value = requireObject(options, "options");
    this.#repoRoot = path.resolve(value.repoRoot);
    this.#root = validateStateRootOutsideRepo(value.root, this.#repoRoot, "Deposit pipeline journal root");
    mkdirSync(this.#root, { recursive: true });
  }

  completed(operationIdHex) {
    const entry = this.get(operationIdHex);
    return entry?.terminal?.state === DEPOSIT_STATES.COMPLETED
      ? structuredClone(entry.terminal)
      : undefined;
  }

  get(operationIdHex) {
    const file = this.#entryPath(operationIdHex);
    if (!existsSync(file)) return undefined;
    return normalizeJournalEntry(JSON.parse(readFileSync(file, "utf8")));
  }

  reserveOperation(operationIdHex, depositOutpointText, encodedMessageHex) {
    const operationId = normalizeHash32(operationIdHex, "operationIdHex");
    const outpoint = normalizeDepositOutpointText(depositOutpointText);
    const encoded = normalizeHexBytes(encodedMessageHex, "encodedMessageHex");
    const existing = this.get(operationId);
    if (existing !== undefined) {
      assertSameJournalEntry(existing, operationId, outpoint, encoded);
      return;
    }

    const index = this.#readOutpointIndex();
    const existingOperation = index[outpoint];
    if (existingOperation !== undefined && existingOperation !== operationId) {
      throw new Error("DepositOutpointAlreadyReserved");
    }

    this.#writeEntry(operationId, {
      protocol: DEPOSIT_PIPELINE_PROTOCOL,
      operationIdHex: operationId,
      depositOutpointText: outpoint,
      encodedMessageHex: encoded,
      events: [],
      terminal: undefined,
    });
    index[outpoint] = operationId;
    this.#writeOutpointIndex(index);
  }

  record(operationIdHex, state, reason) {
    const entry = this.#requireEntry(operationIdHex);
    entry.events.push({
      state,
      reason,
      sequence: entry.events.length + 1,
    });
    this.#writeEntry(entry.operationIdHex, entry);
  }

  finish(operationIdHex, decision) {
    const entry = this.#requireEntry(operationIdHex);
    entry.terminal = structuredClone(decision);
    entry.events.push({
      state: decision.state,
      reason: decision.reason,
      sequence: entry.events.length + 1,
    });
    this.#writeEntry(entry.operationIdHex, entry);
    return structuredClone(decision);
  }

  assertSameCompleted(operationIdHex, encodedMessageHex) {
    const entry = this.#requireEntry(operationIdHex);
    if (entry.encodedMessageHex !== normalizeHexBytes(encodedMessageHex, "encodedMessageHex")) {
      throw new Error("CompletedDepositReplayAltered");
    }
  }

  #requireEntry(operationIdHex) {
    const entry = this.get(operationIdHex);
    if (entry === undefined) throw new Error("UnknownDepositOperation");
    return entry;
  }

  #entryPath(operationIdHex) {
    return path.join(this.#root, `${normalizeHash32(operationIdHex, "operationIdHex")}.json`);
  }

  #outpointIndexPath() {
    return path.join(this.#root, "deposit-outpoints.json");
  }

  #readOutpointIndex() {
    const indexPath = this.#outpointIndexPath();
    if (!existsSync(indexPath)) return {};
    const parsed = JSON.parse(readFileSync(indexPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("DepositOutpointIndexMalformed");
    }
    return Object.fromEntries(
      Object.entries(parsed).map(([outpoint, operationId]) => [
        normalizeDepositOutpointText(outpoint),
        normalizeHash32(operationId, "depositOutpointIndex.operationId"),
      ]),
    );
  }

  #writeOutpointIndex(index) {
    this.#writeJson(this.#outpointIndexPath(), index);
  }

  #writeEntry(operationIdHex, entry) {
    this.#writeJson(this.#entryPath(operationIdHex), normalizeJournalEntry(entry));
  }

  #writeJson(target, value) {
    mkdirSync(this.#root, { recursive: true });
    const temp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    renameSync(temp, target);
  }
}

export class ExactDepositLedger {
  #totals = Object.freeze({
    canonicalReserve: 0n,
    mintedSupply: 0n,
    authorizedUnmintedCredits: 0n,
    feesAccrued: 0n,
    unsettledOperations: 0n,
  });
  #deploymentHex;
  #credits = new Map();
  #backing = new Set();
  #allocations = new Set();

  // Accounting only: the caller must first validate actual reserve evidence.
  // These in-memory markers are not durable authorization or chain proofs.
  recordValidatedDeposit(input) {
    const credit = normalizeLedgerCredit(input);
    this.#assertDeployment(credit);
    const existing = this.#credits.get(credit.operationIdHex);
    if (existing !== undefined) {
      assertSameLedgerCredit(existing, credit);
      return;
    }
    if (this.#backing.has(credit.backingKey)) throw new Error("LedgerBackingAlreadyAllocated");
    if (this.#allocations.has(credit.reserveAllocationIdHex)) throw new Error("LedgerReserveAllocationReused");
    const next = Object.freeze({
      ...this.#totals,
      canonicalReserve: checkedAdd(this.#totals.canonicalReserve, credit.amountAtomic),
      authorizedUnmintedCredits: checkedAdd(this.#totals.authorizedUnmintedCredits, credit.amountAtomic),
      unsettledOperations: checkedAdd(this.#totals.unsettledOperations, 1n),
    });
    assertLedgerCovered(next);
    // No validation or arithmetic remains after markers/balances start changing.
    this.#credits.set(credit.operationIdHex, credit);
    this.#backing.add(credit.backingKey);
    this.#allocations.add(credit.reserveAllocationIdHex);
    this.#deploymentHex = credit.deploymentHex;
    this.#totals = next;
  }

  recordMint(input) {
    const credit = normalizeLedgerCredit(input);
    this.#assertDeployment(credit);
    const amount = exactLedgerAmount(input.mintedAmountAtomic);
    const existing = this.#credits.get(credit.operationIdHex);
    if (existing === undefined) throw new Error("LedgerUnknownCredit");
    assertSameLedgerCredit(existing, credit);
    if (amount !== credit.amountAtomic) throw new Error("LedgerMintAmountMismatch");
    if (existing.minted) return;
    const next = Object.freeze({
      ...this.#totals,
      authorizedUnmintedCredits: checkedSub(this.#totals.authorizedUnmintedCredits, amount),
      mintedSupply: checkedAdd(this.#totals.mintedSupply, amount),
      unsettledOperations: checkedSub(this.#totals.unsettledOperations, 1n),
    });
    assertLedgerCovered(next);
    this.#credits.set(credit.operationIdHex, Object.freeze({ ...existing, minted: true }));
    this.#totals = next;
  }

  snapshot() {
    const coverageRequired = checkedAdd(this.#totals.mintedSupply, this.#totals.authorizedUnmintedCredits);
    return Object.freeze({
      ...Object.fromEntries(Object.entries(this.#totals).map(([key, value]) => [key, value.toString()])),
      coverageRequired: coverageRequired.toString(),
      surplus: checkedSub(this.#totals.canonicalReserve, coverageRequired).toString(),
    });
  }

  #assertDeployment(credit) {
    if (this.#deploymentHex !== undefined && this.#deploymentHex !== credit.deploymentHex) {
      throw new Error("LedgerDeploymentMismatch");
    }
  }
}

function normalizeLedgerCredit(input) {
  const value = requireObject(input, "ledgerCredit");
  if (typeof value.encodedMessageHex !== "string" || value.encodedMessageHex.length !== MESSAGE_LENGTH * 2) {
    throw new Error("LedgerCanonicalMessageRequired");
  }
  const encoded = hexToBytes(value.encodedMessageHex, "ledgerMessage");
  const message = decodeCanonicalBridgeMessage(encoded);
  if (message.action !== "DepositClaim" || message.direction !== "NativeToSolana") {
    throw new Error("LedgerDepositClaimRequired");
  }
  if (message.feeAtomic !== 0n) throw new Error("LedgerProjectBridgeFeeMustBeZero");
  const reserveAllocationIdHex = normalizeHash32(value.reserveAllocationIdHex, "ledgerAllocation");
  if (reserveAllocationIdHex === ZERO_HASH) throw new Error("LedgerAllocationZero");
  return Object.freeze({
    operationIdHex: message.operationIdHex,
    encodedMessageHex: bytesToHex(encoded),
    // Canonical V1 header is 12 bytes; compare the full encoded deployment.
    deploymentHex: bytesToHex(encoded.subarray(12, 12 + DEPLOYMENT_IDENTITY_LENGTH)),
    backingKey: `${bytesToHex(message.deployment.nativeGenesis)}:${message.depositOutpointText}`,
    reserveAllocationIdHex,
    amountAtomic: message.amountAtomic,
    minted: false,
  });
}

function assertSameLedgerCredit(existing, credit) {
  if (existing.encodedMessageHex !== credit.encodedMessageHex || existing.reserveAllocationIdHex !== credit.reserveAllocationIdHex) {
    throw new Error("LedgerCreditReplayAltered");
  }
}

function exactLedgerAmount(value) {
  if (typeof value !== "bigint" && (typeof value !== "string" || value.length > 20 || !UINT_DECIMAL.test(value))) {
    throw new Error("LedgerExactUnsignedAmountRequired");
  }
  const amount = BigInt(value);
  if (amount <= 0n || amount > 0xffff_ffff_ffff_ffffn) throw new Error("LedgerPositiveU64Required");
  return amount;
}

function isExactMintAmount(value, expected) {
  try {
    return exactLedgerAmount(value) === expected;
  } catch {
    return false;
  }
}

function assertLedgerCovered(totals) {
  const coverage = checkedAdd(totals.mintedSupply, totals.authorizedUnmintedCredits);
  if (coverage > totals.canonicalReserve) throw new Error("LedgerInsufficientBacking");
}

export function buildDepositClaimMessage(config, operation) {
  const normalizedConfig = normalizePipelineConfig(config);
  const normalized = normalizeDepositOperation(operation);
  const evidenceDigestHex = depositReserveEvidenceDigestHex(normalized);
  const encoded = encodeCanonicalBridgeMessage({
    action: "DepositClaim",
    direction: "NativeToSolana",
    deployment: normalizedConfig.deployment,
    depositOutpoint: normalized.deposit.depositOutpoint,
    withdrawalId: ZERO_HASH,
    amountAtomic: normalized.deposit.amountAtomic,
    feeAtomic: normalized.deposit.projectBridgeFeeAtomic,
    destination: hexToBytes(normalized.deposit.solanaRecipientHex, "deposit.solanaRecipientHex"),
    policyEpoch: normalizedConfig.policyEpoch,
    keyEpoch: normalizedConfig.keyEpoch,
    nonce: normalized.messageNonceHex,
    validFrom: normalized.validFrom,
    validUntil: normalized.validUntil,
    evidenceDigest: evidenceDigestHex,
  });
  const decodedMessage = decodeCanonicalBridgeMessage(encoded);
  return {
    encodedMessageHex: bytesToHex(encoded),
    decodedMessage,
    evidenceDigestHex,
  };
}

export function depositReserveEvidenceDigestHex(operation) {
  const normalized = normalizeDepositOperation(operation);
  return hashJson({
    protocol: DEPOSIT_EVIDENCE_PROTOCOL,
    deposit: {
      trust: normalized.deposit.trust,
      nativeNetwork: normalized.deposit.nativeNetwork,
      nativeGenesisHash: normalized.deposit.nativeGenesisHash,
      depositOutpoint: outpointText(normalized.deposit.depositOutpoint),
      amountAtomic: normalized.deposit.amountAtomic,
      solanaRecipientHex: normalized.deposit.solanaRecipientHex,
      proofFingerprint: normalized.deposit.proofFingerprint,
      finalitySatisfied: normalized.deposit.finalitySatisfied,
      utxoUnspentAtDeposit: normalized.deposit.utxoUnspentAtDeposit,
      noPriorConsumption: normalized.deposit.noPriorConsumption,
    },
    reserveSweep: {
      reserveAllocationIdHex: normalized.reserveSweep.reserveAllocationIdHex,
      nativeSweepTxidHex: normalized.reserveSweep.nativeSweepTxidHex,
      canonicalReserveScriptPubKeyHex: normalized.reserveSweep.canonicalReserveScriptPubKeyHex,
      transactionCommitment: normalized.reserveSweep.signingIntent.transactionCommitment,
      taprootSighashHex: normalized.reserveSweep.signingIntent.taprootSighashHex,
      outputCommitments: normalized.reserveSweep.signingIntent.outputCommitments,
      changeAtomic: normalized.reserveSweep.signingIntent.changeAtomic,
    },
  });
}

function validateObservedDeposit(config, operation, message) {
  if (config.hardStop) return flowDecision(DEPOSIT_STATES.HARD_STOP, "HARD_STOP_ACTIVE", message);
  if (message.feeAtomic !== 0n) return flowDecision(DEPOSIT_STATES.REJECTED, "PROJECT_BRIDGE_FEE_MUST_BE_ZERO", message);
  if (config.depositsPaused) return flowDecision(DEPOSIT_STATES.WAITING_FOR_DEPENDENCY, "DEPOSITS_PAUSED", message);
  if (!config.acceptedNativeTrust.includes(operation.deposit.trust)) {
    return flowDecision(DEPOSIT_STATES.WAITING_FOR_DEPENDENCY, "NATIVE_TRUST_NOT_ACCEPTED", message);
  }
  if (!operation.deposit.finalitySatisfied) {
    return flowDecision(DEPOSIT_STATES.WAITING_FOR_FINALITY, "DEPOSIT_FINALITY_NOT_SATISFIED", message);
  }
  if (!operation.deposit.utxoUnspentAtDeposit || !operation.deposit.noPriorConsumption) {
    return flowDecision(DEPOSIT_STATES.REJECTED, "DEPOSIT_BACKING_NOT_UNIQUELY_AVAILABLE", message);
  }
  if (operation.deposit.nativeNetwork !== config.deployment.nativeNetwork) {
    return flowDecision(DEPOSIT_STATES.REJECTED, "NATIVE_NETWORK_MISMATCH", message);
  }
  if (operation.deposit.nativeGenesisHash !== bytesToHex(config.deployment.nativeGenesis)) {
    return flowDecision(DEPOSIT_STATES.REJECTED, "NATIVE_GENESIS_MISMATCH", message);
  }
  if (BigInt(operation.deposit.amountAtomic) !== message.amountAtomic) {
    return flowDecision(DEPOSIT_STATES.REJECTED, "AMOUNT_MISMATCH", message);
  }
  if (operation.deposit.solanaRecipientHex !== message.destinationHex) {
    return flowDecision(DEPOSIT_STATES.REJECTED, "RECIPIENT_MISMATCH", message);
  }
  return flowDecision(DEPOSIT_STATES.VERIFIED_READY, "DEPOSIT_OBSERVATION_VERIFIED", message);
}

function validatePreparedReserveSweep(operation, message) {
  const intent = operation.reserveSweep.signingIntent;
  if (intent.purpose !== "RESERVE_SWEEP") throw new Error("ReserveSweepIntentPurposeRequired");
  if (intent.operationId !== message.operationIdHex) throw new Error("ReserveSweepOperationIdMismatch");
  if (intent.withdrawalId !== ZERO_HASH) throw new Error("ReserveSweepWithdrawalIdMustBeZero");
  if (intent.proofFingerprint !== operation.deposit.proofFingerprint) throw new Error("ReserveSweepProofFingerprintMismatch");
  if (intent.amountAtomic !== operation.deposit.amountAtomic) throw new Error("ReserveSweepAmountMismatch");
  if (intent.feeAtomic !== operation.reserveSweep.nativeMinerFeeAtomic) throw new Error("ReserveSweepFeeMismatch");
  const depositOutpointText = outpointText(operation.deposit.depositOutpoint);
  if (!intent.inputOutpoints.includes(depositOutpointText)) {
    throw new Error("ReserveSweepInputOutpointMismatch");
  }
  if (BigInt(intent.feeAtomic) > 0n && intent.inputOutpoints.length < 2) {
    throw new Error("ReserveSweepFeeFundingInputRequired");
  }
  if (intent.changeScriptPubKeyHex !== operation.reserveSweep.canonicalReserveScriptPubKeyHex) {
    throw new Error("ReserveSweepChangeScriptMismatch");
  }
  return { signingIntent: intent };
}

function validateFinalReserveEvidence(config, operation, message, reserveEvidence) {
  const normalized = {
    trust: reserveEvidence.trust,
    nativeNetwork: reserveEvidence.nativeNetwork,
    nativeGenesisHash: normalizeHash32(reserveEvidence.nativeGenesisHash, "reserveEvidence.nativeGenesisHash"),
    operationIdHex: normalizeHash32(reserveEvidence.operationIdHex, "reserveEvidence.operationIdHex"),
    depositOutpoint: reserveEvidence.depositOutpoint,
    amountAtomic: canonicalUintDecimal(reserveEvidence.amountAtomic, "reserveEvidence.amountAtomic"),
    solanaRecipientHex: normalizeHexBytes(reserveEvidence.solanaRecipientHex, "reserveEvidence.solanaRecipientHex"),
    evidenceDigestHex: normalizeHash32(reserveEvidence.evidenceDigestHex, "reserveEvidence.evidenceDigestHex"),
    reserveAllocationIdHex: normalizeHash32(reserveEvidence.reserveAllocationIdHex, "reserveEvidence.reserveAllocationIdHex"),
    reserveTransitionState: reserveEvidence.reserveTransitionState,
    mintCreditState: reserveEvidence.mintCreditState,
    finalitySatisfied: reserveEvidence.finalitySatisfied === true,
    sweepFinalized: reserveEvidence.sweepFinalized === true,
    utxoUnspentAtDeposit: reserveEvidence.utxoUnspentAtDeposit === true,
    noPriorConsumption: reserveEvidence.noPriorConsumption === true,
    nativeSweepTxidHex: normalizeHash32(reserveEvidence.nativeSweepTxidHex, "reserveEvidence.nativeSweepTxidHex"),
  };

  if (!config.acceptedNativeTrust.includes(normalized.trust)) {
    return flowDecision(DEPOSIT_STATES.WAITING_FOR_DEPENDENCY, "RESERVE_TRUST_NOT_ACCEPTED", message);
  }
  if (!normalized.finalitySatisfied || !normalized.sweepFinalized) {
    return flowDecision(DEPOSIT_STATES.WAITING_FOR_FINALITY, "RESERVE_SWEEP_FINALITY_NOT_SATISFIED", message);
  }
  if (normalized.reserveTransitionState !== "CANONICAL_RESERVE") {
    return flowDecision(DEPOSIT_STATES.WAITING_FOR_DEPENDENCY, "RESERVE_TRANSITION_NOT_CANONICAL", message);
  }
  if (normalized.mintCreditState !== "AUTHORIZED_UNCONSUMED") {
    return flowDecision(DEPOSIT_STATES.REJECTED, "MINT_CREDIT_NOT_AVAILABLE", message);
  }
  if (
    normalized.nativeNetwork !== config.deployment.nativeNetwork ||
    normalized.nativeGenesisHash !== bytesToHex(config.deployment.nativeGenesis) ||
    normalized.operationIdHex !== message.operationIdHex ||
    normalized.depositOutpoint !== message.depositOutpointText ||
    BigInt(normalized.amountAtomic) !== message.amountAtomic ||
    normalized.solanaRecipientHex !== message.destinationHex ||
    normalized.evidenceDigestHex !== message.evidenceDigestHex ||
    normalized.reserveAllocationIdHex !== operation.reserveSweep.reserveAllocationIdHex ||
    normalized.nativeSweepTxidHex !== operation.reserveSweep.nativeSweepTxidHex ||
    !normalized.utxoUnspentAtDeposit ||
    !normalized.noPriorConsumption
  ) {
    return flowDecision(DEPOSIT_STATES.REJECTED, "RESERVE_EVIDENCE_MISMATCH", message);
  }

  return flowDecision(DEPOSIT_STATES.VERIFIED_READY, "RESERVE_TRANSITION_VERIFIED", message, {
    attestationEvidence: {
      trust: normalized.trust,
      nativeNetwork: normalized.nativeNetwork,
      nativeGenesisHash: normalized.nativeGenesisHash,
      operationIdHex: normalized.operationIdHex,
      depositOutpoint: normalized.depositOutpoint,
      amountAtomic: normalized.amountAtomic,
      solanaRecipientHex: normalized.solanaRecipientHex,
      evidenceDigestHex: normalized.evidenceDigestHex,
      reserveAllocationIdHex: normalized.reserveAllocationIdHex,
      reserveTransitionState: normalized.reserveTransitionState,
      mintCreditState: normalized.mintCreditState,
      finalitySatisfied: normalized.finalitySatisfied,
      sweepFinalized: normalized.sweepFinalized,
      utxoUnspentAtDeposit: normalized.utxoUnspentAtDeposit,
      noPriorConsumption: normalized.noPriorConsumption,
    },
  });
}

function normalizePipelineConfig(config) {
  const value = requireObject(config, "config");
  const deployment = requireObject(value.deployment, "config.deployment");
  return Object.freeze({
    protocol: DEPOSIT_PIPELINE_PROTOCOL,
    deployment: Object.freeze({
      protocolId: checkedU32(deployment.protocolId, "deployment.protocolId"),
      nativeNetwork: checkedU32(deployment.nativeNetwork, "deployment.nativeNetwork"),
      nativeGenesis: normalizeHash32(deployment.nativeGenesis, "deployment.nativeGenesis"),
      solanaDeployment: normalizeHash32(deployment.solanaDeployment, "deployment.solanaDeployment"),
      managerProgramId: normalizeHash32(deployment.managerProgramId, "deployment.managerProgramId"),
      transceiverProgramId: normalizeHash32(deployment.transceiverProgramId, "deployment.transceiverProgramId"),
      mint: normalizeHash32(deployment.mint, "deployment.mint"),
    }),
    policyEpoch: checkedU32(value.policyEpoch, "policyEpoch"),
    keyEpoch: checkedU32(value.keyEpoch, "keyEpoch"),
    acceptedNativeTrust: value.acceptedNativeTrust ?? ["LOCALLY_VALIDATED_CHAIN_STATE"],
    authorizedAttesterPublicKeys: (value.authorizedAttesterPublicKeys ?? []).map((key) =>
      normalizeHash32(key, "authorizedAttesterPublicKey"),
    ),
    depositsPaused: value.depositsPaused === true,
    hardStop: value.hardStop === true,
  });
}

function normalizeDepositOperation(operation) {
  const value = requireObject(operation, "operation");
  const deposit = requireObject(value.deposit, "operation.deposit");
  const reserveSweep = requireObject(value.reserveSweep, "operation.reserveSweep");
  const signingIntent = requireObject(reserveSweep.signingIntent, "operation.reserveSweep.signingIntent");
  return Object.freeze({
    messageNonceHex: normalizeHash32(value.messageNonceHex, "operation.messageNonceHex"),
    validFrom: canonicalUintDecimal(value.validFrom, "operation.validFrom"),
    validUntil: canonicalUintDecimal(value.validUntil, "operation.validUntil"),
    deposit: Object.freeze({
      trust: deposit.trust,
      nativeNetwork: checkedU32(deposit.nativeNetwork, "deposit.nativeNetwork"),
      nativeGenesisHash: normalizeHash32(deposit.nativeGenesisHash, "deposit.nativeGenesisHash"),
      depositOutpoint: normalizeOutpointObject(deposit.depositOutpoint),
      amountAtomic: canonicalUintDecimal(deposit.amountAtomic, "deposit.amountAtomic"),
      projectBridgeFeeAtomic: canonicalUintDecimal(deposit.projectBridgeFeeAtomic ?? "0", "deposit.projectBridgeFeeAtomic"),
      solanaRecipientHex: normalizeHexBytes(deposit.solanaRecipientHex, "deposit.solanaRecipientHex"),
      proofFingerprint: normalizeHash32(deposit.proofFingerprint, "deposit.proofFingerprint"),
      finalitySatisfied: deposit.finalitySatisfied === true,
      utxoUnspentAtDeposit: deposit.utxoUnspentAtDeposit === true,
      noPriorConsumption: deposit.noPriorConsumption === true,
    }),
    reserveSweep: Object.freeze({
      reserveAllocationIdHex: normalizeHash32(reserveSweep.reserveAllocationIdHex, "reserveSweep.reserveAllocationIdHex"),
      nativeSweepTxidHex: normalizeHash32(reserveSweep.nativeSweepTxidHex, "reserveSweep.nativeSweepTxidHex"),
      nativeMinerFeeAtomic: canonicalUintDecimal(reserveSweep.nativeMinerFeeAtomic, "reserveSweep.nativeMinerFeeAtomic"),
      canonicalReserveScriptPubKeyHex: normalizeHexBytes(
        reserveSweep.canonicalReserveScriptPubKeyHex,
        "reserveSweep.canonicalReserveScriptPubKeyHex",
      ),
      signedNativeTransactionHex:
        reserveSweep.signedNativeTransactionHex === undefined
          ? undefined
          : normalizeHexBytes(reserveSweep.signedNativeTransactionHex, "reserveSweep.signedNativeTransactionHex"),
      signingIntent: Object.freeze({
        ...signingIntent,
        operationId: normalizeHash32(signingIntent.operationId, "signingIntent.operationId"),
        withdrawalId: normalizeHash32(signingIntent.withdrawalId, "signingIntent.withdrawalId"),
        proofFingerprint: normalizeHash32(signingIntent.proofFingerprint, "signingIntent.proofFingerprint"),
        transactionCommitment: normalizeHash32(signingIntent.transactionCommitment, "signingIntent.transactionCommitment"),
        taprootSighashHex: normalizeHash32(signingIntent.taprootSighashHex, "signingIntent.taprootSighashHex"),
        unsignedNativeTransactionId: normalizeHash32(
          signingIntent.unsignedNativeTransactionId,
          "signingIntent.unsignedNativeTransactionId",
        ),
        recipientScriptPubKeyHex: normalizeHexBytes(signingIntent.recipientScriptPubKeyHex, "signingIntent.recipientScriptPubKeyHex"),
        amountAtomic: canonicalUintDecimal(signingIntent.amountAtomic, "signingIntent.amountAtomic"),
        feeAtomic: canonicalUintDecimal(signingIntent.feeAtomic, "signingIntent.feeAtomic"),
        changeScriptPubKeyHex: normalizeHexBytes(signingIntent.changeScriptPubKeyHex, "signingIntent.changeScriptPubKeyHex"),
        changeAtomic: canonicalUintDecimal(signingIntent.changeAtomic, "signingIntent.changeAtomic"),
        inputOutpoints: normalizeOutpointList(signingIntent.inputOutpoints),
        outputCommitments: normalizeHashList(signingIntent.outputCommitments, "signingIntent.outputCommitments"),
        reserveCommitment: normalizeHash32(signingIntent.reserveCommitment, "signingIntent.reserveCommitment"),
      }),
    }),
  });
}

function flowDecision(state, reason, message, extra = {}) {
  return Object.freeze({
    protocol: DEPOSIT_PIPELINE_PROTOCOL,
    state,
    reason,
    operationIdHex: message.operationIdHex,
    messageDigestHex: message.messageDigestHex,
    depositOutpoint: message.depositOutpointText,
    amountAtomic: message.amountAtomic.toString(),
    solanaRecipientHex: message.destinationHex,
    ...extra,
  });
}

function outpointText(outpoint) {
  return `${outpoint.txid}:${outpoint.vout}`;
}

function normalizeOutpointObject(value) {
  const outpoint = requireObject(value, "depositOutpoint");
  return Object.freeze({
    txid: normalizeHash32(outpoint.txid, "depositOutpoint.txid"),
    vout: checkedU32(outpoint.vout, "depositOutpoint.vout"),
  });
}

function normalizeOutpointList(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error("inputOutpoints:ExpectedNonEmptyArray");
  const normalized = value.map((entry) => {
    if (typeof entry !== "string") throw new Error("inputOutpoint:ExpectedString");
    const lower = entry.toLowerCase();
    if (!/^[0-9a-f]{64}:[0-9]+$/u.test(lower)) throw new Error("inputOutpoint:InvalidFormat");
    return lower;
  });
  if (new Set(normalized).size !== normalized.length) throw new Error("inputOutpoint:Duplicate");
  return Object.freeze(normalized);
}

function normalizeDepositOutpointText(value) {
  if (typeof value !== "string") throw new Error("DepositOutpointTextExpectedString");
  const normalized = value.toLowerCase();
  if (!/^[0-9a-f]{64}:[0-9]+$/u.test(normalized)) throw new Error("DepositOutpointTextInvalid");
  return normalized;
}

function normalizeHashList(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label}:ExpectedNonEmptyArray`);
  return Object.freeze(value.map((entry, index) => normalizeHash32(entry, `${label}.${index}`)));
}

function normalizeHash32(value, label) {
  const normalized = normalizeHex(value, label);
  if (!isHash32Hex(normalized)) throw new Error(`${label}:Expected32Bytes`);
  return normalized;
}

function normalizeHexBytes(value, label) {
  const normalized = normalizeHex(value, label);
  if (normalized.length === 0) throw new Error(`${label}:Empty`);
  return normalized;
}

function canonicalUintDecimal(value, label) {
  if (typeof value !== "string" || !UINT_DECIMAL.test(value)) {
    throw new Error(`${label}:ExpectedCanonicalUintDecimal`);
  }
  return value;
}

function checkedU32(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`${label}:ExpectedU32`);
  }
  return value;
}

function requireTwoAttesters(attesters) {
  if (!Array.isArray(attesters) || attesters.length !== 2) throw new Error("ExactlyTwoProjectAttestersRequired");
  if (attesters[0] === attesters[1]) throw new Error("DistinctProjectAttestersRequired");
  return [...attesters];
}

function requireObject(value, label) {
  if (!value || typeof value !== "object") throw new Error(`${label}:ExpectedObject`);
  return value;
}

function requireMethodResult(value, label) {
  if (!value || typeof value !== "object") throw new Error(`${label}:ExpectedObjectResult`);
  return value;
}

function normalizeJournalEntry(value) {
  const entry = requireObject(value, "depositJournalEntry");
  if (entry.protocol !== DEPOSIT_PIPELINE_PROTOCOL) throw new Error("DepositJournalProtocolMismatch");
  return {
    protocol: DEPOSIT_PIPELINE_PROTOCOL,
    operationIdHex: normalizeHash32(entry.operationIdHex, "journal.operationIdHex"),
    depositOutpointText: normalizeDepositOutpointText(entry.depositOutpointText),
    encodedMessageHex: normalizeHexBytes(entry.encodedMessageHex, "journal.encodedMessageHex"),
    events: normalizeJournalEvents(entry.events),
    terminal: entry.terminal === undefined ? undefined : structuredClone(entry.terminal),
  };
}

function normalizeJournalEvents(events) {
  if (!Array.isArray(events)) throw new Error("DepositJournalEventsInvalid");
  return events.map((event, index) => {
    const value = requireObject(event, `depositJournalEvent.${index}`);
    if (!Object.values(DEPOSIT_STATES).includes(value.state)) throw new Error("DepositJournalEventStateInvalid");
    if (typeof value.reason !== "string" || value.reason.length === 0) throw new Error("DepositJournalEventReasonInvalid");
    if (value.sequence !== index + 1) throw new Error("DepositJournalEventSequenceInvalid");
    return {
      state: value.state,
      reason: value.reason,
      sequence: value.sequence,
    };
  });
}

function assertSameJournalEntry(existing, operationIdHex, depositOutpointText, encodedMessageHex) {
  if (
    existing.operationIdHex !== operationIdHex ||
    existing.depositOutpointText !== depositOutpointText ||
    existing.encodedMessageHex !== encodedMessageHex
  ) {
    throw new Error("DepositOperationReplayAltered");
  }
}

function validateStateRootOutsideRepo(root, repoRoot, label) {
  if (typeof root !== "string" || root.length === 0) throw new Error(`${label}:Required`);
  const resolved = path.resolve(root);
  const relative = path.relative(path.resolve(repoRoot), resolved);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error(`${label}:InsideRepositoryRejected`);
  }
  return resolved;
}

function checkedAdd(left, right) {
  if (left < 0n || right < 0n) throw new Error("LedgerNegativeOperand");
  const result = left + right;
  if (result > 0xffff_ffff_ffff_ffff_ffff_ffff_ffff_ffffn) throw new Error("LedgerArithmeticOverflow");
  return result;
}

function checkedSub(left, right) {
  if (left < 0n || right < 0n) throw new Error("LedgerNegativeOperand");
  if (right > left) throw new Error("LedgerInsufficientFunds");
  return left - right;
}
