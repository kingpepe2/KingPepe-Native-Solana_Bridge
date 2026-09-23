// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { schnorr } from '@noble/curves/secp256k1.js';
import { burnOperationId, nativeBurnScript, nativeBurnCommitment, planNativeBurn, validateNativeBurnTransaction,
  nativeAmountRpcString, burnUint, U64_MAX, encodeFinalizedBurnEvidence } from '../burn-protocol.mjs';
import { burnDepositDestination, burnOperationalDestination, signNativeBurnWithKey, verifyNativeBurnSignatures } from '../burn-key.mjs';
import { parseNativeTransactionHex, createUnsignedNativeBurnTransaction } from '../../node/native-taproot-transaction.mjs';

const h = n => n.toString(16).padStart(2,'0').repeat(32);
const rootSecret = schnorr.utils.randomSecretKey();
const binding = Object.freeze({protocolId:1,nativeNetwork:8000111,nativeGenesis:h(1),solanaGenesis:h(2),solanaDeployment:h(8),bridgeProgram:h(3),transceiverProgram:h(4),mint:h(5),destination:h(6),
  burnPublicKey:Buffer.from(schnorr.getPublicKey(rootSecret)).toString('hex'),nonce:h(7)});
const feePolicy = Object.freeze({minimumRateAtomicPerKvB:'100',normalRateAtomicPerKvB:'1000',maximumRateAtomicPerKvB:'1000000',maximumAbsoluteFeeAtomic:'600000',dustRelayAtomicPerKvB:'3000'});
function fixture(amountAtomic='100000') {
  const deposit = burnDepositDestination(binding), operational = burnOperationalDestination(binding);
  const inputs = [{txid:h(10),vout:1,amountAtomic,scriptPubKeyHex:deposit.scriptPubKeyHex},
    {txid:h(11),vout:0,amountAtomic:'1000000',scriptPubKeyHex:operational.scriptPubKeyHex}];
  return planNativeBurn({operationId:deposit.operationId,inputs,operationalScriptHex:operational.scriptPubKeyHex,feePolicy});
}
function validate(plan, rawTransactionHex=plan.unsignedTransactionHex) {
  return validateNativeBurnTransaction({rawTransactionHex,operationId:plan.operationId,inputs:plan.inputs,
    operationalScriptHex:plan.operationalScriptHex,expectedFeeAtomic:plan.feeAtomic,maximumFeeAtomic:plan.maximumFeeAtomic});
}
test('operation identity and unique Native address bind every immutable deployment and recipient field', () => {
  const id=burnOperationId(binding), address=burnDepositDestination(binding).address;
  for (const field of Object.keys(binding)) {
    const changed={...binding,[field]:typeof binding[field] === 'number' ? binding[field]+1 : field === 'burnPublicKey' ? Buffer.from(schnorr.getPublicKey(schnorr.utils.randomSecretKey())).toString('hex') : h(20)};
    assert.notEqual(burnOperationId(changed),id);
    assert.notEqual(burnDepositDestination(changed).address,address);
  }
  assert.equal(burnOperationId({...binding}),id);
  assert.throws(()=>burnOperationId({...binding,amountAtomic:'1'}),/FieldsRejected/);
});
test('two-class burn is exact and pays actual-size miner fee from operational input', () => {
  const plan=fixture(), tx=parseNativeTransactionHex(plan.unsignedTransactionHex);
  assert.equal(plan.burnAmountAtomic,'100000');
  assert.equal(plan.virtualBytes,'235');
  assert.equal(plan.feeAtomic,'235');
  assert.equal(plan.changeAtomic,'999765');
  assert.equal(plan.maxburnamount,'0.00100000');
  assert.equal(BigInt(tx.outputs[0].amountAtomic),BigInt(plan.inputs[0].amountAtomic));
  assert.equal(BigInt(plan.inputs[1].amountAtomic)-BigInt(plan.changeAtomic),235n);
  assert.equal(validate(plan).txid,plan.txid);
});
test('single-key derived deposit and operational inputs sign all exact transaction fields', () => {
  const plan=fixture(), signed=signNativeBurnWithKey({rootSecret,binding,plan});
  assert.equal(validate(plan,signed).burnAmountAtomic,'100000');
  assert.equal(verifyNativeBurnSignatures({rawTransactionHex:signed,inputs:plan.inputs}),true);
  assert.throws(()=>signNativeBurnWithKey({rootSecret,binding:{...binding,destination:h(99)},plan}),/BindingChanged/);
  const changedInputs=structuredClone(plan.inputs); changedInputs[0].amountAtomic='99999';
  assert.throws(()=>verifyNativeBurnSignatures({rawTransactionHex:signed,inputs:changedInputs}),/SignatureRejected/);
});
test('burn overage, user fee deduction, fee input reuse and change mutation are rejected', () => {
  const plan=fixture(),tx=parseNativeTransactionHex(plan.unsignedTransactionHex);
  for(const delta of [-1n,1n]) {
    const raw=createUnsignedNativeBurnTransaction({inputs:plan.inputs,outputs:[
      {amountAtomic:(100000n+delta).toString(),scriptPubKeyHex:tx.outputs[0].scriptPubKeyHex},
      {amountAtomic:(999765n-delta).toString(),scriptPubKeyHex:plan.operationalScriptHex}]});
    assert.throws(()=>validate(plan,raw),/AuthorizedAmountChanged/);
  }
  assert.throws(()=>planNativeBurn({...plan,inputs:[plan.inputs[0],plan.inputs[0]],feePolicy}),/DuplicateInput/);
  assert.throws(()=>planNativeBurn({...plan,inputs:[plan.inputs[0]],feePolicy}),/SeparateFeeInput/);
  assert.throws(()=>planNativeBurn({...plan,inputs:[plan.inputs[0],{...plan.inputs[1],amountAtomic:'300'}],feePolicy}),/FeeFundingInsufficient/);
  assert.throws(()=>planNativeBurn({...plan,feePolicy:{...feePolicy,maximumAbsoluteFeeAtomic:'234'}}),/FeeOutsidePolicy/);
  const raw=createUnsignedNativeBurnTransaction({inputs:plan.inputs,outputs:[{amountAtomic:'100000',scriptPubKeyHex:tx.outputs[0].scriptPubKeyHex},
    {amountAtomic:'999765',scriptPubKeyHex:plan.inputs[0].scriptPubKeyHex}]});
  assert.throws(()=>validate(plan,raw),/ChangeChanged/);
});
test('only one canonical burn output; extra unspendable output cannot bypass per-output RPC ceiling', () => {
  const plan=fixture(), tx=parseNativeTransactionHex(plan.unsignedTransactionHex);
  assert.throws(()=>createUnsignedNativeBurnTransaction({inputs:plan.inputs,outputs:[tx.outputs[0],tx.outputs[0]]}),/BurnOutputRejected/);
  const decoded=Buffer.from(plan.unsignedTransactionHex,'hex');
  // Replace the operational output script with an equally long OP_RETURN script.
  const index=decoded.lastIndexOf(Buffer.from(plan.operationalScriptHex,'hex'));
  assert.ok(index>0); decoded[index]=0x6a;
  assert.throws(()=>validate(plan,decoded.toString('hex')),/ChangeChanged/);
});
test('integer cap boundaries and fee ceilings never accept float, negative, overflow or rounded value', () => {
  for (const value of ['2099999999999999','2100000000000000']) {
    assert.equal(nativeAmountRpcString(value),value==='2100000000000000'?'21000000.00000000':'20999999.99999999');
    // A transaction containing the entire monetary supply plus a separate fee
    // input is impossible under Native MoneyRange, even at the Bridge cap.
    assert.throws(()=>fixture(value),/Overflow/);
  }
  assert.throws(()=>fixture('2100000000000001'),/Overflow/);
  assert.throws(()=>burnUint(U64_MAX+1n),/Overflow/);
  for (const value of [-1,-1n,0.1,'1e8','01','0.001']) assert.throws(()=>burnUint(value));
  assert.equal(nativeAmountRpcString('2100000000000000'),'21000000.00000000');
  assert.equal(nativeAmountRpcString('1'),'0.00000001');
});
test('canonical finalized-burn evidence binds operation, deposit, amount, both chains and immutable destination', () => {
  const operationId=burnOperationId(binding),deposit={txid:h(10),vout:1},amountAtomic='100000';
  const value={binding,operationId,deposit,depositBlockHash:h(12),depositHeight:21,burn:{txid:h(13),vout:0},burnBlockHash:h(14),burnHeight:33,amountAtomic,
    burnCommitment:nativeBurnCommitment({operationId,deposit,amountAtomic})};
  const wire=encodeFinalizedBurnEvidence(value);
  assert.equal(nativeBurnScript(value).slice(0,4),'6a37');
  assert.throws(()=>encodeFinalizedBurnEvidence({...value,burnHeight:30}),/FinalityOrder/);
  assert.throws(()=>encodeFinalizedBurnEvidence({...value,amountAtomic:'100001'}),/CommitmentChanged/);
  assert.throws(()=>encodeFinalizedBurnEvidence({...value,binding:{...binding,destination:h(90)}}),/OperationChanged/);
  assert.notDeepEqual(encodeFinalizedBurnEvidence({...value,burnBlockHash:h(90)}),wire);
});
