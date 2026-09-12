import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  deriveWithdrawalRecordPdaHex,
  evaluateFinalizedWithdrawalObservation,
} from "../solana-withdrawal-observer.mjs";
import { decodeCanonicalBridgeMessage } from "../../../shared/protocol/canonical-message.mjs";

const vectorPath = path.resolve(import.meta.dirname, "../../../solana/modules/bridge-messages/vectors/canonical-borsh-v2.json");
const vectorFile = JSON.parse(readFileSync(vectorPath, "utf8"));
const withdrawalVector = vectorFile.vectors.find((vector) => vector.name === "withdrawal-request-v2");
const decodedWithdrawal = decodeCanonicalBridgeMessage(withdrawalVector.encodedHex);

function h(label) {
  return createHash("sha256").update(label).digest("hex");
}

function config(overrides = {}) {
  return {
    environment: "localnet",
    cluster: "localnet",
    solanaDeploymentHex: withdrawalVector.deployment.solanaDeployment,
    protocolId: withdrawalVector.deployment.protocolId,
    nativeNetwork: withdrawalVector.deployment.nativeNetwork,
    nativeGenesisHex: withdrawalVector.deployment.nativeGenesis,
    managerProgramIdHex: withdrawalVector.deployment.managerProgramId,
    transceiverProgramIdHex: withdrawalVector.deployment.transceiverProgramId,
    managerProgramDataAddressHex: h("manager-programdata"),
    transceiverProgramDataAddressHex: h("transceiver-programdata"),
    upgradeAuthorityHex: h("kingpepe-team-upgrade-authority"),
    mintHex: withdrawalVector.deployment.mint,
    tokenProgramIdHex: h("traditional-spl-token-program"),
    mintAuthorityPdaHex: h("mint-authority-pda"),
    decimals: 8,
    policyEpoch: withdrawalVector.policyEpoch,
    keyEpoch: withdrawalVector.keyEpoch,
    acceptedTrustLevels: ["LOCAL_VALIDATION"],
    productionObserverConfigured: false,
    ...overrides,
  };
}

function observation(overrides = {}) {
  const expected = config();
  const withdrawalPda = deriveWithdrawalRecordPdaHex(expected.managerProgramIdHex, decodedWithdrawal.withdrawalIdHex);
  return {
    trust: "LOCAL_VALIDATION",
    cluster: "localnet",
    solanaDeployment: withdrawalVector.deployment.solanaDeployment,
    slot: 42,
    rootSlot: 45,
    commitment: "finalized",
    transaction: {
      signature: "local-withdrawal-signature",
      err: null,
    },
    programs: {
      manager: {
        programId: expected.managerProgramIdHex,
        programDataAddress: expected.managerProgramDataAddressHex,
        upgradeAuthority: expected.upgradeAuthorityHex,
      },
      transceiver: {
        programId: expected.transceiverProgramIdHex,
        programDataAddress: expected.transceiverProgramDataAddressHex,
        upgradeAuthority: expected.upgradeAuthorityHex,
      },
    },
    mint: {
      address: expected.mintHex,
      tokenProgramId: expected.tokenProgramIdHex,
      decimals: expected.decimals,
      mintAuthority: expected.mintAuthorityPdaHex,
      freezeAuthority: null,
    },
    withdrawalAccount: {
      accountProgramId: expected.managerProgramIdHex,
      pda: withdrawalPda,
      withdrawalIdHex: decodedWithdrawal.withdrawalIdHex,
      operationIdHex: decodedWithdrawal.operationIdHex,
      messageDigestHex: decodedWithdrawal.messageDigestHex,
      grossAmountAtomic: decodedWithdrawal.amountAtomic.toString(),
      feeAtomic: decodedWithdrawal.feeAtomic.toString(),
      nativeDestinationHex: decodedWithdrawal.destinationHex,
    },
    burn: {
      tokenProgramId: expected.tokenProgramIdHex,
      mint: expected.mintHex,
      amountAtomic: decodedWithdrawal.amountAtomic.toString(),
      decimals: expected.decimals,
      userAuthorized: true,
    },
    encodedWithdrawalMessageHex: withdrawalVector.encodedHex,
    ...overrides,
  };
}

test("finalized local Solana withdrawal observation becomes VERIFIED_READY", () => {
  const result = evaluateFinalizedWithdrawalObservation(config(), observation());
  assert.equal(result.state, "VERIFIED_READY");
  assert.equal(result.reason, "ALL_REQUIRED_CHECKS_PASSED");
  assert.equal(result.operationIdHex, decodedWithdrawal.operationIdHex);
  assert.equal(result.messageDigestHex, withdrawalVector.messageDigest);
  assert.match(result.evidenceDigestHex, /^[0-9a-f]{64}$/u);
});

test("RPC-only observation is not promoted to local validation", () => {
  const result = evaluateFinalizedWithdrawalObservation(config(), observation({ trust: "RPC_OBSERVATION" }));
  assert.equal(result.state, "WAITING_FOR_DEPENDENCY");
  assert.equal(result.reason, "SOLANA_TRUST_NOT_ACCEPTED");
});

test("unfinalized Solana transaction waits for finality", () => {
  const result = evaluateFinalizedWithdrawalObservation(
    config(),
    observation({ commitment: "confirmed", rootSlot: 41 }),
  );
  assert.equal(result.state, "WAITING_FOR_FINALITY");
  assert.equal(result.reason, "SOLANA_FINALITY_NOT_REACHED");
});

