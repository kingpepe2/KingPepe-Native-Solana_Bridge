// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Real ephemeral packet signature; execution metadata below is a parser fixture.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { createHash, randomBytes } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { encodeCanonicalBridgeMessage, decodeCanonicalBridgeMessage } from "../../../shared/protocol/canonical-message.mjs";
import { base58Encode, prepareSignedLocalnetSolanaDepositClaimTransaction } from "../../bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { verifyDepositMintExecution } from "../deposit-mint-execution.mjs";
const h = v => createHash("sha256").update(v).digest("hex");
let fixture;
before(async () => {
  const config = { environment: "localnet", cluster: "localnet", managerProgramIdHex: h("manager"), transceiverProgramIdHex: h("transceiver"),
    mintHex: h("mint"), nativeDecimals: 8 };
  const messageBytes = encodeCanonicalBridgeMessage({ action: "DepositClaim", direction: "NativeToSolana",
    deployment: { protocolId: 1, nativeNetwork: 8000111, nativeGenesis: h("genesis"), solanaDeployment: h("deployment"),
      managerProgramId: config.managerProgramIdHex, transceiverProgramId: config.transceiverProgramIdHex, mint: config.mintHex },
    depositOutpoint: { txid: h("deposit"), vout: 0 }, withdrawalId: "00".repeat(32), amountAtomic: "100000000", feeAtomic: "0",
    destination: Buffer.from(h("recipient"), "hex"), policyEpoch: 1, keyEpoch: 1, nonce: h("nonce"), validFrom: "1", validUntil: "4102444800", evidenceDigest: h("evidence") });
  const message = decodeCanonicalBridgeMessage(messageBytes), seed = randomBytes(32), publicKeyHex = Buffer.from(ed25519.getPublicKey(seed)).toString("hex");
  let packet;
  try { packet = await prepareSignedLocalnetSolanaDepositClaimTransaction({ ...config, encodedMessageHex: Buffer.from(messageBytes).toString("hex"),
    tokenProgramIdBase58: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", recipientTokenAccountHex: message.destinationHex,
    feePayerHex: publicKeyHex, recentBlockhashHex: h("blockhash"), lastValidBlockHeight: "50",
    feePayerSigner: { publicKeyHex, sign: bytes => ed25519.sign(bytes, seed) } }); } finally { seed.fill(0); }
  const observation = { slot: "10", transaction: { signature: packet.signatures[0].signatureBase58 },
    depositClaim: { operationIdHex: message.operationIdHex, messageDigestHex: message.messageDigestHex,
      mintedAmountAtomic: message.amountAtomic.toString(), solanaRecipientHex: message.destinationHex } };
  const data = Buffer.alloc(10); data[0] = 14; data.writeBigUInt64LE(message.amountAtomic, 1); data[9] = 8;
  const balance = amount => ({ accountIndex: 4, mint: base58Encode(Buffer.from(config.mintHex, "hex")),
    programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", uiTokenAmount: { amount, decimals: 8 } });
  const result = { version: "legacy", slot: 10, transaction: [packet.preparedTransactionBase64, "base64"], meta: { err: null,
    innerInstructions: [{ index: 0, instructions: [{ programIdIndex: 8, accounts: [3, 4, 7], data: base58Encode(data), stackHeight: 2 }] }],
    preTokenBalances: [balance("12")], postTokenBalances: [balance("100000012")] } };
  fixture = { config, observation, result };
});
test("exact signed claim packet agrees with reported MintToChecked and integer balance delta", () => {
  assert.equal(verifyDepositMintExecution(fixture.result, fixture.observation, fixture.config).amountAtomic, "100000000");
});
for (const [name, change] of [
  ["unrelated transaction signature", v => { v.observation.transaction.signature = base58Encode(Buffer.alloc(64, 3)); }],
  ["wrong transaction slot", v => { v.result.slot = 11; }],
  ["failed transaction", v => { v.result.meta.err = { InstructionError: [1, "InvalidArgument"] }; }],
  ["missing execution status", v => { delete v.result.meta.err; }],
  ["unsupported message version", v => { v.result.version = 0; }],
  ["wrong encoding", v => { v.result.transaction[1] = "json"; }],
  ["corrupt fee-payer signature", v => { const p = Buffer.from(v.result.transaction[0], "base64"); p[1] ^= 1; v.result.transaction[0] = p.toString("base64"); }],
  ["changed canonical packet", v => { const p = Buffer.from(v.result.transaction[0], "base64"); p[p.length - 1] ^= 1; v.result.transaction[0] = p.toString("base64"); }],
  ["trailing packet bytes", v => { v.result.transaction[0] = Buffer.concat([Buffer.from(v.result.transaction[0], "base64"), Buffer.of(0)]).toString("base64"); }],
  ["oversized packet", v => { v.result.transaction[0] = Buffer.alloc(1233).toString("base64"); }],
  ["wrong Manager", v => { v.config.managerProgramIdHex = h("other manager"); }],
  ["wrong Transceiver", v => { v.config.transceiverProgramIdHex = h("other transceiver"); }],
  ["wrong Mint", v => { v.config.mintHex = h("other mint"); }],
  ["wrong precision", v => { v.config.nativeDecimals = 9; }],
  ["wrong claim", v => { v.observation.depositClaim.operationIdHex = h("other operation"); }],
  ["wrong amount", v => { v.observation.depositClaim.mintedAmountAtomic = "2"; }],
  ["wrong recipient", v => { v.observation.depositClaim.solanaRecipientHex = h("other recipient"); }],
  ["missing CPI trace", v => { v.result.meta.innerInstructions = null; }],
  ["wrong outer instruction", v => { v.result.meta.innerInstructions[0].index = 1; }],
  ["duplicate mint CPI", v => { v.result.meta.innerInstructions[0].instructions.push(structuredClone(v.result.meta.innerInstructions[0].instructions[0])); }],
  ["wrong Token Program CPI", v => { v.result.meta.innerInstructions[0].instructions[0].programIdIndex = 9; }],
  ["wrong mint CPI accounts", v => { v.result.meta.innerInstructions[0].instructions[0].accounts = [3, 5, 7]; }],
  ["wrong mint CPI amount", v => { v.result.meta.innerInstructions[0].instructions[0].data = base58Encode(Buffer.alloc(10, 4)); }],
  ["wrong CPI stack height", v => { v.result.meta.innerInstructions[0].instructions[0].stackHeight = 3; }],
  ["missing recipient delta", v => { v.result.meta.postTokenBalances = []; }],
  ["ambiguous duplicate balance", v => { v.result.meta.postTokenBalances.push(v.result.meta.postTokenBalances[0]); }],
  ["wrong delta", v => { v.result.meta.postTokenBalances[0].uiTokenAmount.amount = "100000013"; }],
  ["number instead of integer text", v => { v.result.meta.postTokenBalances[0].uiTokenAmount.amount = 100000012; }],
  ["wrong balance mint", v => { v.result.meta.postTokenBalances[0].mint = base58Encode(Buffer.alloc(32, 5)); }],
  ["wrong balance program", v => { v.result.meta.postTokenBalances[0].programId = base58Encode(Buffer.alloc(32, 6)); }],
]) test("mint execution rejects " + name, () => { const v = structuredClone(fixture); change(v);
  assert.throws(() => verifyDepositMintExecution(v.result, v.observation, v.config), /SOLANA_CLAIM_EXECUTION_MISMATCH/u); });
