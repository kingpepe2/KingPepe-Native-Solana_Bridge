import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { validateRuntimeFile, validateRuntimeStateRoot } from "../../../shared/runtime-path-boundary.mjs";

export const FROST_STATE_FORMAT = "kingpepe-native-solana-frost-state/v1";

export class FileBackedFrostStateStore {
  #root;
  #file;
  #signerId;
  #repoRoot;

  constructor(options) {
    this.#signerId = options.signerId;
    this.#repoRoot = options.repoRoot;
    this.#root = validateRuntimeStateRoot(options.root, this.#repoRoot, "FROST state root");
    mkdirSync(this.#root, { recursive: true, mode: 0o700 });
    this.#file = validateRuntimeFile(path.join(this.#root, "frost-signer-state.json"), this.#repoRoot);
  }

  get root() {
    return this.#root;
  }

  load() {
    validateRuntimeFile(this.#file, this.#repoRoot);
    if (!existsSync(this.#file)) return initialSignerState(this.#signerId);
    const parsed = JSON.parse(readFileSync(this.#file, "utf8"));
    validateStateEnvelope(parsed, this.#signerId);
    return parsed;
  }

  save(state) {
    validateStateEnvelope(state, this.#signerId);
    validateRuntimeFile(this.#file, this.#repoRoot);
    const tmp = validateRuntimeFile(path.join(this.#root, `.${process.pid}.${Date.now()}.tmp`), this.#repoRoot);
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx", flush: true });
    renameSync(tmp, this.#file);
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

function validateStateEnvelope(value, signerId) {
  if (value?.format !== FROST_STATE_FORMAT) throw new Error("unsupported FROST signer state format");
  if (value.signerId !== signerId) throw new Error("FROST signer state role mismatch");
  if (typeof value.dkg !== "object" || value.dkg === null) throw new Error("invalid FROST DKG state");
  if (typeof value.signing !== "object" || value.signing === null) throw new Error("invalid FROST signing state");
  if (!/^(0|[1-9][0-9]{0,19})$/u.test(value.nonceReservationCounter)) {
    throw new Error("invalid FROST nonce reservation counter");
  }
  if (typeof value.nonceTombstones !== "object" || value.nonceTombstones === null) {
    throw new Error("invalid FROST nonce tombstones");
  }
}
