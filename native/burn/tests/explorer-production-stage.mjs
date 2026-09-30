// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Stages the Explorer integration exactly as production composes it: the public
// support files, the shared source and pages, then the deployed reserve gateway.
import {mkdtempSync,cpSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export const overlay=path.resolve(import.meta.dirname,'../../../integrations/explorer');
export function stageProduction(){
 const root=mkdtempSync(path.join(os.tmpdir(),'kingpepe-explorer-production-'));
 cpSync(path.join(overlay,'support'),root,{recursive:true});
 for(const dir of ['src','web'])cpSync(path.join(overlay,dir),path.join(root,dir),{recursive:true});
 for(const dir of ['src','web'])cpSync(path.join(overlay,'reserve-gateway',dir),path.join(root,dir),{recursive:true});
 mkdirSync(path.join(root,'web/bridge-vendor'),{recursive:true});writeFileSync(path.join(root,'package.json'),'{"type":"module"}');
 writeFileSync(path.join(root,'web/bridge-vendor/base.js'),`export {base58,bech32,bech32m} from ${JSON.stringify(import.meta.resolve('@scure/base'))};`);
 writeFileSync(path.join(root,'src/config.js'),`export const SECURITY={trustCloudflareIP:false,rateWindowMs:60000,rateMax:100,burst:10,corsAllowOrigins:[],maxResponseBytes:65536,requestTimeoutMs:1000};`);
 process.on('exit',()=>{if(path.dirname(root)===path.resolve(os.tmpdir())&&path.basename(root).startsWith('kingpepe-explorer-production-'))rmSync(root,{recursive:true,force:true});});
 return {root,src:path.join(root,'src'),web:path.join(root,'web')};
}
