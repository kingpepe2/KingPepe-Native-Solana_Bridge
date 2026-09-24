// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Concrete service composition. Mainnet credentials enter only through the
// protected observer store. Private options never cross the public gateway.
import {WindowsProtectedStore} from '../../shared/windows/protected-store.mjs';
import {NativeRpcClient} from '../../native/node/native-rpc-client.mjs';
import {NativeBurnVerifier} from '../../native/burn/burn-evidence.mjs';
import {NativeBurnObserver} from '../../native/burn/burn-observer.mjs';
import {NativeBurnFeePolicy} from '../../native/burn/burn-fees.mjs';
import {ProtectedNativeBurnSigner} from '../../native/burn/protected-burn-signer.mjs';
import {ProtectedBurnAttester} from '../attesters/protected-burn-attester.mjs';
import {ProtectedBurnSolanaSigner} from '../relayer/burn-solana-signer.mjs';
import {BurnSolanaAdapter} from '../solana-observer/burn-solana-adapter.mjs';
import {ProtectedBurnJournal} from './protected-burn-journal.mjs';
import {BurnRuntime} from './burn-runtime.mjs';
import {BurnUserBalances} from './burn-user-balances.mjs';
import {BurnUserApi} from './burn-user-api.mjs';
import {validateBurnContext} from './burn-context.mjs';
import {requireBurn as check} from '../../native/burn/burn-protocol.mjs';

export async function openBurnServiceRuntime(options,onEvent=()=>{}) {
  const mainnet=options?.policy?.context?.environment==='mainnet';
  check(options&&Object.keys(options).sort().join()===(mainnet?'feePolicy,nativeRpcStore,nativeVerifierExecutable,policy,solanaEndpoint,stores':'feePolicy,nativeRpcOptions,nativeVerifierExecutable,policy,solanaEndpoint,stores'),'BurnServiceFieldsRejected');
  const {nativeRpcOptions,nativeVerifierExecutable,policy,solanaEndpoint,stores,feePolicy}=options;
  validateBurnContext(policy.context);
  check(stores&&Object.keys(stores).sort().join()==='attesterKey0,attesterKey1,attesterState0,attesterState1,burnKey,burnState,journal,payer','BurnServiceStoresRejected');
  const resources=[],remember=value=>{resources.push(value);return value;};
  const close=async()=>{
    let failure;
    // One failed close must not strand the other exclusive signing/journal
    // leases. Attempt every close, then preserve the first failure.
    while(resources.length){try{await resources.pop().close();}catch(error){failure??=error;}}
    if(failure)throw failure;
  };
  try{
    const environment=policy.context.environment;
    const nativeStore=mainnet?remember(new WindowsProtectedStore(options.nativeRpcStore)):null;
    if(mainnet){
      const c=nativeStore.context,d=policy.context.deployment;
      check(c.environment==='mainnet'&&c.nativeGenesis===d.nativeGenesis&&c.solanaDeployment===d.solanaDeployment&&
        c.serviceSid===stores.journal.context.serviceSid,'BurnServiceNativeCredentialBinding');
      check(solanaEndpoint==='ENV:SOLANA_MAINNET_RPC_URL','BurnServiceProtectedSolanaEndpointRequired');
    }
    const client=()=>mainnet?NativeRpcClient.fromProtectedMainnetCredentials(nativeStore):new NativeRpcClient(nativeRpcOptions);
    const rpc=client(),verifier=new NativeBurnVerifier({rpc,executable:nativeVerifierExecutable,environment});
    const journal=remember(await ProtectedBurnJournal.open(new WindowsProtectedStore(stores.journal)));
    const burnSigner=remember(await ProtectedNativeBurnSigner.open({keyStore:new WindowsProtectedStore(stores.burnKey),authorizationStore:new WindowsProtectedStore(stores.burnState)}));
    const attesters=[];
    for(const [index,role] of ['ATTESTER_A','ATTESTER_B'].entries())attesters.push(remember(await ProtectedBurnAttester.open({role,context:policy.context,
      keyStore:new WindowsProtectedStore(stores['attesterKey'+index]),authorizationStore:new WindowsProtectedStore(stores['attesterState'+index]),
      verifier:new NativeBurnVerifier({rpc:client(),executable:nativeVerifierExecutable,environment})})));
    const solanaSigner=remember(new ProtectedBurnSolanaSigner({store:new WindowsProtectedStore(stores.payer),context:policy.context,feePayerHex:policy.feePayerHex}));
    const solana=new BurnSolanaAdapter({policy,endpoint:solanaEndpoint});
    const runtime=new BurnRuntime({journal,observer:new NativeBurnObserver(rpc,environment),verifier,fees:new NativeBurnFeePolicy({rpc,policy:feePolicy}),
      burnSigner,attesters,solanaSigner,solana,onEvent});
    const api=new BurnUserApi({runtime,balances:new BurnUserBalances({nativeRpc:client(),solana})});
    return {runtime,journal,api,close};
  }catch(error){await close();throw error;}
}
