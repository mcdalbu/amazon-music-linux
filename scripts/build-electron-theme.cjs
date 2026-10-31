'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'electron-wrapper/gtk-theme.node');
const flags = execFileSync('pkg-config', ['--cflags', '--libs', 'gtk+-3.0'], { encoding: 'utf8' }).trim().split(/\s+/);
execFileSync(process.env.CC || '/usr/bin/gcc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-fPIC', '-shared',
  '-DNAPI_VERSION=8', '-I' + path.join(root, 'vendor/node-api'), path.join(root, 'electron-wrapper/gtk-theme.c'),
  '-o', target + '.tmp', ...flags], { stdio: 'inherit' });
fs.renameSync(target + '.tmp', target);
