// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { createBridgeClient } from "/sdk/client.mjs";
import { getWallets } from "/vendor/wallet-standard/wallets.js";
import { base58, base64 } from "/vendor/scure-base.js";
import { toAtomic, fromAtomic, checkQuote } from "/app/model.mjs";

const $ = id => document.getElementById(id), registry = getWallets();
const chain = "solana:localnet";
let client, bridgeState = "NOT CONNECTED", direction = "NativeToSolana", prepared, original, wallet, account;
let busy = false, polling = false, walletAttempted = false, preparedCompleted = false, tracking = "", walletChoices = [];
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
  $("native-direction").disabled = $("solana-direction").disabled = busy || Boolean(prepared);
  $("wallet-sign").disabled = !active || busy || walletAttempted || !wallet || account?.address !== original?.userAuthority;
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
function selectDirection(value) {
  if (prepared || busy) return; direction = value; const deposit = value === "NativeToSolana";
  $("native-direction").setAttribute("aria-pressed", String(deposit)); $("solana-direction").setAttribute("aria-pressed", String(!deposit));
  $("deposit-fields").hidden = !deposit; $("withdrawal-fields").hidden = deposit;
  for (const id of ["recipient", "recovery-public-key"]) $(id).required = deposit;
  for (const id of ["user-authority", "source-token-account", "native-destination", "network-fee"]) $(id).required = !deposit;
  $("prepare").textContent = deposit ? "Prepare deposit" : "Prepare withdrawal"; notice("");
}
$("native-direction").onclick = () => selectDirection("NativeToSolana");
$("solana-direction").onclick = () => selectDirection("SolanaToNative");
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
function walletsChanged() {
  walletChoices = registry.get().filter(w => Array.isArray(w.chains) && w.chains.includes(chain) && w.features?.["standard:connect"] && w.features?.["solana:signAndSendTransaction"]);
  $("wallets").replaceChildren(...walletChoices.map((w, i) => { const option = document.createElement("option"); option.value = String(i); option.textContent = w.name; return option; }));
  if (!walletChoices.length) { const option = document.createElement("option"); option.textContent = "No localnet wallet detected"; $("wallets").append(option); }
  $("wallet-connect").disabled = !walletChoices.length;
  if (wallet && !walletChoices.includes(wallet)) { wallet = account = undefined; controls(); }
}
registry.on("register", walletsChanged); registry.on("unregister", walletsChanged); walletsChanged();
$("wallet-connect").onclick = () => void action(async () => {
  wallet = walletChoices[Number($("wallets").value)]; if (!wallet) throw new Error("WalletUnavailable");
  const result = await wallet.features["standard:connect"].connect();
  account = result.accounts.find(a => a.chains.includes(chain) && a.features.includes("solana:signAndSendTransaction"));
  if (!account || base58.encode(account.publicKey) !== account.address) { account = wallet = undefined; throw new Error("WalletAccountRejected"); }
  $("user-authority").value = account.address; $("wallet-state").textContent = `${wallet.name} connected · ${account.address}`;
});
const nonce = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
$("request-form").onsubmit = event => { event.preventDefault(); void action(async () => {
  if (!client || bridgeState !== "ACTIVE" || prepared) return;
  const amountAtomic = toAtomic($("amount").value);
  original = direction === "NativeToSolana" ? { amountAtomic, recipient: $("recipient").value.trim(),
    userRecoveryPublicKeyHex: $("recovery-public-key").value.trim(), nonceHex: nonce() } :
    { amountAtomic, feeAtomic: toAtomic($("network-fee").value, { zero: true }), destination: $("native-destination").value.trim(),
      userAuthority: $("user-authority").value.trim(), sourceTokenAccount: $("source-token-account").value.trim(), withdrawalIdHex: nonce(), nonceHex: nonce() };
  const quote = await client[direction === "NativeToSolana" ? "createNativeDepositRequest" : "createSolanaWithdrawal"](original);
  prepared = checkQuote(quote, original, direction); walletAttempted = preparedCompleted = false;
  detail($("review-details"), { "Operation ID": prepared.operationId, "Amount (KPEPE)": fromAtomic(prepared.amountAtomic),
    "Recipient": prepared.recipient ?? prepared.destination, "Native deposit address": prepared.depositAddress,
    "Native network fee (KPEPE)": prepared.feeAtomic === undefined ? undefined : fromAtomic(prepared.feeAtomic),
    "Native payout (KPEPE)": prepared.netAtomic === undefined ? undefined : fromAtomic(prepared.netAtomic) });
  $("review").hidden = false; $("wallet-sign").hidden = direction !== "SolanaToNative";
  $("transaction-label").textContent = direction === "NativeToSolana" ? "Native deposit transaction ID" : "Solana withdrawal transaction signature";
  $("wallet-instruction").textContent = direction === "NativeToSolana" ? "Save this request, then send the exact amount to the deposit address using your Native wallet. Paste its transaction ID below." :
    "Save this request. Review the burn amount, network fee and Native recipient, then sign in your localnet wallet or with a compatible external wallet.";
  $("operation-id").value = tracking = prepared.operationId;
  $("operation-state").textContent = "AWAITING USER";
}); };
$("new-request").onclick = () => {
  if (!preparedCompleted || busy || bridgeState !== "ACTIVE") return;
  prepared = original = undefined; walletAttempted = preparedCompleted = false;
  $("request-form").reset(); $("transaction-id").value = ""; $("review").hidden = true;
  if (account) $("user-authority").value = account.address;
  selectDirection(direction); controls(); notice("Previous transfer completed. Its operation ID remains in status below.");
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
  if (direction === "NativeToSolana") {
    if (!/^[0-9a-f]{64}$/u.test(signature)) throw new Error("TransactionRejected");
    await client.submitNativeDeposit({ request: original, depositTxidHex: signature, depositVout: null });
  } else { walletAttempted = true; await client.submitSolanaWithdrawal(signature); }
  notice("Notification accepted. The bridge still verifies the actual transaction and finality."); await track();
}); };
$("wallet-sign").onclick = () => void action(async () => {
  // Refresh the existing read-only status before handing a prepared transaction
  // to a wallet; a cached ACTIVE badge is not current authorization.
  await status();
  if (!prepared || walletAttempted || direction !== "SolanaToNative" || bridgeState !== "ACTIVE" || !wallet || account?.address !== original.userAuthority ||
      !wallet.accounts.some(a => a.address === account.address && base58.encode(a.publicKey) === account.address && a.chains.includes(chain))) throw new Error("WalletChanged");
  walletAttempted = true; controls();
  try {
    const [signed] = await wallet.features["solana:signAndSendTransaction"].signAndSendTransaction({ transaction: base64.decode(prepared.transactionBase64), account, chain,
      options: { preflightCommitment: "finalized" } });
    if (!(signed?.signature instanceof Uint8Array) || signed.signature.length !== 64) throw new Error("WalletResultUnavailable");
    const signature = base58.encode(signed.signature); $("transaction-id").value = signature;
    try { await client.submitSolanaWithdrawal(signature); } catch { /* Observer independently discovers the finalized record. No resubmission. */ }
    notice("Submitted by your wallet. Waiting for finality and bridge verification; no automatic resubmission."); await track();
  } catch { notice("Wallet declined or its result is unknown. Check wallet history and the saved operation before retrying. This page will not sign or submit it again.", true); }
});
const timer = setInterval(() => { if (client && !busy && !polling && !document.hidden) {
  polling = true; void (async () => { try { await status(); await track(); } finally { polling = false; } })();
} }, 5000);
window.addEventListener("pagehide", () => { clearInterval(timer); client = undefined; });
controls();
