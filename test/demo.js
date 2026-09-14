'use strict';

// `npm run demo` — scan the hostile fixture without touching the fixture.
//
// Scanning test/fixtures/evil-repo directly shows only the findings that live
// outside the git directory, because the fixture stores its git directory as
// `dot-git/`. This materialises a working copy first, which is how the sample
// output in the README was produced.

const { scan } = require('../src/scan');
const { render } = require('../src/report');
const { workDir, materialize } = require('./materialize');

const target = materialize('evil-repo', workDir());
const result = scan(target);

process.stdout.write(`${render(result, {
  color: process.stdout.isTTY !== false,
  quiet: false,
  short: false,
})}\n`);

process.exitCode = result.summary.critical > 0 ? 1 : 0;
