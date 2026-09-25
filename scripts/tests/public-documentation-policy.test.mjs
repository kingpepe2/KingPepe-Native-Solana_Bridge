// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditPublicDocumentation, checkDocumentationIndex, documentationFindings, PUBLIC_SECURITY_STATEMENT } from '../public-documentation-policy.mjs';

test('public documentation requires complete reviewed classifications and excludes private records', () => {
  const paths = ['README.md', 'docs/history.json', 'services/runtime.mjs'];
  const index = { schemaVersion: 1, documents: [
    { path: 'README.md', classification: 'PUBLIC_SAFE' },
    { path: 'docs/history.json', classification: 'HISTORICAL_TEST_EVIDENCE' },
  ] };
  assert.equal(checkDocumentationIndex(paths, index).length, 2);
  assert.throws(() => checkDocumentationIndex([...paths, 'docs/new.md'], index), /COVERAGE/);
  assert.throws(() => checkDocumentationIndex(paths, { ...index, documents: [...index.documents, index.documents[0]] }), /CLASSIFICATION/);
  assert.throws(() => checkDocumentationIndex(paths, { ...index, documents: [{ ...index.documents[0], classification: 'PRIVATE_SECURITY' }] }), /CLASSIFICATION/);
});

test('publication checks reject privileged disclosure while keeping product facts and legal provenance', () => {
  for (const text of ['burnKeyCustodyModel: example', 'KEY_STORAGE = DPAPI', 'service account topology',
    'The signer uses single-key custody.', 'offline backup missing', 'SOLANA_MAINNET_RPC_URL',
    'private path Z:/example', 'operational fee inputs']) {
    assert.deepEqual(documentationFindings('README.md', text), ['SENSITIVE_IMPLEMENTATION_DISCLOSURE']);
  }
  assert.deepEqual(documentationFindings('README.md', PUBLIC_SECURITY_STATEMENT + '\n12 Native deposit confirmations; fee 0; 21,000,000 KPEPE; activation pending.'), []);
  assert.deepEqual(documentationFindings('PROVENANCE.json', JSON.stringify({ trackedFiles: [{ path: 'shared/windows/example.mjs', notes: 'Original project implementation.' }] })), []);
});

test('current public documentation passes the permanent publication policy', () => {
  const result = auditPublicDocumentation();
  assert.equal(result.status, 'PASS', JSON.stringify(result.findings));
});
