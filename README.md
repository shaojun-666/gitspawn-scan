# gitspawn-scan

[![test](https://github.com/shaojun-666/gitspawn-scan/actions/workflows/test.yml/badge.svg)](https://github.com/shaojun-666/gitspawn-scan/actions/workflows/test.yml)

**A folder can run code at you before your AI agent finishes opening it. Check first.**

```bash
npx gitspawn-scan ~/Downloads/that-repo-someone-sent-me
```

One command. Nothing to install, no dependencies. It reads files as text and
tells you what *will execute* when you open the folder — before you point an
agent at it.

```console
$ npx gitspawn-scan ~/Downloads/pitch-deck-optimizer

gitspawn-scan 0.1.0
target  /home/you/Downloads/pitch-deck-optimizer
scope   1 git directory · 32 findings

  CRITICAL  GS001  core.fsmonitor executes a program from the repository config
          at      .git/config:5
          key     core.fsmonitor
          value   /tmp/payload.sh
          fix     git config --unset core.fsmonitor
          GitSpawn (Sept 2026): git reads this key from the repository's own
          .git/config and executes it as a command. Agent tooling runs `git
          status` / `git diff` constantly, and the execution happens inside
          git's subprocess machinery — outside the agent sandbox, without a
          confirmation dialog, and in some agents before the workspace-trust
          prompt.

  CRITICAL  GS031  project settings define agent hooks that run shell commands
          at      .claude/settings.json
          key     hooks
          value   SessionStart
          fix     Open .claude/settings.json and remove the "hooks" block
                  unless you wrote it.
  ...

──────────────────────────────────────────────────────────────────────────────
15 critical · 8 high · 8 medium · 1 info

STOP. Do not open this folder with an agent until the critical findings are cleared.

Harden every repository at once: git config --global core.fsmonitor false
```

Exit code is `1` when anything is found at or above `--fail-on high`, so it drops
straight into a script or a CI step.

---

## Is it safe to run this on a folder I already think is hostile?

**Yes — that is what it is built for.** `gitspawn-scan` never executes anything.
It opens files, reads them as text, and prints what it found. It does not import
the code, does not run `git` inside the folder, and does not write to it.

Pointing a scanner at a folder you already suspect is the one case where you
cannot afford it to be sloppy, so it is also the case the test suite pins down:
one of the 71 tests asserts the scanner leaves the hostile fixture byte-for-byte
unchanged.

You can also read the whole thing before running it. It is about 1,400 lines with
no dependencies — nothing happens that you cannot trace in `src/`.

## Install

Node 18+ and zero dependencies. That matters more here than in most projects: a
security tool that pulls a dependency tree is asking you to do the thing it is
warning you about.

```bash
npx gitspawn-scan .                   # scan the folder you are in
npx gitspawn-scan ~/Downloads/thing   # scan something you were sent
```

To keep it around instead of re-fetching:

```bash
npm install -g gitspawn-scan
```

**From a clone** (for contributing, or before the npm release):

```bash
git clone https://github.com/shaojun-666/gitspawn-scan
cd gitspawn-scan && npm test
node bin/gitspawn-scan.js /path/to/suspect-folder
```

## Why this exists

In September 2026, [Manifold Security disclosed
GitSpawn](https://thehackernews.com/2026/09/malicious-git-configs-can-make-claude.html):
a repository's own `.git/config` can make your AI coding agent execute attacker
code. Eight findings across seven agents — Claude Code, Codex, Cursor, Goose,
Hermes Agent, Qwen Code and Grok Build. Several were still unpatched weeks later.

The mechanism is that the execution happens *inside git's subprocess machinery*,
which sits below the agent's tool layer:

- **No permission prompt** — the agent never sees a tool call to approve.
- **Outside the agent's sandbox** — it is git doing the executing, not the agent.
- **Before the workspace-trust dialog, in some agents** — you are compromised at
  the moment you point the agent at the folder.

The published mitigation was to check for the keys **by hand**:

```bash
git config --get core.fsmonitor
git config --global --list | grep fsmonitor
```

`gitspawn-scan` is that check, done properly, across the whole class of
configuration-driven execution — plus the execution vectors that are native to
agents themselves, which no other tool covers.

It matters most because of how GitSpawn arrives. `git clone` does **not** transfer
`.git/config`, so the delivery vectors are the ones with no clone step: a ZIP, a
USB stick, a shared drive, a synced folder. Exactly the folders people open
without thinking.

## Reading the output

Most findings on a real project are legitimate. Here is how to sort them.

**Findings that almost never have an innocent explanation** — treat these as
hostile until you personally understand them:

| Rule | What it means |
| --- | --- |
| `GS001` `core.fsmonitor` | A program that runs on every `git status`. Genuine uses exist but are rare, and a *path* value is the GitSpawn sink itself. |
| `GS003` `core.sshCommand` | Runs on every fetch and push. |
| `GS009` `alias.*` starting with `!` | A friendly name that is really a shell command. |
| `GS043` `.npmrc` `onload-script` | Runs on *every* npm command. There is no good reason to see this in a project you downloaded. |

**Findings that fire on honest projects all the time** — read them, then move on:

| Rule | Why it is usually fine |
| --- | --- |
| `GS049` `package.json` lifecycle script | `prepare` and `postinstall` are normal build steps. This is the oldest vector in npm, which is why it is also the one people stopped reading. |
| `GS042` `.envrc` | Legitimate if the project assumes direnv. The finding is a reminder that entering the directory runs it. |
| `GS044` redirected npm registry | Corporate and private mirrors do this on purpose. |
| `GS040` VS Code `runOn: folderOpen` | Some projects really do want build tasks to start on open. |
| `GS035` `CLAUDE.md` / `AGENTS.md` | Every agent-friendly repo has one. It is reported at `info` because it is the standard prompt-injection channel, not because it is malicious. |

**Everything at `critical` is worth five minutes.** The scanner cannot tell you
whether a command is malicious — it tells you a command *will run*, and where it
is defined. On a repository you trust, that is a review checklist. On one you were
handed, it is the reason you did not open it yet.

### Then clear it

Every finding prints a `fix` line. Those are commands for you to read and run —
the scanner never changes the folder. The one-line version, applied globally and
worth doing today regardless of this tool:

```bash
git config --global core.fsmonitor false
```

## What it catches

### Git configuration (`GS001`–`GS017`)

Any key git hands to a shell or to `exec()`:

| Key | Why it matters |
| --- | --- |
| `core.fsmonitor` | **The GitSpawn sink.** Runs on every `git status` / `git diff` |
| `core.hooksPath` | Redirects every git hook to a directory the repo chose |
| `core.sshCommand` | Runs on every fetch and push |
| `credential.helper` | Runs whenever the agent touches a remote |
| `diff.external`, `diff.*.command`, `diff.*.textconv` | Runs whenever git produces a diff |
| `merge.*.driver`, `merge.*.recursive` | Runs on merge, rebase, cherry-pick |
| `filter.*.clean`, `.smudge`, `.process` | Runs on checkout |
| `alias.*` starting with `!` | A friendly name that is really a shell command |
| `include.path`, `includeIf.*.path` | Loads config from anywhere on disk |
| `submodule.*.update` starting with `!` | Runs during recursive clone |
| `core.pager`, `core.editor`, `sequence.editor` | Runs on paginated or interactive operations |
| `gpg.program`, `core.gitProxy`, `url.*.insteadOf`, `http.proxy`, `core.attributesFile` | Execution and redirection channels |

### The `.git` directory itself (`GS020`–`GS023`)

Executable hooks shipped in `.git/hooks/` (stock `.sample` files are ignored),
`.git` pointer files that redirect to a directory outside the folder you scanned,
and `.gitattributes` that route files through unknown filter and diff drivers.

### Agent-native vectors (`GS030`–`GS035`)

This is the part nothing else covers. A repository can ship configuration that
your agent picks up as soon as it is pointed at the folder:

| Finding | What it means |
| --- | --- |
| `.claude/settings.json` with a `hooks` block | Shell commands the agent runs automatically on session start, tool use and stop |
| `permissions.allow` with wildcards | Pre-authorises unrestricted shell commands, skipping prompts you would normally see |
| `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json` | Repository-shipped MCP servers — local processes, or remote endpoints that can return instructions |
| `CLAUDE.md`, `AGENTS.md` | Instructions the agent will follow. Not executable, but the standard delivery mechanism for prompt injection |

### Editor, container and package tooling (`GS040`–`GS051`)

VS Code tasks with `"runOn": "folderOpen"` (executes with no click), devcontainer
lifecycle commands, `.envrc` for direnv, `.npmrc` with `onload-script` or a
redirected registry, `.yarnrc.yml` with `yarnPath`, `package.json` lifecycle
scripts, `setup.py`, and husky hooks.

Every finding carries a severity, the exact file and line, the offending value, a
one-paragraph explanation of the mechanism, and the command that removes it.

## Options

```
--json              machine-readable output
--fail-on <level>   critical | high | medium | low | info | none   (default: high)
--quiet, -q         hide info and low findings
--short             omit the explanation block
--no-color          disable ANSI colour
```

Exit codes: `0` nothing at or above `--fail-on`, `1` findings at or above it,
`2` usage or I/O error.

### Recipes

```bash
# Scan a folder and only see what actually matters
npx gitspawn-scan ~/Downloads/thing --quiet

# Machine-readable, for a dashboard or a review bot
npx gitspawn-scan ~/Downloads/thing --json

# Refuse to start an agent on a dirty folder
npx gitspawn-scan "$WORKDIR" --quiet || { echo "refusing to start"; exit 1; }

# Scan every repo in a directory of checkouts
for d in ~/src/*/; do npx gitspawn-scan "$d" --short -q; done
```

## Use it in CI

Catch a hostile config arriving through a pull request or a vendored dependency:

```yaml
- run: npx gitspawn-scan . --fail-on high
```

## What it does not do

Being precise about this matters more than the feature list.

- **It never executes anything.** It reads files as text. That is why it is safe
  to point at a folder you already believe is hostile.
- **It cannot tell you whether a command is malicious.** It tells you a command
  *will run*, and where it is defined. A legitimate project with a `postinstall`
  script and a hostile one look identical to any static scanner; the difference
  is whether you expected it. See [Reading the output](#reading-the-output).
- **It does not modify your repository.** The `fix` lines are commands for you to
  read and run. A tool that rewrites git config on first contact is a worse
  problem than the one it solves.
- **It does not read your global `~/.gitconfig`** (yet — see [Roadmap](#roadmap)),
  so a repository-level `safe.directory` or a machine-wide `core.fsmonitor` is
  out of scope.
- **It cannot see inside an archive.** Extract the ZIP first, then scan it. A
  `.git` directory inside an archive is precisely the delivery vector GitSpawn
  needs, because `git clone` does not transfer it.

## Roadmap

- Global config audit (`--global`), and a `--diff` mode for comparing a
  repository's config against your own baseline
- SARIF output so findings surface in GitHub code scanning
- Detection of config keys written by a post-checkout bootstrap rather than
  committed

## Contributing

New rule families are the most useful contribution. Rules live in `src/rules/`,
tests in `test/run.js`, and the fixture in `test/fixtures/evil-repo/` exists to
prove each one fires. Read `test/fixtures/README.md` before touching it — it
explains why the fixture's git directory is stored as `dot-git/`.

```bash
npm test          # 71 tests, no dependencies
npm run demo      # scan the hostile fixture and print the report
```

`npm run demo` prints the sample output shown at the top of this README. It
builds the fixture's git directory in a temp tree rather than scanning
`test/fixtures/evil-repo` in place — the fixture ships its git directory as
`dot-git/`, so a direct scan would only show the findings outside `.git`.

## License

MIT
