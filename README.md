# OpenCode PR Auto-Signature Plugin

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![OpenCode](https://img.shields.io/badge/OpenCode-Plugin-green.svg)](https://opencode.ai)
[![npm](https://img.shields.io/npm/v/opencode-pr-signature.svg)](https://www.npmjs.com/package/opencode-pr-signature)

Automatically adds AI model signature to Pull Requests, Issues, and Commits created through OpenCode.

## Features

- 🤖 **Automatic Detection** - Dynamically detects the AI model being used (Kimi, Claude, GPT, Gemini, etc.)
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

### From Local Files

1. Clone or download this repository
2. Copy `src/plugin.ts` to your OpenCode plugins directory:
   - Global: `~/.config/opencode/plugins/pr-signature.ts`
   - Project-level: `.opencode/plugins/pr-signature.ts`

3. Restart OpenCode

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
- `git commit -m "message"`
- `git commit --message="message"`

#### gh CLI (GitHub CLI)
- `gh pr create`
- `gh issue create`
- `gh pr comment`
- `gh issue comment`
- `gh pr review`

### Supported Models

The plugin recognizes and formats the following model families:

- **Kimi** (Kimi, K2.5, Moonshot)
- **Claude** (Claude 3/3.5/4/4.5 - Opus, Sonnet, Haiku)
- **GPT** (GPT-4, GPT-4o, GPT-4.5, GPT-5, o1, o3, o4)
- **Gemini** (Gemini 1.5/2.0/2.5/3 - Pro, Flash, Ultra)
- **DeepSeek** (DeepSeek V3, R1, Coder)
- **Llama** (Llama 3/3.1/3.2/3.3/4)
- **Mistral** (Mistral Large/Medium/Small, Codestral, Pixtral)
- **Qwen** (Qwen 2/2.5, Turbo, Plus, Max, QwQ)
- **Grok** (Grok 2, 3)
- **Cohere** (Command R, R+, A)
- **Others** (Yi, Perplexity Sonar, and more)

Other models will be displayed with their raw ID formatted nicely.

## How It Works

1. **Model Detection**: The plugin listens to chat messages to detect which AI model is currently in use
2. **Tool Interception**: Using the `tool.execute.before` hook, it intercepts:
   - GitHub MCP tool calls (PR/Issue creation and updates)
   - Bash commands (`git commit`, `gh pr create`, etc.)
3. **Signature Injection**: Before the tool executes, it appends the signature:
   - For MCP tools: modifies the `body` argument
   - For `git commit`: adds an additional `-m` flag (git concatenates multiple `-m` with blank lines)
   - For `gh` commands: appends to `--body` or adds new `--body` flag
4. **Duplicate Prevention**: Checks if signature already exists to avoid duplicates

## Configuration

No configuration required! The plugin works out of the box.

## Development

```bash
# Install dependencies
bun install

# Type check
bun run typecheck
```

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
