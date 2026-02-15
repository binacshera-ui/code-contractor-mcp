#!/bin/bash

echo "=============================================="
echo "  Code Contractor MCP Server - Installer"
echo "=============================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Docker
echo "Checking prerequisites..."
if ! command -v docker &> /dev/null; then
    echo -e "${RED}ERROR: Docker is not installed.${NC}"
    echo "Please install Docker first:"
    echo "  curl -fsSL https://get.docker.com | sh"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo -e "${RED}ERROR: Docker is not running.${NC}"
    echo "Please start Docker and try again."
    exit 1
fi
echo -e "${GREEN}[OK]${NC} Docker is installed and running"
echo ""

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Build Docker image
echo "Building Docker image (this may take a few minutes)..."
cd "$SCRIPT_DIR"
docker build -t code-contractor-mcp .
if [ $? -ne 0 ]; then
    echo -e "${RED}ERROR: Failed to build Docker image.${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}[OK]${NC} Docker image built successfully"
echo ""

# Config file location
CONFIG_DIR="$HOME/.cursor"
CONFIG_FILE="$CONFIG_DIR/mcp.json"

# Create config directory if needed
mkdir -p "$CONFIG_DIR"

# Backup existing config if exists
if [ -f "$CONFIG_FILE" ]; then
    echo "Backing up existing config to mcp.json.backup"
    cp "$CONFIG_FILE" "$CONFIG_FILE.backup"
fi

# Create config - mount ENTIRE filesystem to Docker
# This gives Docker direct access to ALL files!
cat > "$CONFIG_FILE" << 'EOF'
{
  "mcpServers": {
    "code-contractor": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-v", "/:/host", "code-contractor-mcp"]
    }
  }
}
EOF

echo ""
echo "=============================================="
echo -e "  ${GREEN}Installation Complete!${NC}"
echo "=============================================="
echo ""
echo "Configuration saved to: $CONFIG_FILE"
echo ""
echo -e "${YELLOW}Architecture:${NC}"
echo "  - Docker has DIRECT access to entire filesystem via /host mount"
echo "  - All tools (ripgrep, tree-sitter, etc.) run INSIDE Docker"
echo "  - No Bridge service needed!"
echo ""
echo "Next steps:"
echo "  1. Restart Cursor IDE"
echo "  2. The MCP tools will be available automatically"
echo ""
echo "To verify Docker works:"
echo '  docker run --rm code-contractor-mcp node -e "console.log('"'"'OK'"'"')"'
echo ""
