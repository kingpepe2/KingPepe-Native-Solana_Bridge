import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  attachKeyPathTaprootWitnesses,
  createLocalTaprootSighashEvidence,
  parseNativeTransactionHex,
  taprootKeyPathSighashDefault,
  taprootPrecomputedHashes,
} from "../native-taproot-transaction.mjs";

// Public BIP-341 wallet test vector data, BSD-3-Clause; see THIRD_PARTY_NOTICES.md.
const BIP341_UNSIGNED_TX =
  "02000000097de20cbff686da83a54981d2b9bab3586f4ca7e48f57f5b55963115f3b334e9c010000000000000000d7b7cab57b1393ace2d064f4d4a2cb8af6def61273e127517d44759b6dafdd990000000000fffffffff8e1f583384333689228c5d28eac13366be082dc57441760d957275419a418420000000000fffffffff0689180aa63b30cb162a73c6d2a38b7eeda2a83ece74310fda0843ad604853b0100000000feffffffaa5202bdf6d8ccd2ee0f0202afbbb7461d9264a25e5bfd3c5a52ee1239e0ba6c0000000000feffffff956149bdc66faa968eb2be2d2faa29718acbfe3941215893a2a3446d32acd050000000000000000000e664b9773b88c09c32cb70a2a3e4da0ced63b7ba3b22f848531bbb1d5d5f4c94010000000000000000e9aa6b8e6c9de67619e6a3924ae25696bb7b694bb677a632a74ef7eadfd4eabf0000000000ffffffffa778eb6a263dc090464cd125c466b5a99667720b1c110468831d058aa1b82af10100000000ffffffff0200ca9a3b000000001976a91406afd46bcdfd22ef94ac122aa11f241244a37ecc88ac807840cb0000000020ac9a87f5594be208f8532db38cff670c450ed2fea8fcdefcc9a663f78bab962b0065cd1d";
const BIP341_UTXOS = Object.freeze([
  { scriptPubKey: "512053a1f6e454df1aa2776a2814a721372d6258050de330b3c6d10ee8f4e0dda343", amountSats: 420000000 },
  { scriptPubKey: "5120147c9c57132f6e7ecddba9800bb0c4449251c92a1e60371ee77557b6620f3ea3", amountSats: 462000000 },
  { scriptPubKey: "76a914751e76e8199196d454941c45d1b3a323f1433bd688ac", amountSats: 294000000 },
  { scriptPubKey: "5120e4d810fd50586274face62b8a807eb9719cef49c04177cc6b76a9a4251d5450e", amountSats: 504000000 },
  { scriptPubKey: "512091b64d5324723a985170e4dc5a0f84c041804f2cd12660fa5dec09fc21783605", amountSats: 630000000 },
  { scriptPubKey: "00147dd65592d0ab2fe0d0257d571abf032cd9db93dc", amountSats: 378000000 },
  { scriptPubKey: "512075169f4001aa68f15bbed28b218df1d0a62cbbcf1188c6665110c293c907b831", amountSats: 672000000 },
  { scriptPubKey: "5120712447206d7a5238acc7ff53fbe94a3b64539ad291c7cdbc490b7577e4b17df5", amountSats: 546000000 },
  { scriptPubKey: "512077e30a5522dd9f894c3f8b8bd4c4b2cf82ca7da8a3ea6a239655c39c050ab220", amountSats: 588000000 },
]);

function h(label) {
  return createHash("sha256").update(label).digest("hex");
}

function p2tr(label) {
  return `5120${h(label)}`;
}

test("BIP341 wallet vector computes the default Taproot key-path sighash", () => {
  const transaction = parseNativeTransactionHex(BIP341_UNSIGNED_TX);
  const precomputed = taprootPrecomputedHashes(transaction, BIP341_UTXOS);

  assert.equal(precomputed.shaAmounts, "58a6964a4f5f8f0b642ded0a8a553be7622a719da71d1f5befcefcdee8e0fde6");
  assert.equal(precomputed.shaOutputs, "a2e6dab7c1f0dcd297c8d61647fd17d821541ea69c3cc37dcbad7f90d4eb4bc5");
  assert.equal(precomputed.shaPrevouts, "e3b33bb4ef3a52ad1fffb555c0d82828eb22737036eaeb02a235d82b909c4c3f");
  assert.equal(precomputed.shaScriptPubKeys, "23ad0f61ad2bca5ba6a7693f50fce988e17c3780bf2b1e720cfbb38fbdd52e21");
  assert.equal(precomputed.shaSequences, "18959c7221ab5ce9e26c3cd67b22c24f8baa54bac281d8e6b05e400e6c3a957e");

  const sighash = taprootKeyPathSighashDefault({
    transaction,
    spentOutputs: BIP341_UTXOS,
    inputIndex: 4,
  });

  assert.equal(
    sighash.sigMsgWithEpochHex,
    "0000020000000065cd1de3b33bb4ef3a52ad1fffb555c0d82828eb22737036eaeb02a235d82b909c4c3f58a6964a4f5f8f0b642ded0a8a553be7622a719da71d1f5befcefcdee8e0fde623ad0f61ad2bca5ba6a7693f50fce988e17c3780bf2b1e720cfbb38fbdd52e2118959c7221ab5ce9e26c3cd67b22c24f8baa54bac281d8e6b05e400e6c3a957ea2e6dab7c1f0dcd297c8d61647fd17d821541ea69c3cc37dcbad7f90d4eb4bc50004000000",
  );
  assert.equal(sighash.sigHashHex, "4f900a0bae3f1446fd48490c2958b5a023228f01661cda3496a11da502a7f7ef");
});

