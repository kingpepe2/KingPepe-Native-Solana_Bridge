// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Fresh raw-chain/Merkle verification, independent of serialized journal flags.
import { createHash } from 'node:crypto';
import { NativeRpcClient } from '../node/native-rpc-client.mjs';
import { REGTEST_GENESIS, collectRegtestEvidence, encodeRegtestEvidence, verifyRegtestEvidencePacket } from '../node/native-raw-evidence.mjs';
import { parseNativeTransactionHex } from '../node/native-taproot-transaction.mjs';
import { burnDepositDestination, burnOperationalDestination, verifyNativeBurnSignatures } from './burn-key.mjs';
import { requireBurn as check, validateNativeBurnTransaction, encodeFinalizedBurnEvidence, nativeBurnCommitment,
  burnEvidenceDigest, burnOperationId, BURN_CONFIRMATIONS } from './burn-protocol.mjs';

const DEPOSIT_ADMISSIONS=new WeakMap(), FINALIZED_BURNS=new WeakMap();
export function validateRegtestBurnNetwork(chain,genesis) {
  check(chain?.chain==='regtest'&&genesis===REGTEST_GENESIS,'BURN_NATIVE_NETWORK_MISMATCH');
  check(typeof chain.initialblockdownload==='boolean'&&Number.isSafeInteger(chain.blocks)&&chain.blocks>=0&&
    Number.isSafeInteger(chain.headers)&&chain.headers>=chain.blocks,'BURN_NATIVE_CHAIN_STATE_REJECTED');
  check(chain.initialblockdownload===false&&chain.blocks===chain.headers,'BURN_NATIVE_SYNCHRONIZING');
  return chain;
}
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function requireBurnDepositAdmission(receipt,binding,plan) {
  const known=DEPOSIT_ADMISSIONS.get(receipt);
  check(known&&known.binding===burnOperationId(binding)&&known.plan===digest(plan)&&Date.now()-known.observedAt<=15000,'VerifiedBurnDepositAdmissionRequired');
  return receipt;
}
export function requireFinalizedNativeBurn(receipt,binding,plan) {
  const known=FINALIZED_BURNS.get(receipt);
  check(known&&known.binding===burnOperationId(binding)&&known.plan===digest(plan),'VerifiedFinalizedNativeBurnRequired');
  return receipt;
}
function freeze(value) {
  for(const child of Object.values(value)) if(child&&typeof child==='object') freeze(child);
  return Object.freeze(value);
}
export class RegtestNativeBurnVerifier {
  #rpc;#executable;
  constructor({rpc,executable}) {
    check(rpc instanceof NativeRpcClient,'NativeBurnRpcRequired');
    this.#rpc=rpc;this.#executable=executable;
  }
  async assertNetwork() {
    const chain=await this.#rpc.getBlockchainInfo();
    return validateRegtestBurnNetwork(chain,(await this.#rpc.call('getblockhash',[0])).result);
  }
  async #bundle(ids) {
    const bundle=await collectRegtestEvidence({rpc:this.#rpc,transactionIds:[...new Set(ids)],minimumConfirmations:BURN_CONFIRMATIONS});
    const verified=await verifyRegtestEvidencePacket({executable:this.#executable,packet:encodeRegtestEvidence(bundle)});
    check(verified.tipHeight===bundle.tipHeight&&verified.tipHash===bundle.tipHash,'NativeBurnProofChanged');
    return {bundle,verified};
  }
  #checkPlan(binding,plan) {
    check(binding.nativeGenesis===REGTEST_GENESIS&&plan.operationId===burnOperationId(binding),'NativeBurnNetworkOrOperationRejected');
    const deposit=burnDepositDestination(binding),operational=burnOperationalDestination(binding);
    check(plan.inputs[0].scriptPubKeyHex===deposit.scriptPubKeyHex&&plan.operationalScriptHex===operational.scriptPubKeyHex,'NativeBurnDestinationChanged');
    validateNativeBurnTransaction({rawTransactionHex:plan.unsignedTransactionHex,operationId:plan.operationId,inputs:plan.inputs,
      operationalScriptHex:plan.operationalScriptHex,expectedFeeAtomic:plan.feeAtomic,maximumFeeAtomic:plan.maximumFeeAtomic});
  }
  #inputs(bundle,plan) {
    return plan.inputs.map(input=>{
      const proof=bundle.proofs.find(p=>parseNativeTransactionHex(p.rawTransactionHex).txidHex===input.txid);
      check(proof,'NativeBurnInputProofMissing');
      const tx=parseNativeTransactionHex(proof.rawTransactionHex),output=tx.outputs[input.vout];
      check(output?.amountAtomic===input.amountAtomic&&output.scriptPubKeyHex===input.scriptPubKeyHex,'NativeBurnInputSubstitution');
      check(bundle.tipHeight-proof.blockHeight+1>=BURN_CONFIRMATIONS,'NativeBurnInputNotFinal');
      return proof;
    });
  }
  async verifyDepositAdmission({binding,plan}) {
    binding=structuredClone(binding);plan=structuredClone(plan);this.#checkPlan(binding,plan);
    const {bundle,verified}=await this.#bundle(plan.inputs.map(i=>i.txid));
    this.#inputs(bundle,plan);
    for(const input of plan.inputs) {
      const coin=await this.#rpc.getUtxoObservation({...input,includeMempool:true});
      check(coin.unspent&&!coin.coinbase&&coin.valueAtomic===input.amountAtomic&&coin.scriptPubKeyHex===input.scriptPubKeyHex&&
        coin.confirmations>=BURN_CONFIRMATIONS&&coin.bestBlockHash===bundle.tipHash,'NativeBurnInputUnavailable');
    }
    check((await this.#rpc.call('getbestblockhash')).result===bundle.tipHash,'NativeBurnSourceChanged');
    const result=freeze({operationId:plan.operationId,proofDigest:verified.digestHex,tipHash:bundle.tipHash,tipHeight:bundle.tipHeight,observedAt:Date.now()});
    DEPOSIT_ADMISSIONS.set(result,{binding:burnOperationId(binding),plan:digest(plan),observedAt:result.observedAt});
    return result;
  }
  async verifyFinalizedBurn({binding,plan}) {
    binding=structuredClone(binding);plan=structuredClone(plan);this.#checkPlan(binding,plan);
    const {bundle,verified}=await this.#bundle([...plan.inputs.map(i=>i.txid),plan.txid]);
    const inputs=this.#inputs(bundle,plan),burn=bundle.proofs.find(p=>parseNativeTransactionHex(p.rawTransactionHex).txidHex===plan.txid);
    check(burn&&bundle.tipHeight-burn.blockHeight+1>=BURN_CONFIRMATIONS,'NativeBurnNotFinal');
    const signed=parseNativeTransactionHex(burn.rawTransactionHex);
    check(signed.strippedHex===plan.unsignedTransactionHex,'NativeBurnSignedTransactionChanged');
    verifyNativeBurnSignatures({rawTransactionHex:burn.rawTransactionHex,inputs:plan.inputs});
    check((await this.#rpc.getUtxoObservation({txid:plan.txid,vout:0,includeMempool:true})).unspent===false,'NativeBurnUnexpectedSpendableOutput');
    const blockHash=height=>createHash('sha256').update(createHash('sha256').update(Buffer.from(bundle.headers[height-1],'hex')).digest()).digest().reverse().toString('hex');
    const deposit={txid:plan.inputs[0].txid,vout:plan.inputs[0].vout},amountAtomic=plan.inputs[0].amountAtomic;
    const evidence={binding,operationId:plan.operationId,deposit,depositBlockHash:blockHash(inputs[0].blockHeight),depositHeight:inputs[0].blockHeight,
      burn:{txid:plan.txid,vout:0},burnBlockHash:blockHash(burn.blockHeight),burnHeight:burn.blockHeight,amountAtomic,
      burnCommitment:nativeBurnCommitment({operationId:plan.operationId,deposit,amountAtomic})};
    const bytes=encodeFinalizedBurnEvidence(evidence);
    check((await this.#rpc.call('getbestblockhash')).result===bundle.tipHash,'NativeBurnSourceChanged');
    const result=freeze({evidence,evidenceHex:bytes.toString('hex'),evidenceDigest:burnEvidenceDigest(evidence),rawProofDigest:verified.digestHex,
      tipHash:bundle.tipHash,tipHeight:bundle.tipHeight,burnConfirmations:bundle.tipHeight-burn.blockHeight+1});
    FINALIZED_BURNS.set(result,{binding:burnOperationId(binding),plan:digest(plan)});
    return result;
  }
}
