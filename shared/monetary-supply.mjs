// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// KingPepe consensus/emission provenance: docs/security/monetary-supply.md.
export const KPEPE_DECIMALS = 8;
export const MAX_KPEPE_SUPPLY_ATOMIC = 21_000_000n * 100_000_000n;
// Production policy: the smallest confirmed Native deposit that may be burned.
// A threshold only. The whole received amount is bridged and no fee is taken.
export const MIN_BRIDGE_DEPOSIT_KPEPE = 1000n;
export const MIN_BRIDGE_DEPOSIT_ATOMIC = MIN_BRIDGE_DEPOSIT_KPEPE * 100_000_000n;
