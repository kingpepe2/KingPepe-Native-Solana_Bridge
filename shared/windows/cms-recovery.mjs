// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Standard CMS authenticated encryption, using the reviewed local OpenSSL tool.
// The server receives only a public certificate. No recovery private key API.
import {createHash,X509Certificate} from 'node:crypto';
import {readFileSync,lstatSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const MAX=24*1024*1024,check=v=>{if(!v)throw Error('RecoveryEncryptionRejected');};
const hash=b=>createHash('sha256').update(b).digest('hex');
const regular=(file,max)=>{
  check(typeof file==='string'&&path.isAbsolute(file));const s=lstatSync(file);
  check(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&s.size>0&&s.size<=max);return readFileSync(file);
};
export function verifyRecoveryCertificate({certificateFile,certificateSha256}){
  check(typeof certificateSha256==='string'&&/^[0-9a-f]{64}$/u.test(certificateSha256));
  const bytes=regular(certificateFile,32768),text=bytes.toString('ascii');
  check(/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\s*$/u.test(text));
  const cert=new X509Certificate(bytes),details=cert.publicKey.asymmetricKeyDetails;
  check(hash(cert.raw)===certificateSha256&&cert.publicKey.asymmetricKeyType==='rsa'&&
    details.modulusLength>=4096&&details.modulusLength<=8192&&details.publicExponent===65537n&&
    !cert.ca&&Date.parse(cert.validFrom)<=Date.now()&&Date.parse(cert.validTo)>Date.now());
  return {certificateSha256,publicKeySha256:hash(cert.publicKey.export({type:'spki',format:'der'})),fileSha256:hash(bytes)};
}
export function encryptRecoveryCms({plaintext,certificateFile,certificateSha256,openssl,opensslSha256}){
  check(Buffer.isBuffer(plaintext)&&plaintext.length>0&&plaintext.length<=MAX);
  const certificate=verifyRecoveryCertificate({certificateFile,certificateSha256});
  check(/^[0-9a-f]{64}$/u.test(opensslSha256)&&hash(regular(openssl,32*1024*1024))===opensslSha256);
  const args=['cms','-encrypt','-binary','-outform','DER','-aes-256-gcm','-recip',certificateFile,
    '-keyopt','rsa_padding_mode:oaep','-keyopt','rsa_oaep_md:sha256','-keyopt','rsa_mgf1_md:sha256'];
  const environment={...process.env};
  for(const name of Object.keys(environment))if(/^OPENSSL_/iu.test(name))delete environment[name];
  let result;
  try{
    result=spawnSync(openssl,args,{input:plaintext,env:environment,encoding:'buffer',windowsHide:true,
      timeout:30000,maxBuffer:MAX+65536,stdio:['pipe','pipe','pipe']});
    check(!result.error&&result.status===0&&result.stderr.length===0&&result.stdout.length>plaintext.length&&result.stdout.length<=MAX+65536);
    check(hash(regular(certificateFile,32768))===certificate.fileSha256&&hash(regular(openssl,32*1024*1024))===opensslSha256);
    return {ciphertext:Buffer.from(result.stdout),receipt:{protocol:'CMS_AUTH_ENVELOPED_DATA_AES256GCM_RSA_OAEP_SHA256',
      certificateSha256,opensslSha256,plaintextSha256:hash(plaintext),ciphertextSha256:hash(result.stdout),
      offlineCopy:'NOT_PROVISIONED',recoveryPrivateMaterialReceived:false}};
  }catch{throw Error('RecoveryEncryptionRejected');}
  finally{result?.stdout?.fill(0);result?.stderr?.fill(0);}
}
