// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Parser fixture ONLY, not compiled code or evidence of blockchain execution.
import { createHash } from "node:crypto";
import { base58Decode, base58Encode, findProgramAddress } from "../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { DEPLOYMENT_MONITOR_PROTOCOL, UPGRADEABLE_LOADER } from "../../services/solana-observer/deployment-integrity.mjs";
import { REGTEST_GENESIS } from "../../native/node/native-raw-evidence.mjs";
import { mainnetDeploymentIdentity, NATIVE_MAINNET_GENESIS, NATIVE_MAINNET_DOMAIN, SOLANA_MAINNET_GENESIS } from "../../shared/network-identity.mjs";
import { encodeBridgeAbi, decodeBridgeAbi } from "../../shared/protocol/solana-bridge-abi.mjs";
export function deploymentFixture() {
  const h = v => createHash("sha256").update(v).digest(), k = v => base58Encode(h(v)), decode = v => Buffer.from(base58Decode(v));
  const manager = k("test-manager"), transceiver = k("test-transceiver"), mint = k("test-mint"), token = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const derive = (seed, program) => findProgramAddress([Buffer.from(seed), decode(mint)], decode(program)).base58;
  const binary = Buffer.concat([Buffer.from("7f454c46", "hex"), h("not-an-executable-parser-fixture")]);
  const program = id => ({ id, loader: UPGRADEABLE_LOADER, programData: findProgramAddress([decode(id)], decode(UPGRADEABLE_LOADER)).base58,
    upgradeAuthority: k("test-upgrade"), deploymentSlot: "0" });
  const manifest = { protocol: DEPLOYMENT_MONITOR_PROTOCOL, environment: "localnet", sourceSha: "12".repeat(20), identityVersion: 1,
    nativeGenesisHex: REGTEST_GENESIS, solanaGenesis: k("test-genesis"), solanaDeploymentHex: h("protected-ipc-local-deployment").toString("hex"), minimumSlot: "1", maximumStallMs: 60000,
    manager: program(manager), transceiver: program(transceiver),
    mint: { id: mint, tokenProgram: token, authority: derive("kingpepe-mint-authority", manager), decimals: 8 },
    config: { bridgePda: derive("kingpepe-bridge-state", manager), transceiverPda: derive("kingpepe-transceiver-config", transceiver),
      policyEpoch: 1, keyEpoch: 1, protocolId: 2, nativeNetwork: 3, attesters: [k("test-attester-a"), k("test-attester-b")], depositsPaused: false,  transceiverActive: true } };
  const record = (owner, executable, bytes) => ({ owner, executable, data: [bytes.toString("base64"), "base64"] });
  const programs = [manifest.manager, manifest.transceiver].map(p => { const b = Buffer.alloc(36); b.writeUInt32LE(2); decode(p.programData).copy(b, 4); return record(UPGRADEABLE_LOADER, true, b); });
  const data = [manifest.manager, manifest.transceiver].map(p => { const b = Buffer.alloc(binary.length + 45); b.writeUInt32LE(3); b[12] = 1; decode(p.upgradeAuthority).copy(b, 13); binary.copy(b, 45); return record(UPGRADEABLE_LOADER, false, b); });
  const mintBytes = Buffer.alloc(82); mintBytes.writeUInt32LE(1); decode(manifest.mint.authority).copy(mintBytes, 4); mintBytes[44] = 8; mintBytes[45] = 1;
  const bridge = Buffer.alloc(281); bridge.write("KPBSTAT1"); bridge[8] = 2; bridge[9] = 2;
  for (const [offset, value] of [[11, manager], [43, transceiver], [107, mint], [139, token], [171, manifest.mint.authority]]) decode(value).copy(bridge, offset);
  Buffer.from(manifest.solanaDeploymentHex, "hex").copy(bridge, 75); bridge[203] = 8; bridge[204] = 8; bridge.writeUInt32LE(1, 254); bridge.writeUInt32LE(1, 258);
  const config = Buffer.alloc(246); config.write("KPTCFG02"); config[8] = 1;
  for (const [offset, value] of [[9, transceiver], [41, manager], [73, mint], [177, manifest.config.attesters[0]], [209, manifest.config.attesters[1]]]) decode(value).copy(config, offset);
  Buffer.from(manifest.solanaDeploymentHex, "hex").copy(config, 105); config.writeUInt32LE(2, 137); config.writeUInt32LE(3, 141);
  Buffer.from(REGTEST_GENESIS, "hex").copy(config, 145); config[241] = 1; config.writeUInt32LE(1, 242);
  return { manifest, snapshot: { genesis: manifest.solanaGenesis, slot: 10, accounts: [...programs, record(token, false, mintBytes), record(manager, false, bridge), record(transceiver, false, config), ...data] } };
}

export function mainnetDeploymentFixture(state = 0) {
  const { manifest: m, snapshot: s } = deploymentFixture();
  m.environment = "mainnet"; m.nativeGenesisHex = NATIVE_MAINNET_GENESIS; m.solanaGenesis = SOLANA_MAINNET_GENESIS;
  m.solanaDeploymentHex = mainnetDeploymentIdentity({ manager: m.manager.id, transceiver: m.transceiver.id, mint: m.mint.id });
  Object.assign(m.config, { protocolId: 1, nativeNetwork: NATIVE_MAINNET_DOMAIN, mainnetProgramState: state,
    mainnetActivationEnabled: state === 5, depositsPaused: state === 0 });
  const bridge = decodeBridgeAbi("BridgeState", Buffer.from(s.accounts[3].data[0], "base64"));
  bridge.state = state; bridge.config.binding.environment = 2; bridge.config.binding.solanaDeployment = Buffer.from(m.solanaDeploymentHex, "hex");
  Object.assign(bridge.config.policy, { depositsPaused: state === 0,  mainnetActivationEnabled: state === 5 });
  s.accounts[3].data[0] = encodeBridgeAbi("BridgeState", bridge).toString("base64");
  const transceiver = decodeBridgeAbi("TransceiverState", Buffer.from(s.accounts[4].data[0], "base64"));
  Object.assign(transceiver.config, { protocolId: 1, nativeNetwork: NATIVE_MAINNET_DOMAIN,
    nativeGenesis: Buffer.from(NATIVE_MAINNET_GENESIS, "hex"), solanaDeployment: Buffer.from(m.solanaDeploymentHex, "hex") });
  s.accounts[4].data[0] = encodeBridgeAbi("TransceiverState", transceiver).toString("base64"); s.genesis = m.solanaGenesis;
  return { manifest: m, snapshot: s };
}