test("direct burn without the bridge withdrawal record creates no payout entitlement", () => {
  const result = evaluateFinalizedWithdrawalObservation(config(), observation({ withdrawalAccount: undefined }));
  assert.equal(result.state, "REJECTED");
  assert.equal(result.reason, "WITHDRAWAL_RECORD_MISSING");
});

test("wrong burn amount, mint, or destination is rejected", () => {
  const wrongAmount = evaluateFinalizedWithdrawalObservation(
    config(),
    observation({ burn: { ...observation().burn, amountAtomic: "1001" } }),
  );
  assert.equal(wrongAmount.state, "REJECTED");
  assert.equal(wrongAmount.reason, "BURN_AMOUNT_MISMATCH");

  const wrongMint = evaluateFinalizedWithdrawalObservation(
    config(),
    observation({ burn: { ...observation().burn, mint: h("wrong-mint") } }),
  );
  assert.equal(wrongMint.state, "REJECTED");
  assert.equal(wrongMint.reason, "BURN_MINT_MISMATCH");

  const wrongDestination = evaluateFinalizedWithdrawalObservation(
    config(),
    observation({
      withdrawalAccount: {
        ...observation().withdrawalAccount,
        nativeDestinationHex: "5120aa",
      },
    }),
  );
  assert.equal(wrongDestination.state, "REJECTED");
  assert.equal(wrongDestination.reason, "WITHDRAWAL_DESTINATION_MISMATCH");
});

test("unauthorized program, upgrade authority, or mint authority changes hard-stop", () => {
  const wrongProgram = evaluateFinalizedWithdrawalObservation(
    config(),
    observation({
      programs: {
        ...observation().programs,
        manager: { ...observation().programs.manager, programId: h("different-manager-program") },
      },
    }),
  );
  assert.equal(wrongProgram.state, "HARD_STOP");
  assert.equal(wrongProgram.reason, "UNAUTHORIZED_PROGRAM_ID_CHANGE");

  const wrongUpgradeAuthority = evaluateFinalizedWithdrawalObservation(
    config(),
    observation({
      programs: {
        ...observation().programs,
        transceiver: { ...observation().programs.transceiver, upgradeAuthority: h("different-upgrade-authority") },
      },
    }),
  );
  assert.equal(wrongUpgradeAuthority.state, "HARD_STOP");
  assert.equal(wrongUpgradeAuthority.reason, "UNAUTHORIZED_TRANSCEIVER_UPGRADE_AUTHORITY_CHANGE");

  const wrongMintAuthority = evaluateFinalizedWithdrawalObservation(
    config(),
    observation({
      mint: {
        ...observation().mint,
        mintAuthority: h("human-hot-wallet-minter"),
      },
    }),
  );
  assert.equal(wrongMintAuthority.state, "HARD_STOP");
  assert.equal(wrongMintAuthority.reason, "UNAUTHORIZED_MINT_AUTHORITY_CHANGE");

  const freezeAuthoritySet = evaluateFinalizedWithdrawalObservation(
    config(),
    observation({
      mint: {
        ...observation().mint,
        freezeAuthority: h("unexpected-freeze-authority"),
      },
    }),
  );
  assert.equal(freezeAuthoritySet.state, "HARD_STOP");
  assert.equal(freezeAuthoritySet.reason, "UNAUTHORIZED_FREEZE_AUTHORITY_SET");
});

test("production observer remains blocked without production-grade source configuration", () => {
  const result = evaluateFinalizedWithdrawalObservation(
    config({ environment: "mainnet", productionObserverConfigured: false }),
    observation(),
  );
  assert.equal(result.state, "HARD_STOP");
  assert.equal(result.reason, "PRODUCTION_SOLANA_OBSERVER_BLOCKED");
});

test("configured flag cannot turn the local observation model into a production source", () => {
  assert.equal(evaluateFinalizedWithdrawalObservation(config({ environment: "mainnet", cluster: "mainnet", productionObserverConfigured: true }), observation()).state, "HARD_STOP");
});

test("missing, malformed or unsafe slot/root values never authorize a withdrawal", () => {
  for (const field of ["slot", "rootSlot"]) for (const value of [undefined, null, NaN, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "01", "-1", "18446744073709551616"]) {
    assert.equal(evaluateFinalizedWithdrawalObservation(config(), observation({ [field]: value })).reason, "SOLANA_SLOT_INVALID");
  }
});

test("withdrawal observation enforces Native network/genesis and protocol identity", () => {
  for (const [patch, reason] of [[{ protocolId: 2 }, "MESSAGE_PROTOCOL_MISMATCH"],
    [{ nativeNetwork: 3 }, "MESSAGE_NATIVE_NETWORK_MISMATCH"], [{ nativeGenesisHex: h("wrong-native-genesis") }, "MESSAGE_NATIVE_GENESIS_MISMATCH"]]) {
    assert.equal(evaluateFinalizedWithdrawalObservation(config(patch), observation()).reason, reason);
  }
});

test("withdrawal record identity is the Solana PDA, not the old JSON hash", () => {
  const actual = deriveWithdrawalRecordPdaHex(config().managerProgramIdHex, decodedWithdrawal.withdrawalIdHex);
  // Golden identity is additionally checked against a REAL program-created PDA
  // by local-withdrawal-record.mjs, not just this host identity regression.
  const old = createHash("sha256").update(JSON.stringify({ managerProgramIdHex: config().managerProgramIdHex,
    prefix: "KINGPEPE_BRIDGE_WITHDRAWAL_RECORD_PDA_V1", withdrawalIdHex: decodedWithdrawal.withdrawalIdHex })).digest("hex");
  assert.notEqual(actual, old);
  assert.match(actual, /^[0-9a-f]{64}$/u);
});
