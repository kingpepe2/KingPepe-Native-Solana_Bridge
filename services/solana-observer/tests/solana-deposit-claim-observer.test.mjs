import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { base58Encode, findProgramAddress } from "../../bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import {
  SolanaDepositClaimObserver,
  SolanaDepositClaimRpcClient,
  decodeDepositClaimAccountBytes,
  decodeSplMintAccountBytes,
  normalizeSolanaDepositClaimRpcEndpoint,
} from "../solana-deposit-claim-observer.mjs";

const CLAIM_ACCOUNT_BASE58 = findProgramAddress([Buffer.from("kingpepe-deposit-claim"), Buffer.from(h("operation-id"), "hex")], Buffer.from(h("bridge-manager-program"), "hex")).base58;
const MINT_ACCOUNT_BASE58 = base58Encode(Buffer.from(h("kpepe-spl-mint"), "hex"));

function h(label) {
  return createHash("sha256").update(label).digest("hex");
}

function signature(label = "deposit-claim-signature") {
  return createHash("sha512").update(label).digest("hex").replaceAll("0", "1").slice(0, 88);
}

function config(overrides = {}) {
  return {
    environment: "localnet",
    cluster: "localnet",
    managerProgramIdHex: h("bridge-manager-program"),
    transceiverProgramIdHex: h("bridge-transceiver-program"),
    mintHex: h("kpepe-spl-mint"),
    depositClaimAccountBase58: CLAIM_ACCOUNT_BASE58,
    mintAccountBase58: MINT_ACCOUNT_BASE58,
    ...overrides,
  };
}

function depositClaimBytes({
  operationIdHex = h("operation-id"),
  messageDigestHex = h("message-digest"),
  amountAtomic = "250000000",
  solanaRecipientHex = h("solana-recipient-token-account"),
} = {}) {
  const recipient = Buffer.from(solanaRecipientHex, "hex");
  const out = Buffer.alloc(211);
  let cursor = 0;
  out.write("KPBCLM01", cursor, "ascii");
  cursor += 8;
  out[cursor] = 1;
  cursor += 1;
  Buffer.from(operationIdHex, "hex").copy(out, cursor);
  cursor += 32;
  Buffer.from(messageDigestHex, "hex").copy(out, cursor);
  cursor += 32;
  out.writeBigUInt64LE(BigInt(amountAtomic), cursor);
  cursor += 8;
  out.writeUInt16LE(recipient.length, cursor);
  cursor += 2;
  recipient.copy(out, cursor);
  return out;
}

function mintBytes({ freezeAuthorityHex = null } = {}) {
  const out = Buffer.alloc(82);
  out.writeUInt32LE(1, 0);
  const authority = findProgramAddress([Buffer.from("kingpepe-mint-authority"), Buffer.from(config().mintHex, "hex")], Buffer.from(config().managerProgramIdHex, "hex"));
  Buffer.from(authority.hex, "hex").copy(out, 4);
  out.writeBigUInt64LE(250000000n, 36);
  out.writeUInt8(8, 44);
  out.writeUInt8(1, 45);
  if (freezeAuthorityHex === null) {
    out.writeUInt32LE(0, 46);
    return out;
  }
  out.writeUInt32LE(1, 46);
  Buffer.from(freezeAuthorityHex, "hex").copy(out, 50);
  return out;
}

function accountInfo(bytes) {
  return {
    context: { slot: "90" },
    value: {
      executable: false,
      owner: bytes.length === 211 ? base58Encode(Buffer.from(config().managerProgramIdHex, "hex")) : "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      data: [Buffer.from(bytes).toString("base64"), "base64"],
    },
  };
}

class FakeDepositClaimRpcClient {
  constructor(options = {}) {
    this.transaction = Object.hasOwn(options, "transaction")
      ? options.transaction
      : { slot: "88", meta: { err: null } };
    this.rootSlot = options.rootSlot ?? "90";
    this.accounts = new Map(
      options.accounts ?? [
        [CLAIM_ACCOUNT_BASE58, accountInfo(depositClaimBytes())],
        [MINT_ACCOUNT_BASE58, accountInfo(mintBytes())],
      ],
    );
  }

  async getTransaction() {
    return this.transaction;
  }

  async getFinalizedSlot() {
    return this.rootSlot;
  }

  async getAccountInfo(addressBase58) {
    return this.accounts.get(addressBase58) ?? { value: null };
  }
}

