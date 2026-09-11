// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { ProjectAttester } from "./attestation-service.mjs";
import { decodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";

// The verifier is configured INSIDE the attester service. Evidence/booleans
// asserted by the bridge validator are never used as the verifier's result.
export function attesterIpcHandler({ attester, verifyNativeDeposit }) {
  if (!(attester instanceof ProjectAttester) || typeof verifyNativeDeposit !== "function") throw new Error("AttesterServiceVerifierRequired");
  return async ({ method, peerRole, operationId, payload }) => {
    if (method !== "attestDeposit" || peerRole !== "BRIDGE_VALIDATOR" || !payload ||
        Object.keys(payload).sort().join() !== "encodedMessageHex,rawEvidence" ||
        typeof payload.encodedMessageHex !== "string" || !/^(?:[0-9a-f]{2})+$/u.test(payload.encodedMessageHex)) throw new Error("AttesterIpcRequestRejected");
    const encodedMessageHex = payload.encodedMessageHex;
    const decoded = decodeCanonicalBridgeMessage(Buffer.from(encodedMessageHex, "hex"));
    if (decoded.operationIdHex !== operationId) throw new Error("AttesterIpcOperationMismatch");
    const verified = await verifyNativeDeposit(Object.freeze({ encodedMessageHex, rawEvidence: structuredClone(payload.rawEvidence) }));
    if (verified?.operationIdHex !== operationId || verified?.messageDigestHex !== decoded.messageDigestHex) throw new Error("AttesterIpcEvidenceMismatch");
    return attester.signDepositCredit({ encodedMessageHex, evidence: verified.evidence });
  };
}
