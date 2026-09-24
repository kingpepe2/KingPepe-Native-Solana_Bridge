// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import {createHash} from 'node:crypto';
import {BurnSolanaRpc} from './burn-solana-rpc.mjs';
import {validateDeploymentManifest,deploymentAddresses,verifyDeploymentSnapshot,UPGRADEABLE_LOADER} from './deployment-integrity.mjs';
import {validateBurnContext,assertBurnBindingContext} from '../bridge-validator/burn-context.mjs';
import {base58Encode,base58Decode,findProgramAddress,associatedTokenDestination} from '../bridge-validator/solana-deposit-claim-transaction-plan.mjs';
import {decodeCanonicalBridgeMessage} from '../../shared/protocol/canonical-message.mjs';
import {decodeBridgeAbi} from '../../shared/protocol/solana-bridge-abi.mjs';
import {verifyDepositMintExecution} from './deposit-mint-execution.mjs';
import {burnOperationId,burnHash,burnUint,requireBurn as check} from '../../native/burn/burn-protocol.mjs';
import {MAX_KPEPE_SUPPLY_ATOMIC} from '../../shared/monetary-supply.mjs';
import {associatedTokenCreationMessage,verifyBurnSolanaPacket} from '../relayer/burn-solana-signer.mjs';
const h=s=>Buffer.from(s,'hex'),hex=b=>Buffer.from(b).toString('hex'),TOKEN='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function validateBurnSolanaPolicy(input) {
  check(input&&Object.keys(input).sort().join()==='artifacts,context,feePayerHex,manifest','BurnSolanaPolicyFields');
  const p=structuredClone(input);p.context=validateBurnContext(p.context);p.manifest=validateDeploymentManifest(p.manifest);burnHash(p.feePayerHex);
  const {deployment:d}=p.context,m=p.manifest;
  check(m.environment===p.context.environment&&m.nativeGenesisHex===d.nativeGenesis&&m.solanaGenesis===base58Encode(h(d.solanaGenesis))&&
    m.solanaDeploymentHex===d.solanaDeployment&&m.manager.id===base58Encode(h(d.bridgeProgram))&&m.transceiver.id===base58Encode(h(d.transceiverProgram))&&
    m.mint.id===base58Encode(h(d.mint))&&m.mint.decimals===8&&m.config.keyEpoch===p.context.keyEpoch&&m.config.policyEpoch===p.context.policyEpoch&&
    m.config.protocolId===d.protocolId&&m.config.nativeNetwork===d.nativeNetwork&&m.config.attesters.every((a,i)=>a===base58Encode(h(p.context.attesters[i])))&&
    !m.config.depositsPaused&&m.config.transceiverActive,'BurnSolanaPolicyBinding');
  check(p.artifacts&&Object.keys(p.artifacts).sort().join()==='manager,transceiver','BurnSolanaArtifactsRequired');
  for(const artifact of Object.values(p.artifacts))check(artifact&&Object.keys(artifact).sort().join()==='byteLength,sha256'&&
    /^[0-9a-f]{64}$/u.test(artifact.sha256)&&Number.isSafeInteger(artifact.byteLength)&&artifact.byteLength>4&&artifact.byteLength<=2_097_152,'BurnSolanaArtifactRejected');
  check(![d.burnPublicKey,...p.context.attesters,d.bridgeProgram,d.transceiverProgram,d.mint].includes(p.feePayerHex),'BurnSolanaFeePayerRoleOverlap');
  return p;
}
function accountBytes(account,owner,length) {
  check(account&&account.owner===owner&&!account.executable&&Array.isArray(account.data)&&account.data.length===2&&account.data[1]==='base64','BURN_SOLANA_ACCOUNT_OWNER');
  const bytes=Buffer.from(account.data[0],'base64');check(bytes.toString('base64')===account.data[0]&&(length===undefined||bytes.length===length),'BURN_SOLANA_ACCOUNT_ENCODING');return bytes;
}
export function verifyBurnDeploymentSnapshot(policy,snapshot) {
  const p=validateBurnSolanaPolicy(policy),addresses=deploymentAddresses(p.manifest);
  const verified=verifyDeploymentSnapshot(p.manifest,{...snapshot,accounts:snapshot.accounts.slice(0,addresses.length)});
  for(const kind of ['manager','transceiver']) {
    const config=p.manifest[kind],account=snapshot.accounts[addresses.indexOf(config.programData??config.id)];
    const data=Buffer.from(account.data[0],'base64'),code=config.loader===UPGRADEABLE_LOADER?data.subarray(45):data,artifact=p.artifacts[kind];
    check(code.length>=artifact.byteLength&&hash(code.subarray(0,artifact.byteLength))===artifact.sha256&&
      code.subarray(artifact.byteLength).every(byte=>byte===0),'BURN_SOLANA_ARTIFACT_CHANGED');
  }
  check(burnUint(verified.managerMintedAtomic)<=MAX_KPEPE_SUPPLY_ATOMIC&&burnUint(verified.mintSupplyAtomic)<=burnUint(verified.managerMintedAtomic),'BURN_SOLANA_SUPPLY_CRITICAL');
  return verified;
}
export function burnSolanaAddresses(binding,plan,attestation) {
  const manager=h(binding.bridgeProgram),mint=h(binding.mint),id=burnOperationId(binding);
  const pd=(seeds,program=manager)=>findProgramAddress(seeds,program).base58;
  const addresses={destinationToken:associatedTokenDestination(h(binding.destination),mint).base58,
    claim:pd([Buffer.from('kingpepe-deposit-claim'),h(id)])};
  if(plan){const vout=Buffer.alloc(4);vout.writeUInt32LE(plan.inputs[0].vout);
    addresses.deposit= pd([Buffer.from('kingpepe-deposit-replay'),mint,h(binding.nativeGenesis),h(plan.inputs[0].txid),vout]);
    addresses.burn=pd([Buffer.from('kingpepe-burn-replay'),mint,h(binding.nativeGenesis),h(plan.txid),Buffer.alloc(4)]);}
  if(attestation){const message=decodeCanonicalBridgeMessage(h(attestation.encodedMessageHex));
    addresses.receipt=pd([Buffer.from('kingpepe-transceiver-receipt'),h(message.messageDigestHex)],h(binding.transceiverProgram));}
  return addresses;
}
const instances=new WeakSet();
export function requireBurnSolanaAdapter(v){check(instances.has(v),'BurnSolanaAdapterRequired');}
export class BurnSolanaAdapter {
  #policy;#rpc;#minimumSlot;
  constructor({policy,endpoint}) {
    this.#policy=validateBurnSolanaPolicy(policy);const m=this.#policy.manifest;
    this.#rpc=new BurnSolanaRpc({environment:m.environment,endpoint,expectedGenesis:m.solanaGenesis});this.#minimumSlot=m.minimumSlot;instances.add(this);
  }
  get policy(){return structuredClone(this.#policy);}
  async deployment(){
    const snapshot=await this.#rpc.snapshot(deploymentAddresses(this.#policy.manifest),this.#minimumSlot);
    const verified=verifyBurnDeploymentSnapshot(this.#policy,snapshot);this.#minimumSlot=verified.slot;return verified;
  }
  async publicBalance(address) {
    const wallet=Buffer.from(base58Decode(address));check(wallet.length===32&&base58Encode(wallet)===address,'BurnBalanceAddressRejected');
    const mint=this.#policy.manifest.mint.id;
    const discovered=await this.#rpc.call('getTokenAccountsByOwner',[address,{mint},{encoding:'base64',commitment:'finalized',minContextSlot:Number(this.#minimumSlot)}]);
    check(Number.isSafeInteger(discovered?.context?.slot)&&BigInt(discovered.context.slot)>=BigInt(this.#minimumSlot)&&
      Array.isArray(discovered.value)&&discovered.value.length<=16,'BurnBalanceDiscoveryRejected');
    const tokens=discovered.value.map(row=>row.pubkey),base=deploymentAddresses(this.#policy.manifest);
    check(new Set(tokens).size===tokens.length,'BurnBalanceDiscoveryRejected');
    const snapshot=await this.#rpc.snapshot([...base,address,...tokens],String(discovered.context.slot));
    const verified=verifyBurnDeploymentSnapshot(this.#policy,snapshot);this.#minimumSlot=verified.slot;
    const walletAccount=snapshot.accounts[base.length],lamports=walletAccount?.lamports??(walletAccount===null?0:undefined);
    check(Number.isSafeInteger(lamports)&&lamports>=0&&(!walletAccount||!walletAccount.executable),'BurnBalanceLamportsRejected');
    let total=0n;
    const tokenAccounts=tokens.map((token,i)=>{
      const bytes=accountBytes(snapshot.accounts[base.length+1+i],TOKEN,165);
      check(base58Encode(bytes.subarray(0,32))===mint&&bytes.subarray(32,64).equals(wallet)&&bytes[108]===1,'BurnBalanceTokenRejected');
      const amount=bytes.readBigUInt64LE(64);total+=amount;check(total<=MAX_KPEPE_SUPPLY_ATOMIC,'BurnBalanceSupplyRejected');
      return {address:token,amountAtomic:amount.toString()};
    });
    return {address,chain:`solana:${this.#policy.context.environment}`,mint,decimals:8,
      solLamports:BigInt(lamports).toString(),kpepeAtomic:total.toString(),tokenAccounts,commitment:'finalized'};
  }
  async observe(binding,plan=null,attestation=null) {
    assertBurnBindingContext(binding,this.#policy.context);const addresses=burnSolanaAddresses(binding,plan,attestation),base=deploymentAddresses(this.#policy.manifest);
    const snapshot=await this.#rpc.snapshot([...base,...Object.values(addresses)],this.#minimumSlot);
    const verified=verifyBurnDeploymentSnapshot(this.#policy,snapshot);this.#minimumSlot=verified.slot;
    const accounts=Object.fromEntries(Object.keys(addresses).map((name,i)=>[name,snapshot.accounts[base.length+i]]));
    const result={...verified,ataExists:accounts.destinationToken!==null,claimExists:accounts.claim!==null,receiptExists:false,addresses};
    if(accounts.destinationToken){const bytes=accountBytes(accounts.destinationToken,TOKEN,165);
      check(hex(bytes.subarray(0,32))===binding.mint&&hex(bytes.subarray(32,64))===binding.destination&&bytes[108]===1&&bytes.readUInt32LE(109)===0,'BURN_SOLANA_DESTINATION_MISMATCH');
      result.destinationBalanceAtomic=bytes.readBigUInt64LE(64).toString();}
    if(!attestation){check(accounts.claim===null&&(!plan||accounts.deposit===null&&accounts.burn===null),'BURN_SOLANA_UNJOURNALED_CLAIM');return result;}
    const m=decodeCanonicalBridgeMessage(h(attestation.encodedMessageHex));
    if(accounts.receipt){const receipt=decodeBridgeAbi('VerifiedReceipt',accountBytes(accounts.receipt,base58Encode(h(binding.transceiverProgram)),240));
      check(Buffer.from(receipt.magic).toString()==='KPTRCPT1'&&receipt.version===1&&hex(receipt.operationId)===m.operationIdHex&&hex(receipt.messageDigest)===m.messageDigestHex&&
        hex(receipt.managerProgramId)===binding.bridgeProgram&&hex(receipt.transceiverProgramId)===binding.transceiverProgram&&hex(receipt.mint)===binding.mint&&
        receipt.direction===0&&receipt.action===0&&receipt.keyEpoch===m.keyEpoch&&!receipt.consumed&&
        receipt.attesters.map(hex).sort().join()===this.#policy.context.attesters.slice().sort().join(),'BURN_SOLANA_RECEIPT_MISMATCH');result.receiptExists=true;}
    for(const [kind,magic] of [['deposit','KPBDPT01'],['burn','KPBBRN01']])if(accounts[kind]){
      const marker=decodeBridgeAbi(kind==='burn'?'BurnReplay':'DepositReplay',accountBytes(accounts[kind],base58Encode(h(binding.bridgeProgram)),73));
      check(Buffer.from(marker.magic).toString()===magic&&marker.version===2&&hex(marker.operationId)===m.operationIdHex&&hex(marker.messageDigest)===m.messageDigestHex,'BURN_SOLANA_REPLAY_MARKER_MISMATCH');
    }
    if(accounts.claim){const claim=decodeBridgeAbi('DepositClaim',accountBytes(accounts.claim,base58Encode(h(binding.bridgeProgram)),211));
      check(Buffer.from(claim.magic).toString()==='KPBCLM01'&&claim.version===2&&hex(claim.operationId)===m.operationIdHex&&hex(claim.messageDigest)===m.messageDigestHex&&
        claim.amountAtomic===m.amountAtomic&&claim.recipient.length===32&&hex(claim.recipient.padded.slice(0,32))===binding.destination&&
        claim.recipient.padded.slice(32).every(v=>v===0)&&accounts.deposit&&accounts.burn&&result.receiptExists,'BURN_SOLANA_CLAIM_MISMATCH');}
    else check(!accounts.deposit&&!accounts.burn,'BURN_SOLANA_PARTIAL_MINT_STATE');
    return result;
  }
  async preBurn(binding,plan,expectedIssuedAtomic) {
    const observed=await this.observe(binding,plan);
    check(observed.managerMintedAtomic===expectedIssuedAtomic,'BURN_SOLANA_UNEXPLAINED_ISSUANCE');
    check(burnUint(observed.managerMintedAtomic)+burnUint(plan.inputs[0].amountAtomic)<=MAX_KPEPE_SUPPLY_ATOMIC,'BURN_SOLANA_CAP_UNAVAILABLE');
    check(await this.#rpc.call('getHealth')==='ok','BURN_SOLANA_UNHEALTHY');
    const recent=await this.#rpc.latestBlockhash(),{message}=associatedTokenCreationMessage({binding,feePayerHex:this.#policy.feePayerHex,...recent});
    const quoted=await this.#rpc.call('getFeeForMessage',[message.toString('base64'),{commitment:'finalized'}]);
    check(Number.isSafeInteger(quoted?.value)&&quoted.value>0,'BURN_SOLANA_FEE_QUOTE_UNAVAILABLE');
    // ATA: one signature, receipt: payer + two Ed25519 verifications, claim:
    // one signature. No ComputeUnitPrice instruction is included in these plans.
    let required=BigInt(quoted.value)*5n;
    for(const size of [0,240,211,73,73,...(observed.ataExists?[]:[165])]){
      const rent=await this.#rpc.call('getMinimumBalanceForRentExemption',[size,{commitment:'finalized'}]);
      check(Number.isSafeInteger(rent)&&rent>=0,'BURN_SOLANA_RENT_QUOTE_UNAVAILABLE');required+=BigInt(rent);
    }
    const balance=await this.#rpc.call('getBalance',[base58Encode(h(this.#policy.feePayerHex)),{commitment:'finalized'}]);
    check(Number.isSafeInteger(balance?.value)&&balance.value>=0,'BURN_SOLANA_BALANCE_UNAVAILABLE');
    check(BigInt(balance.value)>=required,'BURN_SOLANA_OPERATIONAL_FUNDING_REQUIRED');
    return {...observed,...recent,requiredLamports:required.toString()};
  }
  latestBlockhash(){return this.#rpc.latestBlockhash();}
  clock(){return this.#rpc.clock();}
  async packetStatus(packet,binding,plan,attestation) {
    verifyBurnSolanaPacket(packet,this.#policy.context,binding,this.#policy.feePayerHex,attestation);
    const status=await this.#rpc.signatureStatus(packet.signature),observed=await this.observe(binding,plan,attestation);
    const exists=packet.kind==='ATA'?observed.ataExists:packet.kind==='RECEIPT'?observed.receiptExists:observed.claimExists;
    if(status?.confirmationStatus==='finalized')check(status.err!==null||exists,'BURN_SOLANA_FINALIZED_ACCOUNT_MISSING');
    return {status,observed,exists,expired:!exists&&status===null&&await this.#rpc.finalizedHeight()>BigInt(packet.lastValidBlockHeight)};
  }
  async send(packet,binding,attestation) {
    verifyBurnSolanaPacket(packet,this.#policy.context,binding,this.#policy.feePayerHex,attestation);
    const signature=await this.#rpc.send(packet.preparedTransactionBase64);check(signature===packet.signature,'BURN_SOLANA_SUBMISSION_ID_CHANGED');return signature;
  }
  async mintReceipt(op,packet,observed) {
    check(packet.kind==='CLAIM'&&observed.claimExists,'BURN_SOLANA_CLAIM_NOT_FINAL');
    const actual=await this.#rpc.call('getTransaction',[packet.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);
    check(actual!==null&&actual.slot<=Number(observed.slot),'BURN_SOLANA_EXECUTION_PENDING');
    const observation={slot:String(actual.slot),transaction:{signature:packet.signature},depositClaim:{operationIdHex:op.operationId,
      messageDigestHex:decodeCanonicalBridgeMessage(h(op.attestation.encodedMessageHex)).messageDigestHex,
      mintedAmountAtomic:op.deposit.amountAtomic,solanaRecipientHex:op.binding.destination}};
    const proof=verifyDepositMintExecution(actual,observation,{environment:this.#policy.context.environment,cluster:this.#policy.context.environment,
      solanaGenesis:this.#policy.manifest.solanaGenesis,protocolId:op.binding.protocolId,nativeNetwork:op.binding.nativeNetwork,nativeGenesis:op.binding.nativeGenesis,
      solanaDeployment:op.binding.solanaDeployment,managerProgramIdHex:op.binding.bridgeProgram,transceiverProgramIdHex:op.binding.transceiverProgram,mintHex:op.binding.mint,nativeDecimals:8});
    return {operationId:op.operationId,amountAtomic:proof.amountAtomic,destination:op.binding.destination,mint:op.binding.mint,
      signature:packet.signature,slot:String(actual.slot),commitment:'finalized'};
  }
}
