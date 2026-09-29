// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Forward public transport only. Economic decisions stay in the existing Bridge.
import { applyCommonHeaders, clientIP, sendJson } from './security.js';
import { validateSupply, createAccountingDisplay } from '../web/bridge-supply.js';
import { assertPublicNetwork } from '../web/bridge-network.js';

export const BRIDGE_PREFIX = '/api/v1/bridge';
const ID = /^[0-9a-f]{64}$/u;
const STATES = {
  NativeToSolana: ['DEPOSIT_ADDRESS_ISSUED', 'DEPOSIT_OBSERVED', 'DEPOSIT_FINALIZED', 'BURN_READY', 'BURN_BROADCAST', 'BURN_FINALIZED', 'ATTESTED', 'CLAIMED', 'MINTED', 'COMPLETED'],
};
const check = value => { if (!value) throw new Error('Rejected'); };
const fields = (value, expected) => check(value && !Array.isArray(value) &&
  Object.keys(value).sort().join() === expected.split(',').sort().join());
const id = value => { check(typeof value === 'string' && ID.test(value)); return value; };
const atomic = (value, zero = false) => {
  check(typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/u.test(value));
  check(BigInt(value) <= 0xffffffffffffffffn && (zero || BigInt(value) > 0n)); return value;
};

function publicStatus(value, validators) {
  const n = validators.network;
  check(n && value?.environment === n.environment && value.nativeNetwork === n.kingpepeNetwork && value.solanaNetwork === n.solanaNetwork &&
    value.architecture === 'ONE_WAY_AUTOMATIC_BURN_AND_MINT' && value.walletChain === n.walletChain &&
    value.nativeDepositConfirmations === 12 && value.nativeBurnConfirmations === 12 && value.bridgeFeeAtomic === '0' && ['ACTIVE','PAUSED','PENDING','STARTING','CONTROLLED'].includes(value.state));
  validators.publicKey(validators.mint);
  check(value.mint === validators.mint);
  const result = { architecture: value.architecture, state: value.state === 'ACTIVE' ? 'ACTIVE' : 'PAUSED', kingpepeNetwork: n.kingpepeNetwork, solanaNetwork: n.solanaNetwork,
    walletChain: n.walletChain, productionReady: value.productionReady, mainnetActivation: value.mainnetActivation,
    decimals: value.decimals, symbol: value.symbol, mint: validators.mint, bridgeFeeAtomic: '0', nativeDepositConfirmations: 12, nativeBurnConfirmations: 12 };
  assertPublicNetwork(result);
  check(n.test || value.state !== 'ACTIVE' || n.activationAllowed === true);
  // Current Core standard P2TR dust minimum: (43 + 67) bytes at 3000 atomic/kB.
  // Informational only; the runtime determines the exact received amount.
  const checkedSupply = validateSupply(value.supply, result);
  // Display classification only. The runtime's state/activation/admission remain
  // authoritative. Never publish private verification reasons or cache status.
  const failed = [value, value.supply].some(v => v &&
    (v.reconciliation != null && v.reconciliation !== 'MATCH' ||
     v.burnMintConservation != null && v.burnMintConservation !== 'PASS'));
  const verified = !failed && value.state === 'ACTIVE' && checkedSupply.state === 'READY';
  const verifying = !failed && ['PENDING', 'CONTROLLED'].includes(value.state) &&
    value.supply?.state === 'UNAVAILABLE' && value.supply.reason === 'ACCOUNTING_NOT_VERIFIED' && value.supply.environment === n.environment;
  // The runtime enforces the minimum and is its only source. The dust floor
  // is shown solely for a runtime that predates a published minimum.
  const minimumDepositAtomic = value.minimumDepositAtomic === undefined ? '330' : atomic(value.minimumDepositAtomic);
  // Production runs on the Bridge reserve. A runtime reporting any other
  // funding model is not served.
  check(value.executionPolicy === undefined || value.executionPolicy === 'LEGACY_OPERATOR_FUNDED');
  // One transfer at a time. Only whether the Bridge is busy is public.
  const slot = {};
  if(value.executionSlot !== undefined) {
    check(['BRIDGE_BUSY','AVAILABLE'].includes(value.executionSlot) && value.maxConcurrentExecutingOperations === 1);
    Object.assign(slot, { executionSlot: value.executionSlot, maxConcurrentExecutingOperations: 1 });
  }
  return { ...result, depositAmountModel: 'EXACT_RECEIVED', minimumDepositAtomic, ...slot,
    accountingRefreshState: verified ? 'VERIFIED' : verifying ? 'VERIFYING' : 'UNAVAILABLE',
    supply: verified ? checkedSupply : { state: 'UNAVAILABLE' } };
}

