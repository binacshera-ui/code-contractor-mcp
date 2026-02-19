#!/bin/bash
#
# Code Contractor MCP Server - One-Line Installer
#
# Fresh install:
#   curl -fsSL https://raw.githubusercontent.com/binacshera-ui/code-contractor-mcp/main/install.sh | bash
#
# Update existing installation:
#   curl -fsSL https://raw.githubusercontent.com/binacshera-ui/code-contractor-mcp/main/install.sh | bash -s -- --force
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
BLUE='\033[0;34m'
NC='\033[0m'

# Parse arguments
FORCE_INSTALL=false
for arg in "$@"; do
    case $arg in
        --force|--update|-f|-u)
            FORCE_INSTALL=true
            ;;
    esac
done

# Check if running interactively (not piped)
IS_INTERACTIVE=false
if [ -t 0 ]; then
    IS_INTERACTIVE=true
fi

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

# Check if already installed
IMAGE_EXISTS=$(docker images -q code-contractor-mcp 2>/dev/null)
CONFIG_EXISTS=false
if [ -f "$HOME/.cursor/mcp.json" ] && grep -q "code-contractor" "$HOME/.cursor/mcp.json" 2>/dev/null; then
    CONFIG_EXISTS=true
fi

if [ -n "$IMAGE_EXISTS" ] || [ "$CONFIG_EXISTS" = true ]; then
    echo ""
    echo -e "${YELLOW}⚠️  Existing installation detected:${NC}"
    [ -n "$IMAGE_EXISTS" ] && echo "   - Docker image: code-contractor-mcp"
    [ "$CONFIG_EXISTS" = true ] && echo "   - Cursor config: ~/.cursor/mcp.json"
    echo ""
    
    if [ "$FORCE_INSTALL" = true ]; then
        echo -e "${BLUE}Updating installation...${NC}"
        
        # Stop any running containers
        echo "Stopping running containers..."
        docker ps -q --filter ancestor=code-contractor-mcp 2>/dev/null | xargs -r docker stop 2>/dev/null || true
        
        # Remove old image
        if [ -n "$IMAGE_EXISTS" ]; then
            echo "Removing old Docker image..."
            docker rmi code-contractor-mcp -f 2>/dev/null || true
        fi
        echo -e "${GREEN}[OK]${NC} Old installation cleaned"
    elif [ "$IS_INTERACTIVE" = true ]; then
        # Interactive mode - ask user
        echo "Options:"
        echo "  1) Update (reinstall with latest version)"
        echo "  2) Cancel"
        echo ""
        read -p "Choose [1/2]: " choice
        
        case $choice in
            1|u|U|update|Update)
                echo ""
                echo -e "${BLUE}Updating installation...${NC}"
                
                # Stop any running containers
                echo "Stopping running containers..."
                docker ps -q --filter ancestor=code-contractor-mcp 2>/dev/null | xargs -r docker stop 2>/dev/null || true
                
                # Remove old image
                if [ -n "$IMAGE_EXISTS" ]; then
                    echo "Removing old Docker image..."
                    docker rmi code-contractor-mcp -f 2>/dev/null || true
                fi
                echo -e "${GREEN}[OK]${NC} Old installation cleaned"
                ;;
            *)
                echo -e "${YELLOW}Installation cancelled.${NC}"
                exit 0
                ;;
        esac
    else
        # Non-interactive (piped) - show instructions
        echo -e "${RED}Cannot prompt in pipe mode.${NC}"
        echo ""
        echo "To update, run:"
        echo -e "  ${GREEN}curl -fsSL https://raw.githubusercontent.com/binacshera-ui/code-contractor-mcp/main/install.sh | bash -s -- --force${NC}"
        echo ""
        exit 1
    fi
    echo ""
fi

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

echo -e "${GREEN}[OK]${NC} Server files downloaded"

# Download AI Skill (professional workflow guide)
echo "Installing AI Skill..."
SKILL_DIR="$HOME/.cursor/skills/token-efficient-dev"
mkdir -p "$SKILL_DIR"
curl -fsSL "$REPO_URL/skill/SKILL.md" -o "$SKILL_DIR/SKILL.md" 2>/dev/null || true
curl -fsSL "$REPO_URL/skill/tool-reference.md" -o "$SKILL_DIR/tool-reference.md" 2>/dev/null || true
curl -fsSL "$REPO_URL/skill/examples.md" -o "$SKILL_DIR/examples.md" 2>/dev/null || true
echo -e "${GREEN}[OK]${NC} AI Skill installed"

# Download and install Cursor Rule (forces AI to use MCP tools)
echo "Installing Cursor Rule..."
RULES_DIR="$HOME/.cursor/rules"
mkdir -p "$RULES_DIR"
curl -fsSL "$REPO_URL/rules/code-contractor.mdc" -o "$RULES_DIR/code-contractor.mdc"
echo -e "${GREEN}[OK]${NC} Cursor Rule installed"

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
echo "Installed:"
echo "  - MCP Server: Docker image 'code-contractor-mcp'"
echo "  - Config: $CONFIG_FILE"
echo "  - AI Skill: $SKILL_DIR"
echo "  - Cursor Rule: $RULES_DIR/code-contractor.mdc"
echo ""
echo -e "${YELLOW}What's included:${NC}"
echo "  - 20+ token-efficient tools (AST, search, smart patching)"
echo "  - Professional workflow guide for AI"
echo "  - Cursor Rule that forces AI to use MCP tools"
echo "  - 80%+ token savings vs traditional approach"
echo ""
echo -e "${YELLOW}Next step:${NC} Restart Cursor IDE"
echo ""
