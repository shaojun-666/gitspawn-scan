'use strict';

// Rules that match keys inside a repository's own .git/config.
//
// Everything here is a config value that git hands to a shell or to exec().
// The defining property of this class (GitSpawn, Sept 2026) is that execution
// happens inside git's own subprocess machinery, so it bypasses the agent's
// tool layer entirely: no permission prompt, no sandbox, and in several agents
// it fires before the workspace-trust dialog is even answered.
//
// Each rule: first match wins for a given config line.

const { isBooleanish } = require('../gitconfig');

const GITSPAWN = 'GitSpawn (Sept 2026): git reads this key from the repository\'s own .git/config and executes it as a command. Agent tooling runs `git status` / `git diff` constantly, and the execution happens inside git\'s subprocess machinery — outside the agent sandbox, without a confirmation dialog, and in some agents before the workspace-trust prompt. Eight findings across Claude Code, Codex, Cursor, Goose, Hermes, Qwen Code and Grok Build.';

const CRED_HELPER_ALLOW = new Set([
  'cache', 'store', 'manager', 'manager-core', 'manager-git', 'osxkeychain',
  'libsecret', 'gnome-keyring', 'secretservice', 'wincred', 'netrc', 'plaintext',
]);

function credHelperIsBenign(value) {
  const s = String(value).trim();
  if (s.startsWith('!')) return false; // explicit shell escape
  const base = s.split(/\s+/)[0];
  if (CRED_HELPER_ALLOW.has(base.toLowerCase())) return true;
  // A path to a real helper program, e.g. /usr/lib/git-core/git-credential-manager
  return /(^|[\\/])git-credential-[A-Za-z0-9._-]+$/.test(base);
}

const noSub = (e) => e.subsection === null;

