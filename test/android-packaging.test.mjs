import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assetLinks, assetLinksUrl, verifyAssetLinks } from '../android/scripts/assetlinks.mjs';

// Synthetic values for validation tests only, never published or used for signing.
const first = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join(':');
const second = Array.from({ length: 32 }, (_, i) => (i + 32).toString(16).padStart(2, '0')).join(':');
const packageId = 'edu.uconn.law.cgs';

test('asset links require actual-format fingerprints and preserve multiple signing certificates', () => {
  for (const invalid of [[], ['INSERT_PLAY_SHA256'], ['AA:BB'], ['xx:'.repeat(31) + 'xx']]) {
    assert.throws(() => assetLinks(packageId, invalid), /fingerprint/);
  }
  assert.throws(() => assetLinks('not a package', [first]), /application ID/);
  const statements = assetLinks(packageId, [first, first.toUpperCase(), second]);
  assert.deepEqual(statements[0].target.sha256_cert_fingerprints, [first.toUpperCase(), second.toUpperCase()]);
  assert.equal(statements[0].target.package_name, packageId);
});

test('verification stays at the origin root for project paths and future custom domains', async () => {
  const config = JSON.parse(await readFile(new URL('../android/twa-config.json', import.meta.url)));
  const pwa = JSON.parse(await readFile(new URL('../src/manifest.webmanifest', import.meta.url)));
  assert.equal(new URL(pwa.start_url, config.startUrl).href, config.startUrl);
  assert.equal(new URL(pwa.scope, config.startUrl).href, config.startUrl);
  assert.equal(assetLinksUrl(config.startUrl), 'https://uconn-law-library.github.io/.well-known/assetlinks.json');
  assert.equal(assetLinksUrl('https://statutes.example.edu/'), 'https://statutes.example.edu/.well-known/assetlinks.json');
  for (const url of ['http://example.edu/', 'https://example.edu/CGS', 'https://example.edu/#/', 'https://user@example.edu/']) {
    assert.throws(() => assetLinksUrl(url), /HTTPS directory/);
  }
});

test('live verification rejects redirects, wrong MIME types, packages and signing certificates', async () => {
  const expected = assetLinks(packageId, [first, second]);
  const verify = response => verifyAssetLinks('https://example.edu/.well-known/assetlinks.json', expected,
    async (_url, options) => { assert.equal(options.redirect, 'manual'); return response; });
  await verify(Response.json(expected));
  await assert.rejects(verify(new Response('', { status: 302 })), /without redirects/);
  await assert.rejects(verify(new Response(JSON.stringify(expected))), /application\/json/);
  await assert.rejects(verify(Response.json(assetLinks(packageId, [first]))), /every supplied fingerprint/);
  await assert.rejects(verify(Response.json(assetLinks('edu.example.other', [first, second]))), /configured package/);
});
