# Offline burn recovery

The Team has not provisioned a recovery recipient or an offline destination. `OFFLINE_RECOVERY_BACKUP = NOT_PROVISIONED`. Neither a local encrypted file nor a copied DPAPI directory satisfies server-loss recovery. This external requirement does not prevent implementation, program builds, protected service preparation or deployment planning. Normal public Mainnet activation requires the real encrypted offline copy and its recovery evidence.

The implemented manual export uses a public X.509 certificate in PEM format, RSA 4096 bits, with key encipherment usage and `CA:FALSE`. The Team verifies its SHA-256 DER certificate fingerprint separately. It encrypts a quiescent complete snapshot using standard CMS AuthEnvelopedData, AES-256-GCM and RSA-OAEP with SHA-256/MGF1-SHA-256. This is supported by the reviewed OpenSSL tool; its executable digest is checked. There is no recovery private-key parameter in the server export.

## What the Team provides

On a trusted computer disconnected from networks, use a verified OpenSSL 3.5 or later installation. In an offline working directory, generate a dedicated recovery key and public certificate:

```text
openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -keyout KingPepe-Recovery-private.pem -out KingPepe-Recovery-public.pem -subj "/CN=KingPepe Offline Recovery" -addext "basicConstraints=critical,CA:FALSE" -addext "keyUsage=critical,keyEncipherment"
openssl x509 -in KingPepe-Recovery-public.pem -noout -fingerprint -sha256
```

Enter a strong unique passphrase at OpenSSL's local prompt. Do not add `-noenc`/`-nodes` or put the passphrase on the command line. Keep the encrypted private file and its passphrase offline, protected separately. Keep a second protected offline recovery-key copy so loss of one medium does not destroy recovery. Never provide the private file or passphrase to the Bridge, Explorer, chat or Git.

Provide only `KingPepe-Recovery-public.pem`, its independently checked fingerprint, and the actual approved destination for encrypted backups. Use removable media that is disconnected and stored away from the server after export, or an independently administered off-server destination with restricted access and an offline retention copy. A directory on the server's fixed disks is staging, not offline evidence. The operator must record the actual medium/destination and verified transfer; software cannot infer physical removal from a drive letter.

## Export and verification

Stop the economic service cleanly, retain its pause, and run the reviewed local export under the dedicated service identity. It acquires the existing protected-store leases; an active writer prevents capture. The complete snapshot includes the burn root, burn authorizations and signed packets, two attesters and their authorization journals, fee payer, operation journal, private service configuration, protected RPC bindings and gateway token. The upgrade/deployment authority is a separate recovery role and must retain its own approved protected backup.

`exportBurnRecovery` decrypts the DPAPI payloads only in memory, validates network/key bindings and the paused journal, and sends bytes directly to OpenSSL's inherited stdin. Only CMS ciphertext is written by the operator. The receipt records the certificate fingerprint, ciphertext digest, source SHA, operation count and journal checkpoint. Keep this receipt with a separately trusted inventory; public-key encryption alone does not authenticate who created a replacement snapshot. Verify the ciphertext digest after the off-server copy. Export receipts deliberately say `offlineCopy: NOT_PROVISIONED` until the actual external copy and operator evidence exist.

No production export or offline copy is claimed merely because the TEST cryptographic round trip passes. Retain the accepted single-server risk until the external copy is provisioned. Keep snapshots current under the existing manual or OS-scheduled recovery policy; this change creates no backup service.

## Recovery drill and replacement server

First drill with isolated TEST signing keys, a TEST recovery certificate, a signed pending burn and protected journal. The reviewed importer requires a new empty destination, a trusted snapshot digest and the executing Windows identity. It rewraps all secret/state payloads using that identity's CurrentUser DPAPI. It preserves operation IDs, bound destinations, signed packets, consumed evidence and authorization records. It forces `RECOVERY_CHAIN_REVIEW_REQUIRED`, with production disabled; it does not start a service or broadcast.

For real recovery, the Team performs CMS decryption on a trusted offline recovery workstation. Pass the decrypted snapshot through a protected in-memory pipe to the importer on the replacement Windows environment while that environment is offline and under Team control. The recovery key stays under the Team's offline control. Do not send plaintext snapshots over the network or write them into a checkout. If transfer to another machine is needed, re-encrypt to that replacement environment's independently verified temporary recovery certificate before transfer; do not transport a plaintext archive.

Compare recovered public identities and the latest independently retained inventory. Reconfigure verified replacement executable paths and RPC access without changing deployment or operation bindings. Run the existing runtime's full state validators and read-only authoritative Native/Solana reconciliation before any resume. A stale or incomplete snapshot remains paused; never drop unresolved operations or regenerate a burn key to make it open. A burn already broadcast/finalized resumes from its existing transaction, and a completed claim must remain completed. This procedure does not certify arbitrary stale snapshots or full-host rollback.

References: [OpenSSL CMS encryption](https://docs.openssl.org/3.5/man1/openssl-cms/), [OpenSSL certificate generation](https://docs.openssl.org/3.5/man1/openssl-req/), and [AES-GCM in CMS](https://datatracker.ietf.org/doc/html/rfc5084).
