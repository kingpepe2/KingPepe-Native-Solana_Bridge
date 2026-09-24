// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Unsigned production setup. The temporary creation authority exists only
// within one atomic transaction and ends as the exact Bridge mint PDA.
import {createHash} from 'node:crypto';
import {buildMainnetSolanaSetupTransactionPlan} from './mainnet-solana-setup-plan.mjs';
import {base58Decode,base58Encode,findProgramAddress,shortvecEncode} from './solana-deposit-claim-transaction-plan.mjs';
import {SPL_TOKEN_PROGRAM_ID_BASE58 as TOKEN,SYSTEM_PROGRAM_ID_BASE58 as SYSTEM} from './localnet-solana-setup-plan.mjs';

export const TOKEN_METADATA_PROGRAM='metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
// Metadata allocation and protocol charges belong to the deployed external
// program. Quote them from simulation; upstream main is not its deployed ABI.
const check=(v,c='MainnetMetadataPlanRejected')=>{if(!v)throw Error(c)};
const key=v=>{const b=Buffer.from(base58Decode(v));check(b.length===32&&base58Encode(b)===v);return b;};
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const string=v=>{const b=Buffer.from(v,'utf8');return Buffer.concat([u32(b.length),b]);};
const meta=(address,signer=false,writable=false)=>({address,signer,writable});
function transaction(payer,mint,blockhash,instructions){
  const accounts=new Map([[payer,meta(payer,true,true)],[mint,meta(mint,true,true)]]);
  for(const row of instructions.flatMap(i=>[...i.accounts,meta(i.program)])){
    const prior=accounts.get(row.address);accounts.set(row.address,{...row,signer:row.signer||prior?.signer===true,writable:row.writable||prior?.writable===true});
  }
  const sorted=[...accounts.values()].sort((a,b)=>Number(b.signer)-Number(a.signer)||Number(b.writable)-Number(a.writable));
  check(sorted.filter(a=>a.signer).length===2&&sorted[0].address===payer&&sorted[1].address===mint);
  const index=address=>sorted.findIndex(a=>a.address===address);
  const header=Buffer.from([2,sorted.filter(a=>a.signer&&!a.writable).length,sorted.filter(a=>!a.signer&&!a.writable).length]);
  const bytes=Buffer.concat([header,Buffer.from(shortvecEncode(sorted.length)),...sorted.map(a=>key(a.address)),key(blockhash),
    Buffer.from(shortvecEncode(instructions.length)),...instructions.map(i=>Buffer.concat([Buffer.from([index(i.program)]),
      Buffer.from(shortvecEncode(i.accounts.length)),Buffer.from(i.accounts.map(a=>index(a.address))),Buffer.from(shortvecEncode(i.data.length)),i.data]))]);
  check(129+bytes.length<=1232,'MainnetMetadataPacketTooLarge');
  return {requiredSigners:[payer,mint],messageBase64:bytes.toString('base64'),messageFingerprintHex:createHash('sha256').update(bytes).digest('hex'),
    packetBytes:129+bytes.length,instructions:instructions.map(i=>({role:i.role,program:i.program,accounts:i.accounts.map(a=>a.address),dataBase64:i.data.toString('base64')}))};
}
export function buildMainnetMetadataSetupPlans(input){
  const {metadataUri,...configuration}=structuredClone(input);
  check(typeof metadataUri==='string'&&Buffer.byteLength(metadataUri)<=200);
  let uri;try{uri=new URL(metadataUri);}catch{throw Error('MainnetMetadataUriRejected');}
  check(uri.protocol==='https:'&&uri.hostname==='kingpepe.net'&&!uri.username&&!uri.password&&!uri.search&&!uri.hash&&
    uri.pathname.startsWith('/metadata/')&&uri.pathname.endsWith('.json'),'MainnetMetadataUriRejected');
  const original=buildMainnetSolanaSetupTransactionPlan(configuration);
  const payer=configuration.feePayerBase58,mint=configuration.mintBase58;
  const metadata=findProgramAddress([Buffer.from('metadata'),key(TOKEN_METADATA_PROGRAM),key(mint)],key(TOKEN_METADATA_PROGRAM)).base58;
  const create=Buffer.from(original.instructions[0].dataBase64,'base64');
  const mintInstructions=[
    {role:'systemCreateMint',program:SYSTEM,accounts:[meta(payer,true,true),meta(mint,true,true)],data:create},
    {role:'splInitializeMint2',program:TOKEN,accounts:[meta(mint,false,true)],data:Buffer.concat([Buffer.from([20,8]),key(mint),Buffer.from([0])])},
    {role:'createTokenMetadata',program:TOKEN_METADATA_PROGRAM,accounts:[meta(metadata,false,true),meta(mint),meta(mint,true),meta(payer,true,true),meta(mint,true),meta(SYSTEM)],
      // CreateMetadataAccountV3, DataV2 with no royalties, creators, collection
      // or uses; mutable public metadata under the protected enrollment key.
      data:Buffer.concat([Buffer.from([33]),string('KingPepe'),string('KPEPE'),string(metadataUri),Buffer.from([0,0,0,0,0,1,0])])},
    {role:'bindBridgeMintAuthority',program:TOKEN,accounts:[meta(mint,false,true),meta(mint,true)],data:Buffer.concat([Buffer.from([6,0,1]),key(original.mintAuthority)])},
  ];
  const enrollmentInstructions=original.instructions.slice(2).map(i=>({role:i.role,program:original.accountKeys[i.programIdIndex],
    accounts:i.accountIndexes.map(index=>meta(original.accountKeys[index],index===0||index===1,index<4)),data:Buffer.from(i.dataBase64,'base64')}));
  const common={environment:'mainnet',scope:'UNSIGNED_MAINNET_PREPARATION',mint,metadata,metadataUri,metadataUpdateAuthority:mint,
    initialSupplyAtomic:'0',decimals:8,freezeAuthority:null,mintAuthority:original.mintAuthority,pdas:original.pdas,
    recentBlockhashBase58:configuration.recentBlockhashBase58,lastValidBlockHeight:configuration.lastValidBlockHeight};
  return Object.freeze({...common,
    mintAndMetadata:transaction(payer,mint,configuration.recentBlockhashBase58,mintInstructions),
    pausedEnrollment:transaction(payer,mint,configuration.recentBlockhashBase58,enrollmentInstructions)});
}
