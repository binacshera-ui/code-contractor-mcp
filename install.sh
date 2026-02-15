#!/bin/bash

echo "=============================================="
echo "  Code Contractor MCP Server - Installer"
echo "  With Bridge Architecture for Remote Access"
echo "=============================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Check Docker
echo "Checking prerequisites..."
if ! command -v docker &> /dev/null; then
    echo -e "${RED}ERROR: Docker is not installed.${NC}"
    echo "Please install Docker from: https://www.docker.com/products/docker-desktop/"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo -e "${RED}ERROR: Docker is not running.${NC}"
    echo "Please start Docker and try again."
    exit 1
fi
echo -e "${GREEN}[OK]${NC} Docker is installed and running"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}ERROR: Node.js is not installed.${NC}"
    echo "Please install Node.js from: https://nodejs.org/"
    exit 1
fi
echo -e "${GREEN}[OK]${NC} Node.js is installed"
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

# Install Node dependencies for bridge
echo "Installing bridge dependencies..."
npm install
echo -e "${GREEN}[OK]${NC} Dependencies installed"
echo ""

# Config file location
if [[ "$OSTYPE" == "darwin"* ]]; then
    CONFIG_DIR="$HOME/.cursor"
else
    CONFIG_DIR="$HOME/.cursor"
fi
CONFIG_FILE="$CONFIG_DIR/mcp.json"

# Create config directory if needed
mkdir -p "$CONFIG_DIR"

# Backup existing config if exists
if [ -f "$CONFIG_FILE" ]; then
    echo "Backing up existing config to mcp.json.backup"
    cp "$CONFIG_FILE" "$CONFIG_FILE.backup"
fi

# Create config with bridge support
# On Mac, use host.docker.internal which works natively
# On Linux, we need --add-host
if [[ "$OSTYPE" == "darwin"* ]]; then
    DOCKER_ARGS='["run", "-i", "--rm", "code-contractor-mcp"]'
else
    DOCKER_ARGS='["run", "-i", "--rm", "--add-host=host.docker.internal:host-gateway", "code-contractor-mcp"]'
fi

cat > "$CONFIG_FILE" << EOF
{
  "mcpServers": {
    "code-contractor": {
      "command": "docker",
      "args": $DOCKER_ARGS
    }
  }
}
EOF

# Create bridge startup script
BRIDGE_SCRIPT="$SCRIPT_DIR/start-bridge.sh"
cat > "$BRIDGE_SCRIPT" << EOF
#!/bin/bash
echo "Starting Code Contractor Bridge..."
cd "$SCRIPT_DIR"
node bridge.js
EOF
chmod +x "$BRIDGE_SCRIPT"

# Create launchd plist for macOS auto-start
if [[ "$OSTYPE" == "darwin"* ]]; then
    LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
    mkdir -p "$LAUNCH_AGENTS_DIR"
    PLIST_FILE="$LAUNCH_AGENTS_DIR/com.codecontractor.bridge.plist"
    
    cat > "$PLIST_FILE" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.codecontractor.bridge</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>$SCRIPT_DIR/bridge.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$SCRIPT_DIR/bridge.log</string>
    <key>StandardErrorPath</key>
    <string>$SCRIPT_DIR/bridge.error.log</string>
</dict>
</plist>
EOF
    echo -e "${GREEN}[OK]${NC} Created launchd service for auto-start"
fi

# For Linux, create systemd user service
if [[ "$OSTYPE" == "linux"* ]]; then
    SYSTEMD_DIR="$HOME/.config/systemd/user"
    mkdir -p "$SYSTEMD_DIR"
    SERVICE_FILE="$SYSTEMD_DIR/code-contractor-bridge.service"
    
    cat > "$SERVICE_FILE" << EOF
[Unit]
Description=Code Contractor Bridge
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node $SCRIPT_DIR/bridge.js
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
EOF
    
    systemctl --user daemon-reload 2>/dev/null
    systemctl --user enable code-contractor-bridge 2>/dev/null
    echo -e "${GREEN}[OK]${NC} Created systemd service for auto-start"
fi

echo ""
echo "=============================================="
echo "  Installation Complete!"
echo "=============================================="
echo ""
echo "Configuration: $CONFIG_FILE"
echo "Bridge Script: $BRIDGE_SCRIPT"
echo ""
echo "IMPORTANT - New Bridge Architecture:"
echo "  - The Bridge runs on YOUR machine (not in Docker)"
echo "  - It handles all file operations with YOUR permissions"
echo "  - Works with local files AND remote SSH connections!"
echo ""
echo "Next steps:"
echo "  1. Start the bridge: $BRIDGE_SCRIPT"
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "     Or: launchctl load $PLIST_FILE"
elif [[ "$OSTYPE" == "linux"* ]]; then
    echo "     Or: systemctl --user start code-contractor-bridge"
fi
echo "  2. Restart Cursor IDE"
echo "  3. The MCP tools will be available automatically"
echo ""
echo "To verify:"
echo '  - Bridge: curl -X POST http://localhost:9111 -d '\''{"operation":"ping"}'\'''
echo '  - Docker: docker run --rm code-contractor-mcp node -e "console.log('\''OK'\'')"'
echo ""

# Ask to start bridge now
read -p "Start the bridge now? (Y/n): " START_NOW
START_NOW=${START_NOW:-Y}
if [[ "$START_NOW" =~ ^[Yy]$ ]]; then
    echo ""
    echo "Starting bridge in background..."
    nohup node "$SCRIPT_DIR/bridge.js" > "$SCRIPT_DIR/bridge.log" 2>&1 &
    BRIDGE_PID=$!
    echo -e "${GREEN}[OK]${NC} Bridge started (PID: $BRIDGE_PID)"
    
    # On macOS, also load the launchd service
    if [[ "$OSTYPE" == "darwin"* ]]; then
        launchctl load "$PLIST_FILE" 2>/dev/null
    fi
fi

echo ""
