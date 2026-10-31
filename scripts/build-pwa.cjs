"use strict";
// Separate package: the GTK/Electron release and its bundled runtimes are untouched.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const version = '0.6.0';
const name = 'amazon-music-pwa-' + version;
const base = path.join(root, 'build/pwa-rpm');
const stage = path.join(base, 'stage', name);
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
for (const directory of ['pwa', 'assets'])
  fs.cpSync(path.join(root, directory), path.join(stage, directory), { recursive: true });
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(stage, 'LICENSE'));
for (const directory of ['BUILD', 'BUILDROOT', 'RPMS', 'SOURCES', 'SPECS', 'SRPMS', 'tmp'])
  fs.mkdirSync(path.join(base, directory), { recursive: true });
const source = path.join(base, 'SOURCES', name + '.tar.gz');
execFileSync('tar', ['-czf', source, '-C', path.dirname(stage), name]);
const spec = path.join(base, 'SPECS/amazon-music-pwa.spec');
fs.writeFileSync(spec, fs.readFileSync(path.join(root, 'pwa/amazon-music-pwa.spec.in'), 'utf8').replaceAll('@VERSION@', version));
execFileSync('rpmbuild', ['-bb', '--define', '_topdir ' + base,
  '--define', '_tmppath ' + path.join(base, 'tmp'), spec], { stdio: 'inherit' });
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
for (const file of fs.readdirSync(path.join(base, 'RPMS/noarch')).filter(file => file.endsWith('.rpm'))) {
  const output = path.join(dist, file);
  fs.copyFileSync(path.join(base, 'RPMS/noarch', file), output);
  fs.writeFileSync(output + '.sha256', createHash('sha256').update(fs.readFileSync(output)).digest('hex') + '  ' + file + '\n');
  console.log('RPM:', output);
}
