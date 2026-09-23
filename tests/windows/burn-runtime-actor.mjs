// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Child-process TEST recovery boundary, accessible only through the parent's
// private Node IPC channel. This file is not a public or deployed user API.
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {validateRuntimeFile} from '../../shared/runtime-path-boundary.mjs';
import {openBurnServiceRuntime} from '../../services/bridge-validator/burn-service-runtime.mjs';
import {burnRuntimeErrorCode} from '../../services/bridge-validator/burn-runtime.mjs';

if(process.platform!=='win32'||typeof process.send!=='function')throw new Error('WindowsTestParentRequired');
const file=validateRuntimeFile(process.argv[2]);
const configuration=JSON.parse(readFileSync(file,'utf8'));
if(configuration.policy?.context?.environment!=='localnet')throw new Error('RecoveryActorLocalnetOnly');
const service=await openBurnServiceRuntime(configuration,event=>process.send({event}));
let requests=Promise.resolve(),closed=false;
const reply=(id,result)=>process.send?.({id,result});
async function close(){if(closed)return;closed=true;await service.close();process.disconnect?.();}
process.on('message',request=>{
  requests=requests.then(async()=>{
    if(closed)return;
    try{
      if(!request||!Number.isSafeInteger(request.id)||Object.keys(request).sort().join()!=='command,id,input')throw new Error('TestCommandRejected');
      let result;
      switch(request.command){
        case 'cycle': result=await service.runtime.cycle();break;
        case 'status': result=service.runtime.status();break;
        case 'operation': result=service.runtime.operation(request.input);break;
        case 'create': result=await service.runtime.createOperation(request.input);break;
        case 'resume': result=await service.runtime.resumeReviewedTestRuntime();break;
        case 'snapshot': result=service.journal.read();break;
        case 'close': await close();return;
        default: throw new Error('TestCommandRejected');
      }
      reply(request.id,result);
    }catch(error){process.send?.({id:request?.id,error:burnRuntimeErrorCode(error)});}
  });
});
process.on('disconnect',()=>{void requests.finally(close);});
process.send({ready:true});
// Keep the child alive only while its explicit TEST parent is connected.
while(process.connected&&!closed)await delay(100);
