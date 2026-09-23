// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Existing DPAPI/revision/process-exclusion storage, dedicated burn state format.
import {assertWindowsProtectedStore} from '../../shared/windows/protected-store.mjs';
import {REGTEST_GENESIS} from '../../native/node/native-raw-evidence.mjs';
import {validateBurnJournalState} from './burn-journal-state.mjs';

const instances=new WeakSet();
export function requireProtectedBurnJournal(value) {
  if(!instances.has(value))throw new Error('ProtectedBurnJournalRequired');
}
export class ProtectedBurnJournal {
  #store;#lease;#closed=false;#busy=false;
  static async open(store) {
    assertWindowsProtectedStore(store,'BRIDGE_VALIDATOR','burn-operations');
    if(!['localnet','devnet'].includes(store.context.environment)||store.context.nativeGenesis!==REGTEST_GENESIS)
      throw new Error('BurnJournalTestBindingRequired');
    const instance=new ProtectedBurnJournal();instance.#store=store;
    instance.#lease=await store.acquireLease();instances.add(instance);
    try{instance.read();return instance;}catch(error){await instance.close();throw error;}
  }
  #load() {
    if(this.#closed)throw new Error('BurnJournalClosed');this.#lease.assertHeld();
    const {revision,payload}=this.#store.read();
    try {
      const text=payload.toString('utf8'),raw=JSON.parse(text);
      if(JSON.stringify(raw)!==text)throw new Error('BurnJournalNonCanonical');
      const state=validateBurnJournalState(raw),context=this.#store.context;
      if(state.deployment.nativeGenesis!==context.nativeGenesis||state.deployment.solanaDeployment!==context.solanaDeployment)
        throw new Error('BurnJournalDeploymentChanged');
      if(state.deliveryPolicy&&(state.deliveryPolicy.context.environment!==context.environment||
        state.deliveryPolicy.context.keyEpoch!==context.keyEpoch))throw new Error('BurnJournalProtectedContextChanged');
      return {revision,state};
    }finally{payload.fill(0);}
  }
  read(){return this.#load().state;}
  update(change) {
    if(this.#busy)throw new Error('BurnJournalConcurrentMutation');this.#busy=true;
    try{
      const {revision,state}=this.#load(),result=change(state);
      if(result&&typeof result.then==='function')throw new Error('BurnJournalMutationMustBeSynchronous');
      const validated=validateBurnJournalState(state),payload=Buffer.from(JSON.stringify(validated));
      try{this.#lease.assertHeld();this.#store.write(payload,revision);}finally{payload.fill(0);}
      return result;
    }finally{this.#busy=false;}
  }
  pause(reason) {
    if(!/^[A-Z0-9_]{1,96}$/u.test(reason))throw new Error('BurnPauseReasonRejected');
    this.update(state=>{state.paused=true;state.pauseReason=reason;});
  }
  async close(){this.#closed=true;await this.#lease?.close();this.#store?.close();}
}
