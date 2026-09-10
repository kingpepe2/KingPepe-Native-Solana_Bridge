import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { RPC_OBSERVATION, SOURCE_READY } from "../../../native/node/native-rpc-client.mjs";
import {
  FROST_SIGNING_INTENT_PROTOCOL,
  FROST_SIGNING_MODE,
  REQUIRED_FROST_SIGNERS,
  nativeSigningIntentDigest,
} from "../../../native/frost/policy/native-signing-policy.mjs";
import { DEPOSIT_STATES } from "../automatic-deposit-pipeline.mjs";
import {
  FileBackedNativeReserveSweepJournal,
  InMemoryNativeReserveSweepJournal,
  NativeReserveSweepRelayer,
  NativeReserveSweepVerifier,
} from "../native-reserve-sweep-adapters.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const ZERO_HASH = "00".repeat(32);

function h(label) {
  return createHash("sha256").update(label).digest("hex");
}

function p2tr(label) {
  return `5120${h(label)}`;
}

function outpoint(label, index = 0) {
  return { txid: h(label), vout: index };
}

function baseSigningIntent(overrides = {}) {
  return {
    protocol: FROST_SIGNING_INTENT_PROTOCOL,
    mode: FROST_SIGNING_MODE,
    purpose: "RESERVE_SWEEP",
    nativeNetwork: "regtest",
    nativeGenesisHash: h("kingpepe-regtest-genesis"),
    solanaDeployment: h("solana-local-deployment"),
    bridgeProgramId: h("bridge-program-id"),
    transceiverProgramId: h("transceiver-program-id"),
    mint: h("kpepe-mint"),
    keyEpoch: 1,
    signingRequestId: h("reserve-sweep-signing-request"),
    operationId: h("deposit-operation"),
    withdrawalId: ZERO_HASH,
    proofFingerprint: h("validated-native-deposit-proof"),
    unsignedNativeTransactionId: h("unsigned-reserve-sweep-txid"),
    transactionCommitment: h("reserve-sweep-transaction-commitment"),
    signingInputIndex: 0,
    taprootSighashHex: h("reserve-sweep-sighash"),
    recipientScriptPubKeyHex: p2tr("canonical-reserve"),
    amountAtomic: "250000000",
    feeAtomic: "1200",
    changeScriptPubKeyHex: p2tr("canonical-reserve"),
    changeAtomic: "0",
    inputOutpoints: [`${h("phase08-deposit-outpoint")}:2`],
    outputCommitments: [h("reserve-sweep-output")],
    reserveCommitment: h("reserve-commitment"),
    pauseWithdrawals: false,
    hardStop: false,
    ...overrides,
  };
}

function frostResultFor(intent, overrides = {}) {
  return {
    state: "SIGNED",
    requestId: intent.signingRequestId,
    intentDigest: nativeSigningIntentDigest(intent),
    messageHex: intent.taprootSighashHex,
    signerIds: REQUIRED_FROST_SIGNERS,
    ...overrides,
  };
}

function relayerRequest(overrides = {}) {
  const signingIntent = overrides.signingIntent ?? baseSigningIntent();
  return {
    operationIdHex: signingIntent.operationId,
    encodedMessageHex: h("encoded-message"),
    signingIntent,
    frostResult: frostResultFor(signingIntent, overrides.frostResult),
    signedNativeTransactionHex: "02000000000100",
    expectedNativeSweepTxidHex: h("native-sweep-txid"),
    ...overrides.request,
  };
}

function verifierRequest(overrides = {}) {
  const depositOutpoint = outpoint("phase08-deposit-outpoint", 2);
  const nativeSweepTxidHex = h("native-sweep-txid");
  return {
    operationIdHex: h("deposit-operation"),
    encodedMessageHex: h("encoded-message"),
    evidenceDigestHex: h("deposit-reserve-evidence"),
    deposit: {
      trust: RPC_OBSERVATION,
      nativeNetwork: 8_000_111,
      nativeGenesisHash: h("kingpepe-regtest-genesis"),
      depositOutpoint,
      amountAtomic: "250000000",
      solanaRecipientHex: h("solana-recipient"),
      utxoUnspentAtDeposit: true,
      noPriorConsumption: true,
      ...overrides.deposit,
    },
    reserveSweep: {
      reserveAllocationIdHex: h("reserve-allocation"),
      nativeSweepTxidHex,
      nativeMinerFeeAtomic: "1200",
      canonicalReserveScriptPubKeyHex: p2tr("canonical-reserve"),
      ...overrides.reserveSweep,
    },
    broadcast: {
      nativeSweepTxidHex,
      ...overrides.broadcast,
    },
  };
}

class FakeNativeRpc {
  constructor(options = {}) {
    this.sendResults = options.sendResults ?? [h("native-sweep-txid")];
    this.sends = [];
    this.sourceState = options.sourceState ?? SOURCE_READY;
    this.confirmations = options.confirmations ?? 8;
    this.reserveValueAtomic = options.reserveValueAtomic ?? "250000000";
    this.reserveScriptPubKeyHex = options.reserveScriptPubKeyHex ?? p2tr("canonical-reserve");
    this.includeDepositInput = options.includeDepositInput !== false;
  }

