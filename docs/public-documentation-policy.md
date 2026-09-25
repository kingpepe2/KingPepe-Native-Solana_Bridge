# Public documentation policy

Public documentation explains the Bridge's user-facing protocol, economics, official identities, links, correct use and current activation status. Keep detailed security and operational documentation internal. Do not publish unnecessary privileged implementation details, private configuration, credentials or operational records.

Use this statement when referring publicly to custody, upgrades or recovery:

> Custody, upgrade, and recovery controls are documented internally. Relevant security-assurance information will be published alongside the results of an independent security audit.

Do not append implementation details to that statement. Do not imply that an independent audit has been completed, or advertise a security property without verified evidence and approval for disclosure.

Each document is reviewed before publication. Public product documentation is classified PUBLIC_SAFE; a sanitized historical validation summary is HISTORICAL_TEST_EVIDENCE. PRIVATE_SECURITY material stays outside the public source tree and public web content. Full original technical records are retained internally before sanitization. These classifications do not change the scope or outcome of an actual test.

Necessary functional source, regression tests, third-party notices and build reproducibility remain intact. Sanitization never substitutes for fixing vulnerabilities, removes validation or changes economic behavior. Automated documentation checks supplement human review; they cannot establish that every possible disclosure has been detected.
