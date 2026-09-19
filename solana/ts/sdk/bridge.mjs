// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Explicit network-bound public requests. No private key, signer or RPC credential.
import { validateDepositOperationPolicy } from "../../../services/bridge-validator/deposit-operation-state.mjs";
import { base58Decode, base58Encode } from "../../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { buildRegtestRecoverableDeposit, deriveRegtestDepositCommitment,
  buildMainnetRecoverableDeposit, deriveMainnetDepositCommitment } from "../../../native/recovery/taproot-deposit.mjs";
import { nativeIdentity } from "../../../shared/network-identity.mjs";
import { witnessAddressFromScript } from "../../../native/node/witness-address.mjs";

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

export function createNativeDepositRequest(options) { return nativeDepositRequest(options, false); }
export function createMainnetNativeDepositRequest(options) { return nativeDepositRequest(options, true); }
function nativeDepositRequest({ policy, ...input }, mainnet) {
  exactFields(input, "amountAtomic,recipient,userRecoveryPublicKeyHex,nonceHex");
  const p = validateDepositOperationPolicy(policy);
  check((p.environment === "mainnet") === mainnet);
  check(atomicAmount(input.amountAtomic) <= BigInt(p.maximumAmountAtomic)); nonzeroHash(input.nonceHex);
  const depositIntent = { nativeGenesisHex: p.nativeGenesis, solanaDeploymentHex: p.solanaDeployment,
    managerProgramIdHex: p.managerProgramId, transceiverProgramIdHex: p.transceiverProgramId, mintHex: p.mint,
    recipientHex: publicKey(input.recipient).toString("hex"), nonceHex: input.nonceHex, amountAtomic: input.amountAtomic,
    protocolId: p.protocolId, nativeNetwork: p.nativeNetwork, policyEpoch: p.policyEpoch, keyEpoch: p.keyEpoch };
  const operationId = (mainnet ? deriveMainnetDepositCommitment : deriveRegtestDepositCommitment)(depositIntent);
  const script = (mainnet ? buildMainnetRecoverableDeposit : buildRegtestRecoverableDeposit)({ nativeGenesisHex: p.nativeGenesis, depositCommitmentHex: operationId,
    frostPublicKeyHex: p.frostPublicKeyHex, userRecoveryPublicKeyHex: input.userRecoveryPublicKeyHex, csvDelayBlocks: p.csvDelayBlocks });
  return { operationId, direction: "NativeToSolana", state: "AWAITING_USER_TRANSACTION", request: input,
    depositIntent, amountAtomic: input.amountAtomic, recipient: input.recipient,
    depositAddress: witnessAddressFromScript(script.scriptPubKeyHex, nativeIdentity(p.environment).hrp), scriptPubKeyHex: script.scriptPubKeyHex,
    minimumConfirmations: p.minimumConfirmations,
    // Public recovery construction, not a backup of any signing key.
    recovery: script, walletAction: "SEND_EXACT_NATIVE_AMOUNT_WITH_YOUR_WALLET" };
}