test("localnet deposit claim observer emits submitter-compatible finalized observation", async () => {
  const observer = new SolanaDepositClaimObserver({
    config: config(),
    rpcClient: new FakeDepositClaimRpcClient(),
  });
  const observation = await observer.observeFinalizedDepositClaim({
    operationIdHex: h("operation-id"),
    messageDigestHex: h("message-digest"),
    solanaSignature: signature(),
  });

  assert.equal(observation.trust, "RPC_OBSERVATION");
  assert.equal(observation.mint.supplyAtomic, "250000000");
  assert.equal(observation.cluster, "localnet");
  assert.equal(observation.commitment, "finalized");
  assert.equal(observation.slot, "88");
  assert.equal(observation.rootSlot, "90");
  assert.equal(observation.transaction.err, null);
  assert.equal(observation.programs.managerProgramIdHex, config().managerProgramIdHex);
  assert.equal(observation.programs.transceiverProgramIdHex, config().transceiverProgramIdHex);
  assert.equal(observation.mint.addressHex, config().mintHex);
  assert.equal(observation.mint.freezeAuthorityHex, null);
  assert.equal(observation.depositClaim.operationIdHex, h("operation-id"));
  assert.equal(observation.depositClaim.messageDigestHex, h("message-digest"));
  assert.equal(observation.depositClaim.amountAtomic, "250000000");
  assert.equal(observation.depositClaim.mintedAmountAtomic, "250000000");
  assert.equal(observation.depositClaim.solanaRecipientHex, h("solana-recipient-token-account"));
});

test("localnet deposit claim observer exposes freeze authority for downstream hard-stop checks", async () => {
  const freezeAuthorityHex = h("unexpected-freeze-authority");
  const observer = new SolanaDepositClaimObserver({
    config: config(),
    rpcClient: new FakeDepositClaimRpcClient({
      accounts: [
        [CLAIM_ACCOUNT_BASE58, accountInfo(depositClaimBytes())],
        [MINT_ACCOUNT_BASE58, accountInfo(mintBytes({ freezeAuthorityHex }))],
      ],
    }),
  });

  const observation = await observer.observeFinalizedDepositClaim({
    operationIdHex: h("operation-id"),
    messageDigestHex: h("message-digest"),
    solanaSignature: signature(),
  });

  assert.equal(observation.mint.freezeAuthorityHex, freezeAuthorityHex);
});

test("deposit claim account codec rejects malformed or noncanonical data", () => {
  assert.throws(() => decodeDepositClaimAccountBytes(Buffer.alloc(210)), /InvalidLength/);

  const wrongMagic = depositClaimBytes();
  wrongMagic.write("BADMAGIC", 0, "ascii");
  assert.throws(() => decodeDepositClaimAccountBytes(wrongMagic), /InvalidMagic/);

  const wrongVersion = depositClaimBytes();
  wrongVersion[8] = 2;
  assert.throws(() => decodeDepositClaimAccountBytes(wrongVersion), /UnsupportedVersion/);

  const nonZeroPadding = depositClaimBytes({ solanaRecipientHex: "aa" });
  nonZeroPadding[210] = 1;
  assert.throws(() => decodeDepositClaimAccountBytes(nonZeroPadding), /NonZeroDestinationPadding/);
});

test("deposit claim observer rejects substituted claim account records", async () => {
  const observer = new SolanaDepositClaimObserver({
    config: config(),
    rpcClient: new FakeDepositClaimRpcClient({
      accounts: [
        [CLAIM_ACCOUNT_BASE58, accountInfo(depositClaimBytes({ operationIdHex: h("different-operation") }))],
        [MINT_ACCOUNT_BASE58, accountInfo(mintBytes())],
      ],
    }),
  });

  await assert.rejects(
    () =>
      observer.observeFinalizedDepositClaim({
        operationIdHex: h("operation-id"),
        messageDigestHex: h("message-digest"),
        solanaSignature: signature(),
      }),
    /ObservedOperationMismatch/,
  );
});

test("SPL Mint codec preserves unset and set freeze authority states", () => {
  assert.equal(decodeSplMintAccountBytes(mintBytes()).freezeAuthorityHex, null);
  const freezeAuthorityHex = h("freeze-authority");
  assert.equal(decodeSplMintAccountBytes(mintBytes({ freezeAuthorityHex })).freezeAuthorityHex, freezeAuthorityHex);

  const invalidTag = mintBytes();
  invalidTag.writeUInt32LE(2, 46);
  assert.throws(() => decodeSplMintAccountBytes(invalidTag), /InvalidFreezeAuthorityTag/);
});

