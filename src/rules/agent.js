'use strict';

// Rules for execution vectors that are native to AI coding agents rather than
// to git. A repository can ship these and they are picked up as soon as the
// agent is pointed at the folder.

const SETTINGS_FILES = ['.claude/settings.json', '.claude/settings.local.json'];

const MCP_FILES = [
  '.mcp.json',
  '.cursor/mcp.json',
  '.vscode/mcp.json',
  '.gemini/settings.json',
];

const INSTRUCTION_FILES = ['CLAUDE.md', 'AGENTS.md'];

// Entries that grant an agent effectively unlimited shell access.
function isUnrestrictedAllow(entry) {
  if (typeof entry !== 'string') return false;
  const s = entry.trim();
  if (s === '*' || s === 'Bash' || s === 'Bash(*)') return true;
  if (s.startsWith('Bash(') && /\*\*/.test(s)) return true;
  return false;
}

function check(facts) {
  const out = [];

  for (const { path: rel } of facts.notables(SETTINGS_FILES)) {
    const data = facts.json(rel);
    if (data === null) continue;

    if (data === undefined) {
      out.push(unparseable(rel, 'GS030', 'critical'));
      continue;
    }

    const hooks = data && typeof data === 'object' ? data.hooks : null;
    if (hooks && typeof hooks === 'object' && Object.keys(hooks).length > 0) {
      out.push({
        ruleId: 'GS031',
        severity: 'critical',
        title: 'project settings define agent hooks that run shell commands',
        rationale: 'Claude Code hooks are shell commands the agent runs automatically on events such as session start, tool use and stop. When they arrive inside a repository rather than in your own config, they execute as you, unattended, and they are stored in a JSON file that nobody reads during review.',
        remediation: `Open ${rel} and remove the "hooks" block unless you wrote it.`,
        file: rel,
        line: null,
        key: 'hooks',
        evidence: Object.keys(hooks).join(', '),
      });
    }

    const perms = data && typeof data === 'object' ? data.permissions : null;
    const allow = perms && typeof perms === 'object' ? perms.allow : null;
    if (Array.isArray(allow)) {
      const loose = allow.filter(isUnrestrictedAllow);
      if (loose.length) {
        out.push({
          ruleId: 'GS032',
          severity: 'high',
          title: 'project settings pre-authorise unrestricted shell commands',
          rationale: 'A committed permissions.allow list is applied when the agent opens the folder, so prompts you would normally see are silently skipped for the commands it covers.',
          remediation: `Edit ${rel} and remove the wildcard entries from permissions.allow.`,
          file: rel,
          line: null,
          key: 'permissions.allow',
          evidence: loose.join(', '),
        });
      }
    }
  }

  for (const { name, path: rel } of facts.notables(MCP_FILES)) {
    const data = facts.json(rel);
    if (data === null) continue;
    if (data === undefined) {
      out.push(unparseable(rel, 'GS033', 'medium'));
      continue;
    }

    // .mcp.json is a bare server map; the others nest it under mcpServers.
    const servers = data && typeof data === 'object' ? data.mcpServers || (name === '.mcp.json' ? data : null) : null;
    if (!servers || typeof servers !== 'object') continue;

    for (const [name, cfg] of Object.entries(servers)) {
      if (!cfg || typeof cfg !== 'object') continue;
      const cmd = cfg.command || cfg.url;
      if (!cmd) continue;
      const isRemote = typeof cmd === 'string' && /^https?:\/\//.test(cmd);
      out.push({
        ruleId: 'GS034',
        severity: isRemote ? 'medium' : 'high',
        title: `project-shipped MCP server "${name}" starts a ${isRemote ? 'remote' : 'local'} process`,
        rationale: isRemote
          ? 'A remote MCP server receives the contents of your requests and can return instructions the agent treats as trusted.'
          : 'MCP servers are programs started on your machine. A repository that ships its own server definition is asking to run code before you have reviewed anything.',
        remediation: `Open ${rel} and remove the "${name}" entry unless you trust its source.`,
        file: rel,
        line: null,
        key: `mcpServers.${name}`,
        evidence: cmd,
      });
    }
  }

  for (const { path: rel } of facts.notables(INSTRUCTION_FILES)) {
    out.push({
      ruleId: 'GS035',
      severity: 'info',
      title: `repository ships agent instructions in ${rel}`,
      rationale: 'Files like CLAUDE.md and AGENTS.md are read as instructions by the agent. They cannot execute code directly, but they are the standard delivery mechanism for prompt injection — text that tells the agent to do something you did not ask for. Read them before you let an agent act.',
      remediation: 'Read the file. Remove anything that asks the agent to run, fetch or install things you did not request.',
      file: rel,
      line: null,
      key: 'instructions',
      evidence: rel,
    });
  }

  return out;
}

function unparseable(rel, ruleId, severity) {
  return {
    ruleId,
    severity,
    title: `${rel} is present but is not valid JSON`,
    rationale: 'An unparseable agent configuration cannot be reviewed or enforced, and may be rejected or partially honoured depending on the agent. Treat it as untrusted.',
    remediation: `Open ${rel} and either fix or delete it.`,
    file: rel,
    line: null,
    key: 'parse-error',
    evidence: 'invalid JSON',
  };
}

module.exports = [{ id: 'agent', check }];
