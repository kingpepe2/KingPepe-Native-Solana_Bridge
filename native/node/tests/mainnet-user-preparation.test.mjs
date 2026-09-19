// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Public format fixtures only; no wallet keys, network submissions or approval.
import test from "node:test";
import assert from "node:assert/strict";
import { base58 } from "@scure/base";
import { NATIVE_MAINNET_GENESIS, NATIVE_MAINNET_DOMAIN, SOLANA_MAINNET_GENESIS, SOLANA_DEVNET_GENESIS,
  mainnetDeploymentIdentity } from "../../../shared/network-identity.mjs";
import { createNativeDepositRequest, createMainnetNativeDepositRequest } from "../../../solana/ts/sdk/bridge.mjs";
import { prepareMainnetRecoveryPsbt, prepareRegtestRecoveryPsbt, inspectUnsignedMainnetRecoveryPsbt,
  inspectUnsignedRecoveryPsbt } from "../../recovery/recovery-psbt.mjs";
import { createUnsignedNativeTransaction, parseNativeTransactionHex } from "../native-taproot-transaction.mjs";
import { scriptFromWitnessAddress } from "../witness-address.mjs";
import { decodeBridgeAbi } from "../../../shared/protocol/solana-bridge-abi.mjs";
import { createMainnetModeInstruction } from "../../../solana/ts/sdk/mainnet-control.mjs";

const hash = n => n.toString(16).padStart(2, "0").repeat(32);
const key = n => base58.encode(Buffer.from(hash(n), "hex"));
const frost = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const recovery = "c6047f9441ed7d6d3045406e95c07cd85a961ae58cd9ee37abac09b95c709ee5";
const policy = { environment: "mainnet", nativeGenesis: NATIVE_MAINNET_GENESIS,
  solanaDeployment: mainnetDeploymentIdentity({ manager: key(4), transceiver: key(5), mint: key(6) }),
  solanaGenesis: SOLANA_MAINNET_GENESIS, minimumSolanaSlot: "0", managerProgramId: hash(4), transceiverProgramId: hash(5),
  mint: hash(6), protocolId: 1, nativeNetwork: NATIVE_MAINNET_DOMAIN, policyEpoch: 1, keyEpoch: 1, frostPublicKeyHex: frost,
  csvDelayBlocks: 1440, minimumConfirmations: 12, maximumAmountAtomic: "18446744073709551615", maximumFeeAtomic: "10000" };
const deposit = { amountAtomic: "100000", recipient: key(7), userRecoveryPublicKeyHex: recovery, nonceHex: hash(8) };
test("Mainnet control preparation has only the exact config and enrollment signer; it cannot construct a transfer", () => {
  // Same fixed public commitment checked by the Rust Mainnet identity test.
  assert.equal(mainnetDeploymentIdentity({ manager: key(1), transceiver: key(2), mint: key(3) }),
    "f468d52edb30158677499d8258218786c1e5883777bf584f1a43b3b148e9b997");
  for (const [mode, value] of [["PAUSED", 0], ["CONTROLLED", 1], ["ACTIVE", 2]]) {
    const instruction = createMainnetModeInstruction({ deployment: policy, mode });
    assert.equal(instruction.program, key(4)); assert.equal(instruction.accounts.length, 2);
    assert.deepEqual(instruction.accounts.filter(a => a.signer), [{ key: key(6), writable: false, signer: true }]);
    assert.equal(instruction.data.toString("hex"), "04" + value.toString(16).padStart(2, "0"));
    assert.deepEqual(decodeBridgeAbi("MainnetMode", instruction.data), { tag: 4, mode: value });
  }
  for (const mode of [undefined, "ENABLED", "mainnet", 1]) assert.throws(() => createMainnetModeInstruction({ deployment: policy, mode }));
  assert.throws(() => createMainnetModeInstruction({ deployment: { ...policy, nativeNetwork: 8000111 }, mode: "CONTROLLED" }));
  assert.throws(() => createMainnetModeInstruction({ deployment: { ...policy, mint: hash(13) }, mode: "ACTIVE" }));
});

test("explicit Mainnet deposit request uses the approved CSV window and distinct Native address network", () => {
  const request = createMainnetNativeDepositRequest({ policy, ...deposit });
  assert.equal(request.recovery.csvDelayBlocks, 1440);
  assert.equal(request.minimumConfirmations, 12);
  assert(request.recovery.recovery.scriptHex.startsWith("02a005b269"));
  assert.equal(scriptFromWitnessAddress(request.depositAddress, "kpepe"), request.scriptPubKeyHex);
  assert.throws(() => scriptFromWitnessAddress(request.depositAddress));
  assert.throws(() => createNativeDepositRequest({ policy, ...deposit }));
  assert.deepEqual(createMainnetNativeDepositRequest({ policy, ...deposit }), request);
  for (const change of [{ amountAtomic: "99999" }, { recipient: key(9) }, { nonceHex: hash(9) }]) {
    assert.notEqual(createMainnetNativeDepositRequest({ policy, ...deposit, ...change }).operationId, request.operationId);
  }
  for (const change of [{ environment: "devnet" }, { solanaGenesis: SOLANA_DEVNET_GENESIS }, { mint: hash(10) },
    { nativeNetwork: 8000111 }, { minimumConfirmations: 11 }]) {
    assert.throws(() => createMainnetNativeDepositRequest({ policy: { ...policy, ...change }, ...deposit }));
  }
});

test("Mainnet recovery PSBT preserves the 1440-block sequence, user leaf and explicit network domain without signing", () => {
  const request = createMainnetNativeDepositRequest({ policy, ...deposit });
  const fundingTransactionHex = createUnsignedNativeTransaction({ inputs: [{ txid: hash(12), vout: 0 }],
    outputs: [{ amountAtomic: deposit.amountAtomic, scriptPubKeyHex: request.scriptPubKeyHex }] });
  const options = { depositPolicy: request.recovery, fundingTransactionHex, outputIndex: 0, amountAtomic: deposit.amountAtomic,
    destinationScriptPubKeyHex: "5120" + recovery, feeAtomic: "1000", maximumFeeAtomic: "1000",
    userKeyOrigin: { masterFingerprintHex: "01020304", derivationPath: "m/86'/0'/0'/0/3" } };
  const prepared = prepareMainnetRecoveryPsbt(options);
  const decoded = inspectUnsignedMainnetRecoveryPsbt(prepared.psbtBase64);
  const transaction = parseNativeTransactionHex(decoded.global["00"]);
  assert.equal(transaction.version, 2); assert.equal(transaction.inputs[0].sequence, 1440);
  assert.equal(transaction.outputs[0].amountAtomic, "99000");
  assert.equal(decoded.input["15" + request.recovery.recovery.controlBlockHex], request.recovery.recovery.scriptHex + "c0");
  assert.equal(decoded.input["15" + request.recovery.sweep.controlBlockHex], undefined);
  assert.equal(prepared.signingAuthorized, false); assert.equal(prepared.broadcastAuthorized, false);
  assert.equal(prepared.productionReady, false); assert.equal(prepared.walletSigningCompatibility, "NOT_VERIFIED");
  assert.throws(() => inspectUnsignedRecoveryPsbt(prepared.psbtBase64));
  assert.throws(() => prepareRegtestRecoveryPsbt(options));
  assert.throws(() => prepareMainnetRecoveryPsbt({ ...options, feeAtomic: "1001" }));
});
