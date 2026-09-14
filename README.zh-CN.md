# gitspawn-scan

[English](README.md) | 简体中文

**在把文件夹交给 AI 助手之前，先看看里面有没有会自己跑起来的东西。**

```bash
npx github:shaojun-666/gitspawn-scan ~/Downloads/别人发我的项目
```

---

## 先从一件事说起

同事在微信上发你一个压缩包，或者你从群里下了一个项目。解压，用编辑器打开，然后对着 Claude Code 说：帮我看看这个项目是干嘛的。

就在你按下回车那一秒，你电脑上可能已经跑了一段你没写过、也没看过的代码。

你没有点任何按钮，也没有弹窗让你确认。触发它的是一条 `git status`——AI 助手进门第一件事就是跑这个，为了弄清项目当前状态。而这条 git 命令会去读仓库自带的 `.git/config`，照着里面的配置执行一个程序。

这件事别扭的地方在于，执行发生在 git 里面，不在 AI 助手的工具层里。所以：

- 没有工具调用，也就没有"是否允许执行"的弹窗可点
- 不在助手的沙箱里。跑命令的是 git，沙箱管不着它
- 有几个助手在你回答"是否信任这个文件夹"之前，就已经执行完了

等你想起来要确认什么的时候，已经没有可确认的东西了。

## 这是 2026 年 9 月公开的一类漏洞

