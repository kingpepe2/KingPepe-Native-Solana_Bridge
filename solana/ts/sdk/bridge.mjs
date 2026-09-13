// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Public LOCALNET/REGTEST requests only. No private key, signer or RPC credential.
import { createHash } from "node:crypto";
import { validateDepositOperationPolicy } from "../../../services/bridge-validator/deposit-operation-state.mjs";
import { base58Decode, base58Encode, shortvecEncode } from "../../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { buildRegtestRecoverableDeposit, deriveRegtestDepositCommitment } from "../../../native/recovery/taproot-deposit.mjs";
import { witnessAddressFromScript, scriptFromWitnessAddress } from "../../../native/node/witness-address.mjs";
import { encodeCanonicalBridgeMessage, decodeCanonicalBridgeMessage } from "../../../shared/protocol/canonical-message.mjs";
import { createWithdrawalInstruction } from "./withdrawal.mjs";

const check = v => { if (!v) throw new Error("BridgeUserRequestRejected"); };
export function exactFields(v, names) {
  check(v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join() === names.split(",").sort().join());
}
export function atomicAmount(value, { zero = false } = {}) {
  check(typeof value === "string" && /^(0|[1-9][0-9]{0,19})$/u.test(value));
  const n = BigInt(value); check(n <= 0xffffffffffffffffn && (zero || n > 0n)); return n;
}
export function publicKey(value) {
  check(typeof value === "string" && value.length >= 32 && value.length <= 44);
  const bytes = base58Decode(value); check(bytes.length === 32 && base58Encode(bytes) === value); return Buffer.from(bytes);
}
function nonzeroHash(value) { check(typeof value === "string" && /^[0-9a-f]{64}$/u.test(value) && value !== "00".repeat(32)); return value; }

export function createNativeDepositRequest({ policy, ...input }) {
  exactFields(input, "amountAtomic,recipient,userRecoveryPublicKeyHex,nonceHex");
  const p = validateDepositOperationPolicy(policy);
  check(atomicAmount(input.amountAtomic) <= BigInt(p.maximumAmountAtomic)); nonzeroHash(input.nonceHex);
  const depositIntent = { nativeGenesisHex: p.nativeGenesis, solanaDeploymentHex: p.solanaDeployment,
    managerProgramIdHex: p.managerProgramId, transceiverProgramIdHex: p.transceiverProgramId, mintHex: p.mint,
    recipientHex: publicKey(input.recipient).toString("hex"), nonceHex: input.nonceHex, amountAtomic: input.amountAtomic,
    protocolId: p.protocolId, nativeNetwork: p.nativeNetwork, policyEpoch: p.policyEpoch, keyEpoch: p.keyEpoch };
  const operationId = deriveRegtestDepositCommitment(depositIntent);
  const script = buildRegtestRecoverableDeposit({ nativeGenesisHex: p.nativeGenesis, depositCommitmentHex: operationId,
    frostPublicKeyHex: p.frostPublicKeyHex, userRecoveryPublicKeyHex: input.userRecoveryPublicKeyHex, csvDelayBlocks: p.csvDelayBlocks });
  return { operationId, direction: "NativeToSolana", state: "AWAITING_USER_TRANSACTION", request: input,
    depositIntent, amountAtomic: input.amountAtomic, recipient: input.recipient,
    depositAddress: witnessAddressFromScript(script.scriptPubKeyHex), scriptPubKeyHex: script.scriptPubKeyHex,
    minimumConfirmations: p.minimumConfirmations,
    // Public recovery construction, not a backup of any signing key.
    recovery: script, walletAction: "SEND_EXACT_NATIVE_AMOUNT_WITH_YOUR_WALLET" };
}