  async sendRawTransaction(rawTransactionHex) {
    this.sends.push(rawTransactionHex);
    return this.sendResults[Math.min(this.sends.length - 1, this.sendResults.length - 1)];
  }

  async getSourceSnapshot() {
    return {
      trust: RPC_OBSERVATION,
      state: this.sourceState,
      network: "regtest",
      genesisHash: h("kingpepe-regtest-genesis"),
    };
  }

  async getRawTransaction(txid) {
    const request = verifierRequest();
    return {
      txid,
      confirmations: this.confirmations,
      vin: this.includeDepositInput ? [{ txid: request.deposit.depositOutpoint.txid, vout: request.deposit.depositOutpoint.vout }] : [],
      vout: [
        {
          n: 0,
          valueAtomic: this.reserveValueAtomic,
          scriptPubKey: {
            hex: this.reserveScriptPubKeyHex,
          },
        },
      ],
    };
  }
}

test("Native reserve sweep relayer persists before broadcast and retries idempotently", async () => {
  const rpc = new FakeNativeRpc();
  const relayer = new NativeReserveSweepRelayer({
    rpcClient: rpc,
    journal: new InMemoryNativeReserveSweepJournal(),
  });
  const request = relayerRequest();
  const first = await relayer.broadcastReserveSweep(request);
  const second = await relayer.broadcastReserveSweep(request);
  assert.equal(first.state, DEPOSIT_STATES.BROADCAST);
  assert.equal(first.reason, "NATIVE_RESERVE_SWEEP_BROADCAST_ACCEPTED");
  assert.equal(second.reason, "NATIVE_RESERVE_SWEEP_ALREADY_SUBMITTED");
  assert.equal(second.nativeSweepTxidHex, first.nativeSweepTxidHex);
  assert.equal(rpc.sends.length, 1);
});

test("Native reserve sweep relayer rejects altered FROST transcript before broadcast", async () => {
  const rpc = new FakeNativeRpc();
  const relayer = new NativeReserveSweepRelayer({ rpcClient: rpc });
  const signingIntent = baseSigningIntent();
  await assert.rejects(
    () =>
      relayer.broadcastReserveSweep(
        relayerRequest({
          signingIntent,
          frostResult: {
            intentDigest: h("wrong-intent-digest"),
          },
        }),
      ),
    /NativeReserveSweepFrostIntentMismatch/u,
  );
  assert.equal(rpc.sends.length, 0);
});

test("Native reserve sweep relayer hard-stops if the node returns a different txid", async () => {
  const rpc = new FakeNativeRpc({ sendResults: [h("unexpected-native-sweep-txid")] });
  const relayer = new NativeReserveSweepRelayer({ rpcClient: rpc });
  const result = await relayer.broadcastReserveSweep(relayerRequest());
  assert.equal(result.state, DEPOSIT_STATES.HARD_STOP);
  assert.equal(result.reason, "NATIVE_RESERVE_SWEEP_TXID_MISMATCH");
  assert.equal(rpc.sends.length, 1);
});