test("deposit claim observer fails closed for unavailable transaction or non-localnet use", async () => {
  const observer = new SolanaDepositClaimObserver({
    config: config(),
    rpcClient: new FakeDepositClaimRpcClient({ transaction: null }),
  });
  await assert.rejects(
    () =>
      observer.observeFinalizedDepositClaim({
        operationIdHex: h("operation-id"),
        messageDigestHex: h("message-digest"),
        solanaSignature: signature(),
      }),
    /TransactionUnavailable/,
  );

  const mainnetObserver = new SolanaDepositClaimObserver({
    config: config({ environment: "mainnet", cluster: "mainnet-beta" }),
    rpcClient: new FakeDepositClaimRpcClient(),
  });
  await assert.rejects(
    () =>
      mainnetObserver.observeFinalizedDepositClaim({
        operationIdHex: h("operation-id"),
        messageDigestHex: h("message-digest"),
        solanaSignature: signature(),
      }),
    /LocalnetOnly/,
  );
});

test("observer rejects account-program substitution, stale snapshots, and changed Mint authority", async () => {
  const request = { operationIdHex: h("operation-id"), messageDigestHex: h("message-digest"), solanaSignature: signature() };
  const mutations = [
    rpc => { rpc.accounts.get(CLAIM_ACCOUNT_BASE58).value.owner = MINT_ACCOUNT_BASE58; },
    rpc => { rpc.accounts.get(CLAIM_ACCOUNT_BASE58).value.executable = true; },
    rpc => { rpc.accounts.get(CLAIM_ACCOUNT_BASE58).context.slot = "87"; },
    rpc => { rpc.accounts.get(MINT_ACCOUNT_BASE58).value.owner = CLAIM_ACCOUNT_BASE58; },
    rpc => { const bytes = mintBytes(); bytes[4] ^= 1; rpc.accounts.set(MINT_ACCOUNT_BASE58, accountInfo(bytes)); },
    rpc => { const bytes = mintBytes(); bytes[44] = 9; rpc.accounts.set(MINT_ACCOUNT_BASE58, accountInfo(bytes)); },
  ];
  for (const mutate of mutations) {
    const rpc = new FakeDepositClaimRpcClient();
    mutate(rpc);
    const observer = new SolanaDepositClaimObserver({ config: config(), rpcClient: rpc });
    await assert.rejects(() => observer.observeFinalizedDepositClaim(request));
  }
  const observer = new SolanaDepositClaimObserver({ config: config(), rpcClient: new FakeDepositClaimRpcClient() });
  await assert.rejects(() => observer.observeFinalizedDepositClaim({ ...request, depositClaimAccountBase58: MINT_ACCOUNT_BASE58 }), /ADDRESS_MISMATCH/);
});

test("Mint decoding retains u64 precision and rejects extra data or uninitialized state", () => {
  const bytes = mintBytes();
  bytes.writeBigUInt64LE(0xffff_ffff_ffff_ffffn, 36);
  assert.equal(decodeSplMintAccountBytes(bytes).supplyAtomic, "18446744073709551615");
  assert.throws(() => decodeSplMintAccountBytes(Buffer.concat([bytes, Buffer.from([0])])), /InvalidLength/);
  bytes[45] = 0;
  assert.throws(() => decodeSplMintAccountBytes(bytes), /InvalidInitialization/);
});

test("deposit claim RPC client is loopback-only and method-restricted", async () => {
  assert.equal(normalizeSolanaDepositClaimRpcEndpoint("http://127.0.0.1:8899"), "http://127.0.0.1:8899/");
  assert.throws(() => normalizeSolanaDepositClaimRpcEndpoint("https://127.0.0.1:8899"), /ProtocolRejected/);
  const credentialedEndpoint = `http://${["u", "p"].join(":")}@127.0.0.1:8899`;
  assert.throws(() => normalizeSolanaDepositClaimRpcEndpoint(credentialedEndpoint), /CredentialsRejected/);
  assert.throws(() => normalizeSolanaDepositClaimRpcEndpoint("http://192.0.2.10:8899"), /MustBeLoopback/);

  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const result =
        payload.method === "getSlot"
          ? "91"
          : payload.method === "getTransaction"
            ? { slot: "88", meta: { err: null } }
            : accountInfo(payload.params[0] === CLAIM_ACCOUNT_BASE58 ? depositClaimBytes() : mintBytes());
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    const client = new SolanaDepositClaimRpcClient({
      endpoint: `http://127.0.0.1:${address.port}`,
    });
    assert.equal(await client.getFinalizedSlot(), "91");
    assert.deepEqual(await client.getTransaction(signature()), { slot: "88", meta: { err: null } });
    assert.equal((await client.getAccountInfo(CLAIM_ACCOUNT_BASE58)).value.data[1], "base64");
    await assert.rejects(() => client.call("sendTransaction", []), /MethodNotAllowed/);
  } finally {
    server.close();
    await once(server, "close");
  }
});
