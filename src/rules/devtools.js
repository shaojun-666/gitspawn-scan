'use strict';

// Rules for editor, container, package-manager and task-runner configuration
// that executes without an explicit request from you.
//
// Every rule iterates facts.notables(), which yields one record per base
// directory (the scanned root and every repository found beneath it), so a
// hostile .npmrc in a vendored subdirectory is caught even though the literal
// path is not what the rule is looking for.

const NPM_DEFAULT_REGISTRY = 'registry.npmjs.org';

function check(facts) {
  return [
    ...vscodeTasks(facts),
    ...devcontainer(facts),
    ...direnv(facts),
    ...npmrc(facts),
    ...yarnrc(facts),
    ...packageScripts(facts),
    ...setupPy(facts),
    ...husky(facts),
  ];
}

function vscodeTasks(facts) {
  const out = [];
  for (const { path: rel } of facts.notables('.vscode/tasks.json')) {
    const data = facts.json(rel);
    if (!data || typeof data !== 'object') continue;
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];

    for (const task of tasks) {
      if (!task || typeof task !== 'object') continue;
      const runOn = task.runOptions && task.runOptions.runOn;
      if (runOn !== 'folderOpen') continue;
      out.push({
        ruleId: 'GS040',
        severity: 'critical',
        title: `VS Code task "${task.label || '(unlabelled)'}" runs automatically when the folder is opened`,
        rationale: '"runOptions": { "runOn": "folderOpen" } makes the editor execute the task with no click and no prompt as soon as the workspace loads. If your editor and the agent share a workspace, opening the folder is enough.',
        remediation: 'Remove the task, or drop its runOptions.runOn setting.',
        file: rel,
        line: null,
        key: 'runOptions.runOn',
        evidence: String(task.command || task.label || '(no command)'),
      });
    }
  }
  return out;
}

function devcontainer(facts) {
  const out = [];
  const KEYS = ['initializeCommand', 'onCreateCommand', 'postCreateCommand', 'updateContentCommand'];

  for (const { path: rel } of facts.notables(['.devcontainer/devcontainer.json', '.devcontainer.json'])) {
    const data = facts.json(rel);
    if (!data || typeof data !== 'object') continue;

    for (const key of KEYS) {
      if (!data[key]) continue;
      out.push({
        ruleId: 'GS041',
        severity: 'medium',
        title: `devcontainer lifecycle command "${key}" executes on container start`,
        rationale: 'Dev container lifecycle commands run inside the container when it is created or started. They are visible in the config, but they are also the kind of setup step people approve without reading.',
        remediation: `Read the "${key}" entry in ${rel}. Remove it if you did not expect it.`,
        file: rel,
        line: null,
        key,
        evidence: typeof data[key] === 'string' ? data[key] : JSON.stringify(data[key]),
      });
    }
  }
  return out;
}

function direnv(facts) {
  const out = [];
  for (const { path: rel } of facts.notables('.envrc')) {
    out.push({
      ruleId: 'GS042',
      severity: 'high',
      title: '.envrc executes shell code when the directory is entered',
      rationale: 'With direnv installed, entering a directory containing .envrc runs it in your shell. That includes every subshell an agent spawns with a working directory set here.',
      remediation: 'Review .envrc before allowing it, or remove it. Run `direnv deny .` to block it for this directory.',
      file: rel,
      line: null,
      key: 'envrc',
      evidence: '.envrc',
    });
  }
  return out;
}

function npmrc(facts) {
  const out = [];

  for (const { path: rel } of facts.notables('.npmrc')) {
    const text = facts.read(rel);
    if (text === null) continue;
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#') || line.startsWith(';')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim().toLowerCase();
      const value = line.slice(eq + 1).trim();
      const at = { file: rel, line: i + 1, key: line.slice(0, eq).trim() };

      if (key === 'onload-script') {
        out.push({
          ruleId: 'GS043',
          severity: 'critical',
          title: 'npm is configured to run a script on every invocation',
          rationale: 'onload-script makes npm require a module at startup for every npm command. That includes the install an agent runs to get your project building.',
          remediation: `Remove the onload-script line from ${rel}.`,
          ...at,
          evidence: value,
        });
      } else if (key === 'registry' && value && !value.includes(NPM_DEFAULT_REGISTRY)) {
        out.push({
          ruleId: 'GS044',
          severity: 'high',
          title: 'npm registry is redirected to a third-party host',
          rationale: 'A repository-level registry override points every install at that host instead of npmjs.org — the standard dependency-confusion primitive. Package names your project already uses resolve to whatever the host chooses to serve.',
          remediation: `Remove the registry line from ${rel}, or point it back at ${NPM_DEFAULT_REGISTRY}.`,
          ...at,
          evidence: value,
        });
      } else if (key === 'ignore-scripts' && /^(false|0|no)$/i.test(value)) {
        out.push({
          ruleId: 'GS045',
          severity: 'medium',
          title: 'install scripts are explicitly re-enabled in project config',
          rationale: 'ignore-scripts=false re-enables lifecycle scripts that a user may have disabled globally as a safety measure. Re-enabling it per-project is how a repo restores an execution path you had turned off.',
          remediation: `Remove the ignore-scripts line from ${rel}.`,
          ...at,
          evidence: value,
        });
      } else if (/_authToken$/i.test(key)) {
        out.push({
          ruleId: 'GS046',
          severity: 'info',
          title: 'an auth token is committed in .npmrc',
          rationale: 'A committed registry token is a credential leak. It is included here because it is a sign the file was not meant to be public.',
          remediation: `Remove the token from ${rel} and rotate it.`,
          ...at,
          evidence: '(value redacted)',
        });
      }
    }
  }
  return out;
}

