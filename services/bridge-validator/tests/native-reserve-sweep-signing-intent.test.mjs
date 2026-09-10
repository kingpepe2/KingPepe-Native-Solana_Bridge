import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { REGTEST_GENESIS } from "../../../native/node/native-raw-evidence.mjs";
import {
  FROST_SIGNING_INTENT_PROTOCOL,
  FROST_SIGNING_MODE,
} from "../../../native/frost/index.mjs";
import {
  LOCAL_NATIVE_RESERVE_SWEEP_SIGNING_INTENT_PROTOCOL,
  LOCAL_NATIVE_TAPROOT_SIGHASH_EVIDENCE_PROTOCOL,
  prepareLocalNativeReserveSweepSigningIntent,
} from "../native-reserve-sweep-signing-intent.mjs";

const ZERO_HASH = "00".repeat(32);

function h(label) {
  return createHash("sha256").update(label).digest("hex");
}

function p2tr(label) {
  return `5120${h(label)}`;
}

function baseInput(overrides = {}) {
  const depositOutpoint = `${h("phase08-local-deposit")}:1`;
  const feeFundingOutpoint = `${h("phase08-local-fee-funding")}:0`;
  const reserveScript = p2tr("phase08-local-canonical-reserve");
  const base = {
    config: {
      environment: "localnet",
      nativeNetworkName: "regtest",
      nativeGenesisHash: REGTEST_GENESIS,
      solanaDeployment: h("solana-local-deployment"),
      bridgeProgramId: h("bridge-program-id"),
      transceiverProgramId: h("transceiver-program-id"),
      mint: h("kpepe-local-mint"),
      keyEpoch: 1,
      maxAmountAtomic: "1000000000",
      maxFeeAtomic: "10000",
    },
    operationIdHex: h("deposit-operation-id"),
    deposit: {
      depositOutpoint,
      amountAtomic: "100000000",
      proofFingerprintHex: h("validated-local-native-proof"),
      finalitySatisfied: true,
      utxoUnspent: true,
      noPriorConsumption: true,
    },
    reserveSweepDraft: {
      state: "UNSIGNED_DRAFT_ONLY",
      depositOutpoint,
      reserveAmountAtomic: "100000000",
      nativeMinerFeeAtomic: "1000",
      feeFundingOutpoints: [feeFundingOutpoint],
      unsignedNativeTransactionFingerprintHex: h("unsigned-reserve-sweep-raw-tx"),
      proofFingerprintHex: h("validated-local-native-proof"),
      signed: false,
      broadcast: false,
    },
    nativeSighashEvidence: {
      protocol: LOCAL_NATIVE_TAPROOT_SIGHASH_EVIDENCE_PROTOCOL,
      state: "LOCALLY_VALIDATED_NATIVE_SIGHASH",
      unsignedNativeTransactionFingerprintHex: h("unsigned-reserve-sweep-raw-tx"),
      nativeSweepTxidHex: h("reserve-sweep-txid"),
      unsignedNativeTransactionId: h("reserve-sweep-txid"),
      transactionCommitment: h("reserve-sweep-transaction-commitment"),
      taprootSighashHex: h("reserve-sweep-taproot-sighash"),
      proofFingerprintHex: h("validated-local-native-proof"),
      signingInputIndex: 0,
      recipientScriptPubKeyHex: reserveScript,
      changeScriptPubKeyHex: reserveScript,
      changeAtomic: "0",
      nativeMinerFeeAtomic: "1000",
      reserveAmountAtomic: "100000000",
      inputOutpoints: [depositOutpoint, feeFundingOutpoint],
      outputCommitments: [h("reserve-sweep-output-0")],
      reserveCommitment: h("canonical-reserve-commitment"),
    },
  };
  return deepMerge(base, overrides);
}

test("validated local reserve-sweep sighash evidence produces a FROST signing intent and signer authorization", () => {
  const prepared = prepareLocalNativeReserveSweepSigningIntent(baseInput());

  assert.equal(prepared.protocol, LOCAL_NATIVE_RESERVE_SWEEP_SIGNING_INTENT_PROTOCOL);
  assert.equal(prepared.state, "VERIFIED_READY");
  assert.equal(prepared.productionReady, false);
  assert.equal(prepared.mainnetActivation, "DISABLED");
  assert.equal(prepared.signerPolicyDecision.result, "APPROVED");
  assert.match(prepared.signingIntentDigestHex, /^[0-9a-f]{64}$/u);
  assert.equal(prepared.signingIntent.protocol, FROST_SIGNING_INTENT_PROTOCOL);
  assert.equal(prepared.signingIntent.mode, FROST_SIGNING_MODE);
  assert.equal(prepared.signingIntent.purpose, "RESERVE_SWEEP");
  assert.equal(prepared.signingIntent.nativeNetwork, "regtest");
  assert.equal(prepared.signingIntent.withdrawalId, ZERO_HASH);
  assert.equal(prepared.signingIntent.amountAtomic, "100000000");
  assert.equal(prepared.signingIntent.feeAtomic, "1000");
  assert.equal(prepared.signingIntent.changeAtomic, "0");
  assert.deepEqual(prepared.signingIntent.inputOutpoints, baseInput().nativeSighashEvidence.inputOutpoints);
  assert.equal(prepared.authorizedOperation.taprootSighashHex, prepared.signingIntent.taprootSighashHex);
  assert.equal(prepared.authorizedOperation.signingInputIndex, 0);
});

