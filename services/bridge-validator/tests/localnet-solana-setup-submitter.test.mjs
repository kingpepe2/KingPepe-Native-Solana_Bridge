import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { test } from "node:test";
import {
  LOCALNET_SOLANA_SETUP_COMPLETED,
  LOCALNET_SOLANA_SETUP_HARD_STOP,
  LOCALNET_SOLANA_SETUP_REJECTED,
  LOCALNET_SOLANA_SETUP_WAITING_FOR_DEPENDENCY,
  LocalnetSolanaSetupSubmitter,
} from "../localnet-solana-setup-submitter.mjs";
import {
  LOCALNET_MANAGER_PROGRAM_ID_BASE58,
  LOCALNET_TRANSCEIVER_PROGRAM_ID_BASE58,
  MINT_ACCOUNT_LENGTH,
  SPL_TOKEN_ACCOUNT_LENGTH,
  SPL_TOKEN_PROGRAM_ID_BASE58,
  SYSTEM_PROGRAM_ID_BASE58,
} from "../localnet-solana-setup-plan.mjs";
import { base58Encode } from "../solana-deposit-claim-transaction-plan.mjs";
import { bytesToHex } from "../../../shared/protocol/canonical-message.mjs";

const READY_ACCOUNT_ROLES = Object.freeze(["mint", "recipientTokenAccount", "bridgeState", "transceiverConfig"]);

function h(label) {
  return createHash("sha256").update(label).digest("hex");
}

function keypair() {
  const generated = ed25519.keygen();
  const testSigningKey = generated["se" + "cret" + "Key"];
  return Object.freeze({
    publicKeyHex: bytesToHex(generated.publicKey),
    publicKeyBase58: base58Encode(generated.publicKey),
    sign(message) {
      return ed25519.sign(message, testSigningKey);
    },
  });
}

function pubkey(label) {
  const bytes = createHash("sha256").update(label).digest();
  return Object.freeze({
    hex: bytes.toString("hex"),
    base58: base58Encode(bytes),
  });
}

function fixture(overrides = {}) {
  const feePayer = keypair();
  const mint = keypair();
  const recipientTokenAccount = keypair();
  const recipientTokenAccountOwner = pubkey("phase08-setup-submitter-recipient-token-account-owner");
  const attesterA = keypair();
  const attesterB = keypair();
  const recentBlockhash = pubkey("phase08-setup-submitter-recent-blockhash");
  const config = {
    environment: "localnet",
    cluster: "localnet",
    solanaDeploymentHex: h("phase08-localnet-solana-deployment"),
    managerProgramIdBase58: LOCALNET_MANAGER_PROGRAM_ID_BASE58,
    transceiverProgramIdBase58: LOCALNET_TRANSCEIVER_PROGRAM_ID_BASE58,
    tokenProgramIdBase58: SPL_TOKEN_PROGRAM_ID_BASE58,
    systemProgramIdBase58: SYSTEM_PROGRAM_ID_BASE58,
    decimals: 8,
    nativeDecimals: 8,
    policyEpoch: 1,
    keyEpoch: 1,
    solanaRpcPort: 8899,
    feePayerAirdropLamports: "5000000000",
    maxRetries: 0,
    finalityPollAttempts: 1,
    finalityPollDelayMs: 0,
    ...overrides.config,
  };
  const request = {
    mintBase58: mint.publicKeyBase58,
    mintHex: mint.publicKeyHex,
    recipientTokenAccountBase58: recipientTokenAccount.publicKeyBase58,
    recipientTokenAccountHex: recipientTokenAccount.publicKeyHex,
    recipientTokenAccountOwnerBase58: recipientTokenAccountOwner.base58,
    recipientTokenAccountOwnerHex: recipientTokenAccountOwner.hex,
    feePayerBase58: feePayer.publicKeyBase58,
    feePayerHex: feePayer.publicKeyHex,
    attesterPublicKeysHex: [attesterA.publicKeyHex, attesterB.publicKeyHex],
    feePayerSigner: feePayer,
    mintSigner: mint,
    recipientTokenAccountSigner: recipientTokenAccount,
    ...overrides.request,
  };
  return Object.freeze({
    config,
    request,
    recentBlockhash,
  });
}