for (const persistent of [false, true]) {
  test(`${persistent ? "file" : "memory"} Native sweep hard stop survives retry and late journal writes`, async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-sweep-stop-"));
    try {
      let journal = persistent ? new FileBackedNativeReserveSweepJournal({ root, repoRoot: REPO_ROOT }) : new InMemoryNativeReserveSweepJournal();
      const rpc = new FakeNativeRpc({ sendResults: [h("wrong-response"), h("native-sweep-txid")] });
      const request = relayerRequest();
      const first = await new NativeReserveSweepRelayer({ rpcClient: rpc, journal }).broadcastReserveSweep(request);
      assert.equal(first.state, DEPOSIT_STATES.HARD_STOP);
      if (persistent) journal = new FileBackedNativeReserveSweepJournal({ root, repoRoot: REPO_ROOT });
      const retry = await new NativeReserveSweepRelayer({ rpcClient: rpc, journal }).broadcastReserveSweep(request);
      assert.deepEqual(retry, first);
      assert.equal(rpc.sends.length, 1);
      assert.throws(() => journal.recordSubmitted(request.operationIdHex, request.expectedNativeSweepTxidHex), /HardStop/u);
      assert.throws(() => journal.recordTerminal(request.operationIdHex, { ...first, state: DEPOSIT_STATES.BROADCAST }), /Terminal|HardStop/u);
      journal.recordTerminal(request.operationIdHex, first);
      assert.deepEqual(journal.get(request.operationIdHex).result, first);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test("Native reserve sweep verifier reports canonical reserve evidence from finalized local RPC observation", async () => {
  const verifier = new NativeReserveSweepVerifier({
    rpcClient: new FakeNativeRpc(),
    config: {
      requiredConfirmations: 6,
      expectedSourceNetwork: "regtest",
    },
  });
  const result = await verifier.verifyFinalizedReserveSweep(verifierRequest());
  assert.equal(result.trust, RPC_OBSERVATION);
  assert.equal(result.reserveTransitionState, "CANONICAL_RESERVE");
  assert.equal(result.mintCreditState, "AUTHORIZED_UNCONSUMED");
  assert.equal(result.finalitySatisfied, true);
  assert.equal(result.sweepFinalized, true);
  assert.equal(result.amountAtomic, "250000000");
});

for (const fileBacked of [false, true]) {
  for (const rejectResponse of [false, true]) {
    test(`${fileBacked ? "file" : "memory"} Native late ${rejectResponse ? "failure" : "success"} preserves an in-flight integrity stop`, async () => {
      const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-sweep-late-stop-"));
      try {
        const journal = fileBacked ? new FileBackedNativeReserveSweepJournal({ root, repoRoot: REPO_ROOT }) : new InMemoryNativeReserveSweepJournal();
        const request = relayerRequest();
        const entered = Promise.withResolvers();
        const response = Promise.withResolvers();
        let sends = 0;
        const rpcClient = { async sendRawTransaction() { sends++; entered.resolve(); return response.promise; } };
        const relayer = new NativeReserveSweepRelayer({ config: { environment: "localnet" }, rpcClient, journal });
        const pending = relayer.broadcastReserveSweep(request);
        await entered.promise;
        const writer = fileBacked ? new FileBackedNativeReserveSweepJournal({ root, repoRoot: REPO_ROOT }) : journal;
        const stopped = { state: DEPOSIT_STATES.HARD_STOP, reason: "NATIVE_INTEGRITY_STOP", operationIdHex: request.operationIdHex };
        writer.recordTerminal(request.operationIdHex, stopped);
        if (rejectResponse) response.reject(new Error("TestResponseLost"));
        else response.resolve(request.expectedNativeSweepTxidHex);
        assert.deepEqual(await pending, stopped);
        assert.deepEqual(await relayer.broadcastReserveSweep(request), stopped);
        assert.equal(sends, 1);
        assert.equal(journal.submitted(request.operationIdHex), undefined);
        const copy = journal.get(request.operationIdHex);
        copy.result.state = DEPOSIT_STATES.BROADCAST;
        assert.deepEqual(journal.get(request.operationIdHex).result, stopped);
      } finally { rmSync(root, { recursive: true, force: true }); }
    });
  }
}

test("Native reserve sweep verifier waits for finality instead of approving early", async () => {
  const verifier = new NativeReserveSweepVerifier({
    rpcClient: new FakeNativeRpc({ confirmations: 2 }),
    config: {
      requiredConfirmations: 6,
      expectedSourceNetwork: "regtest",
    },
  });
  const result = await verifier.verifyFinalizedReserveSweep(verifierRequest());
  assert.equal(result.reserveTransitionState, "CANONICAL_RESERVE");
  assert.equal(result.finalitySatisfied, false);
  assert.equal(result.sweepFinalized, false);
});

test("Native reserve sweep verifier rejects broadcast txid substitution", async () => {
  const verifier = new NativeReserveSweepVerifier({
    rpcClient: new FakeNativeRpc(),
    config: {
      requiredConfirmations: 6,
      expectedSourceNetwork: "regtest",
    },
  });
  await assert.rejects(
    () =>
      verifier.verifyFinalizedReserveSweep(
        verifierRequest({
          broadcast: {
            nativeSweepTxidHex: h("substituted-sweep-txid"),
          },
        }),
      ),
    /NativeReserveSweepBroadcastTxidMismatch/u,
  );
});

test("Native reserve sweep verifier refuses wrong amount, script, or missing deposit input", async () => {
  for (const rpc of [
    new FakeNativeRpc({ reserveValueAtomic: "249999999" }),
    new FakeNativeRpc({ reserveScriptPubKeyHex: p2tr("wrong-reserve") }),
    new FakeNativeRpc({ includeDepositInput: false }),
    new FakeNativeRpc({ reserveValueAtomic: 250000000 }),
  ]) {
    const verifier = new NativeReserveSweepVerifier({
      rpcClient: rpc,
      config: {
        requiredConfirmations: 6,
        expectedSourceNetwork: "regtest",
      },
    });
    const result = await verifier.verifyFinalizedReserveSweep(verifierRequest());
    assert.equal(result.reserveTransitionState, "INVALID_RESERVE_SWEEP");
    assert.equal(result.mintCreditState, "UNAVAILABLE");
  }
});

test("Native reserve sweep journal rejects source-tree runtime roots", () => {
  assert.throws(
    () =>
      new FileBackedNativeReserveSweepJournal({
        repoRoot: REPO_ROOT,
        root: path.join(REPO_ROOT, "tmp-native-sweep-journal"),
      }),
    /InsideRepositoryRejected/u,
  );

  const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-native-sweep-journal-"));
  try {
    assert.doesNotThrow(
      () =>
        new FileBackedNativeReserveSweepJournal({
          repoRoot: REPO_ROOT,
          root,
        }),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
