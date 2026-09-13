// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Explicit TEST network admission. Local callers remain local by default;
// a hostname is never evidence that an RPC serves the approved cluster.
export const DEVNET_SOLANA_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

export function isTestSolanaCluster({ environment = "localnet", cluster = "localnet", solanaGenesis } = {}) {
  return (environment === "localnet" && cluster === "localnet") ||
    (environment === "devnet" && cluster === "devnet" && solanaGenesis === DEVNET_SOLANA_GENESIS);
}

export function devnetRpcEndpoint(endpoint, expectedGenesis) {
  try {
    if (expectedGenesis !== DEVNET_SOLANA_GENESIS || typeof endpoint !== "string" || endpoint.length > 2048 ||
        endpoint !== endpoint.trim() || /[\u0000-\u0020\u007f]/u.test(endpoint)) throw new Error();
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error();
    return url.href;
  } catch {
    // URL parser exceptions can include a provider credential. Never forward them.
    throw new Error("DevnetRpcEndpointRejected");
  }
}

export function assertDevnetGenesis(observed) {
  if (observed !== DEVNET_SOLANA_GENESIS) {
    const error = new Error("SOLANA_GENESIS_CHANGED");
    error.integrityCode = "SOLANA_GENESIS_CHANGED";
    throw error;
  }
}