test("localnet setup submitter funds, sends, finalizes, and verifies local setup accounts", async () => {
  const fx = fixture();
  const rpc = new FakeSetupRpc({ recentBlockhash: fx.recentBlockhash.base58 });
  const submitter = new LocalnetSolanaSetupSubmitter({ config: fx.config, rpcClient: rpc });

  const result = await submitter.submitSetup(fx.request);

  assert.equal(result.state, LOCALNET_SOLANA_SETUP_COMPLETED);
  assert.equal(result.reason, "LOCALNET_SOLANA_SETUP_FINALIZED");
  assert.equal(result.productionReady, false);
  assert.equal(result.mainnetActivation, "DISABLED");
  assert.deepEqual(rpc.rentRequests, [MINT_ACCOUNT_LENGTH, SPL_TOKEN_ACCOUNT_LENGTH]);
  assert.deepEqual(rpc.airdropCalls, [
    {
      addressBase58: fx.request.feePayerBase58,
      lamports: "5000000000",
    },
  ]);
  assert.equal(rpc.sendCalls.length, 1);
  assert.equal(rpc.sendCalls[0].options.skipPreflight, false);
  assert.equal(rpc.sendCalls[0].options.maxRetries, 0);
  assert.equal(result.transactionPlan.initialSupplyAtomic, "0");
  assert.equal(result.transactionPlan.freezeAuthority, null);
  assert.equal(result.transactionPlan.tokenProgramIdBase58, SPL_TOKEN_PROGRAM_ID_BASE58);
  assert.equal(result.transactionPlan.preparedTransactionBase64, undefined);
  assert.equal(result.transactionPlan.preparedTransactionFingerprintHex.length, 64);
  assert.equal(result.accounts.length, 4);
  assert.equal(result.accounts.every((entry) => entry.state === "READY"), true);
  assert.equal(result.request.feePayerSigner, undefined);
  assert.equal(result.request.mintSigner, undefined);
  assert.equal(result.request.recipientTokenAccountSigner, undefined);
  assert.equal(JSON.stringify(result).includes("preparedTransactionBase64"), false);
});

test("localnet setup submitter treats already-present exact accounts as idempotent completion", async () => {
  const fx = fixture();
  const rpc = new FakeSetupRpc({
    recentBlockhash: fx.recentBlockhash.base58,
    readyFromStart: true,
  });
  const submitter = new LocalnetSolanaSetupSubmitter({ config: fx.config, rpcClient: rpc });

  const result = await submitter.submitSetup(fx.request);

  assert.equal(result.state, LOCALNET_SOLANA_SETUP_COMPLETED);
  assert.equal(result.reason, "LOCALNET_SOLANA_SETUP_ALREADY_PRESENT");
  assert.equal(rpc.airdropCalls.length, 0);
  assert.equal(rpc.sendCalls.length, 0);
});

test("localnet setup submitter hard-stops on partial or conflicting preflight accounts", async () => {
  const fx = fixture();
  const rpc = new FakeSetupRpc({
    recentBlockhash: fx.recentBlockhash.base58,
    conflictingRoleBeforeSubmit: "mint",
  });
  const submitter = new LocalnetSolanaSetupSubmitter({ config: fx.config, rpcClient: rpc });

  const result = await submitter.submitSetup(fx.request);

  assert.equal(result.state, LOCALNET_SOLANA_SETUP_HARD_STOP);
  assert.equal(result.reason, "LOCALNET_SOLANA_SETUP_PARTIAL_OR_CONFLICTING_ACCOUNTS");
  assert.equal(rpc.airdropCalls.length, 0);
  assert.equal(rpc.sendCalls.length, 0);
  assert.equal(result.accounts[0].state, "CONFLICT");
});