function publicOperation(value, validators, expectedId) {
  if (value === null) return null;
  check(value && Object.hasOwn(STATES, value.direction) && STATES[value.direction].includes(value.state));
  check(id(value.operationId) === expectedId); if(value.amountAtomic !== null) atomic(value.amountAtomic);
  validators.publicKey(value.destination);
  validators.nativeAddress(value.depositAddress); check(value.mint === validators.mint);
  for(const key of ['depositTxid','burnTxid']) if(value[key] !== null) id(value[key]);
  if(value.solanaSignature !== null) validators.signature(value.solanaSignature);
  for(const key of ['depositConfirmations','burnConfirmations']) check(value[key] === null || Number.isSafeInteger(value[key]) && value[key] >= 0);
  check(value.requiredDepositConfirmations === 12 && value.requiredBurnConfirmations === 12 && typeof value.retired === 'boolean');
  if(value.burnAmountAtomic !== null) check(atomic(value.burnAmountAtomic) === value.amountAtomic);
  const exceptions = ['LATE_DEPOSIT_TO_RETIRED_ADDRESS','MULTIPLE_DEPOSITS_REQUIRE_REVIEW','STRAY_DEPOSIT_AFTER_BURN','ACCEPTED_DEPOSIT_BASIS_CHANGED'];
  check(value.exception === null || exceptions.includes(value.exception));
  check(value.executionFunding === undefined);
  // Published by the runtime: a deposit below the minimum is held unburned.
  const minimum = {};
  if(value.minimumDepositAtomic !== undefined) {
    const floor = BigInt(atomic(value.minimumDepositAtomic)), remaining = BigInt(atomic(value.remainingDepositAtomic, true));
    check(typeof value.depositBelowMinimum === 'boolean');
    if(value.depositBelowMinimum) check(value.amountAtomic !== null && value.burnTxid === null && value.burnAmountAtomic === null &&
      value.solanaSignature === null && remaining > 0n && BigInt(value.amountAtomic) + remaining === floor);
    else check(remaining === 0n);
    Object.assign(minimum, { minimumDepositAtomic: value.minimumDepositAtomic, depositBelowMinimum: value.depositBelowMinimum, remainingDepositAtomic: value.remainingDepositAtomic });
  }
  if(value.executionSlot !== undefined) {
    check(['OWNED','WAITING_FOR_EXECUTION_SLOT','NOT_REQUESTED'].includes(value.executionSlot));
    // Waiting means exactly that: nothing of this operation has been burned.
    if(value.executionSlot === 'WAITING_FOR_EXECUTION_SLOT') check(value.burnTxid === null && value.solanaSignature === null && value.depositBelowMinimum !== true);
    minimum.executionSlot = value.executionSlot;
  }
  return { operationId: value.operationId, direction: value.direction, state: value.state, ...minimum,
    amountAtomic: value.amountAtomic, destination: value.destination, depositAddress: value.depositAddress, mint: validators.mint,
    depositTxid: value.depositTxid, burnTxid: value.burnTxid, burnAmountAtomic: value.burnAmountAtomic, solanaSignature: value.solanaSignature,
    depositConfirmations: value.depositConfirmations, burnConfirmations: value.burnConfirmations,
    requiredDepositConfirmations: 12, requiredBurnConfirmations: 12, exception: value.exception, retired: value.retired };
}

