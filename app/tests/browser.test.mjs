// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Actual browser/HTTP UI tests with EXPLICIT UI-only wallet/status fixtures.
// Not chain, finality, signature or economic-action evidence: those run in the
// existing real local-bridge-service test, not these presentation fixtures.
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { chromium } from "playwright-core";
import { base58 } from "@scure/base";
import { BridgeUserApi } from "../../services/bridge-validator/user-api.mjs";
import { listenBridgeUserApi } from "../../services/bridge-validator/user-http.mjs";
import { createNativeDepositRequest } from "../../solana/ts/sdk/bridge.mjs";
import { REGTEST_GENESIS } from "../../native/node/native-raw-evidence.mjs";

import { validateRuntimeFile, validateRuntimeStateRoot } from "../../shared/runtime-path-boundary.mjs";

const repo = path.resolve(import.meta.dirname, "../.."), h = n => n.toString(16).padStart(2, "0").repeat(32), key = n => base58.encode(Buffer.from(h(n), "hex"));
const generator = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", second = "c6047f9441ed7d6d3045406e95c07cd85a961ae58cd9ee37abac09b95c709ee5";
const policy = { environment: "localnet", nativeGenesis: REGTEST_GENESIS, solanaDeployment: h(2), solanaGenesis: key(3), minimumSolanaSlot: "0",
  managerProgramId: h(4), transceiverProgramId: h(5), mint: h(6), protocolId: 1, nativeNetwork: 8000111, policyEpoch: 1, keyEpoch: 1,
  frostPublicKeyHex: generator, csvDelayBlocks: 12, minimumConfirmations: 6, maximumAmountAtomic: "100000000", maximumFeeAtomic: "10000" };
let browser, browserTemp;
before(async () => {
  browserTemp = mkdtempSync(path.join(os.tmpdir(), "kingpepe-ui-"));
  validateRuntimeStateRoot(browserTemp, repo);
  const channel = process.env.KINGPEPE_UI_BROWSER_CHANNEL ?? "chrome";
  assert(["chrome", "msedge", "chromium"].includes(channel));
  browser = await chromium.launch({ channel, headless: true, chromiumSandbox: true,
    env: { ...process.env, TEMP: browserTemp, TMP: browserTemp, TMPDIR: browserTemp } });
});
after(async () => {
  await browser?.close();
  // Only this run's newly created browser scratch directory, after shutdown.
  if (browserTemp && path.dirname(browserTemp) === path.resolve(os.tmpdir())) rmSync(validateRuntimeStateRoot(browserTemp, repo), { recursive: true });
});

