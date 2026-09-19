// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Consensus identities from pinned Native source 3f262182, CMainParams and
// CRegTestParams. RPC hostnames and caller labels are never identity evidence.
export const NATIVE_MAINNET_GENESIS = "00000a00a75c7ed12c71b9a8b73c01576009d62a0a606c0a1ef37b043c520fb2";
export const NATIVE_REGTEST_GENESIS = "352a1a62f7880d325da6d3fe2e62272cd0ce735a7ba003eae4fb59d2a175a8b9";
export const SOLANA_MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const SOLANA_DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const NATIVE_MAINNET_MAGIC_HEX = "f3eace21";
// The production bridge's u32 Native domain is the pinned Mainnet P2P magic,
// interpreted little-endian. Legacy TEST domain 8000111 remains unchanged.
export const NATIVE_MAINNET_DOMAIN = 0x21ce_eaf3;
export const NATIVE_TEST_DOMAIN = 8_000_111;
export const NATIVE_MAINNET_HRP = "kpepe";
export const NATIVE_DECIMALS = 8;
export const MAINNET_WALLET_CHAIN = "solana:mainnet";

export function nativeIdentity(environment) {
  if (environment === "mainnet") return Object.freeze({ environment, network: "mainnet", rpcChain: "main",
    genesis: NATIVE_MAINNET_GENESIS, domain: NATIVE_MAINNET_DOMAIN, hrp: NATIVE_MAINNET_HRP, decimals: NATIVE_DECIMALS });
  if (environment === "localnet" || environment === "devnet") return Object.freeze({ environment, network: "regtest", rpcChain: "regtest",
    genesis: NATIVE_REGTEST_GENESIS, domain: NATIVE_TEST_DOMAIN, hrp: "rkpepe", decimals: NATIVE_DECIMALS });
  throw new Error("NativeEnvironmentRejected");
}

export function isMainnetBinding({ environment, nativeGenesis, nativeNetwork, solanaGenesis } = {}) {
  return environment === "mainnet" && nativeGenesis === NATIVE_MAINNET_GENESIS &&
    nativeNetwork === NATIVE_MAINNET_DOMAIN && solanaGenesis === SOLANA_MAINNET_GENESIS;
}

export function isProtectedNativeContext(context) {
  return (context?.environment === "localnet" && context.nativeGenesis === NATIVE_REGTEST_GENESIS) ||
    (context?.environment === "mainnet" && context.nativeGenesis === NATIVE_MAINNET_GENESIS);
}

export function mainnetRpcEndpoint(endpoint, expectedGenesis) {
  try {
    if (expectedGenesis !== SOLANA_MAINNET_GENESIS || typeof endpoint !== "string" || endpoint.length > 2048 ||
        endpoint !== endpoint.trim() || /[\u0000-\u0020\u007f]/u.test(endpoint)) throw new Error();
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error();
    return url.href;
  } catch { throw new Error("MainnetRpcEndpointRejected"); }
}

export function assertMainnetSolanaGenesis(observed) {
  if (observed !== SOLANA_MAINNET_GENESIS) {
    const error = new Error("SOLANA_GENESIS_CHANGED"); error.integrityCode = error.message; throw error;
  }
}
