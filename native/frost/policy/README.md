# FROST policy

`native-signing-policy.mjs` binds signing requests to validated operation
snapshots. It rejects wrong domains, epochs, recipients, amounts, fees, change,
hard-stop state, paused withdrawals, and operation mutations before either
participant signs.
