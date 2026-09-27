# pastcode

A minimal MCP server for git history, git blame, and debugging the moment a bug was introduced.

[![npm version](https://img.shields.io/npm/v/pastcode.svg)](https://www.npmjs.com/package/pastcode)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-43853d.svg)](https://nodejs.org/)

AI coding agents can read the current snapshot of a repo, but they usually cannot answer the question that matters most when debugging: when did this bug get introduced, who changed it, and what did the file look like before the breakage?

pastcode gives any MCP-compatible AI agent read access to your git history so it can investigate bugs the way a senior engineer would: by walking back through time, checking blame, diffing commits, and narrowing the culprit with git bisect.

## Quick start

Add a server entry like this to your MCP client configuration:

### Claude Desktop

```json
{
  "mcpServers": {
    "pastcode": {
      "command": "npx",
      "args": ["-y", "pastcode"]
    }
  }
}
```

This works the same way in Claude Code, Cursor, Windsurf, or any other MCP-compatible client that launches stdio-based MCP servers. There are no environment variables to set up, no repo config to install, and no global state to manage. The repo path is passed per tool call, so one running server can work across unlimited repositories.

Not published yet, or testing locally? Use the local path variant above instead.

```json
{
  "mcpServers": {
    "pastcode": {
      "command": "node",
      "args": ["/absolute/path/to/pastcode/index.js"]
    }
  }
}
```

## Available tools

| Tool | What it does | Example prompt |
| --- | --- | --- |
| `get_file_at_commit` | Returns the contents of a file at a specific commit or ref. Useful when an AI agent wants to inspect older code without checking out the repo. | “Show me the version of src/auth.js from commit abc123 and compare it to the current file.” |
| `list_commits_for_file` | Lists the recent history of a file using `git log --follow`, including commit hashes, authors, dates, and messages. | “Which commits touched src/api/users.ts, and when were they introduced?” |
| `blame_line_range` | Shows who last changed a line range and which commit introduced it. Great for narrowing suspect edits. | “Who changed the validateEmail function and which commit owns this block?” |
| `diff_between_commits` | Compares two refs, optionally scoped to a file, to show exactly what changed between them. | “What changed between release-1.2 and release-1.3 in src/checkout.ts?” |
| `find_introducing_commit` | Runs a git bisect in a temporary worktree using a supplied test command to locate the first bad commit. | “When did the isValidEmail function start returning false for valid emails?” |

## How agents actually use this

### 1) “When did this bug get introduced?”

A user asks: “The login form breaks for valid email addresses after the last deploy. When did this start?”

The AI may call:

- `list_commits_for_file` on the file that owns email validation
- `blame_line_range` on the suspicious lines
- `get_file_at_commit` on historical revisions to inspect behavior before and after the regression
- `find_introducing_commit` with a minimal test command to confirm the exact first bad commit

### 2) “Who changed this logic and why?”

A user asks: “I want to know why the pricing calculation changed in the checkout flow.”

The AI may call:

- `blame_line_range` on the calculation block
- `diff_between_commits` between the relevant revisions
- `get_file_at_commit` to inspect the code as it existed before the refactor or hotfix

### 3) “What did this file look like before the refactor?”

A user asks: “The refactor in the auth service looks risky. Show me the pre-refactor implementation.”

The AI may call:

- `list_commits_for_file` to locate the refactor commit
- `get_file_at_commit` at the parent ref or historical tag
- `diff_between_commits` between the refactor and its parent to highlight the exact behavioral change

This is not a CLI tool you run manually. The AI agent drives it as part of a normal debugging workflow.

## Security note

> ⚠️ `find_introducing_commit` executes an arbitrary shell command (`testCommand`) during bisect. Only use it against trusted repositories and trusted test commands, just as you would with any AI-driven script execution or automated debugging workflow.

## Contributing

This project is intentionally small and dependency-light. The goal is to stay easy to reason about and easy to wire into AI tools without over-engineering the stack.

To work on it locally:

```bash
git clone https://github.com/USERNAME/pastcode.git
cd pastcode
npm install
```

For manual inspection of the MCP server, you can run it via the official MCP inspector:

```bash
npx @modelcontextprotocol/inspector node index.js
```

Then connect the inspector to the local server entry and inspect tool calls in real time.

If you want to propose a new tool, open an issue first to discuss scope and fit before sending a PR. This project keeps the surface area intentionally small, and it’s best to align on the workflow before adding new capabilities.

## License

This project is licensed under the [MIT License](LICENSE).
