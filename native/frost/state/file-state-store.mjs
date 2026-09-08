import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export const FROST_STATE_FORMAT = "kingpepe-native-solana-frost-state/v1";

export class FileBackedFrostStateStore {
  #root;
  #file;
  #signerId;

  constructor(options) {
    this.#signerId = options.signerId;
    this.#root = path.resolve(options.root);
    if (!path.isAbsolute(this.#root)) throw new Error("FROST state root must be absolute");
    if (options.repoRoot !== undefined) {
      const repoRoot = path.resolve(options.repoRoot);
      const relative = path.relative(repoRoot, this.#root);
      if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
        throw new Error("FROST runtime state root must be outside the source repository");
      }
    }
    mkdirSync(this.#root, { recursive: true, mode: 0o700 });
    this.#file = path.join(this.#root, "frost-signer-state.json");
  }

  get root() {
    return this.#root;
  }

  load() {
    if (!existsSync(this.#file)) return initialSignerState(this.#signerId);
    const parsed = JSON.parse(readFileSync(this.#file, "utf8"));
    validateStateEnvelope(parsed, this.#signerId);
    return parsed;
  }

  save(state) {
    validateStateEnvelope(state, this.#signerId);
    mkdirSync(this.#root, { recursive: true, mode: 0o700 });
    const tmp = path.join(this.#root, `.${process.pid}.${Date.now()}.tmp`);
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, this.#file);
  }

  destroyForTestOnly() {
    rmSync(this.#root, { recursive: true, force: true });
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
