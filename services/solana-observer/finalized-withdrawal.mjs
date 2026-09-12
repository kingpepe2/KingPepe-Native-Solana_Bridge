// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Configured local validating RPC observation, NOT a trustless Solana proof.
import { bridgeInputDigest } from "../../shared/protocol/bridge-inputs.mjs";
import { encodeBridgeAbi, decodeBridgeAbi, paddedDestination } from "../../shared/protocol/solana-bridge-abi.mjs";
import { base58Decode, base58Encode, base58DecodeInstruction } from "../bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { MESSAGE_LENGTH, decodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";
import { deriveWithdrawalRecordPdaHex } from "./solana-withdrawal-observer.mjs";
import { LocalDeploymentRpc, validateDeploymentManifest, verifyDeploymentSnapshot, deploymentAddresses } from "./deployment-integrity.mjs";
import { SPL_TOKEN_PROGRAM_ID_BASE58 as TOKEN, SYSTEM_PROGRAM_ID_BASE58 as SYSTEM } from "../bridge-validator/localnet-solana-setup-plan.mjs";
import { REGTEST_GENESIS } from "../../native/node/native-raw-evidence.mjs";

const verified = new WeakSet();
const check = (ok, code = "WithdrawalObservationRejected") => { if (!ok) throw new Error(code); };
const hex = bytes => Buffer.from(bytes).toString("hex");
const u64 = value => { const b = Buffer.alloc(8); b.writeBigUInt64LE(value); return b; };
export function requireFinalizedWithdrawal(value) {
  check(verified.has(value), "LiveFinalizedWithdrawalRequired"); return value;
}

