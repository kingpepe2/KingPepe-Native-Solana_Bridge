// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Public operation creation binds a destination. Only independently observed
// finalized Native deposits authorize the automatic private burn controller.
import {BurnRuntime} from './burn-runtime.mjs';
import {BurnUserBalances} from './burn-user-balances.mjs';
import {base58Decode,base58Encode} from './solana-deposit-claim-transaction-plan.mjs';
import {MAX_KPEPE_SUPPLY_ATOMIC} from '../../shared/monetary-supply.mjs';
import {requireBurn as check} from '../../native/burn/burn-protocol.mjs';
export function publicBurnSupply(status) {
  const expected={localnet:['REGTEST','LOCALNET'],devnet:['REGTEST','DEVNET'],mainnet:['MAINNET','MAINNET']}[status.environment];
  check(expected&&status.nativeNetwork===expected[0]&&status.solanaNetwork===expected[1],'PublicBurnSupplyNetworkMismatch');
  if(status.reconciliation!=='MATCH'||status.accounting===null||!Number.isSafeInteger(status.accounting?.observedAt)||
    status.accounting.observedAt>Date.now()+5000||Date.now()-status.accounting.observedAt>30000)
    return {state:'UNAVAILABLE',reason:'ACCOUNTING_NOT_VERIFIED',environment:status.environment};
  const amount=status.accounting.completedAtomic;check(typeof amount==='string'&&/^(0|[1-9][0-9]*)$/u.test(amount),'PublicBurnSupplyRejected');
  const bridged=BigInt(amount);check(bridged<=MAX_KPEPE_SUPPLY_ATOMIC,'PublicBurnSupplyCapExceeded');
  for(const field of ['mintedAtomic','finalizedNativeBurnAtomic'])check(typeof status.accounting[field]==='string'&&/^(0|[1-9][0-9]*)$/u.test(status.accounting[field]),'PublicBurnSupplyRejected');
  check(bridged<=BigInt(status.accounting.mintedAtomic)&&BigInt(status.accounting.mintedAtomic)<=BigInt(status.accounting.finalizedNativeBurnAtomic)&&
    BigInt(status.accounting.finalizedNativeBurnAtomic)<=MAX_KPEPE_SUPPLY_ATOMIC,'PublicBurnConservationRejected');
  check(typeof status.accounting.liveMintSupplyAtomic==='string'&&/^(0|[1-9][0-9]*)$/u.test(status.accounting.liveMintSupplyAtomic)&&
    BigInt(status.accounting.liveMintSupplyAtomic)<=BigInt(status.accounting.mintedAtomic),'PublicBurnConservationRejected');
  return {state:'READY',source:'CANONICAL_COMPLETED_FINALIZED_NATIVE_BURN_MINT_ACCOUNTING',environment:status.environment,
    nativeNetwork:status.nativeNetwork,solanaNetwork:status.solanaNetwork,mint:base58Encode(Buffer.from(status.mintHex,'hex')),decimals:8,
    maxSupplyAtomic:MAX_KPEPE_SUPPLY_ATOMIC.toString(),bridgedSupplyAtomic:amount,remainingSupplyAtomic:(MAX_KPEPE_SUPPLY_ATOMIC-bridged).toString(),
    liveMintSupplyAtomic:status.accounting.liveMintSupplyAtomic,observedAt:status.accounting.observedAt,
    percentageBasisPoints:(bridged*10000n/MAX_KPEPE_SUPPLY_ATOMIC).toString()};
}
export class BurnUserApi {
  #runtime;#balances;
  constructor({runtime,balances}) {
    check(runtime instanceof BurnRuntime,'BurnUserRuntimeRequired');this.#runtime=runtime;
    if(balances!==undefined){check(balances instanceof BurnUserBalances,'BurnBalanceReaderRequired');balances.assertBurnContext(runtime.publicContext());this.#balances=balances;}
  }
  getBridgeStatus(){
    const s=this.#runtime.status();return {architecture:s.architecture,state:s.state==='HEALTHY'?'ACTIVE':s.state,environment:s.environment,nativeNetwork:s.nativeNetwork,
      solanaNetwork:s.solanaNetwork,walletChain:s.environment==='devnet'?'solana:devnet':'solana:localnet',mint:base58Encode(Buffer.from(s.mintHex,'hex')),
      nativeDepositConfirmations:12,nativeBurnConfirmations:12,decimals:8,symbol:'KPEPE',bridgeFeeAtomic:'0',supply:publicBurnSupply(s),
      productionReady:false,mainnetActivation:'DISABLED'};
  }
  async createOperation(input){
    check(input&&Object.keys(input).sort().join()==='clientNonce,destination,walletChain','BurnUserFieldsRejected');
    const expected=this.getBridgeStatus().walletChain;check(input.walletChain===expected,'BurnUserWrongWalletNetwork');
    check(typeof input.destination==='string'&&input.destination.length>=32&&input.destination.length<=44,'BurnUserDestinationRejected');
    const bytes=Buffer.from(base58Decode(input.destination));check(bytes.length===32&&base58Encode(bytes)===input.destination,'BurnUserDestinationRejected');
    const op=await this.#runtime.createOperation({destinationHex:bytes.toString('hex'),nonce:input.clientNonce});return publicOperation(op);
  }
  getOperationStatus(id){try{return publicOperation(this.#runtime.operation(id));}catch(error){if(error.message==='BurnJournalOperationUnknown')return null;throw error;}}
  getPublicBalance(network,address){check(this.#balances,'BurnPublicBalanceUnavailable');return this.#balances.read(network,address);}
}
function publicOperation(op){
  const {destinationHex,mintHex,...safe}=op;
  return {...safe,direction:'NativeToSolana',destination:base58Encode(Buffer.from(destinationHex,'hex')),mint:base58Encode(Buffer.from(mintHex,'hex'))};
}
