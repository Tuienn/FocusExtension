import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.background.type, 'module');
const files = ['background.js','core.js','popup.js','dashboard.js','content.js'];
for (const file of files) execFileSync(process.execPath, ['--check',file]);
for (const file of [manifest.background.service_worker, manifest.action.default_popup,
  ...Object.values(manifest.icons), ...manifest.web_accessible_resources.flatMap(r => r.resources),
  'dashboard.html','styles.css','gate.css']) assert(existsSync(file), `Missing ${file}`);
for (const html of ['popup.html','dashboard.html']) {
  const text = readFileSync(html, 'utf8');
  assert(!/<script(?![^>]*\bsrc=)/i.test(text), `Inline script in ${html}`);
  assert(!/\son\w+\s*=/i.test(text), `Inline handler in ${html}`);
  assert(/lang="en"/.test(text));
}
const woff = readFileSync('assets/pixel.woff');
assert.equal(woff.toString('ascii',0,4),'wOFF');
assert.equal(woff.readUInt32BE(8),woff.length);
assert.equal(readFileSync('assets/icon128.png').toString('hex',0,8),'89504e470d0a1a0a');
const shipped = [...files,'manifest.json','popup.html','dashboard.html','styles.css','gate.css','assets/pixel.woff',...Object.values(manifest.icons)];
const size = shipped.reduce((total,file) => total+statSync(file).size,0);
console.log(`Manifest, JavaScript, HTML and local assets OK. Runtime package: ${(size/1024).toFixed(1)} KiB.`);
