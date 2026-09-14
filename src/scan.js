'use strict';

const path = require('path');
const {
  statSafe, isDir, isFile, isSymlink, readText, listDir, displayPath, SEVERITY_RANK,
} = require('./util');
const { parseGitConfig } = require('./gitconfig');

const RULE_SETS = [
  require('./rules/gitconfig'),
  require('./rules/gitdir'),
  require('./rules/agent'),
  require('./rules/devtools'),
];

const VERSION = require('../package.json').version;

const MAX_GIT_DEPTH = 4;

// Deliberately short. A false negative is the worst failure mode for this tool,
// so build and dependency directories are still descended into — an agent will
// happily cd into vendor/ or build/. node_modules is the one exception: it is
// large enough to dominate the walk and never contains a repository an agent
// operates inside.
const SKIP_DIRS = new Set(['node_modules', '.git']);

const NOTABLE_FILES = [
  '.gitattributes',
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.mcp.json',
  '.cursor/mcp.json',
  '.vscode/mcp.json',
  '.vscode/tasks.json',
  '.devcontainer/devcontainer.json',
  '.devcontainer.json',
  '.envrc',
  '.npmrc',
  '.yarnrc.yml',
  'package.json',
  'setup.py',
  '.gemini/settings.json',
  'AGENTS.md',
  'CLAUDE.md',
];

const NOTABLE_DIRS = ['.husky'];

function isInside(root, p) {
  const r = path.relative(root, p);
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
}

// A GitSpawn payload must arrive with the .git directory intact (an ordinary
// `git clone` does not transfer it), so the interesting thing is rarely only
// at the top level. Nested repositories and pointer files count too.
function findGitRepos(root) {
  const repos = [];

  const walk = (dir, depth) => {
    const gitPath = path.join(dir, '.git');
    const st = statSafe(gitPath);

    if (st) {
      const asFile = st.isFile();
      let pointer = null;
      let gitDir = gitPath;

      if (asFile) {
        const text = readText(gitPath) || '';
        const m = text.match(/^\s*gitdir:\s*(.+?)\s*$/m);
        pointer = m ? m[1] : null;
        gitDir = pointer ? path.resolve(dir, pointer) : null;
      }

      repos.push({
        workdir: dir,
        gitPath,
        gitDir,
        asFile,
        pointer,
        escapesTarget: !!gitDir && !isInside(root, gitDir),
        hooks: [],
      });
    }

    if (depth >= MAX_GIT_DEPTH) return;
    for (const name of listDir(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const p = path.join(dir, name);
      if (isSymlink(p)) continue; // avoid symlink cycles
      if (isDir(p)) walk(p, depth + 1);
    }
  };

  walk(root, 0);
  return repos;
}

function collectFacts(root) {
  const gitRepos = findGitRepos(root);
  const bases = [...new Set([root, ...gitRepos.map((r) => r.workdir)])];

  const files = new Set();
  const absByRel = new Map();
  const textCache = new Map();
  const notables = [];
  const notableDirs = [];

  const register = (abs) => {
    const rel = displayPath(root, abs);
    files.add(rel);
    absByRel.set(rel, abs);
    return rel;
  };

  // Notables are checked once per base directory, so a nested repository's
  // .npmrc is found even when the scanned root is several levels above it.
  // Each one is carried as a record rather than keyed by its literal name,
  // because that name is only unique within its own base.
  for (const base of bases) {
    for (const name of NOTABLE_FILES) {
      const abs = path.join(base, name);
      if (!isFile(abs)) continue;
      notables.push({ name, path: register(abs), abs });
    }
    for (const name of NOTABLE_DIRS) {
      const abs = path.join(base, name);
      if (!isDir(abs)) continue;
      notableDirs.push({
        name,
        path: register(abs),
        abs,
        entries: listDir(abs).filter((n) => isFile(path.join(abs, n))),
      });
    }
  }

  const configs = [];
  for (const repo of gitRepos) {
    if (!repo.gitDir) continue;

    const hooksDir = path.join(repo.gitDir, 'hooks');
    if (isDir(hooksDir)) {
      repo.hooks = listDir(hooksDir).filter((n) => isFile(path.join(hooksDir, n)));
    }

    const cfgAbs = path.join(repo.gitDir, 'config');
    const rel = displayPath(root, cfgAbs);
    const text = readText(cfgAbs);

    if (text !== null) register(cfgAbs);

    configs.push({
      file: rel,
      entries: text === null ? [] : parseGitConfig(text),
    });
  }

  const facts = {
    root,
    configs,
    gitRepos,
    notables: (names) => {
      const want = names === undefined ? null : new Set(Array.isArray(names) ? names : [names]);
      return notables.filter((n) => !want || want.has(n.name));
    },
    notableDirs: (names) => {
      const want = names === undefined ? null : new Set(Array.isArray(names) ? names : [names]);
      return notableDirs.filter((n) => !want || want.has(n.name));
    },
    read(rel) {
      const abs = absByRel.get(rel) || path.join(root, rel);
      if (!textCache.has(abs)) textCache.set(abs, readText(abs));
      return textCache.get(abs);
    },
    json(rel) {
      const text = facts.read(rel);
      if (text === null) return null;
      try {
        return JSON.parse(text);
      } catch {
        return undefined;
      }
    },
    filesWith: (basename) => [...files].filter((f) => path.posix.basename(f) === basename),
    display: (abs) => displayPath(root, abs),
    repoLabel(repo) {
      const r = displayPath(root, repo.workdir);
      return r === '.' ? '' : `${r}/`;
    },
  };

  return facts;
}

function scan(target) {
  const root = path.resolve(target);
  const facts = collectFacts(root);

  const findings = [];
  for (const set of RULE_SETS) {
    for (const rule of set) {
      findings.push(...rule.check(facts));
    }
  }

  findings.sort((a, b) => {
    const d = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (d !== 0) return d;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return (a.line || 0) - (b.line || 0);
  });

  const summary = { info: 0, low: 0, medium: 0, high: 0, critical: 0, total: findings.length };
  for (const f of findings) summary[f.severity]++;

  return {
    tool: 'gitspawn-scan',
    version: VERSION,
    target: root,
    scannedAt: new Date().toISOString(),
    scope: {
      gitRepositories: facts.gitRepos.length,
    },
    summary,
    findings,
  };
}

module.exports = { scan, VERSION };
