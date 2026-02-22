#Requires -Version 5.1
#
# Code Contractor MCP Server - Windows Installer
#
# Usage (run in PowerShell):
#   irm https://raw.githubusercontent.com/binacshera-ui/code-contractor-mcp/main/install.ps1 | iex
#
# Or with force update:
#   $env:FORCE_UPDATE="true"; irm https://raw.githubusercontent.com/binacshera-ui/code-contractor-mcp/main/install.ps1 | iex
#

$ErrorActionPreference = "Stop"

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  Code Contractor MCP Server - Windows Setup" -ForegroundColor Cyan  
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""

# Check for force update flag
$ForceUpdate = $env:FORCE_UPDATE -eq "true"

# Check Docker
Write-Host "Checking Docker..." -ForegroundColor Yellow

$dockerInstalled = $false
$dockerRunning = $false

# Check if Docker is installed
try {
    $dockerPath = Get-Command docker -ErrorAction SilentlyContinue
    if ($dockerPath) {
        $dockerInstalled = $true
    }
} catch {}

if (-not $dockerInstalled) {
    Write-Host "[!] Docker Desktop not installed" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Installing Docker Desktop..." -ForegroundColor Cyan
    
    # Download Docker Desktop installer
    $dockerInstaller = "$env:TEMP\DockerDesktopInstaller.exe"
    Write-Host "  Downloading Docker Desktop (this may take a few minutes)..." -ForegroundColor Gray
    
    try {
        Invoke-WebRequest -Uri "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe" -OutFile $dockerInstaller -UseBasicParsing
        
        Write-Host "  Running installer (follow the prompts)..." -ForegroundColor Gray
        Start-Process -FilePath $dockerInstaller -ArgumentList "install", "--quiet", "--accept-license" -Wait
        
        # Refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        
        Write-Host "[OK] Docker Desktop installed" -ForegroundColor Green
        Write-Host ""
        Write-Host "IMPORTANT: You may need to:" -ForegroundColor Yellow
        Write-Host "  1. Log out and log back in (or restart computer)" -ForegroundColor Yellow
        Write-Host "  2. Run this script again" -ForegroundColor Yellow
        Write-Host ""
        
        # Try to start Docker Desktop
        $dockerDesktopPath = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
        if (Test-Path $dockerDesktopPath) {
            Write-Host "Starting Docker Desktop..." -ForegroundColor Cyan
            Start-Process $dockerDesktopPath
            Write-Host "Waiting for Docker to initialize (60 seconds)..." -ForegroundColor Gray
            Start-Sleep -Seconds 60
        }
        
        $dockerInstalled = $true
    } catch {
        Write-Host "[ERROR] Failed to install Docker Desktop automatically" -ForegroundColor Red
        Write-Host "Please install manually from: https://docker.com/products/docker-desktop" -ForegroundColor Yellow
        exit 1
    } finally {
        Remove-Item $dockerInstaller -Force -ErrorAction SilentlyContinue
    }
}

# Check if Docker is running
try {
    $dockerVersion = docker version --format '{{.Server.Version}}' 2>$null
    if ($dockerVersion) {
        $dockerRunning = $true
        Write-Host "[OK] Docker is ready (v$dockerVersion)" -ForegroundColor Green
    }
} catch {}

if (-not $dockerRunning) {
    Write-Host "[!] Docker Desktop not running - starting it..." -ForegroundColor Yellow
    
    # Try to find and start Docker Desktop
    $dockerDesktopPaths = @(
        "C:\Program Files\Docker\Docker\Docker Desktop.exe",
        "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
        "$env:LOCALAPPDATA\Docker\Docker Desktop.exe"
    )
    
    $started = $false
    foreach ($path in $dockerDesktopPaths) {
        if (Test-Path $path) {
            Write-Host "  Starting Docker Desktop..." -ForegroundColor Gray
            Start-Process $path
            $started = $true
            break
        }
    }
    
    if (-not $started) {
        # Try via Start Menu
        try {
            Start-Process "Docker Desktop" -ErrorAction SilentlyContinue
            $started = $true
        } catch {}
    }
    
    if ($started) {
        Write-Host "  Waiting for Docker to initialize..." -ForegroundColor Gray
        
        # Wait for Docker to be ready (max 90 seconds)
        $maxWait = 90
        $waited = 0
        $ready = $false
        
        while ($waited -lt $maxWait) {
            Start-Sleep -Seconds 5
            $waited += 5
            
            try {
                $dockerVersion = docker version --format '{{.Server.Version}}' 2>$null
                if ($dockerVersion) {
                    $ready = $true
                    break
                }
            } catch {}
            
            Write-Host "  Still waiting... ($waited/$maxWait seconds)" -ForegroundColor Gray
        }
        
        if ($ready) {
            Write-Host "[OK] Docker is ready (v$dockerVersion)" -ForegroundColor Green
        } else {
            Write-Host "[ERROR] Docker failed to start within $maxWait seconds" -ForegroundColor Red
            Write-Host "Please start Docker Desktop manually and run this script again" -ForegroundColor Yellow
            exit 1
        }
    } else {
        Write-Host "[ERROR] Could not find Docker Desktop to start" -ForegroundColor Red
        Write-Host "Please start Docker Desktop manually and run this script again" -ForegroundColor Yellow
        exit 1
    }
}

