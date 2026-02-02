# OpenCode PR Auto-Signature Plugin

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![OpenCode](https://img.shields.io/badge/OpenCode-Plugin-green.svg)](https://opencode.ai)

Automatically adds AI model signature to Pull Requests and Issues created through OpenCode.

## Features

- 🤖 **Automatic Detection** - Dynamically detects the AI model being used (Kimi, Claude, GPT, Gemini, etc.)
- 📝 **Smart Signature** - Appends signature only to PR/Issue bodies that don't already have it
- 🔄 **Update Support** - Works with both creation and update operations
- 🎯 **Multiple Tools** - Supports both native GitHub tools and MCP Docker tools

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

Once installed, the plugin works automatically. When you create or update a Pull Request or Issue through OpenCode, the signature will be appended:

```markdown
Your PR description here...

🤖 Generated with [OpenCode](https://opencode.ai) (Kimi K2.5)
```

### Supported Operations

- `github_create_pull_request`
- `github_create_issue`
- `github_update_pull_request`
- `github_update_issue`
- `MCP_DOCKER_create_pull_request`
- `MCP_DOCKER_create_issue`
- `MCP_DOCKER_update_pull_request`
- `MCP_DOCKER_update_issue`

### Supported Models

The plugin recognizes and formats the following models:

- **Kimi** (kimi, kimi-for-coding, k2p5)
- **Claude** (claude, claude-3, claude-3-5-sonnet)
- **GPT** (gpt-4, gpt-4o, gpt-4o-mini)
- **Gemini** (gemini, gemini-pro, gemini-ultra)

Other models will be displayed with their raw ID formatted nicely.

## How It Works

1. **Model Detection**: The plugin listens to chat messages to detect which AI model is currently in use
2. **Tool Interception**: Using the `tool.execute.before` hook, it intercepts PR/Issue creation and update calls
3. **Signature Injection**: Before the tool executes, it appends the signature to the body argument
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
