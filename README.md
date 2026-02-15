# Code Contractor MCP Server

> **Professional MCP Server with AST-powered code intelligence, high-performance search, and smart file operations.**

[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Required-blue.svg)](https://www.docker.com/)
[![MCP](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Overview

Code Contractor is a powerful [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that provides AI assistants with advanced code manipulation capabilities.

### Key Features

- **🌳 AST-Powered Analysis** - Tree-sitter based code understanding (JS/TS/Python/Go/Java)
- **🔍 High-Performance Search** - ripgrep integration with semantic classification
- **🔧 Smart File Operations** - 10+ patching methods with automatic backups
- **🛡️ Multi-Layer Linting** - AST + ESLint/flake8/pylint integration
- **📦 Batch Operations** - Execute multiple operations atomically
- **🌐 Bridge Architecture** - Works with local files AND remote SSH connections!

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Cursor IDE                                                      │
│  (local or connected via Remote SSH)                            │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  MCP Server (Docker)                                             │
│  • AST Parsing (Tree-sitter)                                     │
│  • Code Search (ripgrep)                                         │
│  • Linting                                                       │
│  • Heavy processing                                              │
└─────────────────────┬───────────────────────────────────────────┘
                      │ HTTP Request
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  Bridge (runs on YOUR machine)                                   │
│  • Read/Write files                                              │
│  • Has YOUR permissions                                          │
│  • Access to everything YOU can access                           │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  File System                                                     │
│  • Local files                                                   │
│  • Remote SSH files (when using Cursor Remote SSH)              │
│  • Network mounts                                                │
└─────────────────────────────────────────────────────────────────┘
```

**Why Bridge Architecture?**
- Heavy processing (AST parsing, search, linting) runs in Docker for isolation
- File operations run on YOUR machine with YOUR permissions
- Works seamlessly with Cursor Remote SSH connections!

## Quick Start

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- [Node.js 20+](https://nodejs.org/) 
- [Cursor IDE](https://cursor.sh/) or any MCP-compatible client

### Installation

#### One-Click Install (Recommended)

```bash
# Clone the repository
git clone https://github.com/binacshera-ui/code-contractor-mcp.git
cd code-contractor-mcp

# Run the installer
./install.sh        # macOS/Linux
install.bat         # Windows
```

The installer will:
1. Build the Docker image
2. Install Node.js dependencies
3. Configure Cursor's `mcp.json`
4. Set up the Bridge to auto-start
5. Start the Bridge

#### Manual Installation

```bash
# 1. Clone and build
git clone https://github.com/binacshera-ui/code-contractor-mcp.git
cd code-contractor-mcp
docker build -t code-contractor-mcp .
npm install

# 2. Start the bridge (keep running in background)
node bridge.js

# 3. Configure mcp.json (see below)
```

### Configuration

Add to your MCP client configuration file (`~/.cursor/mcp.json` or `%USERPROFILE%\.cursor\mcp.json`):

**With Bridge (Recommended):**
```json
{
  "mcpServers": {
    "code-contractor": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "--add-host=host.docker.internal:host-gateway", "code-contractor-mcp"]
    }
  }
}
```

**macOS (host.docker.internal works natively):**
```json
{
  "mcpServers": {
    "code-contractor": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "code-contractor-mcp"]
    }
  }
}
```

### Starting the Bridge

The Bridge must be running for file operations to work.

**Windows:**
```batch
start-bridge.bat
```

**macOS/Linux:**
```bash
./start-bridge.sh
# Or in background:
nohup node bridge.js > bridge.log 2>&1 &
```

The installer sets up auto-start on login, but you can also start manually.

## Tools Reference

> **Note:** This server provides tools that **complement** Cursor's built-in tools.  
> For basic operations like Read, Write, Delete, Grep, use Cursor's native tools.

### Code Intelligence (AST-powered)

| Tool | Description |
|------|-------------|
| `get_file_outline` | Get function/class definitions with line numbers |
| `extract_code_element` | Extract specific function/class with context |
| `find_references` | Find all usages of a symbol across project |
| `find_large_files` | Find files exceeding line threshold |

### Advanced Search

| Tool | Description |
|------|-------------|
| `search_code` | Semantic code search with modes: |
|  | • `smart` - ripgrep + AST classification (default) |
|  | • `definitions` - Find only declarations |
|  | • `usages` - Find only references |
|  | • `imports` - Find import statements |
|  | • `todos` - Find TODO/FIXME/HACK comments |
|  | • `secrets` - Find potential hardcoded secrets |
|  | • `count` - Count matches only |
|  | • `files` - List files with matches |

### Code Validation

| Tool | Description |
|------|-------------|
| `lint_code` | Validate code string before writing to file |

### Smart Patching

| Tool | Description |
|------|-------------|
| `replace_exact_line` | Replace specific line (exact match) |
| `insert_at_line` | Insert content at line number |
| `replace_line_range` | Replace range of lines |
| `insert_relative_to_marker` | Insert before/after marker text |
| `replace_between_markers` | Replace content between markers |
| `append_to_file` | Add content to end of file |
| `prepend_to_file` | Add content to start of file |
| `apply_diff` | Apply unified diff patch |

### AST Refactoring

| Tool | Description |
|------|-------------|
| `ast_replace_element` | Replace function/class by name |
| `ast_rename_symbol` | Rename variable/function/class |
| `ast_add_import` | Add import at correct location |

### Backup & Recovery

| Tool | Description |
|------|-------------|
| `list_backups` | List all backups for a file |
| `show_diff` | Show diff between current and backup |
| `restore_backup` | Restore file from backup |

### Batch & Sandbox

| Tool | Description |
|------|-------------|
| `batch_smart_apply` | Execute multiple operations in sequence |
| `run_sandbox_terminal` | Execute command in isolated Docker sandbox |

## Path Handling

The server accepts both Windows and Linux style paths:

```
C:\Users\user\project\file.js  →  Works!
c:/Users/user/project/file.js  →  Works!
Users/user/project/file.js     →  Works!
```

All paths are automatically normalized and routed through the Bridge.

## Supported Languages

| Language | AST Parsing | Linting | Search |
|----------|-------------|---------|--------|
| JavaScript/TypeScript | ✅ Tree-sitter | ✅ ESLint | ✅ |
| Python | ✅ Tree-sitter | ✅ flake8/pylint | ✅ |
| Go | ✅ Tree-sitter | ⚠️ Basic | ✅ |
| Java | ✅ Tree-sitter | ⚠️ Basic | ✅ |
| Other | ⚠️ Regex fallback | ⚠️ Basic | ✅ |

## Backup System

All file modifications are automatically backed up to `.mcp-backups/` directories:

```
project/
├── src/
│   ├── app.js
│   └── .mcp-backups/
│       ├── app.js.1699999999999
│       └── app.js.1699999888888
```

Use `list_backups`, `show_diff`, and `restore_backup` to manage backups.

## Troubleshooting

### Bridge not responding

```bash
# Check if bridge is running
curl -X POST http://localhost:9111 -d '{"operation":"ping"}'

# Start bridge manually
node bridge.js
```

### Docker can't connect to bridge (Linux)

Make sure you have `--add-host=host.docker.internal:host-gateway` in the Docker args.

### Permission errors

The Bridge runs with YOUR permissions. If you can't access a file normally, the Bridge can't either.

### File not found

- Check the path is correct
- Ensure the Bridge is running
- Try with full absolute path

## Security

- **Docker Isolation**: Heavy processing (AST, search, lint) runs in Docker
- **Bridge Permissions**: File operations use YOUR user permissions
- **Sensitive Files**: Automatic blocking of `.env`, credentials, keys
- **No Network**: Docker container has no network access by default
- **Backups**: All modifications backed up automatically

## Development

```bash
# Install dependencies
npm install

# Run bridge locally
node bridge.js

# Test tools
node test-all.js
```

## License

MIT License - see [LICENSE](LICENSE) file.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

---

**Made with ❤️ for AI-assisted development**
