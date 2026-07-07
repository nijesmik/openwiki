# OpenWiki — Claude Code Plugin

OpenWiki writes and maintains documentation for your codebase, built specifically for agents.

This fork packages [langchain-ai/openwiki](https://github.com/langchain-ai/openwiki) as a **Claude Code plugin**. The original agent prompts are preserved verbatim; Claude Code replaces the CLI's own agent runtime (model configuration, filesystem tools, shell, and subagents).

> For the original CLI — installation, usage, provider/model configuration — see the [upstream README](https://github.com/langchain-ai/openwiki#readme). The CLI source in this repository (`src/`, `test/`, `package.json`) is unchanged from upstream.

![OpenWiki](https://raw.githubusercontent.com/langchain-ai/openwiki/main/static/openwiki.png)

## Install

In Claude Code:

```
/plugin marketplace add nijesmik/openwiki
/plugin install openwiki@nijesmik
```

## Usage

| Command | Description |
| --- | --- |
| `/openwiki:init [message]` | Initialize OpenWiki documentation for the current repository under `openwiki/` |
| `/openwiki:update [message]` | Update existing OpenWiki documentation from recent repository changes |

`/openwiki:init` creates the initial documentation set, starting from `openwiki/quickstart.md`. `/openwiki:update` inspects commits since the last successful run and makes surgical edits only to the affected pages; it may be a no-op if the wiki is already current. Both commands also keep the OpenWiki reference section in your top-level `AGENTS.md`/`CLAUDE.md` up to date.

An optional trailing `message` is passed to the run as an additional user instruction, matching the upstream CLI's `openwiki --init [message]` / `openwiki --update [message]`.

## How it maps to the upstream CLI

| Upstream CLI | This plugin |
| --- | --- |
| `openwiki --init` | `/openwiki:init` command ([plugin/commands/init.md](./plugin/commands/init.md)) |
| `openwiki --update` | `/openwiki:update` command ([plugin/commands/update.md](./plugin/commands/update.md)) |
| Interactive chat (`openwiki`) | Claude Code itself |
| System/user prompts (`src/agent/prompt.ts`) | Inlined verbatim into the command files |
| Git evidence block (`createGitSummary` in `src/agent/utils.ts`) | Transparent `git` commands injected into the command prompt via `!` |
| Run metadata `openwiki/.last-update.json` (`writeLastUpdateMetadata`) | Written by the agent at the end of a run |
| Provider/model/API-key configuration, `~/.openwiki/.env` | Not needed — Claude Code's own model is used |

The plugin itself lives entirely under [`plugin/`](./plugin), so installing it does not pull in the upstream CLI source. The only prompt changes from upstream are the ones the runtime swap forces: virtual repo-rooted paths (`/openwiki/...`) became repository-relative paths, deepagents tool names (`read_file`, `write_file`, `edit_file`, `task`) became Claude Code tool names (`Read`, `Write`, `Edit`, `Task`), the CLI reference section became a plugin command reference, the git evidence block is gathered by injecting transparent `git` commands (each pre-authorized in the command's `allowed-tools`) instead of a wrapper script, and run metadata is written by the agent instead of by the CLI. Everything else is verbatim.

## License

MIT — see [LICENSE](./LICENSE). Original work by the [langchain-ai/openwiki](https://github.com/langchain-ai/openwiki) authors.
