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

:: Workspace selection
echo ==============================================
echo   WORKSPACE CONFIGURATION
echo ==============================================
echo.
echo The workspace is the folder accessible to MCP tools.
echo Choose how much access you want to give:
echo.
echo   [1] Entire C: drive (recommended - access everything)
echo   [2] User folder (%USERPROFILE%)
echo   [3] Custom path
echo.
set /p "CHOICE=Enter choice (1/2/3) [default: 1]: "

if "%CHOICE%"=="" set "CHOICE=1"
if "%CHOICE%"=="1" (
    set "WORKSPACE_PATH=C:/"
    set "DOCKER_PATH=C:/"
) else if "%CHOICE%"=="2" (
    set "WORKSPACE_PATH=%USERPROFILE%"
    set "DOCKER_PATH=%USERPROFILE:\=/%"
) else if "%CHOICE%"=="3" (
    set /p "CUSTOM_PATH=Enter full path: "
    set "WORKSPACE_PATH=!CUSTOM_PATH!"
    set "DOCKER_PATH=!CUSTOM_PATH:\=/!"
) else (
    set "WORKSPACE_PATH=C:/"
    set "DOCKER_PATH=C:/"
)

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
echo.
if "%CHOICE%"=="1" (
    echo Access: FULL DRIVE - All files on C: are accessible
    echo Example: C:\projects\myapp = /workspace/projects/myapp
) else (
    echo Access: %WORKSPACE_PATH%
)
echo.
echo Next steps:
echo   1. Restart Cursor IDE
echo   2. The MCP tools will be available automatically
echo.
echo To verify installation:
echo   docker run --rm code-contractor-mcp node -e "console.log('OK')"
echo.
pause
