// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Builds an unsigned user instruction; never handles a user private key.
import { decodeCanonicalBridgeMessage } from "../../../shared/protocol/canonical-message.mjs";
import { base58Decode, base58Encode, findProgramAddress } from "../../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { SPL_TOKEN_PROGRAM_ID_BASE58 as TOKEN, SYSTEM_PROGRAM_ID_BASE58 as SYSTEM } from "../../../services/bridge-validator/localnet-solana-setup-plan.mjs";
export function createWithdrawalInstruction({ encodedMessageHex, userAuthority, payer, sourceTokenAccount }) {
  const m = decodeCanonicalBridgeMessage(encodedMessageHex);
  if (m.action !== "WithdrawalRequest" || m.direction !== "SolanaToNative" || m.amountAtomic <= m.feeAtomic ||
      !/^(?:0014[0-9a-f]{40}|0020[0-9a-f]{64}|5120[0-9a-f]{64})$/u.test(m.destinationHex)) throw new Error("WithdrawalInstructionRequestRejected");
  for (const key of [userAuthority, payer, sourceTokenAccount]) if (typeof key !== "string" || key.length > 44 || base58Decode(key).length !== 32) throw new Error("WithdrawalInstructionAccountRejected");
  const manager = base58Encode(m.deployment.managerProgramId), mint = base58Encode(m.deployment.mint);
  const pda = (seed, key, program = m.deployment.managerProgramId) => findProgramAddress([Buffer.from(seed), key], program).base58;
  const amount = Buffer.alloc(8); amount.writeBigUInt64LE(m.amountAtomic);
  const meta = (key, writable = false, signer = false) => ({ key, writable, signer });
  return { program: manager, accounts: [meta(pda("kingpepe-bridge-state", m.deployment.mint), true),
    meta(pda("kingpepe-withdrawal-record", m.withdrawalId), true), meta(sourceTokenAccount, true), meta(mint, true),
    meta(userAuthority, false, true), meta(TOKEN), meta(pda("kingpepe-transceiver-config", m.deployment.mint, m.deployment.transceiverProgramId)),
    meta(payer, true, true), meta(SYSTEM)], data: Buffer.concat([Buffer.from([3]), Buffer.from(m.encoded),
      base58Decode(TOKEN), m.deployment.mint, base58Decode(userAuthority), amount, Buffer.from([8])]) };
}