async function fixture(t, { wallet = false } = {}) {
  const state = { bridge: "ACTIVE", operation: null, requests: [], notifications: [] }, api = Object.create(BridgeUserApi.prototype);
  Object.assign(api, {
    getBridgeStatus: () => ({ state: state.bridge, trust: "UI_FIXTURE_ONLY", environment: "localnet", productionReady: false, mainnetActivation: "DISABLED" }),
    getPublicBalance: (network, address) => network === "solana" ? {
      address, chain: "solana:localnet", decimals: 8, solLamports: "1000000001", kpepeAtomic: "25000000",
      tokenAccounts: [{ address: key(8), amountAtomic: "25000000" }],
    } : { address, nativeNetwork: "REGTEST", balanceAtomic: "125000000", decimals: 8 },
    getOperationStatus: id => state.operation?.operationId === id ? state.operation : null,
    createNativeDepositRequest: input => { state.requests.push(input); return createNativeDepositRequest({ policy, ...input }); },
    submitNativeDeposit: input => { state.notifications.push(input); const q = createNativeDepositRequest({ policy, ...input.request });
      return state.operation = { operationId: q.operationId, direction: "NativeToSolana", state: "OBSERVED", amountAtomic: q.amountAtomic,
        destination: q.recipient, trust: "UI_FIXTURE_ONLY", transactionIds: { nativeDeposit: input.depositTxidHex } }; },
  });
  const accessToken = randomBytes(32), server = await listenBridgeUserApi({ api, accessToken });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1000 } });
  t.after(async () => { await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); accessToken.fill(0); });
  if (wallet) await context.addInitScript(({ address }) => {
    // Recipient-only Wallet Standard fixture: no key or signing feature.
    const account = { address, publicKey: new Uint8Array(32).fill(7), chains: ["solana:localnet"], features: [] };
    let listener;
    const wallet = { version: "1.0.0", name: "UI fixture wallet (no key)", icon: "", chains: ["solana:localnet"], accounts: [account], features: {
      "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: wallet.accounts }) },
      "standard:events": { version: "1.0.0", on: (_event, handler) => { listener = handler; return () => { listener = undefined; }; } },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => {} },
    } };
    window.uiFixtureDisconnect = () => { wallet.accounts = []; listener?.({ accounts: [] }); };
    window.addEventListener("wallet-standard:app-ready", ({ detail }) => detail.register(wallet));
  }, { address: key(7) });
  const page = await context.newPage(), errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  async function connect() { await page.getByLabel("Local user-access code").fill(accessToken.toString("hex")); await page.getByRole("button", { name: "Connect", exact: true }).click(); await page.locator("#bridge-state").filter({ hasText: "ACTIVE" }).waitFor(); }
  async function screenshot(name) {
    if (!process.env.KINGPEPE_UI_EVIDENCE_ROOT) return;
    const root = validateRuntimeStateRoot(process.env.KINGPEPE_UI_EVIDENCE_ROOT, repo);
    mkdirSync(root, { recursive: true });
    const file = validateRuntimeFile(path.join(root, name + ".png"), repo);
    await page.screenshot({ path: file, fullPage: true });
  }
  return { page, state, errors, connect, screenshot, endpoint: `http://127.0.0.1:${server.address().port}/` };
}
test("browser Native request/notification/status, public assets and mobile layout", async t => {
  const f = await fixture(t), p = f.page;
  assert.equal(await p.locator("#amount").isDisabled(), true);
  assert.equal((await fetch(f.endpoint + "bridge/status")).status, 403);
  assert.equal((await fetch(f.endpoint + "license")).status, 200);
  assert.equal((await fetch(f.endpoint + "licenses/wallet-standard")).status, 200);
  assert.equal((await fetch(f.endpoint + "../package.json")).status, 403);
  assert((await fetch(f.endpoint)).headers.get("content-security-policy").includes("frame-ancestors 'none'"));
  await f.connect(); assert.equal(await p.locator("#access-code").inputValue(), "");
  await p.locator("#amount").fill("0.25"); await p.getByLabel("Recipient KPEPE token account on Solana").fill(key(7));
  await p.getByLabel("Native recovery public key", { exact: true }).fill(second);
  await p.getByRole("button", { name: "Create Bridge Deposit", exact: true }).click(); await p.locator("#review").waitFor({ state: "visible" });
  assert.equal(f.state.requests[0].amountAtomic, "25000000"); assert((await p.locator("#review-details").textContent()).includes("0.25000000"));
  assert.equal(await p.locator("#amount").isDisabled(), true);
  const download = p.waitForEvent("download"); await p.getByRole("button", { name: "Save public request" }).click();
  assert((await download).suggestedFilename().startsWith("kingpepe-request-"));
  await p.getByLabel("Native deposit transaction ID").fill(h(23)); await p.getByRole("button", { name: "Notify bridge" }).click();
  await p.locator("#operation-state").filter({ hasText: "OBSERVED" }).waitFor(); assert.equal(f.state.notifications.length, 1);
  f.state.operation.state = "COMPLETED"; await p.getByRole("button", { name: "Track", exact: true }).click();
  await p.locator("#operation-state").filter({ hasText: "COMPLETED" }).waitFor();
  assert((await p.locator("#operation-details").textContent()).includes(h(23)));
  assert.deepEqual(await p.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })), { local: 0, session: 0 });
  await f.screenshot("native-request-desktop"); await p.setViewportSize({ width: 390, height: 844 });
  assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await f.screenshot("native-request-mobile");
  await p.getByRole("button", { name: "Create another transfer", exact: true }).click();
  assert.equal(await p.locator("#amount").isDisabled(), false); assert.equal(await p.locator("#review").isHidden(), true);
  assert.equal(f.state.notifications.length, 1);
  assert.deepEqual(f.errors, []);
});
test("browser connects a recipient wallet without transaction-signing support", async t => {
  const f = await fixture(t, { wallet: true }), p = f.page; await f.connect();
  await p.getByRole("button", { name: "Connect Solana Wallet", exact: true }).click();
  await p.locator("#wallet-state").filter({ hasText: key(7) }).waitFor();
  await p.locator("#solana-balance").filter({ hasText: "0.25000000" }).waitFor();
  assert.equal(await p.locator("#recipient").inputValue(), key(8));
  assert.equal(await p.locator("#wallet-sign").count(), 0);
  assert.equal(f.state.requests.length, 0); assert.equal(f.state.notifications.length, 0);
  await p.getByRole("button", { name: "Disconnect wallet", exact: true }).click();
  await p.locator("#wallet-state").filter({ hasText: "disconnected" }).waitFor();
  await p.getByRole("button", { name: "Connect Solana Wallet", exact: true }).click();
  await p.locator("#wallet-state").filter({ hasText: key(7) }).waitFor();
  await p.evaluate(() => window.uiFixtureDisconnect());
  await p.locator("#wallet-state").filter({ hasText: "disconnected" }).waitFor();
  assert.equal(f.state.requests.length, 0); assert.deepEqual(f.errors, []);
});

test("browser rejects invalid amount and works without collecting any wallet secret", async t => {
  const f = await fixture(t), p = f.page; await f.connect();
  await p.locator("#amount").fill("0.000000001"); await p.locator("#recipient").fill(key(7)); await p.locator("#recovery-public-key").fill(second);
  await p.getByRole("button", { name: "Create Bridge Deposit", exact: true }).click(); await p.locator("#notice").filter({ hasText: "eight decimal" }).waitFor();
  assert.equal(f.state.requests.length, 0);
  assert.equal(await p.locator("#wallet-connect").isDisabled(), true);
  assert.equal(await p.locator("#withdrawal-fields, #wallet-sign, #native-to-solana, #solana-to-native").count(), 0);
  const passwordFields = await p.locator('input[type="password"]').count(); assert.equal(passwordFields, 1); // Local API token only.
  assert.deepEqual(await p.locator('input[type="password"]').getAttribute("id"), "access-code");
  assert.deepEqual(f.errors, []);
});