安全公司 Manifold Security 把它命名为 GitSpawn，[公开报告在这里](https://thehackernews.com/2026/09/malicious-git-configs-can-make-claude.html)。他们在 7 个 AI 编程助手里找到 8 处问题，涉及 Claude Code、Codex、Cursor、Goose、Hermes Agent、Qwen Code 和 Grok Build。到 9 月初，其中几个还没修。

他们给的缓解办法是手动查：

```bash
git config --get core.fsmonitor
```

这个办法本身没问题，只是它只管一个键，而且得一个仓库一个仓库地查。

gitspawn-scan 就是把这件事做完整：GitSpawn 那一整类配置全都覆盖，另外还查一类目前没别的工具在查的东西——AI 助手自己的配置。

## 为什么 `git clone` 下来的项目反而不用担心

这一点决定了你什么时候会撞上它，值得单独讲。

`git clone` 不会传输 `.git/config`。所以能夹带恶意配置的，都是那些没有 clone 这一步的传递方式：压缩包、U 盘、共享盘、同步文件夹。恰好就是那些你不会多想就打开的文件夹。

反过来也一样：你自己 clone 下来的项目是干净的，但同事解压给你的那个不一定。

## 跑起来是什么样

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
          .git/config and executes it as a command. ...

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

（程序输出目前是英文的。上面这段的字段和格式来自真实运行，路径做了替换。）

每条结果都会告诉你四件事：严重程度、**哪个文件的哪一行**、具体是什么值（也就是什么东西会被执行）、以及建议你怎么处理。最后那行 `fix` 是给你自己看的命令，工具不会替你动手。

退出码在发现 `--fail-on` 及以上级别的问题时是 `1`，所以可以直接塞进脚本或者 CI 里当闸门。

## 扫出来一堆，哪些要当真

真实项目上大部分结果是正常的。分两类看，能省掉很多时间。

**基本不可能有正常解释的**，除非你自己清楚它在干嘛，否则按恶意处理：

| 规则 | 是什么 |
| --- | --- |
| `GS001` `core.fsmonitor` | 每次 `git status` 都会跑的程序。正经用法存在但很少见；值写成路径的，就是 GitSpawn 本身 |
| `GS003` `core.sshCommand` | 每次 fetch 和 push 都会跑 |
| `GS009` 以 `!` 开头的 `alias.*` | 看着像个快捷命令，实际上是一整条 shell |
| `GS043` `.npmrc` 里的 `onload-script` | 每条 npm 命令都会跑。你下载来的项目里出现这个，没有正当理由 |

**正经项目也天天报的**，看一眼就过：

| 规则 | 为什么通常是正常的 |
| --- | --- |
| `GS049` `package.json` 的 lifecycle 脚本 | `prepare` 和 `postinstall` 是正常构建步骤。这是 npm 最老的攻击面，也是大家早就不看的那一个 |
| `GS042` `.envrc` | 项目用 direnv 就是正常的。它只是提醒你：进这个目录就会执行 |
| `GS044` 被改过的 npm 源 | 公司内网镜像就这么干，故意的 |
| `GS040` VS Code 的 `runOn: folderOpen` | 确实有项目想一打开就跑构建 |
| `GS035` `CLAUDE.md` / `AGENTS.md` | 现在哪个项目没有。报成 `info`，是因为它是提示注入的标准投放渠道，不是因为它恶意 |

**`critical` 的每一条都值得花五分钟看一眼。** 扫描器没法判断一段命令是不是恶意，它只能告诉你这段命令会被执行、写在哪里。在你自己信得过的项目上，这是一份检查清单；在别人塞给你的项目上，这就是你还没打开它的原因。

每个结果下面都有 `fix` 那一行，照着看一眼再决定跑不跑。另外有一行配置，不管用不用这个工具，今天都可以先加上：

```bash
git config --global core.fsmonitor false
```

这一条会把本机上所有仓库的这个入口一次性关掉。

## 装

Node 18 以上，零依赖，也没有 npm 包。

没有 npm 包是故意的。一个安全工具如果自己拖一整棵依赖树，那是在让你做它正要提醒你别做的事；从 registry 装，又等于让你信任一个你读不到的账号。所以直接从仓库跑：

```bash
npx github:shaojun-666/gitspawn-scan .                   # 扫当前目录
npx github:shaojun-666/gitspawn-scan ~/Downloads/thing   # 扫别人发你的
```

`npx` 会直接从 GitHub 解析这份代码，中间没有 registry。想留一份在本地，或者想先读完源码再决定要不要跑，就 clone 下来：

```bash
git clone --depth 1 https://github.com/shaojun-666/gitspawn-scan
cd gitspawn-scan
node bin/gitspawn-scan.js /path/to/suspect-folder
npm test          # 71 个测试，零依赖
```

下面为了写起来简短，命令都写作 `gitspawn-scan`，你用上面哪种方式都可以。

## 拿它扫一个你已经觉得可疑的文件夹，安全吗

安全，它本来就是为这个场景写的。整个程序只做一件事：把文件当文本读，然后告诉你读到了什么。它不会 import 你的代码，不会在文件夹里跑 git，也不会往里写任何东西。

这一点有测试盯着。71 个测试里有一个专门断言：扫描器跑完之后，那个恶意夹具和跑之前逐字节一致。

你也可以先读完再跑。全部代码大概 1400 行，没有依赖，`src/` 里不存在你追不到的东西。

## 它到底查什么

### git 配置（`GS001`–`GS017`）

凡是 git 会交给 shell 或者 `exec()` 的键：

| 键 | 为什么有问题 |
| --- | --- |
| `core.fsmonitor` | **GitSpawn 的入口。** 每次 `git status` / `git diff` 都跑 |
| `core.hooksPath` | 把 git 的所有 hook 重定向到仓库自己指定的目录 |
| `core.sshCommand` | 每次 fetch 和 push 都跑 |
| `credential.helper` | 助手一碰远端就跑 |
| `diff.external`、`diff.*.command`、`diff.*.textconv` | git 只要生成 diff 就跑。助手为了摸清仓库结构会不停地 diff |
| `merge.*.driver`、`merge.*.recursive` | merge、rebase、cherry-pick 时跑 |
| `filter.*.clean`、`.smudge`、`.process` | checkout 时跑 |
| 以 `!` 开头的 `alias.*` | 表面是快捷命令，实际是一整条 shell |
| `include.path`、`includeIf.*.path` | 从磁盘上任何位置加载配置 |
| 以 `!` 开头的 `submodule.*.update` | 递归 clone 时跑 |
| `core.pager`、`core.editor`、`sequence.editor` | 分页或交互操作时跑 |
| `gpg.program`、`core.gitProxy`、`url.*.insteadOf`、`http.proxy`、`core.attributesFile` | 执行通道和重定向通道 |

### `.git` 目录本身（`GS020`–`GS023`）

`.git/hooks/` 里带着的可执行 hook（原版 `.sample` 文件会忽略）、把 `.git` 指向你所扫目录之外某个位置的指针文件、以及会把文件送进未知 filter 和 diff driver 的 `.gitattributes`。

### AI 助手自己的配置（`GS030`–`GS035`）

这块是别的工具没覆盖的。一个仓库可以带上你自己的助手一打开就会读的配置：

| 查到什么 | 意味着什么 |
| --- | --- |
| `.claude/settings.json` 带 `hooks` 段 | 助手会在会话开始、工具调用、结束时自动跑的 shell 命令 |
| 带通配符的 `permissions.allow` | 预先授权了不受限的 shell 命令，你本来会看到的确认框直接就没了 |
| `.mcp.json`、`.cursor/mcp.json`、`.vscode/mcp.json` | 仓库自带的 MCP server，可能是本地进程，也可能是会返回指令的远端 |
| `CLAUDE.md`、`AGENTS.md` | 助手会照着做的说明。它本身不执行，但它是提示注入最标准的投放方式 |

### 编辑器、容器和包管理器（`GS040`–`GS051`）

带 `"runOn": "folderOpen"` 的 VS Code task（不用点就会执行）、devcontainer 的生命周期命令、direnv 的 `.envrc`、带 `onload-script` 或被改了源的 `.npmrc`、带 `yarnPath` 的 `.yarnrc.yml`、`package.json` 的 lifecycle 脚本、`setup.py`，以及 husky hook。

## 选项

```
--json              输出 JSON，给程序读
--fail-on <级别>    critical | high | medium | low | info | none   默认 high
--quiet, -q         不显示 info 和 low
--short             不显示解释段落
--no-color          关掉颜色
```

退出码：`0` 表示没有达到 `--fail-on` 的问题，`1` 表示有，`2` 表示用法或读写错误。

### 常用组合

```bash
# 只看真正要紧的
npx github:shaojun-666/gitspawn-scan ~/Downloads/thing --quiet

# 给面板或者审查机器人读
npx github:shaojun-666/gitspawn-scan ~/Downloads/thing --json

# 文件夹不干净就拒绝启动助手
gitspawn-scan "$WORKDIR" --quiet || { echo "refusing to start"; exit 1; }

# 批量扫一批 checkout
for d in ~/src/*/; do gitspawn-scan "$d" --short -q; done
```

## 在 CI 里用

挡住在 PR 或者 vendored 依赖里混进来的恶意配置：

```yaml
- run: npx github:shaojun-666/gitspawn-scan . --fail-on high
```

## 它做不到什么

这部分说得比功能表更清楚，反而更有用。

- **它什么都不执行。** 全程只把文件当文本读。所以你拿它扫一个你已经认定有问题的文件夹是安全的。
- **它没法告诉你一段命令是不是恶意。** 它只能告诉你这段命令会被执行、写在哪里。一个正常的项目和一个恶意的项目，在静态扫描器眼里是一样的，区别只在于你事先知不知道它会在那儿。怎么看结果见[上面那节](#扫出来一堆哪些要当真)。
- **它不改你的仓库。** 那些 `fix` 行是留给你自己看、自己跑的命令。一个初次见面就动手改你 git 配置的工具，是比它要解决的问题更麻烦的问题。
- **它不读你的全局 `~/.gitconfig`**（暂时，见[路线图](#路线图)），所以机器级别的 `core.fsmonitor` 或者仓库级别的 `safe.directory` 不在覆盖范围里。
- **它看不进压缩包。** 先解压，再扫。压缩包里如果躺着 `.git` 目录，那正是 GitSpawn 需要的投放方式，因为 `git clone` 不会传它。

## 路线图

- 全局配置审计（`--global`），以及 `--diff` 模式：拿仓库配置和你自己的基线对比
- SARIF 输出，让结果能进 GitHub code scanning
- 识别那些不是提交进去的、而是 post-checkout 引导脚本写进配置的键

## 参与

最有用的贡献是加规则族。规则在 `src/rules/`，测试在 `test/run.js`，`test/fixtures/evil-repo/` 那个夹具的作用是保证每条规则都真的会触发。

动夹具之前请先读 `test/fixtures/README.md`，里面有解释为什么它的 git 目录存成了 `dot-git/`。

```bash
npm test          # 71 个测试，零依赖
npm run demo      # 扫那个恶意夹具，把报告打出来
```

`npm run demo` 打出来的就是本文档上面那段示例输出。它会先在临时目录里把夹具的 git 目录还原出来再扫，而不是就地扫 `test/fixtures/evil-repo`——夹具的 git 目录存成了 `dot-git/`，直接扫只能看到 `.git` 之外的那些结果。

## 许可

MIT
