// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Offline key preparation actor. Its command surface has no transaction signing.
import { existsSync } from "node:fs";
import { WindowsProtectedStore } from "../../../shared/windows/protected-store.mjs";
import { WindowsProtectedFrostStateStore } from "../state/windows-protected-state-store.mjs";
import { createMainnetNativeDkgPolicy } from "../policy/native-signing-policy.mjs";
import { NativeFrostSigner } from "./native-frost-signer.mjs";

if (!process.send || process.env.KINGPEPE_MAINNET_PREPARE_ACTOR !== "1") throw new Error("MainnetPreparationParentRequired");
let signer, state, busy = false, closed = false;
async function close() { if (closed) return; closed = true; signer?.close(); await state?.close(); }
process.on("disconnect", () => { close().finally(() => process.exit(0)); });
process.on("message", async message => {
  if (busy || closed || !message || !Number.isSafeInteger(message.id)) return process.send({ id: message?.id, error: "MainnetPreparationRejected" });
  busy = true;
  try {
    let result;
    const value = message.value;
    switch (message.method) {
      case "INIT": {
        if (signer || state) throw new Error();
        const policy = createMainnetNativeDkgPolicy(value.policy);
        const role = value.stateOptions.context.role;
        state = existsSync(value.stateOptions.root)
          ? new WindowsProtectedFrostStateStore(new WindowsProtectedStore(value.stateOptions), role)
          : WindowsProtectedFrostStateStore.createMainnetPreparation(value.stateOptions, policy);
        await state.acquireExclusive();
        signer = new NativeFrostSigner({ signerId: role, index: role === "KINGPEPE_FROST_A" ? 0 : 1, policy, stateStore: state });
        result = signer.dkgContext(); break;
      }
      case "PHASE": result = signer.dkgPhase(value); break;
      case "ROUND1": result = signer.dkgRound1(value); break;
      case "ROUND2": result = signer.dkgRound2(value.request, value.round1); break;
      case "STAGE": result = signer.dkgStageRound2(value.request, value.round1, value.incoming); break;
      case "COMPLETE": result = signer.dkgCompleteStaged(value); break;
      case "CLOSE": await close(); result = { state: "CLOSED" }; break;
      default: throw new Error();
    }
    process.send({ id: message.id, result });
  } catch { process.send({ id: message.id, error: "MainnetPreparationRejected" }); }
  finally { busy = false; }
});
