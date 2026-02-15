# Code Contractor MCP Server

> **Professional MCP Server with AST-powered code intelligence, high-performance search, and smart file operations.**

[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Required-blue.svg)](https://www.docker.com/)
[![MCP](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Overview

Code Contractor is a powerful [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that provides AI assistants with advanced code manipulation capabilities. It runs in an **isolated Docker environment** for security and consistency.

### Key Features

- **🌳 AST-Powered Analysis** - Tree-sitter based code understanding (JS/TS/Python/Go/Java)
- **🔍 High-Performance Search** - ripgrep integration with semantic classification
- **🔧 Smart File Operations** - 10+ patching methods with automatic backups
- **🛡️ Multi-Layer Linting** - AST + ESLint/flake8/pylint integration
- **📦 Batch Operations** - Execute multiple operations atomically
- **🔒 Isolated Sandbox** - All operations run in Docker container

## Quick Start

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- [Node.js 20+](https://nodejs.org/) (for local development only)
- [Cursor IDE](https://cursor.sh/) or any MCP-compatible client

### Installation

#### Option 1: One-Click Install (Recommended)

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/code-contractor-mcp.git
cd code-contractor-mcp

# Run the installer
./install.sh        # macOS/Linux
install.bat         # Windows
```

#### Option 2: Manual Installation

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/code-contractor-mcp.git
cd code-contractor-mcp

# 2. Build the Docker image
docker build -t code-contractor-mcp .

# 3. Add to your MCP client configuration (see below)
```

### Configuration

Add to your MCP client configuration file (`~/.cursor/mcp.json` or `%USERPROFILE%\.cursor\mcp.json`):

**Windows - Full Drive Access (Recommended):**
```json
{
  "mcpServers": {
    "code-contractor": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-v", "C:/:/workspace", "code-contractor-mcp"]
    }
  }
}
```
This gives access to your entire C: drive. Example: `C:\projects\myapp` → `/workspace/projects/myapp`

**macOS/Linux - Home Directory:**
```json
{
  "mcpServers": {
    "code-contractor": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-v", "/Users/yourname:/workspace", "code-contractor-mcp"]
    }
  }
}
```

> **Tip**: The installer (`install.bat` / `install.sh`) will guide you through workspace configuration automatically.

## Tools Reference

### Navigation & Reading

| Tool | Description |
|------|-------------|
| `get_file_tree` | Get project structure with configurable depth |
| `read_file` | Read file content with optional line range |
| `get_file_outline` | Get function/class definitions (AST-powered) |
| `extract_code_element` | Extract specific function/class with context |

### Search & Analysis

| Tool | Description |
|------|-------------|
| `search_code` | High-performance search (ripgrep + AST classification) |
| `find_references` | Find all usages of a symbol across project |
| `lint_file` | Multi-layer code analysis on file |
| `lint_code` | Multi-layer code analysis on raw code string |

### File Operations

| Tool | Description |
|------|-------------|
| `create_file` | Create or overwrite file (with backup) |
| `delete_file` | Delete file (with backup) |
| `simple_replace` | Find and replace text |
| `replace_exact_line` | Replace exact line match |
| `insert_at_line` | Insert content at line number |
| `replace_line_range` | Replace range of lines |
| `insert_relative_to_marker` | Insert before/after marker |
| `replace_between_markers` | Replace content between delimiters |
| `append_to_file` | Append content to end |
| `prepend_to_file` | Prepend content to start |
| `apply_diff` | Apply unified diff patch |
| `ast_replace_element` | Replace function/class by name (AST-powered) |
| `batch_smart_apply` | Execute multiple operations atomically |

### Backup & Recovery

| Tool | Description |
|------|-------------|
| `list_backups` | List available backups for a file |
| `show_diff` | Show diff between current and backup |
| `restore_backup` | Restore file from backup |

### Terminal (Sandboxed)

| Tool | Description |
|------|-------------|
| `run_terminal` | Execute command in isolated Linux container |

> ⚠️ **Note**: The terminal runs inside Docker and cannot access the host system. For host commands, use your IDE's built-in terminal.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     MCP Client (Cursor)                      │
└─────────────────────────┬───────────────────────────────────┘
                          │ stdio (JSON-RPC)
┌─────────────────────────▼───────────────────────────────────┐
│                   Docker Container                           │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              Code Contractor MCP Server                 │ │
│  │  ┌──────────────┐ ┌──────────────┐ ┌───────────────┐  │ │
│  │  │ CodeAnalyzer │ │  CodeLinter  │ │ SearchEngine  │  │ │
│  │  │ (Tree-sitter)│ │ (Multi-layer)│ │  (ripgrep)    │  │ │
│  │  └──────────────┘ └──────────────┘ └───────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
│                              │                               │
│  ┌───────────────────────────▼──────────────────────────┐   │
│  │                    /workspace                         │   │
│  │            (Mounted from host filesystem)             │   │
│  └───────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Supported Languages

| Language | AST Analysis | Linting | Search |
|----------|:------------:|:-------:|:------:|
| JavaScript | ✅ | ✅ ESLint | ✅ |
| TypeScript | ✅ | ✅ ESLint | ✅ |
| Python | ✅ | ✅ flake8, pylint | ✅ |
| Go | ✅ | ⚠️ Basic | ✅ |
| Java | ✅ | ⚠️ Basic | ✅ |
| Other | ⚠️ Regex | ⚠️ Basic | ✅ |

## Backup System

All file modifications automatically create backups in `.mcp-backups/` directories:

```
project/
├── src/
│   ├── index.js
│   └── .mcp-backups/
│       ├── index.js.1699999999999
│       └── index.js.1699999888888
```

Use `list_backups`, `show_diff`, and `restore_backup` tools to manage backups.

## Security

- **Sandboxed Execution**: All operations run inside Docker container
- **Path Validation**: Prevents directory traversal attacks
- **Sensitive File Blocking**: Blocks access to `.env`, credentials, keys
- **Dangerous Command Blocking**: Blocks destructive terminal commands
- **Automatic Backups**: Every modification is backed up

## Development

### Local Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build Docker image
docker build -t code-contractor-mcp .

# Run locally (requires tree-sitter native build)
npm start
```

### Project Structure

```
code-contractor-mcp/
├── server.js           # Main MCP server
├── CodeAnalyzer.js     # Tree-sitter AST operations
├── CodeLinter.js       # Multi-layer linting
├── SearchEngine.js     # ripgrep + AST search
├── diff-tool.js        # CLI backup/diff utility
├── Dockerfile          # Container definition
├── package.json        # Dependencies
└── README.md           # This file
```

## Troubleshooting

### Common Issues

**Docker not found**
```bash
# Ensure Docker Desktop is running
docker --version
```

**Permission denied on Linux/macOS**
```bash
# Add user to docker group
sudo usermod -aG docker $USER
# Log out and back in
```

**Path issues on Windows**
- Use forward slashes in paths: `C:/projects` not `C:\projects`
- Ensure path is inside mounted volume

**Tool not responding**
- Restart Docker Desktop
- Rebuild image: `docker build -t code-contractor-mcp .`

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic
- [Tree-sitter](https://tree-sitter.github.io/tree-sitter/) for AST parsing
- [ripgrep](https://github.com/BurntSushi/ripgrep) for fast search
