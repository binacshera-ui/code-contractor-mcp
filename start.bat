@echo off
echo ========================================
echo   Code Contractor MCP Server
echo ========================================
echo.

cd /d "%~dp0"

echo Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo Node.js OK

if not exist "node_modules" (
    echo.
    echo Installing dependencies...
    npm install
    if errorlevel 1 (
        echo ERROR: npm install failed!
        pause
        exit /b 1
    )
)

echo.
echo Starting MCP Server...
echo Workspace: %MCP_WORKSPACE_ROOT%
echo.
echo Press Ctrl+C to stop
echo ========================================
echo.

node server.js

pause
