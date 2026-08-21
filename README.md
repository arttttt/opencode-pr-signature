# OpenCode PR Auto-Signature Plugin

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![OpenCode](https://img.shields.io/badge/OpenCode-Plugin-green.svg)](https://opencode.ai)
[![npm](https://img.shields.io/npm/v/opencode-pr-signature.svg)](https://www.npmjs.com/package/opencode-pr-signature)

Automatically adds AI model signature to Pull Requests, Issues, and Commits created through OpenCode.

## Features

- 🤖 **Automatic Detection** - Dynamically detects the AI model being used (Kimi, Claude, GPT, Gemini, etc.)
- 🔄 **Self-Updating Model Names** - names come from OpenRouter's live model catalogue, refreshed in the background at most once a day - no hardcoded list to go stale
- 📝 **Smart Signature** - Appends signature only to content that doesn't already have it
- 🔄 **Update Support** - Works with both creation and update operations
- 🎯 **Multiple Tools** - Supports GitHub MCP tools, MCP Docker tools, git CLI, and gh CLI
- 💻 **Git Commits** - Automatically signs commit messages
- 🔧 **gh CLI** - Supports `gh pr create`, `gh issue create`, comments, and reviews

## Installation

### From NPM (Recommended)

Add to your OpenCode config (`~/.config/opencode/opencode.json` or project-level `opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-pr-signature"]
}
```

### From a Local Checkout

The plugin is several modules under `src/`, so it is installed as a package
rather than copied as a single file:

1. Clone this repository
2. Install the checkout into your OpenCode config directory:

   ```sh
   cd ~/.config/opencode && npm install /path/to/opencode-pr-signature
   ```

3. Reference it in `opencode.json` exactly as for the published package:

   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "plugin": ["opencode-pr-signature"]
   }
   ```

4. Restart OpenCode

## Usage

Once installed, the plugin works automatically. When OpenCode creates a Pull Request, Issue, or Commit, the signature will be appended:

### PR/Issue Example

```markdown
Your PR description here...

🤖 Generated with [OpenCode](https://opencode.ai) (Kimi K2.5)
```

### Commit Example

```
feat: add new feature

🤖 Generated with [OpenCode](https://opencode.ai) (Claude 3.5 Sonnet)
```

### Supported Operations

#### GitHub MCP Tools
- `github_create_pull_request`
- `github_create_issue`
- `github_update_pull_request`
- `github_update_issue`

#### MCP Docker Tools
- `MCP_DOCKER_create_pull_request`
- `MCP_DOCKER_create_issue`
- `MCP_DOCKER_update_pull_request`
- `MCP_DOCKER_update_issue`

#### Git CLI
- `git commit -m "message"`, including the attached forms `-m"message"` and `-mmessage`
- `git commit --message="message"`
- `git commit -F message.txt` and `git commit --file=message.txt`
- `git commit -F-` fed by a heredoc, a pipe, a redirect or a here-string
- `git commit --amend --no-edit`

#### gh CLI (GitHub CLI)
- `gh pr create`
- `gh issue create`
- `gh pr comment`
- `gh issue comment`
- `gh pr review`

The body is signed whether it is written out — `--body x`, `--body=x`, `-b x`,
`-bx` — or only produced when the command runs, as in `--body "$PR_BODY"` or
`--body "$(cat msg.md)"`. A body read from a file with `--body-file` is not
signed; see below.

### Model Names

Model names are not hardcoded. The plugin fetches [OpenRouter's public model
catalogue](https://openrouter.ai/api/v1/models) and uses it to render
human-readable names — `Kimi K2.5`, `GLM 5.3`, `Grok 4.6`, and so on:

- the catalogue is cached on disk and refreshed in the background when the
  cache is older than 24 hours — never delaying or breaking a signature;
- cache location: `~/.config/opencode/cache/opencode-pr-signature/models.jsonl`
  (or `$XDG_CONFIG_HOME/opencode/...` when set);
- offline, on first run, or with an unreadable cache, names fall back to a
  nicely formatted version of the raw model ID;
- models OpenRouter does not carry (direct-vendor APIs, local runtimes) always
  use that fallback.

## How It Works

1. **Model Detection**: The plugin listens to chat messages to detect which AI
   model is currently in use. The display name comes from a locally cached
   copy of OpenRouter's model catalogue, refreshed in the background when the
   cache is older than 24 hours (see [Model Names](#model-names))
2. **Tool Interception**: Using the `tool.execute.before` hook, it intercepts:
   - GitHub MCP tool calls (PR/Issue creation and updates)
   - Bash commands (`git commit`, `gh pr create`, etc.)
3. **Signature Injection**: Before the tool executes, it appends the signature.
   Where the text is written in the command, it is edited directly:
   - For MCP tools: modifies the `body` argument
   - For `git commit -m`: adds an additional `-m` flag (git concatenates multiple `-m` with blank lines)
   - For `git commit -F-` with a heredoc: appends the signature to the heredoc body, in place
   - For a `gh --body` written out in full: rewrites that argument

   Where the text only exists once the command runs — a message file, a pipe, a
   redirect, `--amend --no-edit`, a `gh` body held in a variable — the plugin
   adds a stage that reads the message at that moment and hands the signed
   result on:

   ```sh
   git commit -F msg.txt
   # becomes
   ( … cat -- msg.txt … ) | git commit -F -

   gh pr create --body "$PR_BODY"
   # becomes
   gh pr create --body "$( … "$PR_BODY" … )"
   ```

   The source is read exactly once and never written to, so a message file, a
   producer command or a `$(…)` body behaves as it did before. A commit whose
   message arrives on standard input keeps whatever was feeding it: the
   redirection or pipe moves onto the stage, and git reads the stage.
4. **Duplicate Prevention**: Checks if signature already exists to avoid
   duplicates — in the command for text written out, and at run time for text
   that is not. An empty or blank message stays empty, so git still refuses
   the commit.

## What the Plugin Will Not Sign

Some commands are left exactly as you wrote them, and then behave as if the
plugin were not installed. No error, no signature — because guessing at a
commit message means committing the wrong one, and a missing signature is
easier to live with than a lost message.

Not signed:

- **A message you have not written yet** — `git commit` and `git commit
  --amend` without a message option open an editor. There is nothing to sign
  until you have typed it, and supplying a message would suppress the editor
  you asked for.
- **A message reused from another commit** — `-C`, `-c`, `--reuse-message`,
  `--reedit-message`. These copy the author and the author date along with the
  message, and moving the message onto `-F` would quietly reset both to
  whoever is committing now.
- **`--squash` and `--fixup`** — those messages exist only until the rebase
  that consumes them.
- **A message git would refuse anyway** — `git commit -m ""`. Signing it would
  turn the refusal into a commit whose whole message is the signature.
- **A `gh --body-file`** — reading the file inside the argument would discard
  whether the read succeeded, so a mistyped filename would become an empty
  body and a `gh` run that reported success. Use `--body "$(cat msg.md)"`,
  which is signed.
- **`git commit -F-` with nothing visible feeding standard input**, and
  **`gh --body-file -`**, which reads standard input as well.
- **A message file whose command is already downstream of a pipe** — the
  producer expects git to read its output.
- **A path that names more than one file** — `git commit -F *.txt`. git takes
  the first match as the message and the rest as pathspecs; one reader cannot
  stand in for that.
- **A command the plugin cannot parse with certainty** — unbalanced quotes, an
  option quoted as a whole (`"-Fmsg.txt"`), `-m` mixed with `-F`, more than one
  input redirection, a redirection of a descriptor other than standard input,
  or a `git commit` that appears only inside another command's argument.

## Configuration

Works out of the box. Two things are worth knowing:

**Network.** At most once a day, the plugin makes one background `GET` request
to `openrouter.ai/api/v1/models` — no API key, no account, nothing else is
sent — to refresh its model-name cache. Offline, it silently keeps the last
cache, or the formatted-ID fallback when there is none.

**Options.** Via the tuple form of the plugin config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    ["opencode-pr-signature", { "cachePath": "/custom/path/models.jsonl" }]
  ]
}
```

- `cachePath` — where the model cache is stored (default:
  `~/.config/opencode/cache/opencode-pr-signature/models.jsonl`)

## Development

```bash
# Install dependencies
bun install

# Type check
bun run typecheck

# Run the tests
bun test
```

The tests execute the rewritten commands for real, in throwaway git
repositories, through `/bin/sh` — they need `git` and a POSIX shell on PATH.
The suite is fully offline: network access is always injected or fixtured,
never real.

## License

Apache 2.0 - See [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

- [OpenCode Documentation](https://opencode.ai/docs)
- [OpenCode Discord](https://opencode.ai/discord)
- [GitHub Issues](https://github.com/arttttt/opencode-pr-signature/issues)

---

Made with ❤️ for the OpenCode community