const CONFIG_RULES = [
  {
    id: 'GS001',
    severity: 'critical',
    title: 'core.fsmonitor executes a program from the repository config',
    rationale: GITSPAWN,
    remediation: 'git config --unset core.fsmonitor',
    match: (e) => e.section === 'core' && noSub(e) && e.key === 'fsmonitor' && !isBooleanish(e.value),
  },
  {
    id: 'GS002',
    severity: 'critical',
    title: 'core.hooksPath redirects git hooks to an attacker-controlled directory',
    rationale: 'core.hooksPath replaces the hook directory git trusts. Every hook git would normally run — including pre-commit, post-checkout and post-merge — is then loaded from a path the repository itself chose.',
    remediation: 'git config --unset core.hooksPath',
    match: (e) => e.section === 'core' && noSub(e) && e.key === 'hookspath',
  },
  {
    id: 'GS003',
    severity: 'critical',
    title: 'core.sshCommand executes a program on every fetch and push',
    rationale: 'core.sshCommand overrides the ssh binary git invokes for any ssh remote. A fetch, a push, or an agent checking whether a remote is reachable executes it.',
    remediation: 'git config --unset core.sshCommand',
    match: (e) => e.section === 'core' && noSub(e) && e.key === 'sshcommand',
  },
  {
    id: 'GS004',
    severity: 'critical',
    title: 'credential.helper runs an unvetted program to collect credentials',
    rationale: 'git executes credential helpers as commands. Anything that is not a known platform helper — and anything starting with "!" — is arbitrary code, run at the moment the agent touches a remote.',
    remediation: 'git config --unset credential.helper',
    match: (e) => e.section === 'credential' && e.key === 'helper' && !credHelperIsBenign(e.value),
  },
  {
    id: 'GS005',
    severity: 'critical',
    title: 'diff driver executes a command or textconv filter',
    rationale: 'diff.external, diff.<driver>.command and diff.<driver>.textconv are spawned whenever git produces a diff. Agents diff constantly to orient themselves in a repository.',
    remediation: 'git config --unset diff.external   # and any diff.<driver>.command / .textconv',
    match: (e) => e.section === 'diff' && ((noSub(e) && e.key === 'external') || (e.subsection !== null && (e.key === 'command' || e.key === 'textconv'))),
  },
  {
    id: 'GS006',
    severity: 'critical',
    title: 'merge driver executes an attacker-supplied command',
    rationale: 'merge.<driver>.driver and merge.<driver>.recursive are executed by git during merges, rebases and cherry-picks — all routine agent operations.',
    remediation: 'git config --unset merge.<driver>.driver   # and .recursive',
    match: (e) => e.section === 'merge' && e.subsection !== null && (e.key === 'driver' || e.key === 'recursive'),
  },
  {
    id: 'GS007',
    severity: 'critical',
    title: 'clean/smudge filter executes a command on checkout',
    rationale: 'filter.<driver>.clean, .smudge and .process are run by git when content enters or leaves the repository. A checkout or a stash pop is enough to trigger them.',
    remediation: 'git config --unset filter.<driver>.clean   # and .smudge / .process',
    match: (e) => e.section === 'filter' && e.subsection !== null && (e.key === 'clean' || e.key === 'smudge' || e.key === 'process'),
  },
  {
    id: 'GS008',
    severity: 'high',
    title: 'gpg.program overrides the signing binary',
    rationale: 'The configured program is executed whenever git signs or verifies. Commit signing is disabled by default, so this is lower priority than the hooks and filters above.',
    remediation: 'git config --unset gpg.program',
    match: (e) => e.section === 'gpg' && (e.key === 'program'),
  },
  {
    id: 'GS009',
    severity: 'high',
    title: 'git alias escapes to a shell',
    rationale: 'An alias whose value begins with "!" is run through the shell. Aliases are invisible in normal use — the agent (or you) invokes a friendly name and gets a command.',
    remediation: 'git config --unset alias.<name>',
    match: (e) => e.section === 'alias' && e.subsection === null && String(e.value).trim().startsWith('!'),
  },
  {
    id: 'GS010',
    severity: 'high',
    title: 'include.path pulls configuration from outside this repository',
    rationale: 'include.path and includeIf.<condition>.path load additional config files, which can live anywhere on disk — including a path the attacker controls. The loaded file can define any of the keys above.',
    remediation: 'git config --unset include.path   # and any includeIf.*.path',
    match: (e) => e.section === 'include' && e.key === 'path' || e.section === 'includeif' && e.key === 'path',
  },
  {
    id: 'GS011',
    severity: 'high',
    title: 'submodule update command escapes to a shell',
    rationale: 'submodule.<name>.update accepts a "!<command>" form that git runs during submodule update and recursive clone — a common step in agent bootstrap routines.',
    remediation: 'git config --unset submodule.<name>.update',
    match: (e) => e.section === 'submodule' && e.key === 'update' && String(e.value).trim().startsWith('!'),
  },
  {
    id: 'GS012',
    severity: 'high',
    title: 'core.pager executes a program on paginated output',
    rationale: 'git runs the configured pager for commands like log, diff and show. Agents invoke these frequently, though most pipe output and so may not trigger the pager.',
    remediation: 'git config --unset core.pager',
    match: (e) => (e.section === 'core' && noSub(e) && e.key === 'pager') || (e.section === 'pager' && e.subsection === null && !isBooleanish(e.value)),
  },
  {
    id: 'GS013',
    severity: 'medium',
    title: 'editor override executes a program',
    rationale: 'core.editor, sequence.editor and interactive.diffFilter are executed when git needs an interactive editor or filter. Agents usually pass messages inline, so this fires less often.',
    remediation: 'git config --unset core.editor',
    match: (e) => (e.section === 'core' && noSub(e) && e.key === 'editor') || (e.section === 'sequence' && e.key === 'editor') || (e.section === 'interactive' && e.key === 'difffilter'),
  },
  {
    id: 'GS014',
    severity: 'medium',
    title: 'git proxy command is overridden',
    rationale: 'core.gitProxy names a program git runs to reach a remote. Combined with remote access this is a command execution channel, though it requires a network operation to trigger.',
    remediation: 'git config --unset core.gitProxy',
    match: (e) => e.section === 'core' && noSub(e) && e.key === 'gitproxy',
  },
  {
    id: 'GS015',
    severity: 'medium',
    title: 'url rewrite redirects a remote to another host',
    rationale: 'url.<base>.insteadOf silently rewrites remotes. It is a classic dependency-confusion primitive: the agent fetches what it believes is a trusted repository.',
    remediation: 'git config --unset url.<base>.insteadOf',
    match: (e) => e.section === 'url' && e.subsection !== null && e.key === 'insteadof',
  },
  {
    id: 'GS016',
    severity: 'medium',
    title: 'http proxy is overridden',
    rationale: 'An attacker-positioned proxy intercepts fetches and can serve different content than the upstream remote.',
    remediation: 'git config --unset http.proxy',
    match: (e) => e.section === 'http' && e.key === 'proxy',
  },
  {
    id: 'GS017',
    severity: 'medium',
    title: 'core.attributesFile points at an external attributes file',
    rationale: 'Attributes control which filter and diff drivers apply to which paths. Loading them from outside the repository lets the attacker enable a filter defined elsewhere.',
    remediation: 'git config --unset core.attributesFile',
    match: (e) => e.section === 'core' && noSub(e) && e.key === 'attributesfile',
  },
];

function check(facts) {
  const out = [];
  for (const cfg of facts.configs) {
    for (const e of cfg.entries) {
      for (const rule of CONFIG_RULES) {
        if (!rule.match(e)) continue;
        out.push({
          ruleId: rule.id,
          severity: rule.severity,
          title: rule.title,
          rationale: rule.rationale,
          remediation: rule.remediation,
          file: cfg.file,
          line: e.line,
          key: e.name,
          evidence: e.value,
        });
        break; // first matching rule wins for this line
      }
    }
  }
  return out;
}

module.exports = [{ id: 'gitconfig', check }];
module.exports.CONFIG_RULES = CONFIG_RULES;
