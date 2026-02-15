#!/bin/bash

# Code Contractor MCP Server - Installation Script
# Tested on: macOS, Linux (Ubuntu, Debian)

set -e

echo "=============================================="
echo "  Code Contractor MCP Server - Installer"
echo "=============================================="
echo ""

# Check Docker
echo "Checking prerequisites..."
if ! command -v docker &> /dev/null; then
    echo "ERROR: Docker is not installed."
    echo "Please install Docker Desktop from: https://www.docker.com/products/docker-desktop/"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo "ERROR: Docker is not running."
    echo "Please start Docker Desktop and try again."
    exit 1
fi

echo "✓ Docker is installed and running"

# Build Docker image
echo ""
echo "Building Docker image (this may take a few minutes)..."
docker build -t code-contractor-mcp .

echo ""
echo "✓ Docker image built successfully"

# Smart default: go up from mcp-server to the projects folder
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(dirname "$SCRIPT_DIR")"
WORKSPACE_PATH="$PARENT_DIR"

echo ""
echo "WORKSPACE CONFIGURATION"
echo "======================="
echo "The workspace is the folder that will be accessible to the MCP tools."
echo "All your projects inside this folder will be available."
echo ""
echo "Suggested workspace: $WORKSPACE_PATH"
echo ""
read -p "Enter workspace path (or press Enter to accept): " CUSTOM_PATH
if [ -n "$CUSTOM_PATH" ]; then
    WORKSPACE_PATH="$CUSTOM_PATH"
fi

# Validate path exists
if [ ! -d "$WORKSPACE_PATH" ]; then
    echo ""
    echo "WARNING: Path does not exist: $WORKSPACE_PATH"
    echo "Creating directory..."
    mkdir -p "$WORKSPACE_PATH"
fi

# Detect OS and set config path
if [[ "$OSTYPE" == "darwin"* ]]; then
    CONFIG_DIR="$HOME/.cursor"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    CONFIG_DIR="$HOME/.cursor"
else
    CONFIG_DIR="$HOME/.cursor"
fi

CONFIG_FILE="$CONFIG_DIR/mcp.json"

# Create config directory if needed
mkdir -p "$CONFIG_DIR"

# Backup existing config
if [ -f "$CONFIG_FILE" ]; then
    echo ""
    echo "Backing up existing config to mcp.json.backup"
    cp "$CONFIG_FILE" "$CONFIG_FILE.backup"
fi

# Generate MCP config
cat > "$CONFIG_FILE" << EOF
{
  "mcpServers": {
    "code-contractor": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-v", "${WORKSPACE_PATH}:/workspace", "code-contractor-mcp"]
    }
  }
}
EOF

echo ""
echo "=============================================="
echo "  Installation Complete!"
echo "=============================================="
echo ""
echo "Configuration: $CONFIG_FILE"
echo "Workspace:     $WORKSPACE_PATH"
echo "Docker path:   ${WORKSPACE_PATH}:/workspace"
echo ""
echo "IMPORTANT: Your projects should be inside: $WORKSPACE_PATH"
echo "           They will be accessible at: /workspace/[project-name]"
echo ""
echo "Next steps:"
echo "  1. Restart Cursor IDE"
echo "  2. The MCP tools will be available automatically"
echo ""
echo "To verify installation:"
echo "  docker run --rm code-contractor-mcp node -e \"console.log('OK')\""
echo ""
