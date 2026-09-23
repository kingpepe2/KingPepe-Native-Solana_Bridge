// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Sole current protocol: canonical finalized Native burn evidence (Borsh V4).
import {createHash} from 'node:crypto';
import {encodeBurnMessage,decodeBurnMessage,BURN_MESSAGE_SCHEMA,BURN_MESSAGE_LENGTH} from './burn-message.mjs';
import {encodeBurnBinding,encodeFinalizedBurnEvidence,BURN_BINDING_SCHEMA} from '../../native/burn/burn-protocol.mjs';
import {bytesToHex,hexToBytes,stableJson} from './codec-helpers.mjs';
export * from './codec-helpers.mjs';
export const PROTOCOL_MAGIC='KPBRMSG4',MESSAGE_VERSION=4,MESSAGE_LENGTH=BURN_MESSAGE_LENGTH;
export const DEPLOYMENT_IDENTITY_LENGTH=168,NATIVE_OUTPOINT_LENGTH=36,MAX_DESTINATION_LENGTH=128;
export const CANONICAL_MESSAGE_SCHEMA=BURN_MESSAGE_SCHEMA,OPERATION_ID_SCHEMA=BURN_BINDING_SCHEMA;
const h={array:{type:'u8',len:32}};
export const DEPLOYMENT_SCHEMA={struct:{protocolId:'u32',nativeNetwork:'u32',nativeGenesis:h,solanaDeployment:h,managerProgramId:h,transceiverProgramId:h,mint:h}};
export const OUTPOINT_SCHEMA={struct:{txid:h,vout:'u32'}};
const hash=bytes=>createHash('sha256').update(bytes).digest();

export function decodeCanonicalBridgeMessage(input) {
  const encoded=typeof input==='string'?hexToBytes(input):input;
  const m=decodeBurnMessage(encoded),e=m.evidence,b=e.binding;
  return {
    version:4,action:'DepositClaim',direction:'NativeToSolana',
    deployment:{protocolId:b.protocolId,nativeNetwork:b.nativeNetwork,
      nativeGenesis:hexToBytes(b.nativeGenesis),solanaDeployment:hexToBytes(b.solanaDeployment),
      managerProgramId:hexToBytes(b.bridgeProgram),transceiverProgramId:hexToBytes(b.transceiverProgram),mint:hexToBytes(b.mint)},
    operationId:hexToBytes(e.operationId),depositOutpoint:{txid:hexToBytes(e.deposit.txid),vout:e.deposit.vout},
    amountAtomic:BigInt(e.amountAtomic),feeAtomic:0n,destination:hexToBytes(b.destination),
    policyEpoch:m.policyEpoch,keyEpoch:m.keyEpoch,nonce:hexToBytes(b.nonce),validFrom:BigInt(m.validFrom),validUntil:BigInt(m.validUntil),
    evidenceDigest:hash(encodeFinalizedBurnEvidence(e)),burnEvidence:e,encoded:Uint8Array.from(encoded),
    operationIdHex:e.operationId,messageDigestHex:hash(encoded).toString('hex'),destinationHex:b.destination,
    evidenceDigestHex:hash(encodeFinalizedBurnEvidence(e)).toString('hex'),depositOutpointText:`${e.deposit.txid}:${e.deposit.vout}`,
  };
}
function comparable(value) {
  if(typeof value==='bigint')return value.toString();
  if(value instanceof Uint8Array)return bytesToHex(value);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,comparable(v)]));
  return value;
}
export function encodeCanonicalBridgeMessage(input) {
  if(!input?.burnEvidence)throw new Error('FinalizedBurnEvidenceRequired');
  const bytes=encodeBurnMessage({evidence:input.burnEvidence,policyEpoch:input.policyEpoch,keyEpoch:input.keyEpoch,
    validFrom:input.validFrom,validUntil:input.validUntil});
  const decoded=decodeCanonicalBridgeMessage(bytes);
  // Existing callers may use the derived view. No caller can override a field
  // bound by evidence, or silently retain a stale deposit-only authorization.
  for(const [key,value] of Object.entries(input)) {
    if(!Object.hasOwn(decoded,key)||stableJson(comparable(value))!==stableJson(comparable(decoded[key])))
      throw new Error('BurnEvidenceBindingMismatch');
  }
  return Uint8Array.from(bytes);
}
export function encodeOperationIdInputs(input) {
  if(input.version!==undefined&&input.version!==MESSAGE_VERSION)throw new Error('UnsupportedVersion');
  if(!input?.burnEvidence?.binding)throw new Error('FinalizedBurnEvidenceRequired');
  return encodeBurnBinding(input.burnEvidence.binding);
}
export function deriveOperationId(input) {return Uint8Array.from(hash(encodeOperationIdInputs(input)));}
