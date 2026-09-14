'use strict';

// The fixtures keep their git directories as `dot-git/`, because git refuses to
// track anything inside a directory named `.git` — a committed `.git` would
// silently vanish for everyone who clones the repository. Anything that needs a
// real one (the test suite, `npm run demo`) builds a working copy here.

const fs = require('fs');
const os = require('os');
const path = require('path');

const FIXTURES = path.join(__dirname, 'fixtures');

// Hand-rolled rather than fs.cpSync: cpSync aborts the process outright in some
// environments, even when copying a trivial directory inside the cwd.
function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else fs.copyFileSync(from, to);
  }
}

function workDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gitspawn-fixtures-'));
}

function materialize(name, root) {
  const dest = path.join(root, name);
  copyTree(path.join(FIXTURES, name), dest);
  fs.renameSync(path.join(dest, 'dot-git'), path.join(dest, '.git'));
  return dest;
}

module.exports = { FIXTURES, workDir, materialize };
