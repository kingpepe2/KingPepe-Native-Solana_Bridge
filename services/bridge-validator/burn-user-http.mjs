// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Authenticated loopback API. The Explorer alone handles public origins/CSP;
// it never receives a signing key or a signing/administrative API capability.
import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {BurnUserApi} from './burn-user-api.mjs';
export async function listenBurnUserApi({api,accessToken,port=0}) {
  if(!(api instanceof BurnUserApi)||!(accessToken instanceof Uint8Array)||accessToken.length!==32||!accessToken.some(v=>v!==0)||
    !Number.isInteger(port)||port<0||port>65535)throw new Error('BurnListenerConfigurationRejected');
  const expected=Buffer.from('Bearer '+Buffer.from(accessToken).toString('hex'));let active=0,windowStart=0,creations=0;
  const server=createServer({maxHeaderSize:4096,headersTimeout:10000,requestTimeout:10000},async(req,res)=>{
    const reply=(status,value)=>{if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));};
    try{
      const host=`127.0.0.1:${server.address()?.port}`;
      if(req.headers.host!==host||req.headers.origin&&req.headers.origin!==`http://${host}`||req.headersDistinct.authorization?.length!==1)return reply(403,{error:'ACCESS_DENIED'});
      const given=Buffer.from(req.headers.authorization??'');if(given.length!==expected.length||!timingSafeEqual(given,expected))return reply(403,{error:'ACCESS_DENIED'});
      if(active>=4)return reply(429,{error:'RETRY_LATER'});active++;
      try{
        if(req.method==='GET'&&req.url==='/bridge/status')return reply(200,api.getBridgeStatus());
        const op=/^\/operations\/([0-9a-f]{64})$/u.exec(req.url);
        if(req.method==='GET'&&op){const value=api.getOperationStatus(op[1]);return reply(value?200:404,value??{error:'OPERATION_NOT_FOUND'});}
        const balance=/^\/balances\/(native|solana)\/([a-zA-Z0-9]{32,90})$/u.exec(req.url);
        if(req.method==='GET'&&balance)return reply(200,await api.getPublicBalance(balance[1],balance[2]));
        if(req.method!=='POST'||req.url!=='/operations')return reply(404,{error:'ROUTE_NOT_FOUND'});
        if(!/^application\/json(?:; charset=utf-8)?$/u.test(req.headers['content-type']??''))return reply(415,{error:'JSON_REQUIRED'});
        const now=Date.now();if(now-windowStart>=60000||now<windowStart){windowStart=now;creations=0;}if(++creations>12)return reply(429,{error:'RETRY_LATER'});
        let size=0;const chunks=[];
        for await(const bytes of req){size+=bytes.length;if(size>2048){reply(413,{error:'REQUEST_TOO_LARGE'});req.resume();return;}chunks.push(bytes);}
        const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));reply(200,await api.createOperation(JSON.parse(text)));
      }finally{active--;}
    }catch{reply(400,{error:'REQUEST_REJECTED_OR_DEPENDENCY_UNAVAILABLE'});}
  });
  server.keepAliveTimeout=1000;server.maxConnections=16;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});server.once('close',()=>expected.fill(0));return server;
}
