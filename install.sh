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

# Workspace selection
echo ""
echo "=============================================="
echo "  WORKSPACE CONFIGURATION"
echo "=============================================="
echo ""
echo "The workspace is the folder accessible to MCP tools."
echo "Choose how much access you want to give:"
echo ""
echo "  [1] Home directory ($HOME) - recommended"
echo "  [2] Root (/) - full system access"
echo "  [3] Custom path"
echo ""
read -p "Enter choice (1/2/3) [default: 1]: " CHOICE

CHOICE=${CHOICE:-1}

case $CHOICE in
    1)
        WORKSPACE_PATH="$HOME"
        ;;
    2)
        WORKSPACE_PATH="/"
        ;;
    3)
        read -p "Enter full path: " WORKSPACE_PATH
        ;;
    *)
        WORKSPACE_PATH="$HOME"
        ;;
esac

# Validate path exists
if [ ! -d "$WORKSPACE_PATH" ]; then
    echo ""
    echo "WARNING: Path does not exist: $WORKSPACE_PATH"
    echo "Creating directory..."
    mkdir -p "$WORKSPACE_PATH"
fi

# Config file location
CONFIG_DIR="$HOME/.cursor"
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
echo ""
if [ "$CHOICE" = "1" ]; then
    echo "Access: HOME DIRECTORY - All files in $HOME are accessible"
    echo "Example: ~/projects/myapp = /workspace/projects/myapp"
elif [ "$CHOICE" = "2" ]; then
    echo "Access: FULL SYSTEM - All files are accessible"
    echo "Example: /home/user/projects = /workspace/home/user/projects"
else
    echo "Access: $WORKSPACE_PATH"
fi
echo ""
echo "Next steps:"
echo "  1. Restart Cursor IDE"
echo "  2. The MCP tools will be available automatically"
echo ""
echo "To verify installation:"
echo "  docker run --rm code-contractor-mcp node -e \"console.log('OK')\""
echo ""
