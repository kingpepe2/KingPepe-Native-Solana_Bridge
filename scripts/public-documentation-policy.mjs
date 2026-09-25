// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Publication checks supplement human review; they do not certify security.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PUBLIC_SECURITY_STATEMENT = 'Custody, upgrade, and recovery controls are documented internally. Relevant security-assurance information will be published alongside the results of an independent security audit.';

const sensitivePatterns = [
  /\b(?:SINGLE_KEY_ACCEPTED_RISK|SINGLE_KEY_WITH_REVIEW_CONTROL|UNBOUNDED_BY_TEAM_DECISION|NOT_REQUIRED_BY_TEAM_DECISION|ACCEPTED_BY_KINGPEPE_TEAM)\b/u,
  /\b(?:DPAPI|SCM|CurrentUser|NTFS|service[- ]account|service[- ]identity|signer[- ]hosting|offline[- ]backup|recovery[- ]backup|single[- ]key|threshold[- ]signing|timelock)\b/iu,
  /\b(?:burnKeyCustodyModel|burnSignerHostingModel|offlineRecoveryBackup|recoveryRisk|productionLimitPolicy|upgradeAuthorityModel|upgradeReviewWindow|fixedTimelock|windowsServiceRequired|nativeFeeFunding|keyReference|attesterAKeyRef|attesterBKeyRef)\b/u,
  /\b(?:two|2)[ -]*(?:distinct[ -]*)?(?:project[ -]*)?attesters?\b|\bPROJECT_ATTESTED_[A-Z0-9_]+\b/iu,
  /\b(?:KINGPEPE_[A-Z0-9_]*(?:KEY|TOKEN|RPC|SECRET|CONFIG|PATH|ROOT|STORE|SIGNER|ACCOUNT)[A-Z0-9_]*|SOLANA_(?:MAINNET|DEVNET)_RPC_URL|FROST_[AB]_[A-Z0-9_]+)\b/u,
  /\b[A-Za-z]:[\\/](?!\/)|\/(?:home|Users|var\/tmp)\//u,
  /\b(?:operational|fee)[ -]+(?:funding|inputs?|wallet|UTXOs?)\b/iu,
];

export function documentationFindings(name, text) {
  // File-level provenance must retain actual repository filenames. Descriptive
  // commentary is still checked; paths are not statements about deployed hosts.
  if (name === 'PROVENANCE.json') {
    const value = JSON.parse(text);
    text = JSON.stringify({ ...value, trackedFiles: value.trackedFiles.map(({ path: _path, ...entry }) => entry) });
  }
  return sensitivePatterns.some(pattern => pattern.test(text)) ? ['SENSITIVE_IMPLEMENTATION_DISCLOSURE'] : [];
}

export function isPublicDocument(name) {
  return /\.(?:md|mdx|rst|adoc|html)$/iu.test(name)
    || name.startsWith('docs/')
    || name.startsWith('config/examples/')
    || ['BRIDGE-READINESS.json', 'PROVENANCE.json', 'UPSTREAM-REFERENCES.json'].includes(name);
}

export function checkDocumentationIndex(paths, index) {
  if (index?.schemaVersion !== 1 || !Array.isArray(index.documents)) throw new Error('PUBLIC_DOCUMENTATION_INDEX_INVALID');
  const entries = new Map();
  for (const entry of index.documents) {
    if (typeof entry.path !== 'string' || entries.has(entry.path)
      || !['PUBLIC_SAFE', 'HISTORICAL_TEST_EVIDENCE'].includes(entry.classification)) {
      throw new Error('PUBLIC_DOCUMENTATION_CLASSIFICATION_INVALID');
    }
    entries.set(entry.path, entry.classification);
  }
  const documents = paths.filter(isPublicDocument);
  if (documents.length !== entries.size || documents.some(name => !entries.has(name))) {
    throw new Error('PUBLIC_DOCUMENTATION_COVERAGE_MISMATCH');
  }
  return documents;
}

export function auditPublicDocumentation(root = path.resolve(import.meta.dirname, '..')) {
  const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).split('\0').filter(Boolean);
  const index = JSON.parse(readFileSync(path.join(root, 'docs/publication-index.json'), 'utf8'));
  const documents = checkDocumentationIndex(paths, index);
  const findings = [];
  for (const name of documents) {
    const text = readFileSync(path.join(root, name), 'utf8');
    for (const code of documentationFindings(name, text)) findings.push({ path: name, code });
    if (name.endsWith('.md')) {
      for (const match of text.matchAll(/\]\(([^)]+)\)/gu)) {
        const link = match[1].split('#')[0];
        if (!link || /^(?:https?:|mailto:)/iu.test(link)) continue;
        const resolved = path.resolve(root, path.dirname(name), link);
        const relative = path.relative(root, resolved);
        if (relative.startsWith('..') || path.isAbsolute(relative) || !existsSync(resolved)) {
          findings.push({ path: name, code: 'PUBLIC_DOCUMENTATION_LINK_INVALID' });
        }
      }
    }
  }
  for (const name of ['README.md', 'SECURITY.md']) {
    if (!readFileSync(path.join(root, name), 'utf8').includes(PUBLIC_SECURITY_STATEMENT)) {
      findings.push({ path: name, code: 'PUBLIC_SECURITY_STATEMENT_MISSING' });
    }
  }
  return { status: findings.length ? 'FAIL' : 'PASS', documents: documents.length, findings,
    scope: 'Current public documentation classification, selected disclosures and local links; human review remains required.' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = auditPublicDocumentation();
    console.log(JSON.stringify(result));
    if (result.status !== 'PASS') process.exitCode = 1;
  } catch {
    console.error('PUBLIC_DOCUMENTATION_AUDIT_FAILED');
    process.exitCode = 1;
  }
}
