# Test fixtures

`evil-repo/` contains a deliberately hostile `.git/config` and agent configuration.
It exists so the test suite can prove the scanner catches each rule.

**Every payload in it is inert.** Commands are either `echo` or paths that do not
exist (`/tmp/gitspawn-fixture-*.sh`). Nothing fetches, writes or persists.

The git directory is stored here as `dot-git/`, not `.git`. Git refuses to track
anything inside a directory named `.git`, so a committed `.git` would silently
vanish for everyone who clones the repository. `test/run.js` copies each fixture
into a temp tree at startup and renames `dot-git/` back to `.git` there — that
copy is what the scanner actually reads.

This layout is also why the on-disk fixture can no longer become dangerous: the
temp copy has no `HEAD` and no `objects`, so git refuses to treat it as a
repository at all and never reads its config. Only this scanner reads these
files, and it reads them as text.

Still, do not run `git init` inside a materialised copy. That would create the
missing `HEAD` and turn it into a live hostile repository.

`clean-repo/` is the negative control: a plausible, well-formed project that must
produce no findings at all.

`clean-repo/` is the negative control: a plausible, well-formed project that must
produce no findings at or above `medium`.
