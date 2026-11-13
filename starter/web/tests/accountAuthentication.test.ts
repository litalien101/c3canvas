import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const gateSource = readFileSync(new URL('../src/AccountGate.tsx', import.meta.url), 'utf8');
const apiClientSource = readFileSync(new URL('../src/apiClient.ts', import.meta.url), 'utf8');

test('workspace requires sign-in and offers local account creation', () => {
  assert.match(appSource, /requestJson<AuthSession>\('\/auth\/session'\)/);
  assert.match(appSource, /return <AccountGate\s+initialError=\{authError\}/);
  assert.match(gateSource, /Create your account/);
  assert.match(gateSource, /type="password"/);
  assert.match(gateSource, /minLength=\{mode === 'register' \? 12 : 1\}/);
  assert.match(appSource, /Sign out \$\{account\.username\}/);
});

test('API client sends session cookies and CSRF tokens on state-changing requests', () => {
  assert.match(apiClientSource, /credentials:\s*'include'/);
  assert.match(apiClientSource, /headers\.set\('X-CSRF-Token', csrfToken\)/);
  assert.match(appSource, /setCsrfToken\(session\.csrf_token\)/);
  assert.match(appSource, /apiFetch\(`\/projects\/\$\{project\.id\}\/references`/);
});