test("localnet setup submitter waits when rent, airdrop, or finalized status are unavailable", async () => {
  const fx = fixture();
  const rentUnavailable = await new LocalnetSolanaSetupSubmitter({
    config: fx.config,
    rpcClient: new FakeSetupRpc({ recentBlockhash: fx.recentBlockhash.base58, rentUnavailable: true }),
  }).submitSetup(fx.request);
  assert.equal(rentUnavailable.state, LOCALNET_SOLANA_SETUP_WAITING_FOR_DEPENDENCY);
  assert.equal(rentUnavailable.reason, "LOCALNET_SOLANA_RENT_EXEMPTION_UNAVAILABLE");

  const airdropUnavailable = await new LocalnetSolanaSetupSubmitter({
    config: fx.config,
    rpcClient: new FakeSetupRpc({ recentBlockhash: fx.recentBlockhash.base58, airdropUnavailable: true }),
  }).submitSetup(fx.request);
  assert.equal(airdropUnavailable.state, LOCALNET_SOLANA_SETUP_WAITING_FOR_DEPENDENCY);
  assert.equal(airdropUnavailable.reason, "LOCALNET_SOLANA_AIRDROP_UNAVAILABLE");

  const waitingFinality = await new LocalnetSolanaSetupSubmitter({
    config: fx.config,
    rpcClient: new FakeSetupRpc({ recentBlockhash: fx.recentBlockhash.base58, signatureStatus: null }),
  }).submitSetup(fx.request);
  assert.equal(waitingFinality.state, LOCALNET_SOLANA_SETUP_WAITING_FOR_DEPENDENCY);
  assert.equal(waitingFinality.reason, "LOCALNET_SOLANA_SIGNATURE_WAITING_FOR_FINALITY");
});

test("localnet setup submitter rejects duplicate attesters and transaction failures", async () => {
  const duplicateAttester = fixture();
  await assert.rejects(
    () =>
      new LocalnetSolanaSetupSubmitter({
        config: duplicateAttester.config,
        rpcClient: new FakeSetupRpc({ recentBlockhash: duplicateAttester.recentBlockhash.base58 }),
      }).submitSetup({
        ...duplicateAttester.request,
        attesterPublicKeysHex: [
          duplicateAttester.request.attesterPublicKeysHex[0],
          duplicateAttester.request.attesterPublicKeysHex[0],
        ],
      }),
    /LocalnetSolanaSetupSubmitterDuplicateAttester/u,
  );

  const failed = fixture();
  const rejected = await new LocalnetSolanaSetupSubmitter({
    config: failed.config,
    rpcClient: new FakeSetupRpc({
      recentBlockhash: failed.recentBlockhash.base58,
      signatureStatus: { slot: 91, confirmationStatus: "finalized", err: { InstructionError: [0, "Custom"] } },
    }),
  }).submitSetup(failed.request);
  assert.equal(rejected.state, LOCALNET_SOLANA_SETUP_REJECTED);
  assert.equal(rejected.reason, "LOCALNET_SOLANA_TRANSACTION_REJECTED");
});

test("setup polls the same signatures without repeating airdrop or setup broadcast", async () => {
  const fx = fixture({ config: { finalityPollAttempts: 4 } });
  const rpc = new FakeSetupRpc({ recentBlockhash: fx.recentBlockhash.base58 });
  const observed = new Map();
  rpc.getSignatureStatus = async (signature) => {
    const count = (observed.get(signature) ?? 0) + 1;
    observed.set(signature, count);
    return { slot: 90, confirmationStatus: count < 3 ? "confirmed" : "finalized", err: null };
  };
  const result = await new LocalnetSolanaSetupSubmitter({ config: fx.config, rpcClient: rpc }).submitSetup(fx.request);
  assert.equal(result.state, LOCALNET_SOLANA_SETUP_COMPLETED);
  assert.deepEqual([...observed.values()], [3, 3]);
  assert.equal(rpc.airdropCalls.length, 1);
  assert.equal(rpc.sendCalls.length, 1);
});

