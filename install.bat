@echo off
setlocal enabledelayedexpansion

echo ==============================================
echo   Code Contractor MCP Server - Installer
echo   With Bridge Architecture for Remote Access
echo ==============================================
echo.

:: Check Docker
echo Checking prerequisites...
docker --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Docker is not installed.
    echo Please install Docker Desktop from: https://www.docker.com/products/docker-desktop/
    pause
    exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
    echo ERROR: Docker is not running.
    echo Please start Docker Desktop and try again.
    pause
    exit /b 1
)
echo [OK] Docker is installed and running

:: Check Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed.
    echo Please install Node.js from: https://nodejs.org/
    pause
    exit /b 1
)
echo [OK] Node.js is installed
echo.

:: Build Docker image
echo Building Docker image (this may take a few minutes)...
docker build -t code-contractor-mcp .
if errorlevel 1 (
    echo ERROR: Failed to build Docker image.
    pause
    exit /b 1
)

echo.
echo [OK] Docker image built successfully
echo.

:: Install AI Skill (professional workflow guide)
echo Installing AI Skill...
set "SKILL_DIR=%USERPROFILE%\.cursor\skills\token-efficient-dev"
if not exist "%SKILL_DIR%" mkdir "%SKILL_DIR%"
copy "%SCRIPT_DIR%\skill\SKILL.md" "%SKILL_DIR%\" >nul
copy "%SCRIPT_DIR%\skill\tool-reference.md" "%SKILL_DIR%\" >nul
copy "%SCRIPT_DIR%\skill\examples.md" "%SKILL_DIR%\" >nul
echo [OK] AI Skill installed
echo.

:: Get current directory for bridge path
set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

:: Config file location
set "CONFIG_DIR=%USERPROFILE%\.cursor"
set "CONFIG_FILE=%CONFIG_DIR%\mcp.json"

:: Create config directory if needed
if not exist "%CONFIG_DIR%" mkdir "%CONFIG_DIR%"

:: Backup existing config if exists
if exist "%CONFIG_FILE%" (
    echo Backing up existing config to mcp.json.backup
    copy "%CONFIG_FILE%" "%CONFIG_FILE%.backup" >nul
)

:: Create config with bridge support
:: Using --add-host to allow Docker to connect to host's bridge server
echo {> "%CONFIG_FILE%"
echo   "mcpServers": {>> "%CONFIG_FILE%"
echo     "code-contractor": {>> "%CONFIG_FILE%"
echo       "command": "docker",>> "%CONFIG_FILE%"
echo       "args": ["run", "-i", "--rm", "--add-host=host.docker.internal:host-gateway", "code-contractor-mcp"]>> "%CONFIG_FILE%"
echo     }>> "%CONFIG_FILE%"
echo   }>> "%CONFIG_FILE%"
echo }>> "%CONFIG_FILE%"

:: Create bridge startup script
set "BRIDGE_SCRIPT=%SCRIPT_DIR%\start-bridge.bat"
echo @echo off> "%BRIDGE_SCRIPT%"
echo echo Starting Code Contractor Bridge...>> "%BRIDGE_SCRIPT%"
echo cd /d "%SCRIPT_DIR%">> "%BRIDGE_SCRIPT%"
echo node bridge.js>> "%BRIDGE_SCRIPT%"

:: Create bridge startup VBS for hidden window
set "BRIDGE_VBS=%SCRIPT_DIR%\start-bridge-hidden.vbs"
echo Set WshShell = CreateObject("WScript.Shell")> "%BRIDGE_VBS%"
echo WshShell.Run chr(34) ^& "%BRIDGE_SCRIPT%" ^& chr(34), 0>> "%BRIDGE_VBS%"
echo Set WshShell = Nothing>> "%BRIDGE_VBS%"

:: Add to startup folder
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "STARTUP_LINK=%STARTUP_FOLDER%\CodeContractorBridge.vbs"
copy "%BRIDGE_VBS%" "%STARTUP_LINK%" >nul 2>&1

echo.
echo ==============================================
echo   Installation Complete!
echo ==============================================
echo.
echo Installed:
echo   - MCP Server: Docker image 'code-contractor-mcp'
echo   - Config: %CONFIG_FILE%
echo   - Bridge: %BRIDGE_SCRIPT%
echo   - AI Skill: %SKILL_DIR%
echo.
echo What's included:
echo   - 20+ token-efficient tools (AST, search, smart patching)
echo   - Professional workflow guide for AI
echo   - 80%+ token savings vs traditional approach
echo.
echo Next steps:
echo   1. Start the bridge: "%BRIDGE_SCRIPT%"
echo      (Or it will auto-start on next Windows login)
echo   2. Restart Cursor IDE
echo   3. The MCP tools will be available automatically
echo.

:: Ask to start bridge now
set /p "START_NOW=Start the bridge now? (Y/n): "
if /i "%START_NOW%"=="" set "START_NOW=Y"
if /i "%START_NOW%"=="Y" (
    echo.
    echo Starting bridge in background...
    start "" wscript.exe "%BRIDGE_VBS%"
    echo [OK] Bridge started!
)

echo.
pause
