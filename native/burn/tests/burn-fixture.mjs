// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Synthetic cryptographic/parser fixture, never Native consensus evidence.
import {createHash} from 'node:crypto';
import {schnorr} from '@noble/curves/secp256k1.js';
import {ed25519} from '@noble/curves/ed25519.js';
import {deploymentFixture,mainnetDeploymentFixture} from '../../../tests/integration/deployment-fixture.mjs';
import {beginMainnetControlled} from '../../../services/bridge-validator/burn-mainnet-lifecycle.mjs';
import {base58Decode,base58Encode} from '../../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs';
import {decodeBridgeAbi,encodeBridgeAbi} from '../../../shared/protocol/solana-bridge-abi.mjs';
import {encodeBurnMessage} from '../../../shared/protocol/burn-message.mjs';
import {decodeCanonicalBridgeMessage} from '../../../shared/protocol/canonical-message.mjs';
import {burnOperationId,planNativeBurn,nativeBurnCommitment} from '../burn-protocol.mjs';
import {burnDepositDestination,burnOperationalDestination,signNativeBurnWithKey} from '../burn-key.mjs';
import {initialBurnJournal,issueBurnDeposit,recordBurnDeposits,retainBurnPlan,retainSignedBurn,markBurnBroadcast,retainFinalBurn} from '../../../services/bridge-validator/burn-journal-state.mjs';
import {ATTESTATION_PROTOCOL,ATTESTATION_MODE,BURN_SIGNED_BYTES} from '../../../services/attesters/burn-attestation-codec.mjs';
const hex=bytes=>Buffer.from(bytes).toString('hex'),hash=s=>createHash('sha256').update(s).digest('hex');
export function burnFixture({mainnet=false,amountAtomic='100000'}={}) {
  const {manifest,snapshot}=mainnet?mainnetDeploymentFixture(4):deploymentFixture(),root=schnorr.utils.randomSecretKey(),payer=ed25519.utils.randomSecretKey(),wallet=ed25519.utils.randomSecretKey(),attesters=[ed25519.utils.randomSecretKey(),ed25519.utils.randomSecretKey()];
  const pub=key=>hex(ed25519.getPublicKey(key));
  Object.assign(manifest.config,{protocolId:1,nativeNetwork:mainnet?manifest.config.nativeNetwork:8000111,attesters:attesters.map(a=>base58Encode(ed25519.getPublicKey(a)))});
  const tc=decodeBridgeAbi('TransceiverState',Buffer.from(snapshot.accounts[4].data[0],'base64'));
  Object.assign(tc.config,{protocolId:1,nativeNetwork:manifest.config.nativeNetwork,authorizedAttesters:attesters.map(seed=>ed25519.getPublicKey(seed))});
  snapshot.accounts[4].data[0]=encodeBridgeAbi('TransceiverState',tc).toString('base64');
  const binding={protocolId:1,nativeNetwork:manifest.config.nativeNetwork,nativeGenesis:manifest.nativeGenesisHex,solanaGenesis:hex(base58Decode(manifest.solanaGenesis)),solanaDeployment:manifest.solanaDeploymentHex,
    bridgeProgram:hex(base58Decode(manifest.manager.id)),transceiverProgram:hex(base58Decode(manifest.transceiver.id)),mint:hex(base58Decode(manifest.mint.id)),
    destination:pub(wallet),burnPublicKey:hex(schnorr.getPublicKey(root)),nonce:hash('fixture-nonce')};
  const {destination:_d,nonce:_n,...deployment}=binding,context={environment:manifest.environment,deployment,keyEpoch:1,policyEpoch:1,attesters:attesters.map(pub)};
  const artifact=Buffer.from(snapshot.accounts[5].data[0],'base64').subarray(45),entry={sha256:createHash('sha256').update(artifact).digest('hex'),byteLength:artifact.length};
  const policy={context,manifest,feePayerHex:pub(payer),artifacts:{manager:entry,transceiver:entry}};
  const state=initialBurnJournal(binding,{context,feePayerHex:pub(payer)});
  if(mainnet)beginMainnetControlled(state,{destinationHex:binding.destination,nonce:binding.nonce,amountModel:'EXACT_RECEIVED'});
  state.paused=false;state.pauseReason='TEST_REVIEWED';
  const op=issueBurnDeposit(state,binding,20),id=op.operationId,fees=burnOperationalDestination(binding);
  const deposit={txid:hash('deposit'),vout:0,amountAtomic,blockHash:hash('deposit-block'),height:21,confirmations:12};
  let plan=planNativeBurn({operationId:id,inputs:[{txid:deposit.txid,vout:0,amountAtomic:deposit.amountAtomic,scriptPubKeyHex:burnDepositDestination(binding).scriptPubKeyHex},
    {txid:hash('fee-coin'),vout:0,amountAtomic:'1000000',scriptPubKeyHex:fees.scriptPubKeyHex}],operationalScriptHex:fees.scriptPubKeyHex,
    feePolicy:{minimumRateAtomicPerKvB:'100',normalRateAtomicPerKvB:'1000',maximumRateAtomicPerKvB:'1000000',maximumAbsoluteFeeAtomic:'580000',dustRelayAtomicPerKvB:'3000'}});
  const evidence={binding,operationId:id,deposit:{txid:deposit.txid,vout:0},depositHeight:21,depositBlockHash:deposit.blockHash,burn:{txid:plan.txid,vout:0},
    burnHeight:33,burnBlockHash:hash('burn-block'),amountAtomic:deposit.amountAtomic,burnCommitment:nativeBurnCommitment({operationId:id,deposit:{txid:deposit.txid,vout:0},amountAtomic:deposit.amountAtomic})};
  if(mainnet)plan={...plan,transactionBlockHints:Object.fromEntries(plan.inputs.map(input=>[input.txid,deposit.blockHash]))};
  const finalize=()=>{recordBurnDeposits(state,id,[deposit]);retainBurnPlan(state,id,plan);retainSignedBurn(state,id,signNativeBurnWithKey({rootSecret:root,binding,plan}));markBurnBroadcast(state,id);retainFinalBurn(state,id,evidence);};
  const authorize=(validFrom='100',validUntil='3700')=>{
    const bytes=encodeBurnMessage({evidence,keyEpoch:1,policyEpoch:1,validFrom,validUntil}),m=decodeCanonicalBridgeMessage(bytes);
    return {encodedMessageHex:hex(bytes),attestations:attesters.map((seed,i)=>({protocol:ATTESTATION_PROTOCOL,mode:ATTESTATION_MODE,role:['ATTESTER_A','ATTESTER_B'][i],keyEpoch:1,policyEpoch:1,
      attesterPublicKeyHex:pub(seed),messageDigestHex:m.messageDigestHex,operationIdHex:burnOperationId(binding),signedBytes:BURN_SIGNED_BYTES,signatureHex:hex(ed25519.sign(bytes,seed)),state:'VERIFIED_READY'}))};
  };
  return {manifest,snapshot,policy,context,binding,state,id,plan,evidence,deposit,payer,root,attesters,finalize,authorize,
    destroy:()=>[root,payer,wallet,...attesters].forEach(k=>k.fill(0))};
}
