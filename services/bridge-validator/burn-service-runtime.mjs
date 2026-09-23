// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Concrete TEST service composition. Private local options never cross the
// public gateway; there is no injectable signer or Mainnet admission path.
import {WindowsProtectedStore} from '../../shared/windows/protected-store.mjs';
import {NativeRpcClient} from '../../native/node/native-rpc-client.mjs';
import {RegtestNativeBurnVerifier} from '../../native/burn/burn-evidence.mjs';
import {RegtestBurnObserver} from '../../native/burn/burn-observer.mjs';
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
  check(options&&Object.keys(options).sort().join()==='feePolicy,nativeRpcOptions,nativeVerifierExecutable,policy,solanaEndpoint,stores','BurnServiceFieldsRejected');
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
    const rpc=new NativeRpcClient(nativeRpcOptions),verifier=new RegtestNativeBurnVerifier({rpc,executable:nativeVerifierExecutable});
    const journal=remember(await ProtectedBurnJournal.open(new WindowsProtectedStore(stores.journal)));
    const burnSigner=remember(await ProtectedNativeBurnSigner.open({keyStore:new WindowsProtectedStore(stores.burnKey),authorizationStore:new WindowsProtectedStore(stores.burnState)}));
    const attesters=[];
    for(const [index,role] of ['ATTESTER_A','ATTESTER_B'].entries())attesters.push(remember(await ProtectedBurnAttester.open({role,context:policy.context,
      keyStore:new WindowsProtectedStore(stores['attesterKey'+index]),authorizationStore:new WindowsProtectedStore(stores['attesterState'+index]),
      verifier:new RegtestNativeBurnVerifier({rpc:new NativeRpcClient(nativeRpcOptions),executable:nativeVerifierExecutable})})));
    const solanaSigner=remember(new ProtectedBurnSolanaSigner({store:new WindowsProtectedStore(stores.payer),context:policy.context,feePayerHex:policy.feePayerHex}));
    const solana=new BurnSolanaAdapter({policy,endpoint:solanaEndpoint});
    const runtime=new BurnRuntime({journal,observer:new RegtestBurnObserver(rpc),verifier,fees:new NativeBurnFeePolicy({rpc,policy:feePolicy}),
      burnSigner,attesters,solanaSigner,solana,onEvent});
    const api=new BurnUserApi({runtime,balances:new BurnUserBalances({nativeRpc:new NativeRpcClient(nativeRpcOptions),solana})});
    return {runtime,journal,api,close};
  }catch(error){await close();throw error;}
}