export function createSolanaWithdrawalRequest({ policy, ...input }) {
  exactFields(input, "amountAtomic,feeAtomic,destination,userAuthority,sourceTokenAccount,withdrawalIdHex,nonceHex,validFrom,validUntil,recentBlockhash");
  const p = validateDepositOperationPolicy(policy), amount = atomicAmount(input.amountAtomic), fee = atomicAmount(input.feeAtomic, { zero: true });
  check(amount <= BigInt(p.maximumAmountAtomic) && fee <= BigInt(p.maximumFeeAtomic) && amount > fee);
  const from = atomicAmount(input.validFrom, { zero: true }), until = atomicAmount(input.validUntil);
  check(until > from && until - from <= 86400n);
  nonzeroHash(input.withdrawalIdHex); nonzeroHash(input.nonceHex);
  publicKey(input.userAuthority); publicKey(input.sourceTokenAccount); publicKey(input.recentBlockhash);
  const destination = scriptFromWitnessAddress(input.destination);
  const encoded = encodeCanonicalBridgeMessage({ action: "WithdrawalRequest", direction: "SolanaToNative",
    deployment: { protocolId: p.protocolId, nativeNetwork: p.nativeNetwork, nativeGenesis: p.nativeGenesis,
      solanaDeployment: p.solanaDeployment, managerProgramId: p.managerProgramId, transceiverProgramId: p.transceiverProgramId, mint: p.mint },
    depositOutpoint: { txid: new Uint8Array(32), vout: 0 }, withdrawalId: input.withdrawalIdHex, amountAtomic: amount, feeAtomic: fee,
    destination: Buffer.from(destination, "hex"), policyEpoch: p.policyEpoch, keyEpoch: p.keyEpoch, nonce: input.nonceHex,
    validFrom: from, validUntil: until,
    // The Borsh [u8;32] withdrawal ID commitment is public request context,
    // NOT proof of a burn or payout right. The finalized chain reader verifies those.
    evidenceDigest: createHash("sha256").update(Buffer.from(input.withdrawalIdHex, "hex")).digest() });
  const message = decodeCanonicalBridgeMessage(encoded), encodedMessageHex = Buffer.from(encoded).toString("hex");
  const instruction = createWithdrawalInstruction({ encodedMessageHex, userAuthority: input.userAuthority,
    payer: input.userAuthority, sourceTokenAccount: input.sourceTokenAccount });
  const { data, ...instructionAccounts } = instruction;
  return { operationId: message.operationIdHex, direction: "SolanaToNative", state: "AWAITING_USER_SIGNATURE",
    amountAtomic: input.amountAtomic, feeAtomic: input.feeAtomic, netAtomic: (amount - fee).toString(), destination: input.destination,
    encodedMessageHex, messageDigestHex: message.messageDigestHex, validUntil: input.validUntil,
    instruction: { ...instructionAccounts, dataBase64: Buffer.from(data).toString("base64") },
    transactionBase64: unsignedWithdrawalPacket(instruction, input.userAuthority, input.recentBlockhash),
    walletAction: "SIGN_AND_SEND_WITH_YOUR_SOLANA_WALLET", chain: "solana:localnet" };
}

// Fixed bridge + compute-budget, single-user-signer packet; not an arbitrary
// transaction compiler or fee-payer signing endpoint. BurnChecked is the CPI
// inside this atomic bridge instruction, so a direct burn grants no payout.
function unsignedWithdrawalPacket(ix, payer, blockhash) {
  const budget = Buffer.alloc(5); budget[0] = 2; budget.writeUInt32LE(600000, 1);
  const instructions = [{ program: "ComputeBudget111111111111111111111111111111", accounts: [], data: budget }, ix];
  const map = new Map([[payer, { key: payer, signer: true, writable: true }]]);
  for (const i of instructions) for (const a of [...i.accounts, { key: i.program, signer: false, writable: false }]) {
    const old = map.get(a.key);
    map.set(a.key, { key: a.key, signer: a.signer || old?.signer || false, writable: a.writable || old?.writable || false });
  }
  const keys = [...map.values()].sort((a, b) => (a.key === payer ? -1 : a.writable ? 0 : 1) - (b.key === payer ? -1 : b.writable ? 0 : 1));
  check(keys.filter(k => k.signer).length === 1 && keys[0].key === payer && keys.length <= 16);
  const message = Buffer.concat([Buffer.of(1, 0, keys.filter(k => !k.signer && !k.writable).length), shortvecEncode(keys.length),
    ...keys.map(k => publicKey(k.key)), publicKey(blockhash), shortvecEncode(instructions.length),
    ...instructions.map(i => Buffer.concat([Buffer.of(keys.findIndex(k => k.key === i.program)),
      shortvecEncode(i.accounts.length), Buffer.from(i.accounts.map(a => keys.findIndex(k => k.key === a.key))), shortvecEncode(i.data.length), i.data]))]);
  const bytes = Buffer.concat([Buffer.of(1), Buffer.alloc(64), message]); check(bytes.length <= 1232);
  return bytes.toString("base64");
}
