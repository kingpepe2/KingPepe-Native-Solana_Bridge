// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ed25519} from '@noble/curves/ed25519.js';
import {decodeCanonicalBridgeMessage} from '../../../shared/protocol/canonical-message.mjs';
import {prepareSignedLocalnetSolanaDepositClaimTransaction,prepareSignedLocalnetSolanaDepositReceiptTransaction,
  verifySignedLocalnetSolanaDepositClaimTransaction,verifySignedLocalnetSolanaDepositReceiptTransaction,associatedTokenDestination}
  from '../../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs';
import {ATTESTATION_PROTOCOL,ATTESTATION_MODE,BURN_SIGNED_BYTES,verifyBurnAttestationPair} from '../../../services/attesters/burn-attestation-codec.mjs';
const vector=JSON.parse(readFileSync(new URL('../../../solana/modules/bridge-messages/vectors/burn-borsh-v4.json',import.meta.url)));
test('complete V4 receipt and mint packets fit Solana limits and bind the wallet ATA and both replay PDAs',async()=>{
  const payer=ed25519.utils.randomSecretKey(),seeds=[ed25519.utils.randomSecretKey(),ed25519.utils.randomSecretKey()];
  try{
    const message=decodeCanonicalBridgeMessage(Buffer.from(vector.messageHex,'hex'));
    const attestations=seeds.map((seed,i)=>({protocol:ATTESTATION_PROTOCOL,mode:ATTESTATION_MODE,role:['ATTESTER_A','ATTESTER_B'][i],
      keyEpoch:message.keyEpoch,policyEpoch:message.policyEpoch,attesterPublicKeyHex:Buffer.from(ed25519.getPublicKey(seed)).toString('hex'),
      messageDigestHex:message.messageDigestHex,operationIdHex:message.operationIdHex,signedBytes:BURN_SIGNED_BYTES,
      signatureHex:Buffer.from(ed25519.sign(message.encoded,seed)).toString('hex'),state:'VERIFIED_READY'}));
    verifyBurnAttestationPair(attestations,vector.messageHex,attestations.map(a=>a.attesterPublicKeyHex));
    assert.throws(()=>verifyBurnAttestationPair([attestations[0],attestations[0]],vector.messageHex,attestations.map(a=>a.attesterPublicKeyHex)));
    const pub=Buffer.from(ed25519.getPublicKey(payer)).toString('hex');
    const config={environment:'localnet',cluster:'localnet',managerProgramIdHex:vector.message.evidence.binding.bridgeProgram,
      transceiverProgramIdHex:vector.message.evidence.binding.transceiverProgram,mintHex:vector.message.evidence.binding.mint,
      tokenProgramIdBase58:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',feePayerHex:pub,
      encodedMessageHex:vector.messageHex,attestations,recentBlockhashHex:'7f'.repeat(32),lastValidBlockHeight:'300',
      feePayerSigner:{publicKeyHex:pub,sign:bytes=>ed25519.sign(bytes,payer)}};
    const receipt=await prepareSignedLocalnetSolanaDepositReceiptTransaction(config),claim=await prepareSignedLocalnetSolanaDepositClaimTransaction(config);
    assert(Buffer.from(receipt.preparedTransactionBase64,'base64').length<=1232);
    assert(Buffer.from(claim.preparedTransactionBase64,'base64').length<=1232);
    assert.equal(claim.accounts.find(a=>a.role==='recipientTokenAccount').addressHex,
      associatedTokenDestination(message.destination,message.deployment.mint).hex);
    assert.notEqual(claim.pdas.depositReplay.addressBase58,claim.pdas.burnReplay.addressBase58);
    assert.equal(verifySignedLocalnetSolanaDepositClaimTransaction({...config,preparedTransactionBase64:claim.preparedTransactionBase64}).solanaSignature,claim.signatures[0].signatureBase58);
    assert.equal(verifySignedLocalnetSolanaDepositReceiptTransaction({...config,preparedTransactionBase64:receipt.preparedTransactionBase64}).solanaSignature,receipt.signatures[0].signatureBase58);
    await assert.rejects(prepareSignedLocalnetSolanaDepositClaimTransaction({...config,recipientTokenAccountHex:'09'.repeat(32)}),/RecipientMismatch/);
    const corrupt=Buffer.from(claim.preparedTransactionBase64,'base64');corrupt[110]^=1;
    assert.throws(()=>verifySignedLocalnetSolanaDepositClaimTransaction({...config,preparedTransactionBase64:corrupt.toString('base64')}));
  }finally{payer.fill(0);seeds.forEach(s=>s.fill(0));}
});
