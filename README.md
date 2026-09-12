# KingPepe Native ↔ Solana Bridge

KingPepe is a native blockchain asset with a fixed maximum supply of
21,000,000 KPEPE.

This repository contains the KingPepe Native ↔ Solana Bridge, providing
a 1:1 representation of KingPepe on Solana while keeping KingPepe Native
as the original asset.

## KingPepe Native

- Original asset: KingPepe Native (KPEPE)
- Maximum Native supply: 21,000,000 KPEPE
- Solana representation: KPEPE
- Initial KPEPE supply on Solana: 0
- No Solana premine

KingPepe Native remains the source asset.

The Solana representation is created only through the bridge according
to verified bridge operations.

## Native → Solana

When KPEPE moves from KingPepe Native to Solana:

1. The Native transaction is observed.
2. The bridge verifies the transaction and required finality.
3. The corresponding Native KPEPE is accounted for by the bridge reserve.
4. The verified amount is represented on Solana as KPEPE.
5. The bridge records and reconciles the operation.

KPEPE is not pre-minted on Solana.

The Solana supply begins at zero and increases only when verified
KingPepe Native value enters the bridge.

## Solana → Native

When KPEPE moves from Solana back to KingPepe Native:

1. The user creates a bridge withdrawal on Solana.
2. The corresponding KPEPE representation is burned on Solana.
3. The bridge verifies the finalized withdrawal.
4. The corresponding KingPepe Native amount is released from the bridge
   reserve to the requested Native destination.
5. The operation is finalized and reconciled.

This burn-and-release model prevents the same bridged value from
remaining simultaneously available on both sides.

## 1:1 Bridge Model

The bridge is designed around a simple principle:

1 KPEPE represented on Solana corresponds to 1 KPEPE of bridge-accounted
KingPepe Native value.

The bridge tracks:

- Native reserve
- KPEPE represented on Solana
- pending bridge operations
- completed deposits
- completed withdrawals

The purpose is to preserve consistent bridge accounting between
KingPepe Native and Solana.

## Supply Model

**KingPepe Native maximum supply:** 21,000,000 KPEPE

**Solana KPEPE initial supply:** 0 KPEPE

The bridge does not create an additional independent KingPepe economy.

KPEPE on Solana is a representation of KingPepe Native value transferred
through the bridge.

**Native → Solana:** verified Native value enters bridge accounting and
the corresponding Solana representation is created.

**Solana → Native:** the Solana representation is burned and the
corresponding Native value is released.

## Automatic Bridge Operation

The bridge is designed for automatic operation after verification.

Normal valid transfers do not require manual KingPepe Team approval for
each transaction.

Each direction follows its required blockchain verification, finality
and accounting checks before completion.

## Solana Integration

The Solana side uses dedicated KingPepe bridge programs to manage:

- bridge messages
- deposit claims
- KPEPE representation
- withdrawal records
- replay protection
- bridge accounting

The bridge validates the expected Solana deployment and token
configuration before processing bridge operations.

## Safety Principles

The bridge is designed to enforce several basic rules:

- no minting from an unverified Native deposit
- no duplicate claim
- no double mint
- no duplicate withdrawal payout
- finalized-chain verification
- exact bridge accounting
- replay protection
- reconciliation between Native reserve and Solana representation
- bridge pause when a serious inconsistency is detected

## Project Status

Development / Pre-Activation

Mainnet bridge activation is currently disabled.

Local development and validation do not imply production activation.

Production deployment information will be published only when the
KingPepe Team formally activates the bridge.

## Repository

This repository contains the source code and public technical components
of the KingPepe Native ↔ Solana Bridge.

Private operational data, signing material, wallet credentials and
deployment secrets are not part of the repository.

## KingPepe Team

The KingPepe Native ↔ Solana Bridge is developed and maintained by the
KingPepe Team.

Copyright (c) 2026 KingPepe Team.
All Rights Reserved.

See [LICENSE](LICENSE) for the repository licensing terms.

Third-party components remain subject to their respective licenses.
