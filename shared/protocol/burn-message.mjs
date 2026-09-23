// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Borsh V4 authorizes only finalized Native burn evidence. V3 is not accepted.
import { createHash } from 'node:crypto';
import { serialize,deserialize } from 'borsh';
import { BURN_EVIDENCE_SCHEMA,finalizedBurnEvidenceWire,burnUint,requireBurn as check } from '../../native/burn/burn-protocol.mjs';

export const BURN_MESSAGE_MAGIC='KPBRMSG4';
export const BURN_MESSAGE_VERSION=4;
export const BURN_MESSAGE_LENGTH=563;
export const BURN_MESSAGE_SCHEMA={struct:{magic:{array:{type:'u8',len:8}},version:'u8',evidence:BURN_EVIDENCE_SCHEMA,
  policyEpoch:'u32',keyEpoch:'u32',validFrom:'u64',validUntil:'u64'}};
const hash=data=>createHash('sha256').update(data).digest('hex');
const hex=data=>Buffer.from(data).toString('hex');
function epoch(value) {check(Number.isInteger(value)&&value>0&&value<=0xffffffff,'BurnMessageEpochRejected');return value;}
export function encodeBurnMessage(input) {
  check(input&&Object.keys(input).sort().join()==='evidence,keyEpoch,policyEpoch,validFrom,validUntil','BurnMessageFieldsRejected');
  const validFrom=burnUint(input.validFrom),validUntil=burnUint(input.validUntil);
  check(validUntil>validFrom,'BurnMessageValidityRejected');
  const encoded=Buffer.from(serialize(BURN_MESSAGE_SCHEMA,{magic:Buffer.from(BURN_MESSAGE_MAGIC),version:BURN_MESSAGE_VERSION,
    evidence:finalizedBurnEvidenceWire(input.evidence),policyEpoch:epoch(input.policyEpoch),keyEpoch:epoch(input.keyEpoch),validFrom,validUntil}));
  check(encoded.length===BURN_MESSAGE_LENGTH,'BurnMessageLengthRejected');return encoded;
}
export function decodeBurnMessage(input) {
  check(input instanceof Uint8Array&&input.length===BURN_MESSAGE_LENGTH,'BurnMessageLengthRejected');
  const wire=deserialize(BURN_MESSAGE_SCHEMA,input),e=wire.evidence,b=e.binding;
  check(Buffer.from(wire.magic).toString()===BURN_MESSAGE_MAGIC&&wire.version===BURN_MESSAGE_VERSION&&
    Buffer.from(e.domain).toString()==='KPBURN01'&&e.version===1&&Buffer.from(b.domain).toString()==='KPBOPR01'&&b.version===1,'BurnMessageDomainRejected');
  const binding=Object.fromEntries(Object.entries(b).filter(([k])=>!['domain','version'].includes(k)).map(([k,v])=>[k,typeof v === 'number' ? v : hex(v)]));
  const evidence={binding,operationId:hex(e.operationId),deposit:{txid:hex(e.deposit.txid),vout:e.deposit.vout},
    depositBlockHash:hex(e.depositBlockHash),depositHeight:e.depositHeight,burn:{txid:hex(e.burn.txid),vout:e.burn.vout},
    burnBlockHash:hex(e.burnBlockHash),burnHeight:e.burnHeight,amountAtomic:e.amountAtomic.toString(),burnCommitment:hex(e.burnCommitment)};
  const message={evidence,policyEpoch:wire.policyEpoch,keyEpoch:wire.keyEpoch,validFrom:wire.validFrom.toString(),validUntil:wire.validUntil.toString()};
  check(encodeBurnMessage(message).equals(Buffer.from(input)),'BurnMessageNonCanonical');
  return message;
}
export function burnMessageDigest(input) {decodeBurnMessage(input);return hash(input);}