test("local reserve sweep evidence binds P2TR inputs, exact fee, and reserve output", () => {
  const reserveScript = p2tr("phase08-local-reserve-script");
  const unsignedNativeTransactionHex = buildUnsignedTransactionHex({
    inputs: [
      { txid: h("phase08-deposit-outpoint"), vout: 1 },
      { txid: h("phase08-fee-outpoint"), vout: 0 },
    ],
    outputs: [{ amountAtomic: "100000000", scriptPubKeyHex: reserveScript }],
  });

  const evidence = createLocalTaprootSighashEvidence({
    unsignedNativeTransactionHex,
    spentOutputs: [
      { amountAtomic: "100000000", scriptPubKeyHex: reserveScript },
      { amountAtomic: "1000", scriptPubKeyHex: reserveScript },
    ],
    signingInputIndex: 0,
    proofFingerprintHex: h("validated-native-proof"),
    reserveAmountAtomic: "100000000",
    nativeMinerFeeAtomic: "1000",
    expectedRecipientScriptPubKeyHex: reserveScript,
  });

  const parsed = parseNativeTransactionHex(unsignedNativeTransactionHex);
  assert.equal(evidence.state, "LOCALLY_VALIDATED_NATIVE_SIGHASH");
  assert.equal(evidence.nativeSweepTxidHex, parsed.txidHex);
  assert.equal(evidence.unsignedNativeTransactionFingerprintHex, hBytes(unsignedNativeTransactionHex));
  assert.equal(evidence.signingInputIndex, 0);
  assert.equal(evidence.recipientScriptPubKeyHex, reserveScript);
  assert.equal(evidence.changeScriptPubKeyHex, reserveScript);
  assert.equal(evidence.changeAtomic, "0");
  assert.equal(evidence.nativeMinerFeeAtomic, "1000");
  assert.deepEqual(evidence.inputOutpoints, [
    `${h("phase08-deposit-outpoint")}:1`,
    `${h("phase08-fee-outpoint")}:0`,
  ]);

  assert.throws(
    () =>
      createLocalTaprootSighashEvidence({
        unsignedNativeTransactionHex,
        spentOutputs: [
          { amountAtomic: "100000000", scriptPubKeyHex: reserveScript },
          { amountAtomic: "1000", scriptPubKeyHex: reserveScript },
        ],
        signingInputIndex: 0,
        proofFingerprintHex: h("validated-native-proof"),
        reserveAmountAtomic: "100000000",
        nativeMinerFeeAtomic: "999",
        expectedRecipientScriptPubKeyHex: reserveScript,
      }),
    /FeeMismatch/u,
  );
});

test("key-path witness attachment preserves txid and rejects malformed signatures", () => {
  const reserveScript = p2tr("phase08-local-reserve-script");
  const unsignedNativeTransactionHex = buildUnsignedTransactionHex({
    inputs: [
      { txid: h("phase08-deposit-outpoint"), vout: 1 },
      { txid: h("phase08-fee-outpoint"), vout: 0 },
    ],
    outputs: [{ amountAtomic: "100000000", scriptPubKeyHex: reserveScript }],
  });
  const unsigned = parseNativeTransactionHex(unsignedNativeTransactionHex);
  const signed = attachKeyPathTaprootWitnesses({
    unsignedNativeTransactionHex,
    signatures: [h("signature-a") + h("signature-a-tail"), h("signature-b") + h("signature-b-tail")],
  });
  const parsedSigned = parseNativeTransactionHex(signed.rawSignedTransactionHex);

  assert.equal(signed.txidHex, unsigned.txidHex);
  assert.notEqual(signed.wtxidHex, unsigned.wtxidHex);
  assert.equal(parsedSigned.hasWitness, true);
  assert.equal(parsedSigned.inputs[0].witness.length, 1);
  assert.equal(parsedSigned.inputs[0].witness[0].length, 64);

  assert.throws(
    () =>
      attachKeyPathTaprootWitnesses({
        unsignedNativeTransactionHex,
        signatures: [h("too-short")],
      }),
    /SignaturesLengthMismatch/u,
  );
  assert.throws(
    () =>
      attachKeyPathTaprootWitnesses({
        unsignedNativeTransactionHex,
        signatures: ["00".repeat(65), "11".repeat(64)],
      }),
    /DefaultSighashByteMustBeOmitted/u,
  );
  assert.throws(
    () =>
      attachKeyPathTaprootWitnesses({
        unsignedNativeTransactionHex,
        signatures: ["00".repeat(64) + "01", "11".repeat(64)],
      }),
    /NonDefaultSighashByteUnsupported/u,
  );
});

function buildUnsignedTransactionHex({ inputs, outputs }) {
  return [
    "02000000",
    varintHex(inputs.length),
    ...inputs.map((input) => `${reverse32(input.txid)}${uint32Hex(input.vout)}00ffffffff`),
    varintHex(outputs.length),
    ...outputs.map((output) => `${uint64Hex(BigInt(output.amountAtomic))}${varintHex(output.scriptPubKeyHex.length / 2)}${output.scriptPubKeyHex}`),
    "00000000",
  ].join("");
}

function hBytes(hex) {
  return createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");
}

function reverse32(hex) {
  assert.match(hex, /^[0-9a-f]{64}$/u);
  return Buffer.from(hex, "hex").reverse().toString("hex");
}

function varintHex(value) {
  assert.ok(Number.isSafeInteger(value) && value >= 0 && value < 0xfd);
  return value.toString(16).padStart(2, "0");
}

function uint32Hex(value) {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value, 0);
  return out.toString("hex");
}

function uint64Hex(value) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value, 0);
  return out.toString("hex");
}
