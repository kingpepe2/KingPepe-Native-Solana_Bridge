// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Read-only Phase 15 verification. RPC credentials stay in the process environment.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeBridgeAbi, encodeBridgeAbi } from "../../shared/protocol/solana-bridge-abi.mjs";
import { base58Decode, base58DecodeInstruction, base58Encode, findProgramAddress } from "../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { buildDevnetSolanaSetupTransactionPlan, DEVNET_SOLANA_GENESIS,
  SPL_TOKEN_PROGRAM_ID_BASE58 as TOKEN } from "../../services/bridge-validator/localnet-solana-setup-plan.mjs";
import { REGTEST_GENESIS } from "../../native/node/native-raw-evidence.mjs";

const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const check = (ok, code) => { if (!ok) throw Error(code); };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const key = bytes => base58Encode(Uint8Array.from(bytes));
const equal = (a, b) => Buffer.from(a).equals(Buffer.from(b));

export async function verifyDevnetDeployment(manifest, binaryDirectory) {
  const endpoint = process.env.SOLANA_DEVNET_RPC_URL;
  check(typeof endpoint === "string" && new URL(endpoint).protocol === "https:", "DEVNET_HTTPS_RPC_REQUIRED");
  let requestId = 0;
  async function rpc(method, params = []) {
    const id = ++requestId;
    const response = await fetch(endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
    check(response.ok, "DEVNET_RPC_HTTP_FAILED");
    const value = await response.json();
    check(value?.jsonrpc === "2.0" && value.id === id && !value.error && Object.hasOwn(value, "result"), "DEVNET_RPC_RESPONSE_REJECTED");
    return value.result;
  }
  check(await rpc("getGenesisHash") === DEVNET_SOLANA_GENESIS, "DEVNET_GENESIS_MISMATCH");
  check(manifest.scope === "DEVNET_TEST_ONLY" && manifest.solanaGenesis === DEVNET_SOLANA_GENESIS &&
    manifest.nativeGenesis === REGTEST_GENESIS && manifest.nativeNetwork === 8_000_111 &&
    manifest.borshSchemaVersion === 2 && /^[0-9a-f]{40}$/u.test(manifest.sourceSha) &&
    manifest.productionReady === false && manifest.mainnetActivation === "DISABLED", "DEVNET_MANIFEST_REJECTED");
  const balance = await rpc("getBalance", [manifest.feePayer, { commitment: "finalized" }]);
  const derive = (seed, id) => findProgramAddress(seed, base58Decode(id)).base58;
  const pdas = {
    managerProgramData: derive([base58Decode(manifest.managerProgram)], LOADER),
    transceiverProgramData: derive([base58Decode(manifest.transceiverProgram)], LOADER),
    mintAuthority: derive([Buffer.from("kingpepe-mint-authority"), base58Decode(manifest.mint)], manifest.managerProgram),
    bridgePda: derive([Buffer.from("kingpepe-bridge-state"), base58Decode(manifest.mint)], manifest.managerProgram),
    transceiverPda: derive([Buffer.from("kingpepe-transceiver-config"), base58Decode(manifest.mint)], manifest.transceiverProgram),
  };
  for (const [name, address] of Object.entries(pdas)) check(manifest.pdas[name] === address, "DEVNET_PDA_MISMATCH");
  const addresses = [manifest.managerProgram, pdas.managerProgramData, manifest.transceiverProgram,
    pdas.transceiverProgramData, manifest.mint, manifest.recipientSplAccount, pdas.bridgePda, pdas.transceiverPda];
  check(new Set(addresses).size === addresses.length, "DEVNET_DUPLICATED_IDENTITY");
  const accounts = await rpc("getMultipleAccounts", [addresses, { commitment: "finalized", encoding: "base64" }]);
  check(Number.isSafeInteger(accounts?.context?.slot) && accounts.value?.length === addresses.length, "DEVNET_ACCOUNT_READ_REJECTED");
  function bytes(index, expectedOwner, executable = false) {
    const a = accounts.value[index];
    check(a?.owner === expectedOwner && a.executable === executable && a.data?.[1] === "base64", "DEVNET_ACCOUNT_IDENTITY_MISMATCH");
    const result = Buffer.from(a.data[0], "base64");
    check(result.toString("base64") === a.data[0], "DEVNET_ACCOUNT_ENCODING_REJECTED");
    return result;
  }
  const programs = {};
  for (const [name, index] of [["manager", 0], ["transceiver", 2]]) {
    const program = bytes(index, LOADER, true), data = bytes(index + 1, LOADER);
    check(program.length === 36 && program.readUInt32LE(0) === 2 && key(program.subarray(4)) === addresses[index + 1], "DEVNET_PROGRAMDATA_MISMATCH");
    check(data.length > 109 && data.readUInt32LE(0) === 3 && data[12] === 1 &&
      key(data.subarray(13, 45)) === manifest.upgradeAuthority && manifest.upgradeAuthority === manifest.feePayer, "DEVNET_UPGRADE_AUTHORITY_MISMATCH");
    const binary = data.subarray(45), pinned = manifest.binaries[name];
    check(binary.length === pinned.bytes && hash(binary) === pinned.sha256 && binary.subarray(0, 4).toString("hex") === "7f454c46" &&
      binary.readUInt32LE(48) === 3, "DEVNET_BYTECODE_MISMATCH");
    if (binaryDirectory) check(equal(binary, readFileSync(path.join(binaryDirectory, `kingpepe_${name === "manager" ? "bridge" : name}.so`))), "DEVNET_LOCAL_BUILD_MISMATCH");
    const slot = Number(data.readBigUInt64LE(4));
    check(Number.isSafeInteger(slot), "DEVNET_DEPLOYMENT_SLOT_INVALID");
    const history = await rpc("getSignaturesForAddress", [addresses[index], { commitment: "finalized", limit: 100 }]);
    const deployments = history.filter(tx => tx.err === null && tx.slot === slot);
    check(deployments.length === 1, "DEVNET_DEPLOYMENT_TRANSACTION_UNRESOLVED");
    const transaction = await rpc("getTransaction", [deployments[0].signature, { commitment: "finalized", encoding: "json", maxSupportedTransactionVersion: 0 }]);
    check(transaction?.meta?.err === null && transaction.slot === slot && transaction.transaction.message.instructions.some(ix =>
      transaction.transaction.message.accountKeys[ix.programIdIndex] === LOADER && Buffer.from(base58DecodeInstruction(ix.data)).readUInt32LE(0) === 2), "DEVNET_DEPLOYMENT_TRANSACTION_REJECTED");
    programs[name] = { programId: addresses[index], programData: addresses[index + 1], deploymentSlot: slot,
      signature: deployments[0].signature, bytecodeSha256: hash(binary), bytes: binary.length, upgradeAuthority: manifest.upgradeAuthority };
  }
  const mint = bytes(4, TOKEN), token = bytes(5, TOKEN);
  check(mint.length === 82 && mint.readUInt32LE(0) === 1 && key(mint.subarray(4, 36)) === pdas.mintAuthority &&
    mint.readBigUInt64LE(36) === 0n && mint[44] === 8 && mint[45] === 1 && mint.readUInt32LE(46) === 0 &&
    mint.subarray(50).every(v => v === 0), "DEVNET_ZERO_SUPPLY_MINT_REJECTED");
  check(token.length === 165 && key(token.subarray(0, 32)) === manifest.mint && key(token.subarray(32, 64)) === manifest.recipient &&
    token.readBigUInt64LE(64) === 0n && token[108] === 1, "DEVNET_RECIPIENT_ACCOUNT_REJECTED");
  const setup = buildDevnetSolanaSetupTransactionPlan({ environment: "devnet", cluster: "devnet", solanaGenesis: DEVNET_SOLANA_GENESIS,
    nativeGenesisHex: manifest.nativeGenesis, nativeNetwork: manifest.nativeNetwork, protocolId: 1, solanaDeploymentHex: manifest.solanaDeploymentHex,
    managerProgramIdBase58: manifest.managerProgram, transceiverProgramIdBase58: manifest.transceiverProgram, mintBase58: manifest.mint,
    recipientTokenAccountBase58: manifest.recipientSplAccount, recipientTokenAccountOwnerBase58: manifest.recipient, feePayerBase58: manifest.feePayer,
    decimals: 8, nativeDecimals: 8, initialSupplyAtomic: "0", recentBlockhashBase58: "11111111111111111111111111111111", lastValidBlockHeight: "1",
    mintRentLamports: "1", tokenAccountRentLamports: "1", policyEpoch: 1, keyEpoch: 1,
    attesterPublicKeysHex: manifest.attesters.map(k => Buffer.from(base58Decode(k)).toString("hex")) });
  const bridgeInit = decodeBridgeAbi("BridgeInitialize", Buffer.from(setup.instructions[5].dataBase64, "base64"));
  const transceiverInit = decodeBridgeAbi("TransceiverInitialize", Buffer.from(setup.instructions[4].dataBase64, "base64"));
  const bridgeExpected = encodeBridgeAbi("BridgeState", { magic: Buffer.from("KPBSTAT1"), version: 1, state: 3,
    config: { binding: bridgeInit.binding, policy: bridgeInit.policy, freezeTag: 0, freezeKey: new Uint8Array(32), initialSupply: 0n },
    mintedSupply: 0n, burnedUnpaidWithdrawals: 0n });
  const transceiverExpected = encodeBridgeAbi("TransceiverState", { magic: Buffer.from("KPTCFG02"), version: 1, config: transceiverInit.config });
  check(equal(bytes(6, manifest.managerProgram), bridgeExpected), "DEVNET_BRIDGE_BORSH_CONFIG_MISMATCH");
  check(equal(bytes(7, manifest.transceiverProgram), transceiverExpected), "DEVNET_TRANSCEIVER_BORSH_CONFIG_MISMATCH");
  const mintHistory = await rpc("getSignaturesForAddress", [manifest.mint, { commitment: "finalized", limit: 100 }]);
  const enrollment = [];
  for (const item of mintHistory.filter(tx => tx.err === null)) {
    const tx = await rpc("getTransaction", [item.signature, { commitment: "finalized", encoding: "json", maxSupportedTransactionVersion: 0 }]);
    if (tx?.meta?.err !== null) continue;
    const message = tx.transaction.message;
    if (message.instructions.length !== 6) continue;
    if (![4, 5].every(i => message.accountKeys[message.instructions[i].programIdIndex] === (i === 4 ? manifest.transceiverProgram : manifest.managerProgram) &&
      equal(base58DecodeInstruction(message.instructions[i].data), Buffer.from(setup.instructions[i].dataBase64, "base64")))) continue;
    // All six instruction account lists must match the atomic setup plan; rent
    // and blockhash are consensus transaction fields, not bridge Borsh messages.
    check(setup.instructions.every((ix, i) => message.accountKeys[message.instructions[i].programIdIndex] === setup.accounts[ix.programIdIndex].addressBase58 &&
      JSON.stringify(message.instructions[i].accounts.map(a => message.accountKeys[a])) ===
      JSON.stringify(ix.accountIndexes.map(a => setup.accounts[a].addressBase58))), "DEVNET_ENROLLMENT_ACCOUNTS_MISMATCH");
    enrollment.push({ signature: item.signature, slot: tx.slot });
  }
  check(enrollment.length === 1, "DEVNET_ENROLLMENT_TRANSACTION_UNRESOLVED");
  if (manifest.transactions) {
    for (const [name, actual] of [["managerDeployment", { signature: programs.manager.signature, slot: programs.manager.deploymentSlot }],
      ["transceiverDeployment", { signature: programs.transceiver.signature, slot: programs.transceiver.deploymentSlot }],
      ["mintAndConfigEnrollment", enrollment[0]]]) {
      check(manifest.transactions[name]?.signature === actual.signature && manifest.transactions[name]?.slot === actual.slot, "DEVNET_RECORDED_TRANSACTION_MISMATCH");
    }
  }
  return { status: "PASS", scope: "DEVNET_TEST_ONLY_ZERO_SUPPLY_ENROLLMENT", sourceSha: manifest.sourceSha,
    verifiedAt: new Date().toISOString(), finalizedSlot: accounts.context.slot, genesis: DEVNET_SOLANA_GENESIS,
    feePayerBalanceLamports: String(balance.value), borshSchemaVersion: 2, bridgeAccountLayoutVersion: 1,
    transceiverAccountLayoutVersion: 1, programs, mint: manifest.mint, initialSupplyAtomic: "0", decimals: 8,
    mintAuthority: pdas.mintAuthority, freezeAuthority: null, pdas, enrollment: enrollment[0],
    exactBorshConfigBytes: true, localBuildBytesCompared: Boolean(binaryDirectory), noTransactionSubmitted: true,
    productionReady: false, mainnetActivation: "DISABLED" };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const manifest = JSON.parse(readFileSync(process.argv[2], "utf8"));
    console.log(JSON.stringify(await verifyDevnetDeployment(manifest, process.argv[3]), null, 2));
  } catch (error) {
    // Never print a provider response, endpoint, stack, or raw transport error.
    console.error(/^[A-Z_]{1,100}$/u.test(error?.message ?? "") ? error.message : "DEVNET_VERIFICATION_FAILED");
    process.exitCode = 1;
  }
}
