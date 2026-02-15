#!/bin/bash
#
# Code Contractor MCP Server - One-Line Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/binacshera-ui/code-contractor-mcp/main/install.sh | bash
#

set -e

echo "=============================================="
echo "  Code Contractor MCP Server - Installer"
echo "=============================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check Docker
echo "Checking Docker..."
if ! command -v docker &> /dev/null; then
    echo -e "${RED}ERROR: Docker is not installed.${NC}"
    echo "Install Docker: curl -fsSL https://get.docker.com | sh"
    exit 1
fi

if ! docker info &> /dev/null 2>&1; then
    echo -e "${RED}ERROR: Docker is not running.${NC}"
    exit 1
fi
echo -e "${GREEN}[OK]${NC} Docker is ready"

# Create temp directory
INSTALL_DIR=$(mktemp -d)
cd "$INSTALL_DIR"
echo "Working in: $INSTALL_DIR"

# Download files from GitHub
REPO_URL="https://raw.githubusercontent.com/binacshera-ui/code-contractor-mcp/main"
echo ""
echo "Downloading files..."

curl -fsSL "$REPO_URL/Dockerfile" -o Dockerfile
curl -fsSL "$REPO_URL/package.json" -o package.json
curl -fsSL "$REPO_URL/server.js" -o server.js
curl -fsSL "$REPO_URL/SearchEngine.js" -o SearchEngine.js
curl -fsSL "$REPO_URL/CodeLinter.js" -o CodeLinter.js
curl -fsSL "$REPO_URL/CodeAnalyzer.js" -o CodeAnalyzer.js
curl -fsSL "$REPO_URL/diff-tool.js" -o diff-tool.js

echo -e "${GREEN}[OK]${NC} Files downloaded"

# Build Docker image
echo ""
echo "Building Docker image (this may take a few minutes)..."
docker build -t code-contractor-mcp . --quiet

echo -e "${GREEN}[OK]${NC} Docker image built"

# Clean up temp directory
cd /
rm -rf "$INSTALL_DIR"

# Configure Cursor
CONFIG_DIR="$HOME/.cursor"
CONFIG_FILE="$CONFIG_DIR/mcp.json"
mkdir -p "$CONFIG_DIR"

# Backup existing config
if [ -f "$CONFIG_FILE" ]; then
    cp "$CONFIG_FILE" "$CONFIG_FILE.backup"
    echo "Backed up existing config"
fi

# Create config with full filesystem mount
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
echo "Config: $CONFIG_FILE"
echo ""
echo -e "${YELLOW}Next step:${NC} Restart Cursor IDE"
echo ""
echo "Verify: docker run --rm code-contractor-mcp node -e \"console.log('OK')\""
echo ""