function publicBalance(value, validators, network, address) {
  check(value?.address === address);
  if (network === 'native') {
    check(value.network === validators.network.kingpepeNetwork && value.decimals === 8 && value.kind === 'CONFIRMED_UTXO');
    return { address, network: validators.network.kingpepeNetwork, decimals: 8, amountAtomic: atomic(value.amountAtomic, true), kind: 'CONFIRMED_UTXO' };
  }
  check(value.chain === validators.network.walletChain && value.mint === validators.mint && value.decimals === 8 && value.commitment === 'finalized');
  check(Array.isArray(value.tokenAccounts) && value.tokenAccounts.length <= 16);
  let total = 0n;
  const tokenAccounts = value.tokenAccounts.map(a => {
    validators.publicKey(a.address); atomic(a.amountAtomic, true); total += BigInt(a.amountAtomic);
    return { address: a.address, amountAtomic: a.amountAtomic };
  });
  check(new Set(tokenAccounts.map(a => a.address)).size === tokenAccounts.length && total.toString() === atomic(value.kpepeAtomic, true));
  return { address, chain: validators.network.walletChain, mint: validators.mint, decimals: 8, solLamports: atomic(value.solLamports, true),
    kpepeAtomic: value.kpepeAtomic, tokenAccounts, commitment: 'finalized' };
}

function operationInput(value, validators) {
  fields(value, 'clientNonce,destination,walletChain');
  validators.publicKey(value.destination); id(value.clientNonce);
  check(value.clientNonce !== '0'.repeat(64) && value.walletChain === validators.network.walletChain);
  return value;
}

async function readBody(req, timeoutMs) {
  check(/^application\/json(?:;\s*charset=utf-8)?$/iu.test(req.headers['content-type'] ?? ''));
  check(!req.headers['content-encoding']);
  if (req.headers['content-length']) check(/^\d{1,5}$/u.test(req.headers['content-length']) && Number(req.headers['content-length']) <= 4096);
  const timer = setTimeout(() => req.destroy(), timeoutMs);
  try {
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; check(size <= 4096); chunks.push(chunk); }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } finally { clearTimeout(timer); }
}

