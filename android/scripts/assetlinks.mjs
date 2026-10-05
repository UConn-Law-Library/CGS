#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export function assetLinks(applicationId, fingerprints) {
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/.test(applicationId)) {
    throw new Error('Expected a reverse-domain Android application ID.');
  }
  if (!fingerprints.length) throw new Error('Supply at least one real signing certificate SHA-256 fingerprint.');
  const normalized = fingerprints.map(value => value.trim().toUpperCase());
  if (normalized.some(value => !/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value))) {
    throw new Error('Each fingerprint must contain 32 colon-separated hexadecimal bytes; placeholders are rejected.');
  }
  return [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: applicationId,
      sha256_cert_fingerprints: [...new Set(normalized)]
    }
  }];
}

export function assetLinksUrl(startUrl) {
  const url = new URL(startUrl);
  if (url.protocol !== 'https:' || url.port || url.username || url.password ||
      url.search || url.hash || !url.pathname.endsWith('/')) {
    throw new Error('startUrl must be an HTTPS directory URL with no port, credentials, query, or fragment.');
  }
  return new URL('/.well-known/assetlinks.json', url).href;
}

export async function verifyAssetLinks(url, expected, fetcher = fetch) {
  const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
  if (response.status !== 200) throw new Error(`Expected HTTP 200 without redirects at ${url}; got ${response.status}.`);
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
    throw new Error('assetlinks.json must be served as application/json.');
  }
  const actual = await response.json();
  const target = expected[0].target;
  const matches = Array.isArray(actual) ? actual.filter(statement =>
    statement.relation?.includes('delegate_permission/common.handle_all_urls') &&
    statement.target?.namespace === 'android_app' &&
    statement.target.package_name === target.package_name) : [];
  const published = matches.flatMap(statement => statement.target.sha256_cert_fingerprints ?? []);
  if (!target.sha256_cert_fingerprints.every(value => published.includes(value))) {
    throw new Error('Published asset links do not authorize the configured package and every supplied fingerprint.');
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    fingerprint: { type: 'string', multiple: true, default: [] },
    output: { type: 'string' },
    verify: { type: 'boolean', default: false }
  } });
  const config = JSON.parse(await readFile(new URL('../twa-config.json', import.meta.url), 'utf8'));
  const url = assetLinksUrl(config.startUrl);
  const statements = assetLinks(config.applicationId, values.fingerprint);
  if (values.verify) {
    if (values.output) throw new Error('Use --output to generate OR --verify to check the live origin.');
    await verifyAssetLinks(url, statements);
    console.log(`Verified package and certificate statements at ${url}. Also test Android and Chrome verification on a device.`);
  } else {
    if (!values.output) throw new Error('Use --output <path> to write a file, or --verify to check the live origin.');
    const output = path.resolve(values.output);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(statements, null, 2)}\n`, { flag: 'wx' });
    console.log(`Created ${output}. Publish at ${url}. Merge with existing origin statements; do not overwrite other apps.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
