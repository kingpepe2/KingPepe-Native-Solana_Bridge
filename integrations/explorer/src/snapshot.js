// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { marketResponse } from './market.js';
import { applyCommonHeaders, sendJson, sendError } from './security.js';

// Both public endpoints use the same market service, including its cache,
// in-flight refresh, Mint checks and unavailable/stale observations.
export function createSnapshotHandler(readNativeSnapshot, readMarket = marketResponse) {
  return async (req, res) => {
    applyCommonHeaders(req, res);
    try {
      const { value: market, ttlSec } = await readMarket();
      if (res.destroyed || res.writableEnded) return;
      // Read Native state after the bounded market refresh, without mutating it.
      // The same observation as GET /api/v1/market. Only its price history is left to that endpoint:
      // this one is read every few seconds by every open page.
      const { history7d, ...observation } = market;
      sendJson(res, 200, { ...readNativeSnapshot(), market: observation }, { cacheSeconds: Math.min(2, ttlSec) });
    } catch {
      if (!res.headersSent && !res.destroyed) sendError(res, 500, 'Snapshot temporarily unavailable.');
    }
  };
}
