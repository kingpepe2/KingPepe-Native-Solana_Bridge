#!/usr/bin/env node
// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// JSON requests on stdin; no user wallet/private-key import or automatic signing.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBridgeClient } from "../solana/ts/sdk/client.mjs";

export async function runBridgeCli(args, { client, readInput, output }) {
  const [command, subcommand] = args;
  if (command === "--help" && args.length === 1) {
    output("bridge deposit [submit]\nbridge withdraw [submit]\nbridge status\nbridge operation <id>\nRequests: public JSON on stdin. User wallet signs. No automatic transaction submission retry."); return;
  }
  let value;
  if (command === "status" && args.length === 1) value = await client.getBridgeStatus();
  else if (command === "operation" && args.length === 2) value = await client.getOperationStatus(subcommand);
  else if (["deposit", "withdraw"].includes(command) && (args.length === 1 || args.length === 2 && subcommand === "submit")) {
    const input = JSON.parse(await readInput());
    if (command === "deposit") value = await client[subcommand ? "submitNativeDeposit" : "createNativeDepositRequest"](input);
    else if (subcommand) {
      if (!input || Object.keys(input).join() !== "signature") throw new Error("PublicSignatureRequired");
      value = await client.submitSolanaWithdrawal(input.signature);
    } else value = await client.createSolanaWithdrawal(input);
  } else throw new Error("UseBridgeHelp");
  output(JSON.stringify(value, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const client = args[0] === "--help" ? null : createBridgeClient({ endpoint: process.env.KINGPEPE_BRIDGE_URL, accessToken: process.env.KINGPEPE_USER_ACCESS_TOKEN });
    await runBridgeCli(args, { client, output: text => process.stdout.write(text + "\n"), readInput: async () => {
      let text = "", length = 0;
      for await (const chunk of process.stdin) { length += chunk.length; if (length > 16384) throw new Error("RequestTooLarge"); text += chunk.toString("utf8"); }
      return text;
    } });
  } catch { process.stderr.write("BRIDGE_REQUEST_FAILED: check configuration/status and bridge --help; no wallet transaction was signed by this CLI.\n"); process.exitCode = 1; }
}
