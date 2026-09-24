// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import {validateBurnBinding,burnHash,requireBurn as check} from '../../native/burn/burn-protocol.mjs';
import {REGTEST_GENESIS} from '../../native/node/native-raw-evidence.mjs';
import {DEVNET_SOLANA_GENESIS} from '../../shared/solana-test-network.mjs';
import {base58Decode} from './solana-deposit-claim-transaction-plan.mjs';
import {assertMainnetDeploymentFields,SOLANA_MAINNET_GENESIS} from '../../shared/network-identity.mjs';

export function validateBurnContext(input) {
  check(input&&Object.keys(input).sort().join()==='attesters,deployment,environment,keyEpoch,policyEpoch','BurnContextFieldsRejected');
  const c=structuredClone(input);
  check(['localnet','devnet','mainnet'].includes(c.environment),'BurnContextEnvironmentRejected');
  validateBurnBinding({...c.deployment,destination:'01'.repeat(32),nonce:'02'.repeat(32)});
  check(Object.keys(c.deployment).length===9,'BurnContextNativeNetworkRejected');
  if(c.environment==='mainnet'){
    assertMainnetDeploymentFields({...c.deployment,managerProgramId:c.deployment.bridgeProgram,transceiverProgramId:c.deployment.transceiverProgram});
    check(c.deployment.solanaGenesis===Buffer.from(base58Decode(SOLANA_MAINNET_GENESIS)).toString('hex'),'BurnContextSolanaNetworkRejected');
  }else check(c.deployment.nativeGenesis===REGTEST_GENESIS&&c.deployment.nativeNetwork===8000111&&c.deployment.protocolId===1,'BurnContextNativeNetworkRejected');
  if(c.environment==='devnet')check(c.deployment.solanaGenesis===Buffer.from(base58Decode(DEVNET_SOLANA_GENESIS)).toString('hex'),'BurnContextSolanaNetworkRejected');
  for(const n of [c.policyEpoch,c.keyEpoch])check(Number.isInteger(n)&&n>0&&n<=0xffffffff,'BurnContextEpochRejected');
  check(Array.isArray(c.attesters)&&c.attesters.length===2&&new Set(c.attesters).size===2,'BurnContextAttestersRejected');
  c.attesters.forEach(burnHash);
  check(!c.attesters.includes(c.deployment.burnPublicKey),'BurnContextKeyRoleOverlap');
  return c;
}
export function assertBurnBindingContext(binding,context) {
  validateBurnBinding(binding);const c=validateBurnContext(context);
  check(Object.entries(c.deployment).every(([key,value])=>binding[key]===value),'BurnContextBindingMismatch');
  return c;
}
export function assertBurnMessageContext(message,context) {
  const c=assertBurnBindingContext(message.burnEvidence.binding,context);
  check(message.policyEpoch===c.policyEpoch&&message.keyEpoch===c.keyEpoch,'BurnContextEpochMismatch');
}
