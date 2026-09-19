// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// SYNTHETIC Mainnet-shaped reads for intake/state tests. No genuine Native proof,
// private key, signing, economic RPC or production state is present.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { solanaDeliveryFixture } from "./solana-delivery-fixture.mjs";
import { createMainnetNativeDepositRequest } from "../../solana/ts/sdk/bridge.mjs";
import { base58Encode } from "../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { NativeRpcClient } from "../../native/node/native-rpc-client.mjs";
import { LocalNativeEvidenceVerifier } from "../../native/node/native-raw-evidence.mjs";
import { createUnsignedNativeTransaction, parseNativeTransactionHex } from "../../native/node/native-taproot-transaction.mjs";
const h = s => createHash("sha256").update(s).digest("hex");
export async function mainnetDepositRequestFixture() {
  const delivery = (await solanaDeliveryFixture({ mainnet: true })).policy;
  const p = delivery.operationPolicy;
  p.frostPublicKeyHex = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
  const input = { amountAtomic: "100000", recipient: base58Encode(Buffer.from(h("public recipient fixture"), "hex")),
    userRecoveryPublicKeyHex: "c6047f9441ed7d6d3045406e95c07cd85a961ae58cd9ee37abac09b95c709ee5", nonceHex: h("intake nonce") };
  const quote = createMainnetNativeDepositRequest({ policy: p, ...input });
  const raw = createUnsignedNativeTransaction({ inputs: [{ txid: h("deposit source"), vout: 0 }],
    outputs: [{ amountAtomic: input.amountAtomic, scriptPubKeyHex: quote.scriptPubKeyHex }] });
  const request = { operationId: quote.operationId, depositIntent: quote.depositIntent, userRecoveryPublicKeyHex: input.userRecoveryPublicKeyHex,
    depositTxidHex: parseNativeTransactionHex(raw).txidHex, depositVout: 0,
    feeFundingInputs: [{ txid: h("operator fee fixture"), vout: 0, amountAtomic: "212", scriptPubKeyHex: "5120" + p.frostPublicKeyHex, minimumConfirmations: 12 }] };
  const calls = [], conditions = { finalized: false };
  const rpc = new NativeRpcClient({ endpoint: "http://127.0.0.1:23457", fetchFn: () => { throw new Error("ISOLATED_TEST_NETWORK_FORBIDDEN"); } });
  rpc.getSourceSnapshot = async options => {
    assert.deepEqual(options, { expectedNetwork: "main", expectedGenesisHash: p.nativeGenesis });
    calls.push("identity"); return { state: "READY", bestHash: h("synthetic tip") };
  };
  rpc.getRawTransaction = async txid => { assert.equal(txid, request.depositTxidHex); calls.push("transaction"); return raw; };
  rpc.getUtxoObservation = async () => ({ unspent: true, valueAtomic: input.amountAtomic, scriptPubKeyHex: quote.scriptPubKeyHex, bestBlockHash: h("synthetic tip") });
  rpc.call = async (method, params) => {
    calls.push(method); if (method === "estimatesmartfee") assert.deepEqual(params, [3, "ECONOMICAL"]);
    const fields = { estimatesmartfee: '"feerate":0.00001000,"blocks":3', getnetworkinfo: '"relayfee":0.00001000', getmempoolinfo: '"mempoolminfee":0.00001000' };
    assert(Object.hasOwn(fields, method)); return { raw: '{"result":{' + fields[method] + '},"error":null,"id":1}' };
  };
  const verifier = LocalNativeEvidenceVerifier.createMainnet({ rpc, executable: "/unused-synthetic-intake-fixture" });
  verifier.verifyInputs = async value => {
    calls.push("finality"); assert.equal(value.minimumConfirmations, 12);
    if (!conditions.finalized) throw new Error("RAW_NATIVE_INPUT_FINALITY_INSUFFICIENT");
    return { digestHex: h("synthetic checkpoint"), acceptedCheckpoint: { protocol: "KINGPEPE_MAINNET_ACCEPTANCE_CHECKPOINT_V1",
      genesis: p.nativeGenesis, tipHash: h("synthetic tip"), tipHeight: 100, chainworkHex: h("synthetic work"), minimumConfirmations: 12, evidenceDigestHex: h("synthetic checkpoint") } };
  };
  return { policy: { deliveryPolicy: delivery, creditValiditySeconds: 3600 }, quote, request, input, calls, conditions, rpc, verifier,
    feePolicy: { policy: "DYNAMIC_NODE_ESTIMATE_WITH_CAP", minimumRelayAtomicPerKvB: "1000", maximumAtomicPerKvB: "10000", maximumFeeAtomic: p.maximumFeeAtomic } };
}