# Check if already installed
$ImageExists = docker images -q code-contractor-mcp 2>$null
$ConfigPath = "$env:APPDATA\Cursor\mcp.json"
$ConfigExists = (Test-Path $ConfigPath) -and (Select-String -Path $ConfigPath -Pattern "code-contractor" -Quiet -ErrorAction SilentlyContinue)

if ($ImageExists -or $ConfigExists) {
    Write-Host ""
    Write-Host "Existing installation detected:" -ForegroundColor Yellow
    if ($ImageExists) { Write-Host "  - Docker image: code-contractor-mcp" }
    if ($ConfigExists) { Write-Host "  - Cursor config: $ConfigPath" }
    Write-Host ""
    
    if ($ForceUpdate) {
        Write-Host "Force update mode - reinstalling..." -ForegroundColor Blue
    } else {
        $choice = Read-Host "Update existing installation? [Y/n]"
        if ($choice -eq "n" -or $choice -eq "N") {
            Write-Host "Installation cancelled." -ForegroundColor Yellow
            exit 0
        }
    }
    
    # Stop running containers
    Write-Host "Stopping running containers..." -ForegroundColor Yellow
    docker ps -q --filter ancestor=code-contractor-mcp 2>$null | ForEach-Object { docker stop $_ 2>$null }
    
    # Remove old image
    if ($ImageExists) {
        Write-Host "Removing old Docker image..." -ForegroundColor Yellow
        docker rmi code-contractor-mcp -f 2>$null | Out-Null
    }
    Write-Host "[OK] Old installation cleaned" -ForegroundColor Green
    Write-Host ""
}

# Create temp directory
$TempDir = Join-Path $env:TEMP "mcp-install-$(Get-Random)"
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
Push-Location $TempDir

try {
    $RepoUrl = "https://raw.githubusercontent.com/binacshera-ui/code-contractor-mcp/main"
    
    Write-Host "Downloading files..." -ForegroundColor Yellow
    
    $files = @(
        "Dockerfile",
        "package.json", 
        "server.js",
        "SearchEngine.js",
        "CodeLinter.js", 
        "CodeAnalyzer.js",
        "diff-tool.js"
    )
    
    foreach ($file in $files) {
        Invoke-WebRequest -Uri "$RepoUrl/$file" -OutFile $file -UseBasicParsing
    }
    Write-Host "[OK] Server files downloaded" -ForegroundColor Green
    
    # Download Cursor Rule
    Write-Host "Installing Cursor Rule..." -ForegroundColor Yellow
    $RulesDir = "$env:USERPROFILE\.cursor\rules"
    New-Item -ItemType Directory -Path $RulesDir -Force | Out-Null
    Invoke-WebRequest -Uri "$RepoUrl/rules/code-contractor.mdc" -OutFile "$RulesDir\code-contractor.mdc" -UseBasicParsing
    Write-Host "[OK] Cursor Rule installed" -ForegroundColor Green
    
    # Build Docker image
    Write-Host ""
    Write-Host "Building Docker image (this may take a few minutes)..." -ForegroundColor Yellow
    docker build -t code-contractor-mcp . --quiet
    Write-Host "[OK] Docker image built" -ForegroundColor Green
    
} finally {
    Pop-Location
    Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}

# Create run-mcp.bat wrapper
$CursorDir = "$env:APPDATA\Cursor"
New-Item -ItemType Directory -Path $CursorDir -Force | Out-Null

$RunBatPath = "$CursorDir\run-mcp.bat"
$RunBatContent = @"
@echo off
docker run -i --rm -v c:/:/host code-contractor-mcp
"@
Set-Content -Path $RunBatPath -Value $RunBatContent -Encoding ASCII

# Configure Cursor
$ConfigContent = @"
{
  "mcpServers": {
    "code-contractor": {
      "command": "$($RunBatPath -replace '\\', '\\\\')"
    }
  }
}
"@

# Backup existing config
if (Test-Path $ConfigPath) {
    Copy-Item $ConfigPath "$ConfigPath.backup" -Force
    Write-Host "Backed up existing config" -ForegroundColor Gray
}

Set-Content -Path $ConfigPath -Value $ConfigContent -Encoding UTF8

Write-Host ""
Write-Host "==============================================" -ForegroundColor Green
Write-Host "  Installation Complete!" -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Installed:" -ForegroundColor White
Write-Host "  - MCP Server: Docker image 'code-contractor-mcp'"
Write-Host "  - Config: $ConfigPath"
Write-Host "  - Cursor Rule: $RulesDir\code-contractor.mdc"
Write-Host ""
Write-Host "What's included:" -ForegroundColor Yellow
Write-Host "  - 20+ token-efficient tools (AST, search, smart patching)"
Write-Host "  - Cursor Rule that guides AI to use MCP tools"
Write-Host "  - 80%+ token savings vs traditional approach"
Write-Host ""
Write-Host "Next step: Restart Cursor IDE" -ForegroundColor Cyan
Write-Host ""

# Clear force flag
$env:FORCE_UPDATE = $null
