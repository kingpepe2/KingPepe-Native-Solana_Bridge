// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Bounded transaction construction; this is not an arbitrary signing API.
import {ed25519} from '@noble/curves/ed25519.js';
import {assertWindowsProtectedStore} from '../../shared/windows/protected-store.mjs';
import {requireBurnDepositAdmission,requireFinalizedNativeBurn} from '../../native/burn/burn-evidence.mjs';
import {encodeFinalizedBurnEvidence,burnOperationId as planOperationId,requireBurn as check} from '../../native/burn/burn-protocol.mjs';
import {decodeCanonicalBridgeMessage} from '../../shared/protocol/canonical-message.mjs';
import {validateBurnContext,assertBurnBindingContext,assertBurnMessageContext} from '../bridge-validator/burn-context.mjs';
import {verifyBurnAttestationPair} from '../attesters/burn-attestation-codec.mjs';
import {associatedTokenDestination,base58Decode,base58Encode,shortvecEncode,
  prepareSignedLocalnetSolanaDepositClaimTransaction,prepareSignedLocalnetSolanaDepositReceiptTransaction,
  verifySignedLocalnetSolanaDepositClaimTransaction,verifySignedLocalnetSolanaDepositReceiptTransaction}
  from '../bridge-validator/solana-deposit-claim-transaction-plan.mjs';

