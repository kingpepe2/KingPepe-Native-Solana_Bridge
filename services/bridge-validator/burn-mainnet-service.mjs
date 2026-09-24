// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Mainnet has no launch/resume flag. The protected lifecycle and verified
// on-chain mode control admission; restart cannot clear a persistent pause.
import {pathToFileURL} from 'node:url';
import {runBurnService} from './burn-service.mjs';
import {burnRuntimeErrorCode} from './burn-runtime.mjs';
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.length!==3)throw new Error('BurnMainnetPrivateConfigurationRequired');
  const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{await runBurnService(process.argv[2],{mainnet:true,signal:controller.signal,log:event=>process.stdout.write(JSON.stringify(event)+'\n')});}
  catch(error){process.stderr.write(JSON.stringify({event:'MAINNET_SERVICE_STOPPED',reason:burnRuntimeErrorCode(error)})+'\n');process.exitCode=1;}
}
