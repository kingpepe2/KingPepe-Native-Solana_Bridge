// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Public additive child derivation; private material stays in the signer.
// This module is a primitive, not economic admission or a public signing API.
import { createHash } from 'node:crypto';
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js';
import { burnHash, requireBurn, validateNativeBurnTransaction, burnOperationId } from './burn-protocol.mjs';
import { taprootKeyPathSighashDefault, attachKeyPathTaprootWitnesses, parseNativeTransactionHex } from '../node/native-taproot-transaction.mjs';
import { witnessAddressFromScript } from '../node/witness-address.mjs';

const order = secp256k1.Point.Fn.ORDER;
const scalarBytes = n => Buffer.from(n.toString(16).padStart(64,'0'),'hex');
function derivation(publicKeyHex, nativeGenesis, operationId) {
  const publicKey = Buffer.from(burnHash(publicKeyHex),'hex');
  const root = secp256k1.Point.fromHex('02'+publicKeyHex);
  // Fixed public domain labels; their bytes are part of address derivation.
  let domain = 'KINGPEPE_BURN_DEPOSIT_KEY_V1';
  if(operationId === null) domain = 'KINGPEPE_BURN_OPERATIONAL_KEY_V1';
  const digest = createHash('sha256').update(domain).update(publicKey).update(Buffer.from(burnHash(nativeGenesis),'hex'));
  if (operationId !== null) digest.update(Buffer.from(burnHash(operationId),'hex'));
  const tweak = BigInt('0x'+digest.digest('hex'));
  requireBurn(tweak > 0n && tweak < order,'NativeBurnDerivationRejected');
  const child = root.add(secp256k1.Point.BASE.multiply(tweak));
  requireBurn(!child.equals(secp256k1.Point.ZERO),'NativeBurnDerivationRejected');
  return { tweak, publicKeyHex:Buffer.from(child.toBytes(true)).subarray(1).toString('hex') };
}
export function burnDepositDestination(binding, hrp = 'rkpepe') {
  const operationId = burnOperationId(binding);
  const child = derivation(binding.burnPublicKey,binding.nativeGenesis,operationId);
  const scriptPubKeyHex = '5120'+child.publicKeyHex;
  return Object.freeze({operationId,scriptPubKeyHex,address:witnessAddressFromScript(scriptPubKeyHex,hrp)});
}
export function burnOperationalDestination({ burnPublicKey, nativeGenesis }, hrp = 'rkpepe') {
  const child = derivation(burnPublicKey,nativeGenesis,null), scriptPubKeyHex = '5120'+child.publicKeyHex;
  return Object.freeze({scriptPubKeyHex,address:witnessAddressFromScript(scriptPubKeyHex,hrp)});
}
// Caller must first obtain trusted pre-burn admission, reserve inputs durably,
// and persist these exact signed bytes before any broadcast. No RPC is used here.
export function signNativeBurnWithKey({ rootSecret, binding, plan }) {
  requireBurn(rootSecret instanceof Uint8Array && rootSecret.length === 32,'NativeBurnSecretRejected');
  const rootPublic = Buffer.from(schnorr.getPublicKey(rootSecret)).toString('hex');
  requireBurn(rootPublic === binding.burnPublicKey,'NativeBurnWrongKey');
  const deposit = burnDepositDestination(binding), operational = burnOperationalDestination(binding);
  requireBurn(plan.operationId === deposit.operationId && plan.inputs[0].scriptPubKeyHex === deposit.scriptPubKeyHex && plan.operationalScriptHex === operational.scriptPubKeyHex,'NativeBurnKeyBindingChanged');
  validateNativeBurnTransaction({ rawTransactionHex:plan.unsignedTransactionHex,operationId:plan.operationId,
    inputs:plan.inputs,operationalScriptHex:plan.operationalScriptHex,expectedFeeAtomic:plan.feeAtomic,maximumFeeAtomic:plan.maximumFeeAtomic });
  let root = BigInt('0x'+Buffer.from(rootSecret).toString('hex'));
  if (secp256k1.getPublicKey(rootSecret,true)[0] === 3) root = order-root;
  const spentOutputs = plan.inputs.map(i => ({amountAtomic:i.amountAtomic,scriptPubKeyHex:i.scriptPubKeyHex}));
  const signatures = plan.inputs.map((_input,index) => {
    const child = derivation(rootPublic,binding.nativeGenesis,index===0 ? plan.operationId : null);
    const secret = scalarBytes((root+child.tweak)%order);
    try {
      requireBurn(Buffer.from(schnorr.getPublicKey(secret)).toString('hex') === child.publicKeyHex,'NativeBurnDerivedKeyChanged');
      const hash = taprootKeyPathSighashDefault({transaction:plan.unsignedTransactionHex,spentOutputs,inputIndex:index}).sigHashHex;
      return Buffer.from(schnorr.sign(Buffer.from(hash,'hex'),secret)).toString('hex');
    } finally { secret.fill(0); }
  });
  const signed = attachKeyPathTaprootWitnesses({unsignedNativeTransactionHex:plan.unsignedTransactionHex,signatures});
  verifyNativeBurnSignatures({rawTransactionHex:signed.rawSignedTransactionHex,inputs:plan.inputs});
  return signed.rawSignedTransactionHex;
}
export function verifyNativeBurnSignatures({rawTransactionHex,inputs}) {
  const tx = parseNativeTransactionHex(rawTransactionHex);
  requireBurn(tx.hasWitness && tx.inputs.length === inputs.length,'NativeBurnSignaturesMissing');
  const spentOutputs = inputs.map(i => ({amountAtomic:i.amountAtomic,scriptPubKeyHex:i.scriptPubKeyHex}));
  for (const [index,input] of tx.inputs.entries()) {
    requireBurn(input.witness?.length === 1 && input.witness[0].length === 64,'NativeBurnWitnessRejected');
    const digest = taprootKeyPathSighashDefault({transaction:rawTransactionHex,spentOutputs,inputIndex:index}).sigHashHex;
    requireBurn(schnorr.verify(input.witness[0],Buffer.from(digest,'hex'),Buffer.from(inputs[index].scriptPubKeyHex.slice(4),'hex')),'NativeBurnSignatureRejected');
  }
  return true;
}