// One immutable transaction/record identity per economic request. Every read
// rechecks the current deployment and the exact finalized BurnChecked CPI.
export class FinalizedWithdrawalReader {
  #rpc; #manifest;
  constructor({ rpc, manifest }) {
    check(rpc instanceof LocalDeploymentRpc, "WithdrawalLocalRpcRequired");
    this.#manifest = validateDeploymentManifest(manifest);
    check(this.#manifest.environment === "localnet" && this.#manifest.nativeGenesisHex === REGTEST_GENESIS && this.#manifest.mint.decimals === 8);
    this.#rpc = rpc;
  }
  async discover(knownOperationIds, limit = 16) {
    check(Array.isArray(knownOperationIds) && knownOperationIds.length <= 8192 && knownOperationIds.every(id => /^[0-9a-f]{64}$/u.test(id)) &&
      Number.isInteger(limit) && limit >= 1 && limit <= 100, "WithdrawalDiscoveryRequestRejected");
    const m = this.#manifest, known = new Set(knownOperationIds), found = [];
    verifyDeploymentSnapshot(m, await this.#rpc.snapshot(m));
    // Records remain on chain. Re-scan the bounded local deployment rather
    // than introduce another database/cursor that could lose an owed request.
    for (const account of await this.#rpc.withdrawalRecordAccounts(m)) {
      const id = account.data.subarray(41, 73).toString("hex"), withdrawalId = account.data.subarray(9, 41).toString("hex");
      check(account.address === base58Encode(Buffer.from(deriveWithdrawalRecordPdaHex(hex(base58Decode(m.manager.id)), withdrawalId), "hex")), "WithdrawalDiscoveryPdaMismatch");
      if (known.has(id)) continue;
      let receipt;
      for (const signature of await this.#rpc.finalizedSignatures(account.address)) {
        try { receipt = await this.read(signature); }
        catch (error) {
          if (["WithdrawalManagerInstructionRequired", "WithdrawalInstructionMalformed"].includes(error.message)) continue;
          throw error;
        }
        check(receipt.operationId === id && receipt.record === account.address, "WithdrawalDiscoveryRecordMismatch");
        break;
      }
      check(receipt, "WithdrawalDiscoveryHistoryIncomplete"); found.push(receipt);
      if (found.length === limit) break;
    }
    return found;
  }
  async read(signature, expectedMessageHex) {
    const m = this.#manifest;
    check(!m.config.withdrawalsPaused && m.config.transceiverActive, "WithdrawalBridgePaused");
    const tx = await this.#rpc.finalizedTransaction(signature);
    check(tx !== null, "WithdrawalWaitingForFinality");
    check(tx?.meta?.err === null && Number.isSafeInteger(tx.slot) && tx.slot >= 0, "WithdrawalTransactionFailed");
    check(tx.transaction?.signatures?.[0] === signature, "WithdrawalTransactionSubstituted");
    // Minimal supported user transaction: legacy/no address lookup tables.
    check(tx.version === undefined || tx.version === "legacy" || tx.version === 0);
    check((tx.meta.loadedAddresses?.writable?.length ?? 0) === 0 && (tx.meta.loadedAddresses?.readonly?.length ?? 0) === 0);
    const message = tx.transaction.message, keys = message?.accountKeys, instructions = message?.instructions;
    check(Array.isArray(keys) && keys.length > 0 && keys.length <= 256 && new Set(keys).size === keys.length);
    check(keys.every(k => typeof k === "string" && k.length >= 32 && k.length <= 44 && base58Decode(k).length === 32));
    check(Array.isArray(instructions) && instructions.length > 0 && instructions.length <= 64);
    const keyAt = i => { check(Number.isInteger(i) && i >= 0 && i < keys.length); return keys[i]; };
    const candidates = instructions.map((ix, index) => ({ ix, index })).filter(({ ix }) => keyAt(ix.programIdIndex) === m.manager.id);
    check(candidates.length === 1, "WithdrawalManagerInstructionRequired");
    const { ix, index } = candidates[0];
    check(typeof ix.data === "string" && ix.data.length <= 1000 && Array.isArray(ix.accounts) && ix.accounts.length === 9);
    const wire = Buffer.from(base58DecodeInstruction(ix.data));
    check(wire.length === 1 + MESSAGE_LENGTH + 105 && wire[0] === 3, "WithdrawalInstructionMalformed");
    const instruction = decodeBridgeAbi("RecordWithdrawal", wire);
    const encoded = Buffer.from(instruction.message), request = decodeCanonicalBridgeMessage(encoded);
    if (expectedMessageHex !== undefined) check(encoded.toString("hex") === expectedMessageHex, "WithdrawalMessageSubstituted");
    check(request.action === "WithdrawalRequest" && request.direction === "SolanaToNative");
    const d = request.deployment;
    check(d.protocolId === m.config.protocolId && d.nativeNetwork === m.config.nativeNetwork && hex(d.nativeGenesis) === m.nativeGenesisHex &&
      hex(d.solanaDeployment) === m.solanaDeploymentHex && base58Encode(d.managerProgramId) === m.manager.id &&
      base58Encode(d.transceiverProgramId) === m.transceiver.id && base58Encode(d.mint) === m.mint.id &&
      request.policyEpoch === m.config.policyEpoch && request.keyEpoch === m.config.keyEpoch, "WithdrawalDomainMismatch");
    check(request.amountAtomic > request.feeAtomic && /^(?:0014[0-9a-f]{40}|0020[0-9a-f]{64}|5120[0-9a-f]{64})$/u.test(request.destinationHex), "WithdrawalAmountOrDestinationRejected");
    // Expiry is evaluated at the user's successful burn, never used to erase
    // an already owed liability merely because the payout was delayed.
    check(Number.isSafeInteger(tx.blockTime) && tx.blockTime >= 0 && BigInt(tx.blockTime) >= request.validFrom && BigInt(tx.blockTime) <= request.validUntil, "WithdrawalExecutionTimeRejected");
    const record = base58Encode(Buffer.from(deriveWithdrawalRecordPdaHex(hex(d.managerProgramId), request.withdrawalIdHex), "hex"));
    const accounts = ix.accounts.map(keyAt), authority = accounts[4], source = accounts[2];
    check(accounts[0] === m.config.bridgePda && accounts[1] === record && accounts[3] === m.mint.id && accounts[5] === TOKEN &&
      accounts[6] === m.config.transceiverPda && accounts[8] === SYSTEM, "WithdrawalAccountsSubstituted");
    const required = message.header?.numRequiredSignatures;
    check(Number.isInteger(required) && required > 0 && required <= keys.length && keys.indexOf(authority) < required, "WithdrawalUserSignatureRequired");
    const burnContext = encodeBridgeAbi("BurnChecked", { tokenProgramId: base58Decode(TOKEN), mint: base58Decode(m.mint.id),
      authority: base58Decode(authority), amountAtomic: request.amountAtomic, decimals: 8 });
    check(wire.subarray(1 + MESSAGE_LENGTH).equals(burnContext), "WithdrawalBurnContextMismatch");
    check(Array.isArray(tx.meta.innerInstructions) && tx.meta.innerInstructions.length <= 64);
    const group = tx.meta.innerInstructions.filter(g => g.index === index);
    check(group.length === 1 && Array.isArray(group[0].instructions) && group[0].instructions.length <= 64);
    const burns = group[0].instructions.filter(i => keyAt(i.programIdIndex) === TOKEN);
    const burn = burns[0], burnBytes = Buffer.concat([Buffer.from([15]), u64(request.amountAtomic), Buffer.from([8])]);
    check(burns.length === 1 && typeof burn.data === "string" && burn.data.length < 32 && Buffer.from(base58DecodeInstruction(burn.data)).equals(burnBytes) &&
      Array.isArray(burn.accounts) && JSON.stringify(burn.accounts.map(keyAt)) === JSON.stringify([source, m.mint.id, authority]), "WithdrawalBurnCheckedMissing");
    const balance = values => {
      check(Array.isArray(values) && values.length <= 256);
      const matches = values.filter(v => v.accountIndex === keys.indexOf(source));
      check(matches.length === 1 && matches[0].mint === m.mint.id && matches[0].owner === authority && matches[0].uiTokenAmount?.decimals === 8);
      const amount = matches[0].uiTokenAmount.amount;
      check(typeof amount === "string" && /^(0|[1-9][0-9]{0,19})$/u.test(amount) && BigInt(amount) <= 0xffffffffffffffffn);
      return BigInt(amount);
    };
    check(balance(tx.meta.preTokenBalances) - balance(tx.meta.postTokenBalances) === request.amountAtomic, "WithdrawalTokenDeltaMismatch");
    const snapshot = await this.#rpc.snapshotWithAdditionalAccounts(m, [record], String(tx.slot));
    const count = deploymentAddresses(m).length;
    check(snapshot.accounts.length === count + 1);
    const deployment = verifyDeploymentSnapshot(m, { ...snapshot, accounts: snapshot.accounts.slice(0, count) });
    check(BigInt(deployment.slot) >= BigInt(tx.slot));
    const a = snapshot.accounts[count];
    check(a?.owner === m.manager.id && a.executable === false && a.data?.[1] === "base64" && typeof a.data[0] === "string" && a.data[0].length === 380, "WithdrawalRecordMissingOrSubstituted");
    const bytes = Buffer.from(a.data[0], "base64"), destination = Buffer.from(request.destinationHex, "hex");
    const expected = encodeBridgeAbi("WithdrawalRecord", { magic: Buffer.from("KPBWDR01"), version: 1,
      withdrawalId: request.withdrawalId, operationId: request.operationId, messageDigest: Buffer.from(request.messageDigestHex, "hex"),
      grossAmountAtomic: request.amountAtomic, feeAtomic: request.feeAtomic, nativeDestination: paddedDestination(destination),
      burnAuthority: base58Decode(authority) });
    check(bytes.equals(expected) && bytes.toString("base64") === a.data[0], "WithdrawalRecordMismatch");
    const receipt = Object.freeze({ protocol: "KINGPEPE_FINALIZED_WITHDRAWAL_V1", trust: "RPC_OBSERVATION", signature,
      encodedMessageHex: encoded.toString("hex"), operationId: request.operationIdHex, withdrawalId: request.withdrawalIdHex,
      messageDigest: request.messageDigestHex, grossAtomic: request.amountAtomic.toString(), feeAtomic: request.feeAtomic.toString(),
      netAtomic: (request.amountAtomic - request.feeAtomic).toString(), destinationHex: request.destinationHex, record,
      transactionSlot: String(tx.slot), observedSlot: deployment.slot, authority,
      evidenceDigest: bridgeInputDigest("FinalizedWithdrawal", { signature: base58Decode(signature), message: encoded, record: bytes, slot: BigInt(tx.slot) }) });
    verified.add(receipt); return receipt;
  }
}
