#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { scan, VERSION } = require('../src/scan');
const { render, toJson } = require('../src/report');
const { SEVERITY_RANK } = require('../src/util');

const USAGE = `gitspawn-scan ${VERSION} — pre-flight scan for folders you are about to
hand to an AI coding agent.

usage
  gitspawn-scan [path] [options]

options
  --json              machine-readable output
  --fail-on <level>   critical | high | medium | low | info | none   (default: high)
  --quiet, -q         hide info and low findings
  --short             omit the explanation block
  --no-color          disable ANSI colour
  --help, -h          show this message
  --version, -V       print the version

exit codes
  0  nothing at or above --fail-on
  1  findings at or above --fail-on
  2  usage or I/O error

reads only. gitspawn-scan never modifies the folder it scans.`;

function parseArgs(argv) {
  const opts = {
    target: null,
    json: false,
    quiet: false,
    short: false,
    color: process.stdout.isTTY !== false,
    failOn: 'high',
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--version' || arg === '-V') opts.version = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--quiet' || arg === '-q') opts.quiet = true;
    else if (arg === '--short') opts.short = true;
    else if (arg === '--no-color') opts.color = false;
    else if (arg === '--color') opts.color = true;
    else if (arg === '--fail-on') opts.failOn = String(argv[++i] || '').toLowerCase();
    else if (arg.startsWith('--fail-on=')) opts.failOn = arg.slice(10).toLowerCase();
    else if (arg.startsWith('-') && arg !== '-') {
      return { error: `unknown option: ${arg}` };
    } else if (opts.target === null) {
      opts.target = arg;
    } else {
      return { error: `unexpected argument: ${arg}` };
    }
  }

  if (opts.failOn !== 'none' && !(opts.failOn in SEVERITY_RANK)) {
    return { error: `invalid --fail-on value: ${opts.failOn}` };
  }

  return { opts };
}

function main() {
  const { opts, error } = parseArgs(process.argv.slice(2));

  if (error) {
    process.stderr.write(`gitspawn-scan: ${error}\n\n${USAGE}\n`);
    return 2;
  }
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (opts.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const target = opts.target || '.';

  if (!fs.existsSync(target)) {
    process.stderr.write(`gitspawn-scan: no such path: ${target}\n`);
    return 2;
  }
  // A file would scan as an empty folder and report "clean", which is the one
  // answer this tool must never give by accident.
  if (!fs.statSync(target).isDirectory()) {
    process.stderr.write(`gitspawn-scan: not a directory: ${target}\n`);
    return 2;
  }

  let result;
  try {
    result = scan(target);
  } catch (err) {
    process.stderr.write(`gitspawn-scan: scan failed: ${err && err.message}\n`);
    return 2;
  }

  if (opts.json) {
    process.stdout.write(`${toJson(result)}\n`);
  } else {
    process.stdout.write(`${render(result, opts)}\n`);
  }

  if (opts.failOn === 'none') return 0;
  const failing = result.findings.some((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK[opts.failOn]);
  return failing ? 1 : 0;
}

process.exitCode = main();