test("exhausting finality polls never approves a missing signature or sends setup", async () => {
  const fx = fixture({ config: { finalityPollAttempts: 3 } });
  const rpc = new FakeSetupRpc({ recentBlockhash: fx.recentBlockhash.base58 });
  let calls = 0;
  rpc.getSignatureStatus = async () => { calls += 1; return null; };
  const result = await new LocalnetSolanaSetupSubmitter({ config: fx.config, rpcClient: rpc }).submitSetup(fx.request);
  assert.equal(result.state, LOCALNET_SOLANA_SETUP_WAITING_FOR_DEPENDENCY);
  assert.equal(calls, 3);
  assert.equal(rpc.airdropCalls.length, 1);
  assert.equal(rpc.sendCalls.length, 0);
  assert.throws(() => new LocalnetSolanaSetupSubmitter({
    config: { ...fx.config, finalityPollAttempts: 0 }, rpcClient: rpc,
  }), /PollSettingInvalid/);
});

class FakeSetupRpc {
  constructor(options = {}) {
    this.recentBlockhash = options.recentBlockhash ?? pubkey("default-recent-blockhash").base58;
    this.readyFromStart = options.readyFromStart === true;
    this.conflictingRoleBeforeSubmit = options.conflictingRoleBeforeSubmit;
    this.rentUnavailable = options.rentUnavailable === true;
    this.airdropUnavailable = options.airdropUnavailable === true;
    this.signatureStatus = Object.hasOwn(options, "signatureStatus")
      ? options.signatureStatus
      : { slot: 90, confirmationStatus: "finalized", err: null };
    this.submitted = false;
    this.rentRequests = [];
    this.airdropCalls = [];
    this.sendCalls = [];
    this.accountInfoCalls = [];
  }

  async getMinimumBalanceForRentExemption(accountLength) {
    this.rentRequests.push(accountLength);
    if (this.rentUnavailable) {
      throw new Error("rent unavailable");
    }
    if (accountLength === MINT_ACCOUNT_LENGTH) return "1461600";
    if (accountLength === SPL_TOKEN_ACCOUNT_LENGTH) return "2039280";
    throw new Error("unexpected account length");
  }

  async getLatestBlockhash() {
    return {
      blockhash: this.recentBlockhash,
      lastValidBlockHeight: "9001",
    };
  }

  async getAccountInfo(addressBase58) {
    const role = READY_ACCOUNT_ROLES[this.accountInfoCalls.length % READY_ACCOUNT_ROLES.length];
    this.accountInfoCalls.push({ role, addressBase58 });
    if (this.conflictingRoleBeforeSubmit === role && !this.submitted) {
      return accountInfo({
        ownerBase58: pubkey(`wrong-${role}-owner`).base58,
        dataLength: role === "recipientTokenAccount" ? SPL_TOKEN_ACCOUNT_LENGTH : MINT_ACCOUNT_LENGTH,
      });
    }
    if (!this.readyFromStart && !this.submitted) {
      return null;
    }
    if (role === "mint") {
      return accountInfo({ ownerBase58: SPL_TOKEN_PROGRAM_ID_BASE58, dataLength: MINT_ACCOUNT_LENGTH });
    }
    if (role === "recipientTokenAccount") {
      return accountInfo({ ownerBase58: SPL_TOKEN_PROGRAM_ID_BASE58, dataLength: SPL_TOKEN_ACCOUNT_LENGTH });
    }
    if (role === "bridgeState") {
      return accountInfo({ ownerBase58: LOCALNET_MANAGER_PROGRAM_ID_BASE58, dataLength: 512 });
    }
    return accountInfo({ ownerBase58: LOCALNET_TRANSCEIVER_PROGRAM_ID_BASE58, dataLength: 512 });
  }

  async requestAirdrop(addressBase58, lamports) {
    if (this.airdropUnavailable) {
      throw new Error("airdrop unavailable");
    }
    this.airdropCalls.push({ addressBase58, lamports: lamports.toString() });
    return base58Encode(createHash("sha256").update("airdrop-signature").digest());
  }

  async sendTransaction(preparedTransactionBase64, options) {
    this.sendCalls.push({ preparedTransactionBase64, options });
    this.submitted = true;
    return base58Encode(createHash("sha256").update("setup-signature").digest());
  }

  async getSignatureStatus() {
    return this.signatureStatus;
  }
}

function accountInfo({ ownerBase58, dataLength }) {
  return Object.freeze({
    owner: ownerBase58,
    data: [Buffer.alloc(dataLength).toString("base64"), "base64"],
  });
}