export function createBridgeGateway({ backend = async () => null, approvedOrigin = 'https://kingpepe.net',
  timeoutMs = 10000, mutationTimeoutMs = 32000, now = Date.now, mutationLimit = 8, readLimit = 90 } = {}) {
  // A new deposit address waits for the runtime, which creates it between two
  // accounting cycles. Bounded, a little above the client's own 30 seconds so
  // that the client's answer, not this limit, is what the caller receives.
  check(Number.isSafeInteger(mutationTimeoutMs) && mutationTimeoutMs >= timeoutMs && mutationTimeoutMs <= 60000);
  const origin = new URL(approvedOrigin);
  check(origin.origin === approvedOrigin && !origin.username && !origin.password &&
    (origin.protocol === 'https:' || origin.protocol === 'http:' && origin.hostname === '127.0.0.1'));
  const buckets = new Map(); let active = 0, creating = 0;
  // Shared, bounded display memory for a page opened during a refresh hold.
  // Never use it for operation admission, balances, or the runtime ACTIVE state.
  const accountingDisplay = createAccountingDisplay({now});
  function limited(req) {
    const time = now(), ip = clientIP(req);
    for (const [key, bucket] of buckets) if (time - bucket.start >= 60000) buckets.delete(key);
    const key = ip + ':' + (req.method === 'POST' ? 'write' : 'read');
    let bucket = buckets.get(key);
    if (!bucket) { if (buckets.size >= 4096) return true; bucket = { start: time, count: 0 }; buckets.set(key, bucket); }
    return ++bucket.count > (req.method === 'POST' ? mutationLimit : readLimit);
  }
  return async (req, res, url) => {
    applyCommonHeaders(req, res);
    res.removeHeader('Access-Control-Allow-Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    const reply = (code, value) => { if (!res.destroyed && !res.writableEnded) sendJson(res, code, value); };
    const failure = (code, message) => reply(code, { error: true, message });
    if (req.headers.origin === approvedOrigin) { res.setHeader('Access-Control-Allow-Origin', approvedOrigin); res.setHeader('Vary', 'Origin'); }
    if (req.headers.origin && req.headers.origin !== approvedOrigin ||
        ['POST', 'OPTIONS'].includes(req.method) && (req.headers.origin !== approvedOrigin || req.headers['sec-fetch-site'] === 'cross-site'))
      return failure(403, 'Origin not allowed.');
    if (limited(req)) { res.setHeader('Retry-After', '60'); return failure(429, 'Please wait before trying again.'); }
    const route = url.pathname.slice(BRIDGE_PREFIX.length);
    const operation = /^\/operations\/([0-9a-f]{64})$/u.exec(route);
    const balance = /^\/balances\/(solana|native)\/([a-zA-Z0-9]{32,90})$/u.exec(route);
    const mutation = route === '/operations';
    if (url.search || !(route === '/status' || operation || mutation || balance)) return failure(404, 'Not found.');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method !== (mutation ? 'POST' : 'GET')) return failure(405, 'Method not allowed.');
    if (active >= 4) return failure(429, 'Bridge is busy. Please wait.');
    // The Bridge admits one transfer at a time. Requests waiting for an address
    // never take the slots that status and tracking need.
    if (mutation && creating >= 2) { res.setHeader('Retry-After', '10'); return failure(429, 'Bridge is busy. Please wait.'); }
    active++; if (mutation) creating++;
    const accountingRequest = route === '/status' ? accountingDisplay.begin() : null;
    let timer, task;
    try {
      const input = mutation ? await readBody(req, Math.min(timeoutMs, 5000)) : undefined;
      const connection = await backend();
      if (!connection) { if(accountingRequest)accountingDisplay.failure(accountingRequest);return failure(503, 'Bridge temporarily unavailable.'); }
      if (connection.activationPending === true) {
        if(accountingRequest)accountingDisplay.failure(accountingRequest);
        // Block every operation/address/balance path, including old saved TEST
        // operations. This backend has no signing or operation capability.
        if (route !== '/status') return reply(503, { error: true, code: 'ACTIVATION_PENDING',
          message: 'Bridge activation pending. No deposits are being accepted yet.' });
        return reply(200, await connection.getPublicStatus());
      }
      const { client, validators } = connection;
      if (balance) (balance[1] === 'solana' ? validators.publicKey : validators.nativeAddress)(balance[2]);
      if (mutation) operationInput(input, validators);
      // Recheck the authenticated deployment for EVERY request, including mutations.
      // Never infer network admission from a browser field or cached ACTIVE badge.
      const work = async () => {
        const status = publicStatus(await client.getBridgeStatus(), validators);
        if (route === '/status') {
          const display = accountingDisplay.receive(accountingRequest,status,status);
          return status.accountingRefreshState === 'VERIFYING' && display.state === 'STALE' ?
            {...status,lastVerifiedSupply:display.supply} : status;
        }
        if (operation) return publicOperation(await client.getOperationStatus(operation[1]), validators, operation[1]);
        if (balance) {
          const address = balance[1] === 'native' ? balance[2].toLowerCase() : balance[2];
          return publicBalance(await client[balance[1] === 'solana' ? 'getSolanaBalance' : 'getNativeBalance'](address), validators, balance[1], address);
        }
        if (status.state !== 'ACTIVE') { const error = new Error('Paused'); error.paused = true; throw error; }
        // Recover an already persisted request through the read path. A retry
        // need not wait behind the private controller's current economic cycle.
        // Derive the identity server-side; never accept a browser operation ID.
        const existing = await client.getOperationStatus(validators.operationId(input));
        // While another transfer is being processed nobody new is given a
        // deposit address. The runtime decides; this only names the reason.
        const busy = () => { const error = new Error('Busy'); error.busy = true; return error; };
        if (!existing && status.executionSlot === 'BRIDGE_BUSY') throw busy();
        let created = existing;
        if (!created) try { created = await client.createOperation(input); } catch (error) {
          // Two requests can pass the check above together; the runtime admits one.
          if (publicStatus(await client.getBridgeStatus(), validators).executionSlot === 'BRIDGE_BUSY') throw busy();
          throw error;
        }
        validators.operationBinding(created, input);
        return publicOperation(created, validators, created.operationId);
      };
      task = work();
      const result = await Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Unavailable')), mutation ? mutationTimeoutMs : timeoutMs); })]);
      reply(result === null ? 404 : 200, result ?? { error: true, message: 'Operation not yet observed.' });
    } catch (error) {
      if(accountingRequest)accountingDisplay.failure(accountingRequest);
      if (error.busy) return reply(409, { error: true, code: 'BRIDGE_BUSY',
        message: 'Another bridge transfer is currently being processed. Please wait until the Bridge becomes available.' });
      failure(error.paused ? 409 : 400, error.paused ? 'Bridge paused. Operation tracking remains available.' :
        'Request rejected or service unavailable. Check the operation before retrying.');
    } finally {
      clearTimeout(timer);
      // A timed-out upstream mutation remains in flight; keep its slot occupied.
      const release = () => { active--; if (mutation) creating--; };
      if (task) void task.finally(release).catch(() => {}); else release();
    }
  };
}
