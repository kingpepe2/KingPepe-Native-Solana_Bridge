# FROST coordinator

`native-frost-coordinator.mjs` orchestrates two-party DKG and automatic signing
for `KINGPEPE_FROST_A` + `KINGPEPE_FROST_B`.

The coordinator does not hold a private FROST share. It verifies both signature
shares and the final BIP340 aggregate signature before returning a signed
result.
