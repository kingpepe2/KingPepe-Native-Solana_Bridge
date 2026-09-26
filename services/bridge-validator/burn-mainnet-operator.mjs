// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Local, protected-service-identity operator. No public administrative route.
// Inspect/transitions never submit Native or Solana economic transactions.
import {readFileSync,statSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {validateRuntimeFile} from '../../shared/runtime-path-boundary.mjs';
import {loadBurnServiceConfiguration} from './burn-service.mjs';
import {openBurnServiceRuntime} from './burn-service-runtime.mjs';
import {burnRuntimeErrorCode} from './burn-runtime.mjs';
import {requireBurn as check} from '../../native/burn/burn-protocol.mjs';

export async function runMainnetBurnOperator(configurationFile,action,controlledFile){
  check(['inspect','prepare-controlled','adopt-exact-received','enable-normal','pause','resume-reviewed'].includes(action),'BurnMainnetOperatorActionRejected');
  const bindingRequired=['prepare-controlled','adopt-exact-received'].includes(action);
  check(bindingRequired===(controlledFile!==undefined),'BurnMainnetOperatorArgumentsRejected');
  const c=loadBurnServiceConfiguration(configurationFile,{mainnet:true}),service=await openBurnServiceRuntime(c.runtime);
  try{
    if(action==='pause'){await service.runtime.pause();return service.runtime.status();}
    await service.runtime.cycle({readOnly:true});
    if(bindingRequired){
      const file=validateRuntimeFile(controlledFile);check(statSync(file).size<=1024,'BurnMainnetControlledFileLimit');
      let a;try{a=JSON.parse(readFileSync(file,'utf8'));}catch{throw Error('BurnMainnetControlledFileRejected');}
      check(a&&Object.keys(a).sort().join()===(action==='prepare-controlled'?'amountModel,destinationHex,nonce':'amountModel,destinationHex,nonce,operationId')&&
        a.amountModel==='EXACT_RECEIVED','BurnMainnetControlledFileRejected');
      return action==='prepare-controlled'?await service.runtime.beginControlledMainnet(a):await service.runtime.adoptExactReceivedMainnet(a);
    }
    if(action==='enable-normal')return await service.runtime.enableNormalMainnet();
    if(action==='resume-reviewed')await service.runtime.resumeReviewedMainnetRuntime();
    return service.runtime.status();
  }finally{await service.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    check(process.argv.length===4||process.argv.length===5,'BurnMainnetOperatorArgumentsRejected');
    process.stdout.write(JSON.stringify(await runMainnetBurnOperator(...process.argv.slice(2)))+'\n');
  }catch(error){process.stderr.write(JSON.stringify({state:'BLOCKED',reason:burnRuntimeErrorCode(error)})+'\n');process.exitCode=1;}
}
