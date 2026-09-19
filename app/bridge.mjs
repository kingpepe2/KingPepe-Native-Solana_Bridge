// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { createBridgeClient } from "/sdk/client.mjs";
import { getWallets } from "/vendor/wallet-standard/wallets.js";
import { base58 } from "/vendor/scure-base.js";
import { toAtomic, fromAtomic, checkQuote } from "/app/model.mjs";

const $ = id => document.getElementById(id), registry = getWallets();
const chain = "solana:localnet";
let client, bridgeState = "NOT CONNECTED", prepared, original, wallet, account;
let busy = false, polling = false, preparedCompleted = false, tracking = "", walletChoices = [];
const notice = (text, error = false) => { $("notice").textContent = text; $("notice").className = error ? "error" : ""; };
function detail(list, values) {
  list.replaceChildren();
  for (const [label, value] of Object.entries(values)) if (value !== null && value !== undefined) {
    const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = label; dd.textContent = String(value); list.append(dt, dd);
  }
}
function controls() {
  const active = client && bridgeState === "ACTIVE";
  $("request-fields").disabled = !active || busy || Boolean(prepared);
  $("notify").disabled = !active || busy;
  $("disconnect").disabled = !client || busy;
  $("new-request").hidden = !prepared;
  $("new-request").disabled = !active || busy || !preparedCompleted;
  $("bridge-state").textContent = bridgeState;
  $("bridge-state").className = "badge" + (bridgeState === "ACTIVE" ? "" : " neutral");
}
async function action(fn) {
  if (busy) return; busy = true; controls(); notice("");
  try { await fn(); }
  catch (error) { notice(["AMOUNT_FORMAT", "AMOUNT_RANGE"].includes(error.message) ? "Enter an exact positive KPEPE amount with at most eight decimal places." :
    "Request unavailable or rejected. Check the fields, bridge status and previous transaction before retrying.", true); }
  finally { busy = false; controls(); }
}
async function status() {
  const connected = client; if (!connected) return;
  try {
    const result = await connected.getBridgeStatus(); if (client !== connected) return;
    if (result.environment !== "localnet" || result.productionReady !== false || result.mainnetActivation !== "DISABLED") throw new Error("UnexpectedDeployment");
    bridgeState = ["ACTIVE", "PAUSED"].includes(result.state) ? result.state : "UNAVAILABLE";
  } catch { if (client !== connected) return; bridgeState = "UNAVAILABLE"; }
  controls();
}
$("connect-form").onsubmit = event => { event.preventDefault(); void action(async () => {
  const next = createBridgeClient({ endpoint: location.origin + "/", accessToken: $("access-code").value });
  $("access-code").value = ""; client = next; await status();
  if (bridgeState === "UNAVAILABLE") { client = undefined; throw new Error("ServiceUnavailable"); }
  $("connection").open = false; notice(bridgeState === "ACTIVE" ? "Connected to the local test bridge." : "Bridge paused. Read-only status remains available.");
}); };
$("disconnect").onclick = () => { client = undefined; bridgeState = "NOT CONNECTED"; $("connection").open = true; controls(); };
let unsubscribeWallet;
function clearWallet() {
  unsubscribeWallet?.(); unsubscribeWallet = undefined; wallet = account = undefined;
  $("wallet-state").textContent = "Wallet disconnected"; $("solana-balance").textContent = "";
  $("wallet-disconnect").disabled = true;
}
function walletsChanged() {
  walletChoices = registry.get().filter(w => Array.isArray(w.chains) && w.chains.includes(chain) && w.features?.["standard:connect"] && w.features?.["standard:events"]);
  $("wallets").replaceChildren(...walletChoices.map((w, i) => { const option = document.createElement("option"); option.value = String(i); option.textContent = w.name; return option; }));
  if (!walletChoices.length) { const option = document.createElement("option"); option.textContent = "No compatible Solana wallet detected"; $("wallets").append(option); }
  $("wallet-connect").disabled = !walletChoices.length;
  if (wallet && !walletChoices.includes(wallet)) clearWallet();
}
async function recipientBalance() {
  const current = account, connected = client;
  if (!current || !connected) return;
  const b = await connected.getSolanaBalance(current.address);
  if (account !== current || client !== connected) return;
  if (b.address !== current.address || b.chain !== chain || b.decimals !== 8) throw new Error("WrongWalletNetwork");
  const lamports = BigInt(b.solLamports);
  $("solana-balance").textContent = `SOL: ${lamports / 1000000000n}.${(lamports % 1000000000n).toString().padStart(9, "0")} · KPEPE: ${fromAtomic(b.kpepeAtomic)}`;
  if (!prepared && b.tokenAccounts.length === 1) $("recipient").value = b.tokenAccounts[0].address;
}
function selectAccount(accounts) {
  const candidate = accounts.find(a => a.chains?.includes(chain));
  if (!candidate || !(candidate.publicKey instanceof Uint8Array) || candidate.publicKey.length !== 32 || base58.encode(candidate.publicKey) !== candidate.address) {
    clearWallet(); throw new Error("WrongWalletNetwork");
  }
  account = candidate; $("wallet-state").textContent = `Connected: ${account.address}`;
  $("wallet-disconnect").disabled = false;
}
registry.on("register", walletsChanged); registry.on("unregister", walletsChanged); walletsChanged();
$("wallet-connect").onclick = () => void action(async () => {
  const selected = walletChoices[Number($("wallets").value)]; if (!selected) throw new Error("WalletUnavailable");
  const result = await selected.features["standard:connect"].connect();
  clearWallet(); wallet = selected; selectAccount(result.accounts);
  unsubscribeWallet = selected.features["standard:events"].on("change", () => {
    try { selectAccount(selected.accounts); void recipientBalance().catch(() => { $("solana-balance").textContent = "Balance unavailable"; }); }
    catch { notice("Wrong Solana network or locked wallet. Connect a compatible recipient session.", true); }
  });
  await recipientBalance();
});
$("wallet-disconnect").onclick = () => void action(async () => { const previous = wallet; clearWallet(); await previous?.features?.["standard:disconnect"]?.disconnect(); });
$("native-balance-read").onclick = () => void action(async () => {
  if (!client) throw new Error("ServiceUnavailable");
  const b = await client.getNativeBalance($("native-address").value.trim());
  if (b.network !== "REGTEST" || b.decimals !== 8) throw new Error("WrongNativeNetwork");
  $("native-balance").textContent = `Balance: ${fromAtomic(b.amountAtomic)} KPEPE`;
});
const nonce = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
$("request-form").onsubmit = event => { event.preventDefault(); void action(async () => {
  if (!client || bridgeState !== "ACTIVE" || prepared) return;
  const amountAtomic = toAtomic($("amount").value);
  original = { amountAtomic, recipient: $("recipient").value.trim(),
    userRecoveryPublicKeyHex: $("recovery-public-key").value.trim(), nonceHex: nonce() };
  const quote = await client.createNativeDepositRequest(original);
  prepared = checkQuote(quote, original); preparedCompleted = false;
  detail($("review-details"), { "Operation ID": prepared.operationId, "Amount (KPEPE)": fromAtomic(prepared.amountAtomic),
    "Solana token destination": prepared.recipient, "Native deposit address": prepared.depositAddress });
  $("review").hidden = false;
  $("wallet-instruction").textContent = "Confirm the destination and amount, save this request, then send the exact amount to the deposit address using your Native wallet. Paste its transaction ID below.";
  $("operation-id").value = tracking = prepared.operationId;
  $("operation-state").textContent = "AWAITING USER";
}); };
$("new-request").onclick = () => {
  if (!preparedCompleted || busy || bridgeState !== "ACTIVE") return;
  prepared = original = undefined; preparedCompleted = false;
  $("request-form").reset(); $("transaction-id").value = ""; $("review").hidden = true;
  controls(); notice("Previous transfer completed. Its operation ID remains in status below.");
};
$("download").onclick = () => {
  if (!prepared) return; const blob = new Blob([JSON.stringify({ request: original, response: prepared }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = `kingpepe-request-${prepared.operationId}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
async function track() {
  const connected = client, id = tracking; if (!connected || !/^[0-9a-f]{64}$/u.test(id)) return;
  try {
    const result = await connected.getOperationStatus(id); if (client !== connected || tracking !== id) return;
    preparedCompleted = id === prepared?.operationId && result?.state === "COMPLETED"; controls();
    $("operation-state").textContent = result?.state?.replaceAll("_", " ") ?? "NOT OBSERVED";
    $("operation-help").textContent = result ? `${result.direction} · ${fromAtomic(result.amountAtomic)} KPEPE · ${result.trust}` : "Not yet observed. Check your wallet and allow the required chain finality. Do not create a replacement economic operation.";
    detail($("operation-details"), result ? { Recipient: result.destination, ...result.transactionIds } : {});
  } catch { if (client !== connected || tracking !== id) return; $("operation-state").textContent = "UNAVAILABLE"; $("operation-help").textContent = "Status unavailable. The operation may still be pending or completed; check before retrying."; }
}
$("track-form").onsubmit = event => { event.preventDefault(); void action(async () => { tracking = $("operation-id").value.trim(); if (!/^[0-9a-f]{64}$/u.test(tracking)) throw new Error("OperationRejected"); await track(); }); };
$("notify-form").onsubmit = event => { event.preventDefault(); void action(async () => {
  if (!prepared || !client || bridgeState !== "ACTIVE") return;
  const signature = $("transaction-id").value.trim();
  if (!/^[0-9a-f]{64}$/u.test(signature)) throw new Error("TransactionRejected");
  await client.submitNativeDeposit({ request: original, depositTxidHex: signature, depositVout: null });
  notice("Notification accepted. The bridge still verifies the actual transaction and finality."); await track();
}); };
const timer = setInterval(() => { if (client && !busy && !polling && !document.hidden) {
  polling = true; void (async () => { try { await status(); await track(); } finally { polling = false; } })();
} }, 5000);
window.addEventListener("pagehide", () => { clearInterval(timer); client = undefined; });
controls();
