# gitspawn-scan

[English](README.md) | [简体中文](README.zh-CN.md)

[![test](https://github.com/shaojun-666/gitspawn-scan/actions/workflows/test.yml/badge.svg)](https://github.com/shaojun-666/gitspawn-scan/actions/workflows/test.yml)

**A folder can run code at you before your AI agent finishes opening it. Check first.**

```bash
npx github:shaojun-666/gitspawn-scan ~/Downloads/that-repo-someone-sent-me
```

One command. No dependencies, nothing to install, no npm package in the middle.

---

## What happens without it

Someone sends you a zip. You unpack it, open it up, and tell Claude Code to take a look at the project.

At that moment a program may already have run on your machine, and you did not write it.

You did not click anything, and nothing asked you for permission. What triggered it was a `git status` — the first thing an agent runs to orient itself. That git command reads the repository's own `.git/config` and executes a program named in there.

The awkward part is where the execution happens: inside git, below the agent's tool layer. So there is no tool call for the agent to approve, no sandbox in the way, and in some agents it fires before the workspace-trust prompt is even answered. By the time you think to check, there is nothing left to check.

## Where this came from

Manifold Security disclosed the class in September 2026 and named it GitSpawn ([write-up](https://thehackernews.com/2026/09/malicious-git-configs-can-make-claude.html)). Eight findings across seven agents: Claude Code, Codex, Cursor, Goose, Hermes Agent, Qwen Code and Grok Build. Several were still unpatched weeks later.

The mitigation they published was to look by hand:

```bash
git config --get core.fsmonitor
```

Sound advice. It just covers one key, and one repository at a time.

gitspawn-scan does the whole check: every configuration key in that family, plus a category nothing else looks at — the agent's own configuration files.

## Clone is not the risky path

Worth knowing, because it decides when you are actually exposed.

`git clone` does not transfer `.git/config`. The repositories that can carry a hostile config are the ones with no clone step: a zip, a USB stick, a shared drive, a synced folder. Which is to say, the folders you open without thinking about it.

The reverse is also true. What you cloned yourself is clean. What a colleague unzipped for you is not necessarily.

## What it looks like

```console
$ npx github:shaojun-666/gitspawn-scan ~/Downloads/pitch-deck-optimizer

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

(The fields and layout are real. The path is a stand-in.)

Every finding gives you four things: how bad it is, which file and line, what value sits there — that is, what would run — and what to do about it. The `fix` line is a command for you to read and run. The tool never touches the folder.

Exit code is `1` when anything at or above `--fail-on` is found, so it drops straight into a script or a CI step.

## Sorting the output

Most findings on a real project are legitimate, and a scanner you stop reading is worse than no scanner. Two groups.

**Rarely innocent.** Treat as hostile until you personally understand it.

| Rule | What it is |
| --- | --- |
| `GS001` `core.fsmonitor` | A program that runs on every `git status`. Honest uses exist but are uncommon, and a *path* as the value is the GitSpawn sink itself |
| `GS003` `core.sshCommand` | Runs on every fetch and push |
| `GS009` `alias.*` starting with `!` | A friendly name that is really a whole shell command |
| `GS043` `.npmrc` `onload-script` | Runs on every npm command. No good reason for it to be in a project you downloaded |

**Fires on honest projects all the time.** Read it, then move on.

| Rule | Why it is usually fine |
| --- | --- |
| `GS049` `package.json` lifecycle script | `prepare` and `postinstall` are ordinary build steps. This is the oldest vector in npm, which is exactly why people stopped reading it |
| `GS042` `.envrc` | Legitimate if the project assumes direnv. The finding is a reminder that entering the directory runs it |
| `GS044` redirected npm registry | Corporate and private mirrors do this on purpose |
| `GS041` devcontainer lifecycle command | `pallets/flask` ships one. Read the script it names, then move on |
| `GS050` `setup.py` | `psf/requests` has one. Installing from source runs the file |
| `GS040` VS Code `runOn: folderOpen` | Some projects really do want build tasks to start on open |
| `GS035` `CLAUDE.md` / `AGENTS.md` | Every agent-friendly repo has one. Reported at `info` because it is the standard prompt-injection channel, not because it is malicious |

**Everything at `critical` is worth five minutes.** The scanner cannot tell you whether a command is malicious; it tells you a command *will run*, and where it is defined. On a repository you trust, that is a review checklist. On one you were handed, it is the reason you have not opened it yet.

### Then clear it

Every finding prints a `fix` line — commands for you to read and run. One of them is worth doing today regardless of this tool, because it closes the entry point for every repository on the machine at once:

```bash
git config --global core.fsmonitor false
```

## Install

Node 18+, zero dependencies, and no npm package. The last one is deliberate. A security tool that pulls a dependency tree is asking you to do the thing it is warning you about, and one installed from a registry is asking you to trust an account you cannot read.

Run it straight from this repository:

```bash
npx github:shaojun-666/gitspawn-scan .                   # the folder you are in
npx github:shaojun-666/gitspawn-scan ~/Downloads/thing   # something you were sent
```

There is no registry in the middle. `npx` resolves the code you can read here.

To keep a copy around, or to read the source before its first run — which is rather the point of a tool like this — clone it:

```bash
git clone --depth 1 https://github.com/shaojun-666/gitspawn-scan
cd gitspawn-scan
node bin/gitspawn-scan.js /path/to/suspect-folder
npm test          # 84 tests, no dependencies
```

The rest of this README writes the command as `gitspawn-scan`. Substitute whichever of the two forms above you used.

## Is it safe to point this at a folder I already think is hostile?

Yes, that is what it is built for. The whole program does one thing: reads files as text and tells you what it found. It does not import your code, does not run `git` inside the folder, and does not write to it.

The test suite pins that down. One of the 84 tests asserts the scanner leaves the hostile fixture byte-for-byte unchanged.

You can also read the whole thing first. It is about 1,400 lines with no dependencies, so there is nothing in `src/` you cannot trace.

## What it catches

### Git configuration (`GS001`–`GS017`)

Every key git hands to a shell or to `exec()`:

| Key | Why it matters |
| --- | --- |
| `core.fsmonitor` | **The GitSpawn sink.** Runs on every `git status` / `git diff` |
| `core.hooksPath` | Redirects every git hook to a directory the repository chose |
| `core.sshCommand` | Runs on every fetch and push |
| `credential.helper` | Runs whenever the agent touches a remote |
| `diff.external`, `diff.*.command`, `diff.*.textconv` | Runs whenever git produces a diff, and agents diff constantly to orient themselves |
| `merge.*.driver`, `merge.*.recursive` | Runs on merge, rebase, cherry-pick |
| `filter.*.clean`, `.smudge`, `.process` | Runs on checkout |
| `alias.*` starting with `!` | A friendly name that is really a shell command |
| `include.path`, `includeIf.*.path` | Loads config from anywhere on disk |
| `submodule.*.update` starting with `!` | Runs during recursive clone |
| `core.pager`, `core.editor`, `sequence.editor` | Runs on paginated or interactive operations |
| `gpg.program`, `core.gitProxy`, `url.*.insteadOf`, `http.proxy`, `core.attributesFile` | Execution and redirection channels |

### The `.git` directory itself (`GS020`–`GS023`)

Executable hooks shipped in `.git/hooks/` (stock `.sample` files are ignored), `.git` pointer files that redirect to a directory outside the folder you scanned, and `.gitattributes` that route files through unknown filter and diff drivers.

### Agent configuration (`GS030`–`GS035`)

The part nothing else covers. A repository can ship configuration your agent picks up as soon as it is pointed at the folder:

| Finding | What it means |
| --- | --- |
| `.claude/settings.json` with a `hooks` block | Shell commands the agent runs automatically on session start, tool use and stop |
| `permissions.allow` with wildcards | Pre-authorises unrestricted shell commands, skipping the prompts you would normally see |
| `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json` | Repository-shipped MCP servers — local processes, or remote endpoints that can return instructions |
| `CLAUDE.md`, `AGENTS.md` | Instructions the agent will follow. Not executable itself, but the standard delivery mechanism for prompt injection |

### Editor, container and package tooling (`GS040`–`GS051`)

VS Code tasks with `"runOn": "folderOpen"` (executes with no click), devcontainer lifecycle commands, `.envrc` for direnv, `.npmrc` with `onload-script` or a redirected registry, `.yarnrc.yml` with `yarnPath`, `package.json` lifecycle scripts, `setup.py`, and husky hooks.

Every finding carries a severity, the exact file and line, the offending value, a paragraph on the mechanism, and the command that removes it.

## Options

```
--json              machine-readable output
--fail-on <level>   critical | high | medium | low | info | none   (default: high)
--quiet, -q         hide info and low findings
--short             omit the explanation block
--no-color          disable ANSI colour
```

Exit codes: `0` nothing at or above `--fail-on`, `1` findings at or above it, `2` usage or I/O error.

### Recipes

Below, `gitspawn-scan` stands for the command from [Install](#install). If you are copy-pasting, that is `npx github:shaojun-666/gitspawn-scan`.

```bash
# Scan a folder and only see what actually matters
npx github:shaojun-666/gitspawn-scan ~/Downloads/thing --quiet

# Machine-readable, for a dashboard or a review bot
npx github:shaojun-666/gitspawn-scan ~/Downloads/thing --json

# Refuse to start an agent on a dirty folder
gitspawn-scan "$WORKDIR" --quiet || { echo "refusing to start"; exit 1; }

# Scan every repo in a directory of checkouts
for d in ~/src/*/; do gitspawn-scan "$d" --short -q; done
```

## Use it in CI

Catch a hostile config arriving through a pull request or a vendored dependency:

```yaml
- run: npx github:shaojun-666/gitspawn-scan . --fail-on high
```

## What it does not do

Being precise here matters more than the feature list.

- **It never executes anything.** It reads files as text. That is why it is safe to point at a folder you already believe is hostile.
- **It cannot tell you whether a command is malicious.** It tells you a command *will run*, and where it is defined. A legitimate project with a `postinstall` script and a hostile one look identical to any static scanner; the difference is whether you expected it. See [Sorting the output](#sorting-the-output).
- **It does not modify your repository.** The `fix` lines are commands for you to read and run. A tool that rewrites git config on first contact is a worse problem than the one it solves.
- **It does not read your global `~/.gitconfig`** (yet — see [Roadmap](#roadmap)), so a machine-wide `core.fsmonitor` or a repository-level `safe.directory` is out of scope.
- **It cannot see inside an archive.** Extract the zip first, then scan it. A `.git` directory inside an archive is precisely the delivery vector GitSpawn needs, because `git clone` does not transfer it.

## Roadmap

- Global config audit (`--global`), and a `--diff` mode for comparing a repository's config against your own baseline
- SARIF output so findings surface in GitHub code scanning
- Detection of config keys written by a post-checkout bootstrap rather than committed

## Contributing

New rule families are the most useful contribution. Rules live in `src/rules/`, tests in `test/run.js`, and the fixture in `test/fixtures/evil-repo/` exists to prove each one fires.

Two things to know before you start:

- Read `test/fixtures/README.md` before touching the fixture. It explains why the fixture's git directory is stored as `dot-git/`.
- A rule that no test exercises will fail the suite. `test/run.js` keeps a table of inputs for rules the fixture cannot cover, and asserts that every rule ID declared in `src/rules/` appears in one of them. Add your rule there and the guard stays honest.

Found a problem with the scanner itself — a vector it misses, an input that crashes it? Report it privately rather than in an issue: see [SECURITY.md](SECURITY.md).

```bash
npm test          # 84 tests, no dependencies
npm run demo      # scan the hostile fixture and print the report
```

`npm run demo` prints the sample output shown near the top of this README. It builds the fixture's git directory in a temp tree rather than scanning `test/fixtures/evil-repo` in place — the fixture ships its git directory as `dot-git/`, so a direct scan would show only the findings outside `.git`.

## License

MIT