function yarnrc(facts) {
  const out = [];

  for (const { path: rel } of facts.notables('.yarnrc.yml')) {
    const text = facts.read(rel);
    if (text === null) continue;
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#')) continue;

      if (/^yarnPath\s*:/.test(line)) {
        out.push({
          ruleId: 'GS047',
          severity: 'high',
          title: 'yarn runs a JavaScript file from inside the repository',
          rationale: 'yarnPath makes yarn execute a bundled .cjs file instead of the installed release. It is a supported Yarn feature and an equally supported way to run arbitrary code on the first yarn command.',
          remediation: `Confirm the file named in ${rel} is the Yarn release you expect, or remove the yarnPath entry.`,
          file: rel,
          line: i + 1,
          key: 'yarnPath',
          evidence: line,
        });
      } else if (/^plugins\s*:/.test(line)) {
        out.push({
          ruleId: 'GS048',
          severity: 'medium',
          title: 'yarn loads plugins from inside the repository',
          rationale: 'Yarn plugins are JavaScript loaded into the yarn process. A repository-supplied plugin runs on the first yarn command.',
          remediation: `Review the plugin paths in ${rel}.`,
          file: rel,
          line: i + 1,
          key: 'plugins',
          evidence: line,
        });
      }
    }
  }
  return out;
}

const LIFECYCLE = ['preinstall', 'install', 'postinstall', 'prepare'];

function packageScripts(facts) {
  const out = [];

  for (const { path: rel } of facts.notables('package.json')) {
    const data = facts.json(rel);
    if (!data || typeof data !== 'object') continue;
    if (!data.scripts || typeof data.scripts !== 'object') continue;

    for (const key of LIFECYCLE) {
      const cmd = data.scripts[key];
      if (typeof cmd !== 'string' || !cmd.trim()) continue;
      out.push({
        ruleId: 'GS049',
        severity: 'medium',
        title: `package.json defines a "${key}" lifecycle script`,
        rationale: `The "${key}" script runs automatically during install. It is the oldest and best-known code-execution vector in the npm ecosystem, which is exactly why it is also the one people stop looking at.`,
        remediation: `Read the "${key}" script, or install with --ignore-scripts when you do not need it.`,
        file: rel,
        line: null,
        key: `scripts.${key}`,
        evidence: cmd,
      });
    }
  }
  return out;
}

function setupPy(facts) {
  const out = [];
  for (const { path: rel } of facts.notables('setup.py')) {
    out.push({
      ruleId: 'GS050',
      severity: 'medium',
      title: 'setup.py executes as Python code during install',
      rationale: 'Installing a project with a setup.py runs the file, including any top-level code in it. This applies to `pip install .` and to many editable installs.',
      remediation: 'Read setup.py before installing, or install from a built wheel.',
      file: rel,
      line: null,
      key: 'setup.py',
      evidence: 'setup.py',
    });
  }
  return out;
}

function husky(facts) {
  const out = [];

  for (const dir of facts.notableDirs('.husky')) {
    for (const name of dir.entries) {
      if (name.startsWith('_') || name === '.gitignore') continue;
      out.push({
        ruleId: 'GS051',
        severity: 'medium',
        title: `git hook installed via husky: ${name}`,
        rationale: 'Husky hooks live in version control and run on commit, push and other routine git operations. They are reviewable — unlike hooks in .git/hooks — but they still execute automatically.',
        remediation: 'Read the hook script before committing in this repository.',
        file: `${dir.path}/${name}`,
        line: null,
        key: 'husky',
        evidence: name,
      });
    }
  }
  return out;
}

module.exports = [{ id: 'devtools', check }];
