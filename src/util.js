'use strict';

const fs = require('fs');
const path = require('path');

const SEVERITY_ORDER = ['info', 'low', 'medium', 'high', 'critical'];
const SEVERITY_RANK = Object.fromEntries(SEVERITY_ORDER.map((s, i) => [s, i]));

const MAX_FILE_BYTES = 2 * 1024 * 1024;

function statSafe(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function lstatSafe(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

function isDir(p) {
  const s = statSafe(p);
  return !!s && s.isDirectory();
}

function isFile(p) {
  const s = statSafe(p);
  return !!s && s.isFile();
}

function isSymlink(p) {
  const s = lstatSafe(p);
  return !!s && s.isSymbolicLink();
}

function readText(p, max = MAX_FILE_BYTES) {
  const s = statSafe(p);
  if (!s || !s.isFile() || s.size > max) return null;
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

// null = missing, undefined = present but unparseable
function readJson(p) {
  const t = readText(p);
  if (t === null) return null;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

function listDir(p) {
  try {
    return fs.readdirSync(p).sort();
  } catch {
    return [];
  }
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

// Repo-relative when inside the target, absolute otherwise (e.g. a gitdir
// pointer that escapes the scanned folder).
function displayPath(root, p) {
  const r = toPosix(path.relative(root, p));
  return r === '' ? '.' : r.startsWith('..') ? toPosix(p) : r;
}

module.exports = {
  SEVERITY_ORDER,
  SEVERITY_RANK,
  statSafe,
  lstatSafe,
  isDir,
  isFile,
  isSymlink,
  readText,
  readJson,
  listDir,
  toPosix,
  displayPath,
};
