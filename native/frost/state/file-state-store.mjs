import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { validateRuntimeFile, validateRuntimeStateRoot } from "../../../shared/runtime-path-boundary.mjs";
import { REQUIRED_FROST_SIGNERS, assertNativeFrostRuntimePolicy, canonicalUintDecimal,
  dataRecord } from "../policy/native-signing-policy.mjs";

export const FROST_STATE_FORMAT = "kingpepe-native-solana-frost-state/v2";

export class FileBackedFrostStateStore {
  #root;
  #file;
  #signerId;
  #repoRoot;

  constructor(options) {
    options = dataRecord(options, "FrostStateOptions");
    if (!REQUIRED_FROST_SIGNERS.includes(options.signerId)) throw new Error("FrostStateRoleInvalid");
    this.#signerId = options.signerId;
    this.#repoRoot = options.repoRoot;
    this.#root = validateRuntimeStateRoot(options.root, this.#repoRoot, "FROST state root");
    // This prepares a directory only; opening never creates an envelope or keys.
    try { mkdirSync(this.#root, { recursive: true, mode: 0o700 }); }
    catch { throw new Error("FrostStateDirectoryUnavailable"); }
    this.#file = validateRuntimeFile(path.join(this.#root, "frost-signer-state.json"), this.#repoRoot);
  }

  static createLocal(options) {
    options = dataRecord(options, "FrostStateCreationOptions");
    // Genuine immutable localnet/REGTEST capability, checked before any I/O.
    // Production provisioning is not implemented by this explicit test setup API.
    assertNativeFrostRuntimePolicy(options.policy);
    const store = new FileBackedFrostStateStore(options);
    validateRuntimeFile(store.#file, store.#repoRoot);
    try {
      writeFileSync(store.#file, `${JSON.stringify(initialSignerState(store.#signerId), null, 2)}\n`,
        { encoding: "utf8", mode: 0o600, flag: "wx", flush: true });
    } catch (error) {
      if (error.code === "EEXIST") throw new Error("FrostStateAlreadyExists");
      throw new Error("FrostStateCreationFailed");
    }
    return store;
  }

  get root() {
    return this.#root;
  }

  load() {
    validateRuntimeFile(this.#file, this.#repoRoot);
    let raw;
    try { raw = readFileSync(this.#file, "utf8"); }
    catch (error) {
      if (error.code === "ENOENT") throw new Error("FrostStateMissing");
      throw new Error("FrostStateReadFailed");
    }
    let parsed;
    // JSON parser errors can contain source excerpts. Never forward them.
    try { parsed = JSON.parse(raw); }
    catch { throw new Error("FrostStateInvalidJson"); }
    assertFrostStateEnvelope(parsed, this.#signerId);
    return parsed;
  }

  save(state) {
    assertFrostStateEnvelope(state, this.#signerId);
    // Save updates an existing compatible envelope; it is never initialization
    // or an automatic repair of missing/corrupt/foreign state.
    this.load();
    const tmp = validateRuntimeFile(path.join(this.#root, `.${randomUUID()}.tmp`), this.#repoRoot);
    try {
      writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx", flush: true });
    } catch { throw new Error("FrostStateWriteFailed"); }
    this.load(); // Recheck after writing; not an atomic filesystem fencing proof.
    try { renameSync(tmp, this.#file); }
    catch { throw new Error("FrostStateCommitFailed"); }
  }
}

export function initialSignerState(signerId) {
  return {
    format: FROST_STATE_FORMAT,
    signerId,
    activeEpoch: undefined,
    dkg: {},
    signing: {},
    nonceReservationCounter: "0",
    nonceTombstones: {},
  };
}

export function assertFrostStateEnvelope(value, signerId) {
  value = dataRecord(value, "FrostStateEnvelope");
  if (value?.format !== FROST_STATE_FORMAT) throw new Error("unsupported FROST signer state format");
  if (value.signerId !== signerId) throw new Error("FROST signer state role mismatch");
  if (!isRecord(value.dkg)) throw new Error("invalid FROST DKG state");
  if (!isRecord(value.signing)) throw new Error("invalid FROST signing state");
  try { canonicalUintDecimal(value.nonceReservationCounter, "nonce reservation counter"); }
  catch { throw new Error("invalid FROST nonce reservation counter"); }
  if (!isRecord(value.nonceTombstones)) {
    throw new Error("invalid FROST nonce tombstones");
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
