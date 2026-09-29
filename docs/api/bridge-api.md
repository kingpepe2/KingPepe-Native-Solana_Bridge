# Bridge API

The official interface is [kingpepe.net/bridge](https://kingpepe.net/bridge). These routes are the public gateway that page uses. They are not a signing or administrative API. All routes are under `https://kingpepe.net/api/v1/bridge`, answer JSON and accept no query string.

## Status

`GET /status` reports current availability.

| Field | Meaning |
|---|---|
| `state` | `ACTIVE` when new transfers are accepted, otherwise `PAUSED` |
| `productionReady`, `mainnetActivation` | `true` and `ENABLED` when available |
| `executionSlot` | `AVAILABLE` or `BRIDGE_BUSY` |
| `maxConcurrentExecutingOperations` | `1`: one transfer at a time |
| `minimumDepositAtomic` | `100000000000`, which is 1,000 KPEPE |
| `bridgeFeeAtomic` | `0` |
| `depositAmountModel` | `EXACT_RECEIVED`: the confirmed Native amount is the bridged amount |
| `nativeDepositConfirmations`, `nativeBurnConfirmations` | `12` each |
| `accountingRefreshState` | `VERIFIED`, or `VERIFYING` during a hold |
| `supply` | Verified completed issuance, the remaining amount and the time of observation |
| `mint` | The official KPEPE Mint |

While a transfer is being processed the status shows `PAUSED`, `VERIFYING` and `BRIDGE_BUSY`. This is the normal busy state.

## Starting a transfer

`POST /operations` with `clientNonce`, `destination` and `walletChain` binds the Solana destination and returns the operation with its unique Native deposit address. The request must come from the official page. Repeating the same request returns the same operation and never a second address.

The runtime issues an address between two accounting cycles, so an answer can take up to 30 seconds.

| Answer | Meaning |
|---|---|
| `200` | The operation and its deposit address |
| `409` with `code: BRIDGE_BUSY` | Another transfer is being processed. Repeat the same request later. |
| `409` | The Bridge is paused |
| `429` | Too many requests; see `Retry-After` |
| `503` | The Bridge is temporarily unavailable |

## Tracking a transfer

`GET /operations/{operationId}` returns the state of one operation: deposit, confirmations, burn, burn finality, mint and completion, with the public transaction identifiers. A deposit below the minimum is reported with `depositBelowMinimum: true`; it is not burned and nothing is minted.

## Balances

`GET /balances/solana/{address}` and `GET /balances/native/{address}` return the finalized public balance of an address.

## What is not served

Production funds Solana execution from the Bridge reserve. The user-funded routes described in [execution funding](execution-funding.md) are disabled and answer `404`. There is no Solana → Native route.
