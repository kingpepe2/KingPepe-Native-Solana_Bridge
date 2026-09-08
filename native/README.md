# Native-side implementation scaffold

This directory contains Native-side bridge source:

- `frost/`: same-host A+B Native-compatible FROST signing runtime.
- `proof/`: header, PoW, difficulty, Merkle, transaction, UTXO, and deposit validation primitives.
- `reserve/`: canonical reserve-sweep and mint-credit accounting transitions.
- `recovery/`: temporary-deposit user recovery eligibility checks.

No production secrets are tracked here.
