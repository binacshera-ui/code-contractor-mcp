@echo off
echo ========================================
echo   Building Code Contractor MCP Image
echo ========================================
echo.

cd /d "%~dp0"

echo Building Docker image...
docker build -t code-contractor-mcp:latest .

if errorlevel 1 (
    echo.
    echo ERROR: Docker build failed!
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Build Complete!
echo ========================================
echo.
echo Image: code-contractor-mcp:latest
echo.
echo Next: Run install.bat to configure Cursor
echo.
pause