test("validated fee-funding input sighash evidence produces a distinct FROST signing intent", () => {
  const prepared = prepareLocalNativeReserveSweepSigningIntent(
    baseInput({
      nativeSighashEvidence: {
        signingInputIndex: 1,
        taprootSighashHex: h("reserve-sweep-fee-funding-input-sighash"),
      },
    }),
  );

  assert.equal(prepared.state, "VERIFIED_READY");
  assert.equal(prepared.signingIntent.signingInputIndex, 1);
  assert.equal(prepared.authorizedOperation.signingInputIndex, 1);
  assert.equal(prepared.signerPolicyDecision.result, "APPROVED");
});

test("missing or unvalidated Native sighash evidence cannot produce a signing intent", () => {
  assert.throws(
    () => prepareLocalNativeReserveSweepSigningIntent(baseInput({ nativeSighashEvidence: undefined })),
    /nativeSighashEvidence:ExpectedObject/u,
  );
  assert.throws(
    () =>
      prepareLocalNativeReserveSweepSigningIntent(
        baseInput({
          nativeSighashEvidence: {
            protocol: "WRONG_PROTOCOL",
            state: "LOCALLY_VALIDATED_NATIVE_SIGHASH",
          },
        }),
      ),
    /WrongSighashEvidenceProtocol/u,
  );
  assert.throws(
    () =>
      prepareLocalNativeReserveSweepSigningIntent(
        baseInput({
          nativeSighashEvidence: {
            protocol: LOCAL_NATIVE_TAPROOT_SIGHASH_EVIDENCE_PROTOCOL,
            state: "RPC_ONLY",
          },
        }),
      ),
    /SighashEvidenceNotValidated/u,
  );
});

test("signing intent preparation rejects altered sweep evidence before FROST can sign", () => {
  assert.throws(
    () =>
      prepareLocalNativeReserveSweepSigningIntent(
        baseInput({
          nativeSighashEvidence: {
            unsignedNativeTransactionFingerprintHex: h("different-unsigned-tx"),
          },
        }),
      ),
    /UnsignedTransactionMismatch/u,
  );
  assert.throws(
    () =>
      prepareLocalNativeReserveSweepSigningIntent(
        baseInput({
          nativeSighashEvidence: {
            inputOutpoints: [`${h("different-deposit")}:1`],
          },
        }),
      ),
    /InputOutpointMismatch/u,
  );
  assert.throws(
    () =>
      prepareLocalNativeReserveSweepSigningIntent(
        baseInput({
          nativeSighashEvidence: {
            nativeMinerFeeAtomic: "2000",
          },
        }),
      ),
    /FeeMismatch/u,
  );
  assert.throws(
    () =>
      prepareLocalNativeReserveSweepSigningIntent(
        baseInput({
          reserveSweepDraft: {
            reserveAmountAtomic: "99998000",
          },
        }),
      ),
    /ReserveAmountMismatch/u,
  );
  assert.throws(
    () =>
      prepareLocalNativeReserveSweepSigningIntent(
        baseInput({
          nativeSighashEvidence: {
            inputOutpoints: [baseInput().deposit.depositOutpoint],
          },
          reserveSweepDraft: {
            feeFundingOutpoints: [],
          },
        }),
      ),
    /FeeFundingInputRequired/u,
  );
});

test("local signing-intent builder stays localnet and regtest only", () => {
  assert.throws(
    () =>
      prepareLocalNativeReserveSweepSigningIntent(
        baseInput({
          config: {
            environment: "production",
          },
        }),
      ),
    /LocalnetOnly/u,
  );
  assert.throws(
    () =>
      prepareLocalNativeReserveSweepSigningIntent(
        baseInput({
          config: {
            nativeNetworkName: "mainnet",
          },
        }),
      ),
    /RegtestOnly/u,
  );
});

function deepMerge(base, overrides) {
  if (overrides === undefined) return structuredClone(base);
  if (base === null || typeof base !== "object" || Array.isArray(base)) {
    return structuredClone(overrides);
  }
  const merged = structuredClone(base);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete merged[key];
      continue;
    }
    merged[key] =
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      merged[key] !== null &&
      typeof merged[key] === "object" &&
      !Array.isArray(merged[key])
        ? deepMerge(merged[key], value)
        : structuredClone(value);
  }
  return merged;
}
