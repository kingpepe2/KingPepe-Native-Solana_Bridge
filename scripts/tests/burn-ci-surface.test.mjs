// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const read=name=>readFileSync(path.join(root,name),'utf8');

test('retired reserve/FROST and reverse entrypoints cannot silently return to the active package',()=>{
  for(const file of ['native/frost/index.mjs','native/reserve/Cargo.toml','native/recovery/Cargo.toml',
    'services/relayer/deposit-service.mjs','services/bridge-validator/user-api.mjs','shared/protocol/bridge-inputs.mjs'])
    assert.equal(existsSync(path.join(root,file)),false,file);
  const pkg=JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['burn:service'],'node services/bridge-validator/burn-service.mjs');
  assert(!Object.keys(pkg.scripts).some(name=>/withdraw|payout|frost|round-trip/.test(name)));
  const sdk=read('solana/ts/sdk/bridge.mjs')+read('solana/ts/sdk/client.mjs')+read('cli/bridge.mjs');
  assert(!/solanaToNative|createWithdrawal|submitWithdrawal|bridge withdraw|NativePayout/.test(sdk));
  const walk=dir=>readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(dir+'/'+e.name):[dir+'/'+e.name]);
  for(const file of ['native/burn','services','shared','solana/ts/sdk'].flatMap(walk).filter(f=>f.endsWith('.mjs')&&!f.includes('/tests/'))){
    const imports=[...read(file).matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)].map(m=>m[1]);
    assert(!imports.some(name=>/native\/(?:frost|reserve|recovery)|withdrawal|payout/.test(name)),file);
  }
});

test('required CI keeps real burn/reindex/mint/replay and protected Windows coverage on the current source',()=>{
  const ci=read('.github/workflows/ci.yml');
  assert.deepEqual([...ci.slice(ci.indexOf('\njobs:')).matchAll(/^  ([a-z][a-z0-9-]+):$/gm)].map(m=>m[1]),
    ['source-history-scan','linux-sbf','foundation-guardrails','foundation-windows-check']);
  assert(!/^\s*if:|continue-on-error:\s*true|--ignore\s+RUSTSEC|--skip/mi.test(ci));
  for(const command of ['npm run local:proof:burn','npm run local:e2e:native-to-solana','npm run test:windows-security',
    'npm audit --audit-level=low','node scripts/source-audit.mjs','node .github/scripts/dependency-license-audit.mjs',
    'cargo clippy --locked','--log-opts=--all','r.sourceSha!==process.env.GITHUB_SHA','r.exactSource!==true',
    'CLAIM_REPLAY_REJECTED_NO_SECOND_MINT','CRITICAL_ACCOUNTING_MISMATCH_PAUSES'])assert(ci.includes(command),command);
  assert(read('scripts/regtest-burn-proof.mjs').includes('FULL_REINDEX_PRESERVES_EXACT_BURN_AND_UTXO_EXCLUSION'));
  const readiness=JSON.parse(read('BRIDGE-READINESS.json'));
  assert.equal(readiness.productionReady,false);assert.equal(readiness.mainnetActivation,'DISABLED');
});
