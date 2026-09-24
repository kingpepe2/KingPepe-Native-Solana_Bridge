// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Fresh raw-chain/Merkle verification, independent of serialized journal flags.
import { createHash } from 'node:crypto';
import { NativeRpcClient } from '../node/native-rpc-client.mjs';
import { collectRegtestEvidence, encodeRegtestEvidence, verifyRegtestEvidencePacket,
  collectMainnetEvidence, encodeMainnetEvidence, verifyMainnetEvidencePacket } from '../node/native-raw-evidence.mjs';
import { nativeIdentity } from '../../shared/network-identity.mjs';
import { parseNativeTransactionHex } from '../node/native-taproot-transaction.mjs';
import { burnDepositDestination, burnOperationalDestination, verifyNativeBurnSignatures } from './burn-key.mjs';
import { requireBurn as check, validateNativeBurnTransaction, encodeFinalizedBurnEvidence, nativeBurnCommitment,
  burnEvidenceDigest, burnOperationId, validateBurnPlanBlockHints, BURN_CONFIRMATIONS } from './burn-protocol.mjs';

const DEPOSIT_ADMISSIONS=new WeakMap(), FINALIZED_BURNS=new WeakMap();
export function validateRegtestBurnNetwork(chain,genesis) {
  return validateNativeBurnNetwork(chain,genesis,'localnet');
}
export function validateNativeBurnNetwork(chain,genesis,environment) {
  const identity=nativeIdentity(environment);
  check(chain?.chain===identity.rpcChain&&genesis===identity.genesis,'BURN_NATIVE_NETWORK_MISMATCH');
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
export class NativeBurnVerifier {
  #rpc;#executable;#identity;
  constructor({rpc,executable,environment}) {
    check(rpc instanceof NativeRpcClient,'NativeBurnRpcRequired');
    this.#rpc=rpc;this.#executable=executable;this.#identity=nativeIdentity(environment);
  }
  get nativeGenesis(){return this.#identity.genesis;}
  async assertNetwork() {
    const chain=await this.#rpc.getBlockchainInfo();
    return validateNativeBurnNetwork(chain,(await this.#rpc.call('getblockhash',[0])).result,this.#identity.environment);
  }
  async #bundle(ids,transactionBlockHints) {
    const mainnet=this.#identity.environment==='mainnet';
    const bundle=await (mainnet?collectMainnetEvidence:collectRegtestEvidence)({rpc:this.#rpc,transactionIds:[...new Set(ids)],minimumConfirmations:BURN_CONFIRMATIONS,transactionBlockHints});
    const verified=await (mainnet?verifyMainnetEvidencePacket:verifyRegtestEvidencePacket)({executable:this.#executable,packet:(mainnet?encodeMainnetEvidence:encodeRegtestEvidence)(bundle)});
    check(verified.tipHeight===bundle.tipHeight&&verified.tipHash===bundle.tipHash,'NativeBurnProofChanged');
    return {bundle,verified};
  }
  #checkPlan(binding,plan) {
    check(binding.nativeGenesis===this.#identity.genesis&&binding.nativeNetwork===this.#identity.domain&&plan.operationId===burnOperationId(binding),'NativeBurnNetworkOrOperationRejected');
    if(this.#identity.environment==='mainnet')validateBurnPlanBlockHints(plan);
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
    const {bundle,verified}=await this.#bundle(plan.inputs.map(i=>i.txid),plan.transactionBlockHints);
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
  async verifyFinalizedBurn({binding,plan,burnBlockHash}) {
    binding=structuredClone(binding);plan=structuredClone(plan);this.#checkPlan(binding,plan);
    let hints=plan.transactionBlockHints;
    if(this.#identity.environment==='mainnet'){
      // The change output locates a newly mined burn without txindex. Once
      // finalized, the durable burn evidence provides its independently checked
      // block location even after that operational change has been spent.
      const location=await this.#rpc.locateMainnetTransaction({txid:plan.txid,vout:1,blockHash:burnBlockHash});
      check(location.state==='OBSERVED'&&location.confirmations>=BURN_CONFIRMATIONS&&location.blockHash,'NativeBurnNotFinal');
      hints={...hints,[plan.txid]:location.blockHash};
    }
    const {bundle,verified}=await this.#bundle([...plan.inputs.map(i=>i.txid),plan.txid],hints);
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
// Preserve the explicit REGTEST constructor used by the retained proof runner.
export class RegtestNativeBurnVerifier extends NativeBurnVerifier {
  constructor(options){super({...options,environment:'localnet'});}
}
