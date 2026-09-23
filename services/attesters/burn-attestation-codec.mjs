// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import {ed25519} from '@noble/curves/ed25519.js';
import {decodeCanonicalBridgeMessage} from '../../shared/protocol/canonical-message.mjs';

export const ATTESTATION_PROTOCOL='KINGPEPE_FINALIZED_NATIVE_BURN_ATTESTATION_V1';
export const ATTESTATION_MODE='PROJECT_ATTESTED_2_OF_2_ED25519';
export const BURN_SIGNED_BYTES='CANONICAL_FINALIZED_NATIVE_BURN_BORSH_V4';
export function verifyProjectAttestation(a,encodedMessageHex) {
  try {
    const m=decodeCanonicalBridgeMessage(Buffer.from(encodedMessageHex,'hex'));
    return a && Object.keys(a).sort().join()==='attesterPublicKeyHex,keyEpoch,messageDigestHex,mode,operationIdHex,policyEpoch,protocol,role,signatureHex,signedBytes,state' &&
      a.protocol===ATTESTATION_PROTOCOL&&a.mode===ATTESTATION_MODE&&['ATTESTER_A','ATTESTER_B'].includes(a.role)&&
      a.signedBytes===BURN_SIGNED_BYTES&&a.state==='VERIFIED_READY'&&a.keyEpoch===m.keyEpoch&&a.policyEpoch===m.policyEpoch&&
      a.operationIdHex===m.operationIdHex&&a.messageDigestHex===m.messageDigestHex&&
      /^[0-9a-f]{64}$/u.test(a.attesterPublicKeyHex)&&/^[0-9a-f]{128}$/u.test(a.signatureHex)&&
      ed25519.verify(Buffer.from(a.signatureHex,'hex'),m.encoded,Buffer.from(a.attesterPublicKeyHex,'hex'),{zip215:false});
  }catch{return false;}
}
export function verifyBurnAttestationPair(attestations,encodedMessageHex,authorizedPublicKeys) {
  if(!Array.isArray(attestations)||attestations.length!==2||!Array.isArray(authorizedPublicKeys)||authorizedPublicKeys.length!==2||
      authorizedPublicKeys[0]===authorizedPublicKeys[1]||!attestations.every((a,i)=>a?.role===['ATTESTER_A','ATTESTER_B'][i]&&
        a.attesterPublicKeyHex===authorizedPublicKeys[i]&&verifyProjectAttestation(a,encodedMessageHex)))
    throw new Error('FinalizedBurnAttestationPairRejected');
}
