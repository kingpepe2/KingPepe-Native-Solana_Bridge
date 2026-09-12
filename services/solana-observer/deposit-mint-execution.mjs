// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Verifies the exact current legacy claim packet and its reported execution.
// RPC metadata is still RPC_OBSERVATION, not independent Solana consensus.
import { decodeCanonicalBridgeMessage, MESSAGE_LENGTH } from "../../shared/protocol/canonical-message.mjs";
import { base58Encode, verifySignedLocalnetSolanaDepositClaimTransaction } from "../bridge-validator/solana-deposit-claim-transaction-plan.mjs";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const check = v => { if (!v) throw new Error("SOLANA_CLAIM_EXECUTION_MISMATCH"); };
const uint = v => { check(typeof v === "string" && /^(0|[1-9][0-9]{0,19})$/u.test(v) && BigInt(v) <= 0xffff_ffff_ffff_ffffn); return BigInt(v); };
function balance(entries, mint, decimals) {
  check(Array.isArray(entries) && entries.length <= 13);
  const matches = entries.filter(b => b?.accountIndex === 4); check(matches.length === 1);
  const b = matches[0]; check(b.mint === mint && b.programId === TOKEN_PROGRAM && b.uiTokenAmount?.decimals === decimals);
  return uint(b.uiTokenAmount.amount);
}

export function verifyDepositMintExecution(result, observation, config) {
  let stage = "RPC_ENVELOPE";
  try {
    check(result?.version === "legacy" && result.meta?.err === null && String(result.slot) === observation.slot);
    check(Array.isArray(result.transaction) && result.transaction.length === 2 && result.transaction[1] === "base64");
    const encoded = result.transaction[0]; check(typeof encoded === "string" && encoded.length <= 1644);
    const packet = Buffer.from(encoded, "base64");
    stage = "CANONICAL_PACKET";
    // The complete signed packet is rebuilt and compared below; these offsets
    // extract fields ONLY for that canonical format, never for generic messages.
    check(packet.length >= 1031 && packet.length <= 1232 && packet.toString("base64") === encoded &&
      packet[0] === 1 && packet.subarray(65, 69).equals(Buffer.from([1, 0, 7, 13])));
    // Manager claim is first; the trailing eight bytes encode ComputeBudget.
    const bytes = packet.subarray(-(MESSAGE_LENGTH + 8), -8), message = decodeCanonicalBridgeMessage(bytes);
    stage = "CLAIM_IDENTITY";
    check(message.operationIdHex === observation.depositClaim.operationIdHex && message.messageDigestHex === observation.depositClaim.messageDigestHex &&
      message.amountAtomic.toString() === observation.depositClaim.mintedAmountAtomic && message.destinationHex === observation.depositClaim.solanaRecipientHex &&
      message.action === "DepositClaim" && message.direction === "NativeToSolana" && message.feeAtomic === 0n);
    stage = "SIGNED_PACKET";
    const verified = verifySignedLocalnetSolanaDepositClaimTransaction({
      environment: "localnet", cluster: "localnet", managerProgramIdHex: config.managerProgramIdHex,
      transceiverProgramIdHex: config.transceiverProgramIdHex, mintHex: config.mintHex,
      recipientTokenAccountHex: message.destinationHex, encodedMessageHex: bytes.toString("hex"),
      recentBlockhashHex: packet.subarray(485, 517).toString("hex"), lastValidBlockHeight: "0",
      preparedTransactionBase64: encoded,
    });
    stage = "SIGNATURE_IDENTITY";
    check(verified.solanaSignature === observation.transaction.signature && verified.mintAccountBase58 === base58Encode(Buffer.from(config.mintHex, "hex")));
    stage = "MINT_CPI";
    const groups = result.meta.innerInstructions;
    check(Array.isArray(groups) && groups.length === 1 && groups[0]?.index === 0);
    const instructions = groups[0].instructions; check(Array.isArray(instructions) && instructions.length <= 8);
    const mintCalls = instructions.filter(i => i?.programIdIndex === 8);
    check(mintCalls.length === 1);
    const mint = mintCalls[0], data = Buffer.alloc(10); data[0] = 14; data.writeBigUInt64LE(message.amountAtomic, 1); data[9] = config.nativeDecimals;
    check(JSON.stringify(mint.accounts) === "[3,4,7]" && mint.data === base58Encode(data) && mint.stackHeight === 2);
    // The packet has only the one Manager claim + ComputeBudget. Requiring the
    // matching CPI and exact recipient delta rejects unrelated finalized txs.
    stage = "TOKEN_DELTA";
    const mintAddress = verified.mintAccountBase58;
    const before = balance(result.meta.preTokenBalances, mintAddress, config.nativeDecimals);
    const after = balance(result.meta.postTokenBalances, mintAddress, config.nativeDecimals);
    check(after >= before && after - before === message.amountAtomic);
    return Object.freeze({ operationId: message.operationIdHex, messageDigest: message.messageDigestHex,
      amountAtomic: message.amountAtomic.toString(), signature: verified.solanaSignature });
  } catch { const error = new Error("SOLANA_CLAIM_EXECUTION_MISMATCH"); error.validationStage = stage; throw error; }
}
