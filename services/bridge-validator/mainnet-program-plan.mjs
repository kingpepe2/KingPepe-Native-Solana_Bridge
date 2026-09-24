// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Initial loader-v3 deployment only, no upgrade path, signer, RPC or sender.
// Loader/system instruction bytes follow the Solana platform ABI (Agave 4.2.2);
// they are unrelated to the Bridge's canonical burn-evidence Borsh schema.
import {createHash} from 'node:crypto';
import {base58Decode,base58Encode,shortvecEncode,findProgramAddress} from './solana-deposit-claim-transaction-plan.mjs';
import {SOLANA_MAINNET_GENESIS} from '../../shared/network-identity.mjs';
export const PROGRAM_LOADER='BPFLoaderUpgradeab1e11111111111111111111111';
const SYSTEM='11111111111111111111111111111111',RENT='SysvarRent111111111111111111111111111111111',CLOCK='SysvarC1ock11111111111111111111111111111111';
const COMPUTE='ComputeBudget111111111111111111111111111111';
const check=(v,c='MainnetProgramPlanRejected')=>{if(!v)throw Error(c);},hash=b=>createHash('sha256').update(b).digest('hex');
const key=v=>{check(typeof v==='string');const b=Buffer.from(base58Decode(v));check(b.length===32&&base58Encode(b)===v);return b;};
const u32=n=>{check(Number.isInteger(n)&&n>=0&&n<=0xffffffff);const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const u64=n=>{check(typeof n==='string'&&/^(0|[1-9][0-9]{0,19})$/u.test(n)&&BigInt(n)<=0xffffffffffffffffn);const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;};
const meta=(key,signer=false,writable=false)=>({key,signer,writable});
function identity(c,artifact){
  check(c&&Object.keys(c).sort().join()==='artifactSha256,buffer,environment,feePayer,genesis,program,upgradeAuthority');
  check(c.environment==='mainnet'&&c.genesis===SOLANA_MAINNET_GENESIS,'MainnetProgramClusterRequired');
  const addresses=[c.buffer,c.program,c.feePayer,c.upgradeAuthority];addresses.forEach(key);
  check(new Set(addresses).size===4&&addresses.every(a=>![PROGRAM_LOADER,SYSTEM,RENT,CLOCK,COMPUTE].includes(a)));
  check(Buffer.isBuffer(artifact)&&artifact.length>=64&&artifact.length<=2097152&&artifact.subarray(0,4).equals(Buffer.from([127,69,76,70]))&&hash(artifact)===c.artifactSha256,'MainnetProgramArtifactChanged');
  return findProgramAddress([key(c.program)],key(PROGRAM_LOADER)).base58;
}
function message(c,instructions,recentBlockhash){
  key(recentBlockhash);const accounts=new Map([[c.feePayer,meta(c.feePayer,true,true)]]);
  for(const item of instructions.flatMap(i=>[...i.accounts,meta(i.program)])){
    key(item.key);const prior=accounts.get(item.key);accounts.set(item.key,{...item,signer:item.signer||prior?.signer===true,writable:item.writable||prior?.writable===true});
  }
  const keys=[...accounts.values()].sort((a,b)=>(a.key===c.feePayer?-1:b.key===c.feePayer?1:0)||Number(b.signer)-Number(a.signer)||Number(b.writable)-Number(a.writable));
  const header=[keys.filter(k=>k.signer).length,keys.filter(k=>k.signer&&!k.writable).length,keys.filter(k=>!k.signer&&!k.writable).length];
  const index=k=>keys.findIndex(a=>a.key===k);
  const bytes=Buffer.concat([Buffer.from(header),Buffer.from(shortvecEncode(keys.length)),...keys.map(k=>key(k.key)),key(recentBlockhash),Buffer.from(shortvecEncode(instructions.length)),
    ...instructions.map(i=>Buffer.concat([Buffer.from([index(i.program)]),Buffer.from(shortvecEncode(i.accounts.length)),Buffer.from(i.accounts.map(a=>index(a.key))),Buffer.from(shortvecEncode(i.data.length)),i.data]))]);
  const packetBytes=1+header[0]*64+bytes.length;check(packetBytes<=1232,'MainnetProgramPacketLimit');
  return {messageBase64:bytes.toString('base64'),messageSha256:hash(bytes),packetBytes,requiredSigners:keys.filter(k=>k.signer).map(k=>k.key)};
}
const create=(payer,address,lamports,space)=>({program:SYSTEM,accounts:[meta(payer,true,true),meta(address,true,true)],
  data:Buffer.concat([u32(0),u64(lamports),u64(String(space)),key(PROGRAM_LOADER)])});
const write=(c,offset,bytes)=>({program:PROGRAM_LOADER,accounts:[meta(c.buffer,false,true),meta(c.upgradeAuthority,true)],data:Buffer.concat([u32(1),u32(offset),u64(String(bytes.length)),bytes])});
export function mainnetProgramWriteChunkSize(configuration,artifact){
  identity(configuration,artifact);return 1232-message(configuration,[write(configuration,0,Buffer.alloc(0))],configuration.program).packetBytes-1;
}
export function buildMainnetProgramStep({configuration,artifact,recentBlockhash,step,offset,bufferFundingLamports,programRentLamports}){
  const c=configuration,programData=identity(c,artifact);let instructions;
  if(step==='CREATE_BUFFER'){
    check(offset===undefined&&programRentLamports===undefined&&BigInt(bufferFundingLamports)>0n);
    instructions=[create(c.feePayer,c.buffer,bufferFundingLamports,artifact.length+37),
      {program:PROGRAM_LOADER,accounts:[meta(c.buffer,false,true),meta(c.upgradeAuthority)],data:u32(0)}];
  }else if(step==='WRITE'){
    const chunk=mainnetProgramWriteChunkSize(c,artifact);
    check(bufferFundingLamports===undefined&&programRentLamports===undefined&&Number.isSafeInteger(offset)&&offset>=0&&offset<artifact.length&&offset%chunk===0);
    instructions=[write(c,offset,artifact.subarray(offset,Math.min(offset+chunk,artifact.length)))];
  }else if(step==='DEPLOY'){
    check(offset===undefined&&bufferFundingLamports===undefined&&BigInt(programRentLamports)>0n);
    instructions=[{program:COMPUTE,accounts:[],data:Buffer.concat([Buffer.from([2]),u32(1400000)])},
      create(c.feePayer,c.program,programRentLamports,36),{program:PROGRAM_LOADER,
        accounts:[meta(c.feePayer,true,true),meta(programData,false,true),meta(c.program,false,true),meta(c.buffer,false,true),meta(RENT),meta(CLOCK),meta(SYSTEM),meta(c.upgradeAuthority,true)],
        data:Buffer.concat([u32(2),u64(String(artifact.length))])}];
  }else throw Error('MainnetInitialProgramStepRequired');
  return {protocol:'KINGPEPE_INITIAL_MAINNET_PROGRAM_DEPLOYMENT_V1',step,program:c.program,programData,buffer:c.buffer,
    artifactSha256:c.artifactSha256,artifactBytes:artifact.length,computeUnitPriceMicroLamports:'0',...message(c,instructions,recentBlockhash)};
}
function bytes(account,length,executable){
  check(account&&account.owner===PROGRAM_LOADER&&account.executable===executable&&Array.isArray(account.data)&&account.data.length===2&&account.data[1]==='base64','MainnetProgramAccountChanged');
  const b=Buffer.from(account.data[0],'base64');check(b.length===length&&b.toString('base64')===account.data[0],'MainnetProgramAccountChanged');return b;
}
export function inspectMainnetProgramUpload({configuration,artifact,programAccount,programDataAccount,bufferAccount}){
  const c=configuration,pda=identity(c,artifact);
  if(programAccount!==null){
    const p=bytes(programAccount,36,true),d=bytes(programDataAccount,artifact.length+45,false);
    check(p.readUInt32LE(0)===2&&base58Encode(p.subarray(4))===pda&&d.readUInt32LE(0)===3&&d.readBigUInt64LE(4)>0n&&
      d[12]===1&&base58Encode(d.subarray(13,45))===c.upgradeAuthority&&d.subarray(45).equals(artifact),'MainnetDeployedArtifactOrAuthorityChanged');
    return {state:'DEPLOYED_VERIFIED',programData:pda,deploymentSlot:d.readBigUInt64LE(4).toString(),writes:[]};
  }
  check(programDataAccount===null,'MainnetUnexpectedProgramData');
  if(bufferAccount===null)return {state:'CREATE_BUFFER',programData:pda,writes:[]};
  const b=bytes(bufferAccount,artifact.length+37,false);
  check(b.readUInt32LE(0)===1&&b[4]===1&&base58Encode(b.subarray(5,37))===c.upgradeAuthority,'MainnetBufferAuthorityChanged');
  const data=b.subarray(37),chunk=mainnetProgramWriteChunkSize(c,artifact),writes=[];
  for(let offset=0;offset<artifact.length;offset+=chunk)if(!data.subarray(offset,offset+chunk).equals(artifact.subarray(offset,offset+chunk)))writes.push(offset);
  return {state:writes.length?'WRITE':'DEPLOY',programData:pda,writes};
}
