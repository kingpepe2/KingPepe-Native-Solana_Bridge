// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Separate protected LOCALNET transaction identity, not an attester or minter.
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { assertWindowsProtectedStore } from "../../shared/windows/protected-store.mjs";
import { requireIntegrityGuard } from "../supervisor/protected-integrity.mjs";
import { LocalDeploymentRpc, verifyDeploymentSnapshot } from "../solana-observer/deployment-integrity.mjs";
import { SolanaLocalRpcClient } from "./solana-deposit-claim-submitter.mjs";
import { validateSolanaDeliveryPolicy, validateSolanaDepositSigningIntent, validateSolanaDepositDelivery,
  solanaDeliveryPolicyDigest, deliveryUint } from "../relayer/solana-deposit-delivery.mjs";
import { prepareSignedLocalnetSolanaDepositReceiptTransaction, prepareSignedLocalnetSolanaDepositClaimTransaction,
  base58Encode, base58Decode } from "./solana-deposit-claim-transaction-plan.mjs";
const INSTANCES = new WeakSet();
const check = (v, code = "ProtectedDepositFeePayerUnavailable") => { if (!v) throw new Error(code); };
const digest = b => createHash("sha256").update(b).digest("hex");
export class ProtectedDepositFeePayer {
  #store; #guard; #policy; #chain; #rpc; #lease; #revision; #busy = false; #closed = false; #stopped = false;
  static async open({ store, integrity, policy, endpoint }) {
    assertWindowsProtectedStore(store, "FEE_PAYER", "fee-payer-seed"); requireIntegrityGuard(integrity, "FEE_PAYER");
    const self = new ProtectedDepositFeePayer(); self.#policy = validateSolanaDeliveryPolicy(policy);
    const { environment, nativeGenesis, solanaDeployment, keyEpoch } = self.#policy.operationPolicy;
    check(environment === "localnet" && Object.entries({ environment, nativeGenesis, solanaDeployment, keyEpoch }).every(([k, v]) => store.context[k] === v));
    integrity.assertDeployment({ environment, nativeGenesis, solanaDeployment, keyEpoch });
    self.#store = store; self.#guard = integrity;
    self.#chain = new LocalDeploymentRpc({ endpoint }); self.#rpc = new SolanaLocalRpcClient({ endpoint });
    try { self.#lease = await store.acquireLifetimeLease(); const seed = self.#seed(); seed.fill(0); INSTANCES.add(self); return self; }
    catch (error) { try { await self.#report(error); } finally { await self.close(); } throw new Error("ProtectedDepositFeePayerUnavailable"); }
  }
  assertBinding(policy, integrity) {
    check(!this.#closed && !this.#stopped && integrity === this.#guard && solanaDeliveryPolicyDigest(policy) === solanaDeliveryPolicyDigest(this.#policy));
    this.#lease.assertHeld();
  }
  #seed() {
    this.#lease.assertHeld(); const r = this.#store.read();
    try {
      check(r.payload.length === 32 && base58Encode(ed25519.getPublicKey(r.payload)) === this.#policy.feePayerPublicKey, "FeePayerKeyChanged");
      check(this.#revision === undefined || this.#revision === r.revision, "FeePayerKeyChanged"); this.#revision = r.revision;
      return Buffer.from(r.payload);
    } finally { r.payload.fill(0); }
  }
  async #report(error) {
    const reason = error.integrityCode ?? error.message;
    const keyFailure = ["ProtectedStateRollbackDetected", "ProtectedLifetimeLeaseLost", "FeePayerKeyChanged"].includes(reason);
    const deploymentFailure = ["SOLANA_GENESIS_CHANGED", "SOLANA_DEPLOYMENT_CHANGED", "FINALIZED_SOLANA_CONFLICT"].includes(reason);
    if (!keyFailure && !deploymentFailure) return;
    this.#stopped = true;
    await this.#guard.report(solanaDeliveryPolicyDigest(this.#policy), keyFailure ? "FEE_PAYER_KEY_INTEGRITY" : "FEE_PAYER_DEPLOYMENT_CHANGED", digest(reason));
  }
  async prepare(input) {
    const { intent, message } = validateSolanaDepositSigningIntent(input, this.#policy);
    this.assertBinding(this.#policy, this.#guard); check(!this.#busy, "FeePayerBusy"); this.#busy = true;
    const validNow = () => { const now = BigInt(Math.floor(Date.now() / 1000)); check(now >= message.validFrom && now <= message.validUntil, "FeePayerAuthorizationExpired"); };
    try {
      validNow();
      const snapshot = await this.#chain.snapshot(this.#policy.manifest);
      const observed = verifyDeploymentSnapshot(this.#policy.manifest, snapshot);
      check(deliveryUint(observed.slot) >= deliveryUint(intent.minimumSlot), "FeePayerStaleDeployment");
      check(await this.#rpc.getBlockHeight() <= deliveryUint(intent.lastValidBlockHeight), "FeePayerExpiredBlockhash");
      await this.#guard.assertRunning(intent.operationId, "SIGN_SOLANA_CLAIM"); validNow();
      const p = this.#policy.operationPolicy, payer = this.#policy.feePayerPublicKey;
      const prepare = intent.kind === "RECEIPT" ? prepareSignedLocalnetSolanaDepositReceiptTransaction : prepareSignedLocalnetSolanaDepositClaimTransaction;
      const transaction = await prepare({ environment: "localnet", cluster: "localnet", managerProgramIdHex: p.managerProgramId,
        transceiverProgramIdHex: p.transceiverProgramId, mintHex: p.mint, recipientTokenAccountHex: message.destinationHex,
        tokenProgramIdBase58: this.#policy.manifest.mint.tokenProgram,
        feePayerBase58: payer, feePayerHex: Buffer.from(base58Decode(payer)).toString("hex"),
        recentBlockhashBase58: intent.recentBlockhash, lastValidBlockHeight: intent.lastValidBlockHeight,
        encodedMessageHex: intent.encodedMessageHex, attestations: intent.attestations,
        feePayerSigner: { publicKeyBase58: payer, sign: bytes => {
          validNow(); this.assertBinding(this.#policy, this.#guard);
          const seed = this.#seed(); try { return ed25519.sign(bytes, seed); } finally { seed.fill(0); }
        } } });
      const delivery = validateSolanaDepositDelivery({ ...intent, preparedTransactionBase64: transaction.preparedTransactionBase64 }, this.#policy).delivery;
      await this.#guard.assertRunning(intent.operationId, "SIGN_SOLANA_CLAIM"); validNow();
      return delivery;
    } catch (error) { await this.#report(error); throw error; }
    finally { this.#busy = false; }
  }
  async close() { this.#closed = true; await this.#lease?.close(); this.#store?.close(); }
}
export function requireProtectedDepositFeePayer(value, policy, integrity) { check(INSTANCES.has(value)); value.assertBinding(policy, integrity); }
