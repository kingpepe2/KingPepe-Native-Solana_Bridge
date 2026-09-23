// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// TEST-only automatic service. SIGINT/SIGTERM drain the active cycle before
// closing protected stores. A critical pause persists across restarts.
import {readFileSync,statSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {validateRuntimeFile} from '../../shared/runtime-path-boundary.mjs';
import {WindowsProtectedStore} from '../../shared/windows/protected-store.mjs';
import {openBurnServiceRuntime} from './burn-service-runtime.mjs';
import {listenBurnUserApi} from './burn-user-http.mjs';
import {burnRuntimeErrorCode} from './burn-runtime.mjs';
import {requireBurn as check} from '../../native/burn/burn-protocol.mjs';

export function loadBurnServiceConfiguration(file) {
  file=validateRuntimeFile(file);check(statSync(file).size<=65536,'BurnServiceConfigurationLimit');
  let c;try{c=JSON.parse(readFileSync(file,'utf8'));}catch{throw new Error('BurnServiceConfigurationRejected');}
  check(c&&Object.keys(c).sort().join()==='accessTokenStore,intervalMs,mainnetActivation,port,productionReady,runtime','BurnServiceConfigurationFields');
  check(c.productionReady===false&&c.mainnetActivation==='DISABLED'&&['localnet','devnet'].includes(c.runtime?.policy?.context?.environment),'BurnServiceTestOnly');
  check(Number.isSafeInteger(c.port)&&c.port>=1024&&c.port<=65535&&Number.isSafeInteger(c.intervalMs)&&c.intervalMs>=1000&&c.intervalMs<=10000,'BurnServiceLoopConfiguration');
  const context=c.accessTokenStore?.context,expected=c.runtime.policy.context;
  check(context?.role==='BRIDGE_VALIDATOR'&&context.purpose==='service-auth'&&context.environment===expected.environment&&
    context.nativeGenesis===expected.deployment.nativeGenesis&&context.solanaDeployment===expected.deployment.solanaDeployment,'BurnServiceAccessTokenBinding');
  return c;
}

export async function runBurnService(file,{resumeReviewedTest=false,signal,log=()=>{}}={}) {
  check(typeof resumeReviewedTest==='boolean'&&typeof log==='function','BurnServiceOptionsRejected');
  const configuration=loadBurnServiceConfiguration(file);
  const service=await openBurnServiceRuntime(configuration.runtime,event=>log(event));
  let server,tokenStore,secret;
  try {
    await service.runtime.cycle();
    // A retained launch argument may admit an initially reviewed empty TEST
    // runtime. It must never clear a later operator or critical safety pause.
    if(resumeReviewedTest&&service.journal.read().pauseReason==='INITIAL_REVIEW_REQUIRED')await service.runtime.resumeReviewedTestRuntime();
    tokenStore=new WindowsProtectedStore(configuration.accessTokenStore);secret=tokenStore.read().payload;
    server=await listenBurnUserApi({api:service.api,accessToken:secret,port:configuration.port});
    secret.fill(0);secret=null;tokenStore.close();tokenStore=null;
    log({event:'TEST_SERVICE_LISTENING',environment:configuration.runtime.policy.context.environment,productionReady:false,mainnetActivation:'DISABLED'});
    let health='';
    while(!signal?.aborted) {
      const result=await service.runtime.cycle(),next=JSON.stringify([result.state,result.reconciliation,result.reason]);
      if(next!==health){health=next;log({event:'HEALTH',state:result.state,reconciliation:result.reconciliation,reason:result.reason});}
      try{await delay(configuration.intervalMs,undefined,{signal});}catch(error){if(error.name!=='AbortError')throw error;}
    }
  }finally {
    secret?.fill(0);tokenStore?.close();
    // Drain authenticated in-flight requests before releasing journal/signers.
    if(server)await new Promise(resolve=>server.close(resolve));
    await service.close();
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const allowed=process.argv.length===3||process.argv.length===4&&process.argv[3]==='--resume-reviewed-test';
  if(!allowed)throw new Error('BurnServicePrivateConfigurationPathRequired');
  const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{await runBurnService(process.argv[2],{resumeReviewedTest:process.argv[3]==='--resume-reviewed-test',signal:controller.signal,
    log:event=>process.stdout.write(JSON.stringify(event)+'\n')});}
  catch(error){process.stderr.write(JSON.stringify({event:'TEST_SERVICE_STOPPED',reason:burnRuntimeErrorCode(error)})+'\n');process.exitCode=1;}
}
