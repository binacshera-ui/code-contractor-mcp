@echo off
setlocal enabledelayedexpansion

echo ==============================================
echo   Code Contractor MCP Server - Installer
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

:: Smart default: go up from mcp-server to the projects folder
:: If running from C:\projects\code-contractor-mcp, default to C:\projects
for %%I in ("%cd%\..") do set "PARENT_DIR=%%~fI"
set "WORKSPACE_PATH=%PARENT_DIR%"

echo.
echo WORKSPACE CONFIGURATION
echo =======================
echo The workspace is the folder that will be accessible to the MCP tools.
echo All your projects inside this folder will be available.
echo.
echo Suggested workspace: %WORKSPACE_PATH%
echo.
set /p "CUSTOM_PATH=Enter workspace path (or press Enter to accept): "
if not "%CUSTOM_PATH%"=="" set "WORKSPACE_PATH=%CUSTOM_PATH%"

:: Validate path exists
if not exist "%WORKSPACE_PATH%" (
    echo.
    echo WARNING: Path does not exist: %WORKSPACE_PATH%
    echo Creating directory...
    mkdir "%WORKSPACE_PATH%"
)

:: Convert backslashes to forward slashes for Docker
set "DOCKER_PATH=%WORKSPACE_PATH:\=/%"

:: Config file location
set "CONFIG_DIR=%USERPROFILE%\.cursor"
set "CONFIG_FILE=%CONFIG_DIR%\mcp.json"

:: Create config directory if needed
if not exist "%CONFIG_DIR%" mkdir "%CONFIG_DIR%"

:: Backup existing config if exists
if exist "%CONFIG_FILE%" (
    echo.
    echo Backing up existing config to mcp.json.backup
    copy "%CONFIG_FILE%" "%CONFIG_FILE%.backup" >nul
)

:: Create config content
echo {> "%CONFIG_FILE%"
echo   "mcpServers": {>> "%CONFIG_FILE%"
echo     "code-contractor": {>> "%CONFIG_FILE%"
echo       "command": "docker",>> "%CONFIG_FILE%"
echo       "args": ["run", "-i", "--rm", "-v", "%DOCKER_PATH%:/workspace", "code-contractor-mcp"]>> "%CONFIG_FILE%"
echo     }>> "%CONFIG_FILE%"
echo   }>> "%CONFIG_FILE%"
echo }>> "%CONFIG_FILE%"

echo.
echo ==============================================
echo   Installation Complete!
echo ==============================================
echo.
echo Configuration: %CONFIG_FILE%
echo Workspace:     %WORKSPACE_PATH%
echo Docker path:   %DOCKER_PATH%:/workspace
echo.
echo IMPORTANT: Your projects should be inside: %WORKSPACE_PATH%
echo            They will be accessible at: /workspace/[project-name]
echo.
echo Next steps:
echo   1. Restart Cursor IDE
echo   2. The MCP tools will be available automatically
echo.
echo To verify installation:
echo   docker run --rm code-contractor-mcp node -e "console.log('OK')"
echo.
pause
