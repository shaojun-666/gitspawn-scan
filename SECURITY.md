# Security Policy

## Reporting a vulnerability

Use GitHub's private reporting form:

**https://github.com/shaojun-666/gitspawn-scan/security/advisories/new**

Please do not open a public issue for anything that could be used against someone before a fix is available. A public "the scanner misses X" post is, for as long as it stands, a description of a working attack.

If the form is unavailable to you, open a public issue that says only *"I have a security report, please contact me"* and no details.

## What counts

This is a scanner, so the findings that matter most are the ones where it is **wrong**, not the ones where it is noisy.

**In scope**

- **A missed execution vector in a family the README claims to cover.** The most valuable report there is. If a git config key, `.git` construct, agent settings file or devtool config can cause code to run and `gitspawn-scan` reports the folder as clean, that is a bug worth a report.
- **A crash, hang, or resource exhaustion on a crafted input.** The tool is built to be pointed at folders that may be hostile, so input is untrusted by definition. A config file that makes it exit non-zero, loop forever, or exhaust memory is in scope.
- **A write to the scanned folder.** The scanner never modifies what it scans. One test asserts this. If you find a path where it does, that is a bug.
- **A false clean.** Any input that makes the tool exit `0` with "No execution vectors found" while an execution vector is present.

**Out of scope**

- **The scanner reports something legitimate.** A static scanner cannot tell a benign `postinstall` from a hostile one; both are just a command that will run. Reporting that it flags a normal-looking project is not a vulnerability. See [Sorting the output](README.md#sorting-the-output).
- **The payloads in `test/fixtures/evil-repo/`.** Those are deliberately hostile-shaped and entirely inert: every one is an `echo` or a path under `/tmp/gitspawn-fixture-*` that does not exist. Finding them is expected. The fixture exists so that each rule is proven to fire. See `test/fixtures/README.md`.
- **The absence of a feature.** No sandboxing, no archive support, no global `~/.gitconfig` audit — those are documented limitations, not vulnerabilities. `--global` and `--diff` are on the roadmap.

## What you can expect

- An acknowledgement within a few days. This is a small project maintained by one person, so that is an honest estimate rather than a guarantee.
- Credit in the release notes and the advisory, unless you would rather stay anonymous.
- A fix released as a new commit on `main`. There are no versioned releases and no npm package, so `npx github:` users pick up the fix on their next run.

## For users

The tool reads files as text and never executes anything from the folder it scans, which is why it is safe to point at something you already believe is hostile. It does not modify the folder, does not run `git` inside it, and has no dependencies.

You can read all of it before the first run: roughly 1,400 lines, no dependency tree, nothing in `src/` you cannot trace.
