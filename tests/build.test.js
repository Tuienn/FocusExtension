import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const builder = join(root, 'scripts', 'build.py');

function runBuild(outputDir) {
  const result = spawnSync('python3', [builder, '--output-dir', outputDir], {
    cwd: tmpdir(), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function inspectZip(file) {
  const script = String.raw`import json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 print(json.dumps({'names': z.namelist(), 'manifest': json.loads(z.read('manifest.json'))}))`;
  const result = spawnSync('python3', ['-c', script, file], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('builds deterministic Chrome, Edge, and Firefox archives with scoped contents', () => {
  const output = mkdtempSync(join(tmpdir(), 'focus-guard-build-'));
  try {
    const unrelated = join(output, 'keep-me.txt');
    writeFileSync(unrelated, 'preserve');
    runBuild(output);
    const archives = ['chrome', 'edge', 'firefox'].map(browser => join(output, `focus-guard-${browser}.zip`));
    const first = archives.map(file => readFileSync(file));
    runBuild(output);
    assert.deepEqual(archives.map(file => readFileSync(file)), first);
    assert.equal(readFileSync(unrelated, 'utf8'), 'preserve');

    const [chrome, edge, firefox] = archives.map(inspectZip);
    assert.deepEqual(chrome.names, edge.names);
    assert.deepEqual(chrome.names, firefox.names);
    assert.ok(chrome.names.includes('manifest.json'));
    assert.ok(chrome.names.includes('assets/LICENSE.txt'));
    assert.ok(chrome.names.includes('assets/icon128.png'));
    assert.ok(chrome.names.includes('assets/pixel.woff'));
    assert.ok(!chrome.names.some(name => /(^|\/)(tests?|docs?|\.git|node_modules)(\/|$)|README|DECISIONS/.test(name)));
    assert.deepEqual(chrome.manifest, edge.manifest);
    assert.deepEqual(chrome.manifest.background, { service_worker: 'background.js', type: 'module' });
    assert.equal(chrome.manifest.minimum_chrome_version, '120');
    assert.deepEqual(firefox.manifest.background, { scripts: ['background.js'], type: 'module' });
    assert.ok(!Object.hasOwn(firefox.manifest, 'minimum_chrome_version'));
    assert.deepEqual(firefox.manifest.browser_specific_settings.gecko, {
      id: 'focus-guard@focusguard.local',
      strict_min_version: '140.0',
      data_collection_permissions: { required: ['none'] },
    });
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
