// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Exact one-operation Native burn construction. No key storage or RPC authority.
import { createHash } from 'node:crypto';
import { serialize } from 'borsh';
import { createUnsignedNativeBurnTransaction, parseNativeTransactionHex, attachTaprootWitnesses } from '../node/native-taproot-transaction.mjs';
import { MAX_KPEPE_SUPPLY_ATOMIC } from '../../shared/monetary-supply.mjs';

export const BURN_DOMAIN = 'KINGPEPE_BRIDGE_BURN_V1';
export const BURN_CONFIRMATIONS = 12;
export const BURN_SCHEMA_VERSION = 1;
export const U64_MAX = (1n << 64n) - 1n;
const bytes = len => ({ array: { type: 'u8', len } });
const h = bytes(32);
const point = { struct: { txid: h, vout: 'u32' } };
export const BURN_BINDING_SCHEMA = { struct: {
  domain: bytes(8), version: 'u8', protocolId: 'u32', nativeNetwork: 'u32', nativeGenesis: h, solanaGenesis: h, solanaDeployment: h,
  bridgeProgram: h, transceiverProgram: h, mint: h, destination: h,
  burnPublicKey: h, nonce: h,
} };
export const BURN_COMMITMENT_SCHEMA = { struct: {
  domain: bytes(8), version: 'u8', operationId: h, deposit: point, amountAtomic: 'u64',
} };
export const BURN_EVIDENCE_SCHEMA = { struct: {
  domain: bytes(8), version: 'u8', binding: BURN_BINDING_SCHEMA,
  operationId: h, deposit: point, depositBlockHash: h, depositHeight: 'u32',
  burn: point, burnBlockHash: h, burnHeight: 'u32', amountAtomic: 'u64',
  burnCommitment: h,
} };
export function requireBurn(ok, code = 'NativeBurnRejected') { if (!ok) throw new Error(code); }
export function burnHash(value) {
  requireBurn(typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value) && !/^0+$/u.test(value), 'NativeBurnHashRejected');
  return value;
}
export function burnUint(value, maximum = U64_MAX) {
  requireBurn((typeof value === 'string' || typeof value === 'bigint') && /^(0|[1-9][0-9]{0,38})$/u.test(String(value)), 'NativeBurnIntegerRejected');
  const result = BigInt(value);
  requireBurn(result <= maximum, 'NativeBurnArithmeticOverflow');
  return result;
}
export function burnAmount(value) {
  const n = burnUint(value, MAX_KPEPE_SUPPLY_ATOMIC);
  requireBurn(n > 0n, 'NativeBurnAmountZero'); return n;
}
const uint32 = n => { requireBurn(Number.isInteger(n) && n >= 0 && n <= 0xffffffff, 'NativeBurnIndexRejected'); return n; };
const hb = s => Buffer.from(burnHash(s), 'hex');
const hash = data => createHash('sha256').update(data).digest('hex');
const exact = (value, fields) => requireBurn(value && !Array.isArray(value) && Object.keys(value).sort().join() === fields.split(',').sort().join(), 'NativeBurnFieldsRejected');
export function validateBurnBinding(input) {
  exact(input, 'protocolId,nativeNetwork,nativeGenesis,solanaGenesis,solanaDeployment,bridgeProgram,transceiverProgram,mint,destination,burnPublicKey,nonce');
  const value = {};
  for (const field of Object.keys(BURN_BINDING_SCHEMA.struct).slice(2)) value[field] = ['protocolId','nativeNetwork'].includes(field) ? uint32(input[field]) : burnHash(input[field]);
  requireBurn(value.protocolId > 0 && value.nativeNetwork > 0, 'NativeBurnDomainRejected');
  requireBurn(new Set([value.burnPublicKey, value.bridgeProgram, value.transceiverProgram, value.mint]).size === 4, 'NativeBurnRolesOverlap');
  return Object.freeze(value);
}
function bindingWire(input) {
  const b = validateBurnBinding(input);
  return { domain: Buffer.from('KPBOPR01'), version: BURN_SCHEMA_VERSION,
    ...Object.fromEntries(Object.entries(b).map(([k,v]) => [k,typeof v === 'number' ? v : hb(v)])) };
}
export function encodeBurnBinding(binding) { return Buffer.from(serialize(BURN_BINDING_SCHEMA, bindingWire(binding))); }
export function burnOperationId(binding) { return hash(encodeBurnBinding(binding)); }
function pointWire(input) {
  exact(input, 'txid,vout'); return { txid: hb(input.txid), vout: uint32(input.vout) };
}
export function nativeBurnCommitment({ operationId, deposit, amountAtomic }) {
  return hash(serialize(BURN_COMMITMENT_SCHEMA, { domain: Buffer.from('KPBCOM01'), version: BURN_SCHEMA_VERSION,
    operationId: hb(operationId), deposit: pointWire(deposit), amountAtomic: burnAmount(amountAtomic) }));
}
export function nativeBurnScript(input) {
  const payload = Buffer.concat([Buffer.from(BURN_DOMAIN), hb(nativeBurnCommitment(input))]);
  requireBurn(payload.length <= 75);
  return Buffer.concat([Buffer.of(0x6a,payload.length),payload]).toString('hex');
}
export function encodeFinalizedBurnEvidence(input) {
  return Buffer.from(serialize(BURN_EVIDENCE_SCHEMA, finalizedBurnEvidenceWire(input)));
}
export function finalizedBurnEvidenceWire(input) {
  exact(input, 'binding,operationId,deposit,depositBlockHash,depositHeight,burn,burnBlockHash,burnHeight,amountAtomic,burnCommitment');
  requireBurn(input.operationId === burnOperationId(input.binding), 'NativeBurnOperationChanged');
  requireBurn(input.burn.vout === 0 && input.depositHeight > 0 && input.burnHeight >= input.depositHeight + BURN_CONFIRMATIONS, 'NativeBurnFinalityOrderRejected');
  requireBurn(input.burnCommitment === nativeBurnCommitment(input), 'NativeBurnCommitmentChanged');
  return { domain: Buffer.from('KPBURN01'), version: BURN_SCHEMA_VERSION,
    binding: bindingWire(input.binding), operationId: hb(input.operationId),
    deposit: pointWire(input.deposit), depositBlockHash: hb(input.depositBlockHash), depositHeight: uint32(input.depositHeight),
    burn: pointWire(input.burn), burnBlockHash: hb(input.burnBlockHash), burnHeight: uint32(input.burnHeight),
    amountAtomic: burnAmount(input.amountAtomic), burnCommitment: hb(input.burnCommitment) };
}
export function burnEvidenceDigest(input) { return hash(encodeFinalizedBurnEvidence(input)); }
export function nativeAmountRpcString(value) {
  const n = burnUint(value, MAX_KPEPE_SUPPLY_ATOMIC);
  return `${n / 100000000n}.${String(n % 100000000n).padStart(8,'0')}`;
}
export function validateBurnInputs(inputs) {
  requireBurn(Array.isArray(inputs) && inputs.length >= 2 && inputs.length <= 8, 'NativeBurnSeparateFeeInputRequired');
  let total = 0n;
  const ids = new Set();
  const normalized = inputs.map(input => {
    exact(input,'txid,vout,amountAtomic,scriptPubKeyHex');
    const txid = burnHash(input.txid), vout = uint32(input.vout), amountAtomic = burnAmount(input.amountAtomic).toString();
    requireBurn(typeof input.scriptPubKeyHex === 'string' && /^5120[0-9a-f]{64}$/u.test(input.scriptPubKeyHex), 'NativeBurnInputScriptRejected');
    const id = `${txid}:${vout}`; requireBurn(!ids.has(id),'NativeBurnDuplicateInput'); ids.add(id);
    // Native consensus MoneyRange applies to aggregate input value as well.
    // The operational fee coin cannot make an otherwise capped burn valid.
    total = burnUint(total + BigInt(amountAtomic), MAX_KPEPE_SUPPLY_ATOMIC);
    return Object.freeze({ txid,vout,amountAtomic,scriptPubKeyHex:input.scriptPubKeyHex });
  });
  return Object.freeze(normalized);
}
export function validateBurnPlanBlockHints(plan) {
  const hints=plan.transactionBlockHints,ids=[...new Set(plan.inputs.map(i=>i.txid))].sort();
  requireBurn(hints&&!Array.isArray(hints)&&Object.keys(hints).sort().join()===ids.join(),'NativeBurnBlockHintsRequired');
  Object.values(hints).forEach(burnHash);
  return hints;
}
export function validateBurnFeePolicy(input) {
  exact(input,'minimumRateAtomicPerKvB,normalRateAtomicPerKvB,maximumRateAtomicPerKvB,maximumAbsoluteFeeAtomic,dustRelayAtomicPerKvB');
  const p = Object.fromEntries(Object.entries(input).map(([k,v]) => [k,burnAmount(v).toString()]));
  requireBurn(BigInt(p.minimumRateAtomicPerKvB) <= BigInt(p.normalRateAtomicPerKvB) && BigInt(p.normalRateAtomicPerKvB) <= BigInt(p.maximumRateAtomicPerKvB), 'NativeBurnFeeOutsidePolicy');
  return Object.freeze(p);
}
export function validateNativeBurnTransaction({ rawTransactionHex, operationId, inputs, operationalScriptHex, expectedFeeAtomic, maximumFeeAtomic }) {
  const coins = validateBurnInputs(inputs), amount = burnAmount(coins[0].amountAtomic);
  requireBurn(/^5120[0-9a-f]{64}$/u.test(operationalScriptHex), 'NativeBurnOperationalScriptRejected');
  requireBurn(coins[0].scriptPubKeyHex !== operationalScriptHex && coins.slice(1).every(i => i.scriptPubKeyHex === operationalScriptHex), 'NativeBurnFeeOwnershipRejected');
  const tx = parseNativeTransactionHex(rawTransactionHex);
  requireBurn(tx.version === 2 && tx.lockTime === 0 && tx.inputs.length === coins.length, 'NativeBurnTransactionShapeRejected');
  requireBurn(tx.inputs.every((i,n) => i.outpoint === `${coins[n].txid}:${coins[n].vout}` && i.scriptSigHex === '' && i.sequence === 0xffffffff), 'NativeBurnInputChanged');
  requireBurn(tx.outputs.length === 2, 'NativeBurnUnexpectedOutput');
  const expectedScript = nativeBurnScript({ operationId, deposit:{txid:coins[0].txid,vout:coins[0].vout}, amountAtomic: amount });
  requireBurn(tx.outputs[0].scriptPubKeyHex === expectedScript && BigInt(tx.outputs[0].amountAtomic) === amount, 'NativeBurnAuthorizedAmountChanged');
  requireBurn(tx.outputs[1].scriptPubKeyHex === operationalScriptHex, 'NativeBurnChangeChanged');
  const funding = coins.slice(1).reduce((n,i) => burnUint(n+BigInt(i.amountAtomic)),0n);
  const change = burnAmount(tx.outputs[1].amountAtomic);
  requireBurn(funding > change,'NativeBurnFeeFundingInsufficient');
  const fee = funding-change;
  requireBurn(fee === burnAmount(expectedFeeAtomic) && fee <= burnAmount(maximumFeeAtomic),'NativeBurnFeeOutsidePolicy');
  return Object.freeze({ txid:tx.txidHex, burnVout:0, burnAmountAtomic:amount.toString(), feeAtomic:fee.toString(), changeAtomic:change.toString(), burnScriptHex:expectedScript });
}
export function planNativeBurn({ operationId, inputs, operationalScriptHex, feePolicy }) {
  const coins = validateBurnInputs(inputs), p = validateBurnFeePolicy(feePolicy);
  const amount = burnAmount(coins[0].amountAtomic), funding = coins.slice(1).reduce((n,i) => burnUint(n+BigInt(i.amountAtomic)),0n);
  const burnScript = nativeBurnScript({ operationId, deposit:{txid:coins[0].txid,vout:coins[0].vout}, amountAtomic:amount });
  const construct = change => createUnsignedNativeBurnTransaction({ inputs: coins, outputs:[
    { amountAtomic:amount.toString(),scriptPubKeyHex:burnScript },{amountAtomic:change.toString(),scriptPubKeyHex:operationalScriptHex}] });
  const provisional = construct(funding);
  const sized = attachTaprootWitnesses({ unsignedNativeTransactionHex:provisional,
    signatures:coins.map(() => '00'.repeat(64)) });
  const parsed = parseNativeTransactionHex(sized.rawSignedTransactionHex);
  const weight = BigInt(Buffer.from(parsed.strippedHex,'hex').length)*3n + BigInt(Buffer.from(parsed.rawHex,'hex').length);
  const virtualBytes = (weight+3n)/4n;
  const fee = (virtualBytes*BigInt(p.normalRateAtomicPerKvB)+999n)/1000n;
  requireBurn(fee > 0n && fee <= BigInt(p.maximumAbsoluteFeeAtomic),'NativeBurnFeeOutsidePolicy');
  const dust = (110n*BigInt(p.dustRelayAtomicPerKvB))/1000n;
  requireBurn(funding > fee && funding-fee >= dust,'NativeBurnFeeFundingInsufficient');
  const unsignedTransactionHex = construct(funding-fee);
  const checked = validateNativeBurnTransaction({ rawTransactionHex:unsignedTransactionHex,operationId,inputs:coins,operationalScriptHex,
    expectedFeeAtomic:fee.toString(),maximumFeeAtomic:p.maximumAbsoluteFeeAtomic });
  return Object.freeze({...checked,operationId,inputs:coins,operationalScriptHex,unsignedTransactionHex,
    feeRateAtomicPerKvB:p.normalRateAtomicPerKvB,maximumFeeAtomic:p.maximumAbsoluteFeeAtomic,virtualBytes:virtualBytes.toString(),maxburnamount:nativeAmountRpcString(amount)});
}
