'use strict';

// Rules about the shape of the .git directory itself, plus .gitattributes.

const path = require('path');

const HOOK_ALLOW = /\.sample$/i;
const FILTER_ALLOW = new Set(['lfs', 'git-crypt']);

function check(facts) {
  const out = [];

  for (const repo of facts.gitRepos) {
    const repoLabel = facts.repoLabel(repo);

    // A `.git` file means the real git directory lives elsewhere. GitSpawn
    // only needs the config to be readable; the pointer decides where from.
    if (repo.asFile) {
      const escapes = repo.escapesTarget;
      out.push({
        ruleId: 'GS020',
        severity: escapes ? 'high' : 'info',
        title: escapes
          ? '.git is a pointer to a git directory outside the scanned folder'
          : '.git is a pointer file rather than a directory',
        rationale: 'A ".git" file redirects git to a directory of the attacker\'s choosing, whose config, hooks and attributes are then trusted as if they belonged to this repository.',
        remediation: 'Inspect the target, or remove the repository and re-clone it from a source you trust.',
        file: facts.display(repo.gitPath),
        line: 1,
        key: 'gitdir',
        evidence: repo.pointer || '(unparsed)',
      });
    }

    if (!repo.gitDir) continue;

    for (const hook of repo.hooks) {
      if (HOOK_ALLOW.test(hook)) continue;
      out.push({
        ruleId: 'GS021',
        severity: 'critical',
        title: `executable git hook shipped in ${repoLabel}.git/hooks`,
        rationale: 'Hooks in .git/hooks are run by git itself, with your privileges, on routine operations: pre-commit on every commit, post-checkout on branch switches, post-merge on pulls. They never appear in a diff and are invisible to normal review.',
        remediation: 'Delete the hook file unless you recognise it: rm .git/hooks/<name>',
        file: facts.display(path.join(repo.gitDir, 'hooks', hook)),
        line: null,
        key: 'hooks',
        evidence: hook,
      });
    }
  }

  for (const rel of facts.filesWith('.gitattributes')) {
    const text = facts.read(rel);
    if (text === null) continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#')) continue;

      const filter = line.match(/(?:^|\s)filter=([A-Za-z0-9._-]+)/);
      if (filter && !FILTER_ALLOW.has(filter[1])) {
        out.push({
          ruleId: 'GS022',
          severity: 'medium',
          title: `unknown content filter "${filter[1]}" is applied to files`,
          rationale: 'A filter= attribute routes file content through the clean/smudge/process commands defined for that driver. The attributes file alone cannot execute anything, but it decides which files the driver touches — check that the matching filter.<driver> entries in .git/config are ones you expect.',
          remediation: 'Remove the filter attribute, or confirm the driver it names is one you trust.',
          file: rel,
          line: i + 1,
          key: 'filter',
          evidence: line,
        });
      }

      const diff = line.match(/(?:^|\s)diff=([A-Za-z0-9._-]+)/);
      if (diff && !FILTER_ALLOW.has(diff[1])) {
        out.push({
          ruleId: 'GS023',
          severity: 'medium',
          title: `custom diff driver "${diff[1]}" is applied to files`,
          rationale: 'A diff=<driver> attribute selects a driver whose command or textconv is executed by git when producing a diff. Verify the matching diff.<driver> entries in .git/config.',
          remediation: 'Remove the diff attribute, or confirm the driver it names is one you trust.',
          file: rel,
          line: i + 1,
          key: 'diff',
          evidence: line,
        });
      }
    }
  }

  return out;
}

module.exports = [{ id: 'gitdir', check }];