const TOKEN='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',ATA='ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const h=value=>Buffer.from(value,'hex');
export function associatedTokenCreationMessage({binding,feePayerHex,recentBlockhash}) {
  const owner=h(binding.destination),mint=h(binding.mint),token=base58Decode(TOKEN),payer=h(feePayerHex);
  check(payer.length===32&&base58Decode(recentBlockhash).length===32,'BurnSolanaPublicKeyRejected');
  const ata=associatedTokenDestination(owner,mint,token);
  const entries=[{key:feePayerHex,signer:true,writable:true},{key:ata.hex,signer:false,writable:true},
    ...[binding.destination,binding.mint,Buffer.from(base58Decode('11111111111111111111111111111111')).toString('hex'),
      Buffer.from(token).toString('hex'),Buffer.from(base58Decode(ATA)).toString('hex')].map(key=>({key,signer:false,writable:false}))];
  const merged=new Map();for(const row of entries){const old=merged.get(row.key);merged.set(row.key,old?{...old,signer:old.signer||row.signer,writable:old.writable||row.writable}:row);}
  const ordered=[...merged.values()].sort((a,b)=>Number(b.signer)-Number(a.signer)||Number(b.writable)-Number(a.writable));
  const index=key=>ordered.findIndex(a=>a.key===key);
  // SPL Associated Token Account interface: CreateIdempotent=1, exact six
  // accounts. No external token generator or Token-2022 extension is involved.
  const message=Buffer.concat([Buffer.from([1,0,ordered.filter(a=>!a.signer&&!a.writable).length]),
    Buffer.from(shortvecEncode(ordered.length)),...ordered.map(a=>h(a.key)),Buffer.from(base58Decode(recentBlockhash)),
    Buffer.from([1,index(entries[6].key),6,...entries.slice(0,6).map(a=>index(a.key)),1,1])]);
  return {message,ata:ata.base58};
}
export function burnSolanaPlanOptions({context,binding,feePayerHex,encodedMessageHex,attestations,recentBlockhash,lastValidBlockHeight}) {
  const c=assertBurnBindingContext(binding,context);
  return {environment:c.environment,cluster:c.environment,solanaGenesis:base58Encode(h(binding.solanaGenesis)),
    managerProgramIdHex:binding.bridgeProgram,transceiverProgramIdHex:binding.transceiverProgram,mintHex:binding.mint,
    tokenProgramIdBase58:TOKEN,feePayerHex,encodedMessageHex,attestations,recentBlockhashBase58:recentBlockhash,lastValidBlockHeight};
}
export function verifyBurnSolanaPacket(packet,context,binding,feePayerHex,attestation) {
  check(packet&&Object.keys(packet).sort().join()==='kind,lastValidBlockHeight,messageDigestHex,preparedTransactionBase64,recentBlockhash,signature','BurnSolanaPacketFields');
  check(['ATA','RECEIPT','CLAIM'].includes(packet.kind)&&/^[1-9][0-9]{0,18}$/u.test(packet.lastValidBlockHeight),'BurnSolanaPacketKind');
  const bytes=Buffer.from(packet.preparedTransactionBase64,'base64');
  check(bytes.length<=1232&&bytes.toString('base64')===packet.preparedTransactionBase64&&bytes[0]===1&&
    base58Encode(bytes.subarray(1,65))===packet.signature,'BurnSolanaPacketEncoding');
  assertBurnBindingContext(binding,context);
  if(packet.kind==='ATA'){
    check(packet.messageDigestHex===null,'BurnSolanaAtaAuthorizationRejected');
    const expected=associatedTokenCreationMessage({binding,feePayerHex,recentBlockhash:packet.recentBlockhash});
    check(bytes.subarray(65).equals(expected.message)&&ed25519.verify(bytes.subarray(1,65),expected.message,h(feePayerHex),{zip215:false}),'BurnSolanaAtaPacketChanged');
  }else{
    check(attestation,'BurnSolanaAttestationRequired');
    const m=decodeCanonicalBridgeMessage(h(attestation.encodedMessageHex));assertBurnMessageContext(m,context);
    check(packet.messageDigestHex===m.messageDigestHex&&m.operationIdHex===planOperationId(binding),'BurnSolanaPacketAuthorizationChanged');
    verifyBurnAttestationPair(attestation.attestations,attestation.encodedMessageHex,context.attesters);
    const config={...burnSolanaPlanOptions({context,binding,feePayerHex,encodedMessageHex:attestation.encodedMessageHex,
      attestations:attestation.attestations,...packet}),preparedTransactionBase64:packet.preparedTransactionBase64};
    const result=(packet.kind==='CLAIM'?verifySignedLocalnetSolanaDepositClaimTransaction:verifySignedLocalnetSolanaDepositReceiptTransaction)(config);
    check(result.solanaSignature===packet.signature,'BurnSolanaPacketSignatureChanged');
    check(bytes.subarray(69,101).equals(h(feePayerHex)),'BurnSolanaFeePayerChanged');
  }
  return packet;
}
const instances=new WeakSet();
export function requireProtectedBurnSolanaSigner(v){check(instances.has(v),'ProtectedBurnSolanaSignerRequired');}
export class ProtectedBurnSolanaSigner {
  #store;#context;#public;#busy=false;#closed=false;
  constructor({store,context,feePayerHex}) {
    assertWindowsProtectedStore(store,'FEE_PAYER','fee-payer-seed');this.#context=validateBurnContext(context);
    check(store.context.environment===context.environment&&store.context.nativeGenesis===context.deployment.nativeGenesis&&
      store.context.solanaDeployment===context.deployment.solanaDeployment&&store.context.keyEpoch===context.keyEpoch,'BurnSolanaSignerContext');
    this.#store=store;const {payload}=store.read();
    try{check(payload.length===32,'BurnSolanaKeyEncoding');this.#public=Buffer.from(ed25519.getPublicKey(payload)).toString('hex');}finally{payload.fill(0);}
    check(this.#public===feePayerHex&&![context.deployment.burnPublicKey,...context.attesters].includes(feePayerHex),'BurnSolanaSignerRoleOverlap');instances.add(this);
  }
  get publicKeyHex(){return this.#public;}
  ready(){check(!this.#closed,'BurnSolanaSignerClosed');const {payload}=this.#store.read();try{check(payload.length===32,'BurnSolanaKeyUnavailable');}finally{payload.fill(0);}}
  async prepare({kind,binding,plan,nativeAdmission,finalizedBurn,attestation,recentBlockhash,lastValidBlockHeight}) {
    check(!this.#closed&&!this.#busy,'BurnSolanaSignerUnavailable');this.#busy=true;
    try{
      assertBurnBindingContext(binding,this.#context);check(['ATA','RECEIPT','CLAIM'].includes(kind),'BurnSolanaKindRejected');
      if(kind==='ATA')requireBurnDepositAdmission(nativeAdmission,binding,plan);
      else {
        requireFinalizedNativeBurn(finalizedBurn,binding,plan);
        const m=decodeCanonicalBridgeMessage(h(attestation?.encodedMessageHex));assertBurnMessageContext(m,this.#context);
        check(encodeFinalizedBurnEvidence(m.burnEvidence).toString('hex')===finalizedBurn.evidenceHex,'BurnSolanaEvidenceChanged');
        verifyBurnAttestationPair(attestation.attestations,attestation.encodedMessageHex,this.#context.attesters);
        const now=BigInt(Math.floor(Date.now()/1000));check(m.validFrom<=now&&now<=m.validUntil,'BurnSolanaAuthorizationExpired');
      }
      const {payload}=this.#store.read();let signed;
      try{
        if(kind==='ATA'){
          const {message}=associatedTokenCreationMessage({binding,feePayerHex:this.#public,recentBlockhash});
          const signature=ed25519.sign(message,payload);signed={preparedTransactionBase64:Buffer.concat([Buffer.of(1),Buffer.from(signature),message]).toString('base64'),signature:base58Encode(signature)};
        }else{
          const config=burnSolanaPlanOptions({context:this.#context,binding,feePayerHex:this.#public,...attestation,recentBlockhash,lastValidBlockHeight});
          config.feePayerSigner={publicKeyHex:this.#public,sign:bytes=>ed25519.sign(bytes,payload)};
          const result=await (kind==='CLAIM'?prepareSignedLocalnetSolanaDepositClaimTransaction:prepareSignedLocalnetSolanaDepositReceiptTransaction)(config);
          signed={preparedTransactionBase64:result.preparedTransactionBase64,signature:result.signatures[0].signatureBase58};
        }
      }finally{payload.fill(0);}
      const packet={kind,recentBlockhash,lastValidBlockHeight,messageDigestHex:kind==='ATA'?null:decodeCanonicalBridgeMessage(h(attestation.encodedMessageHex)).messageDigestHex,...signed};
      verifyBurnSolanaPacket(packet,this.#context,binding,this.#public,attestation);return packet;
    }finally{this.#busy=false;}
  }
  close(){this.#closed=true;this.#store.close();}
}
