#!/usr/bin/env node

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Code Contractor Bridge - Local File Operations Server
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * This bridge runs on the HOST machine (not in Docker) and handles all file
 * operations. This allows the MCP server in Docker to access files that the
 * user's machine has access to - including:
 * 
 * - Local files
 * - Remote files via SSH (when connected via Cursor Remote SSH)
 * - Network mounts
 * - Everything the user can access!
 * 
 * The MCP Server (Docker) sends HTTP requests to this bridge for file I/O,
 * while keeping heavy processing (AST, search, lint) inside Docker.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

// Configuration
const PORT = process.env.BRIDGE_PORT || 9111;
const HOST = '127.0.0.1'; // Only local connections

// Security: Only allow access to paths under these roots (configurable)
const ALLOWED_ROOTS = process.env.ALLOWED_ROOTS 
    ? process.env.ALLOWED_ROOTS.split(',')
    : ['/'];  // Default: allow all (user's responsibility)

// Backup configuration
const BACKUP_ENABLED = process.env.BACKUP !== 'false';

// =============================================================================
// Helpers
// =============================================================================

function normalizePath(inputPath) {
    // Handle Windows paths
    let normalized = inputPath;
    
    // Convert Windows-style paths
    const windowsMatch = normalized.match(/^([a-zA-Z]):[\\\/](.*)$/);
    if (windowsMatch) {
        if (process.platform === 'win32') {
            normalized = windowsMatch[1] + ':/' + windowsMatch[2].replace(/\\/g, '/');
        } else {
            normalized = '/' + windowsMatch[2].replace(/\\/g, '/');
        }
    }
    
    // Convert backslashes to forward slashes
    normalized = normalized.replace(/\\/g, '/');
    
    return normalized;
}

function isPathAllowed(filePath) {
    const normalized = path.resolve(normalizePath(filePath));
    return ALLOWED_ROOTS.some(root => {
        const normalizedRoot = path.resolve(normalizePath(root));
        return normalized.startsWith(normalizedRoot);
    });
}

function backupFile(filePath) {
    if (!BACKUP_ENABLED || !fs.existsSync(filePath)) return null;
    
    const backupDir = path.join(path.dirname(filePath), '.mcp-backups');
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }
    
    const backupPath = path.join(backupDir, `${path.basename(filePath)}.${Date.now()}`);
    fs.copyFileSync(filePath, backupPath);
    return backupPath;
}

function sendJSON(res, statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                resolve(JSON.parse(body));
            } catch (e) {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

// =============================================================================
// File Operations
// =============================================================================

const operations = {
    // Health check
    ping: async () => ({ status: 'ok', timestamp: Date.now() }),
    
    // Read file
    read_file: async ({ path: filePath, line_start, line_end }) => {
        const normalized = normalizePath(filePath);
        
        if (!isPathAllowed(normalized)) {
            throw new Error(`Access denied: ${filePath}`);
        }
        
        if (!fs.existsSync(normalized)) {
            throw new Error(`File not found: ${filePath}`);
        }
        
        let content = fs.readFileSync(normalized, 'utf-8');
        const totalLines = content.split('\n').length;
        
        if (line_start !== undefined || line_end !== undefined) {
            const lines = content.split('\n');
            const start = Math.max(0, (line_start || 1) - 1);
            const end = Math.min(lines.length, line_end || lines.length);
            content = lines.slice(start, end).join('\n');
        }
        
        return { file: filePath, total_lines: totalLines, content };
    },
    
    // Write file
    write_file: async ({ path: filePath, content }) => {
        const normalized = normalizePath(filePath);
        
        if (!isPathAllowed(normalized)) {
            throw new Error(`Access denied: ${filePath}`);
        }
        
        const dir = path.dirname(normalized);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        const existed = fs.existsSync(normalized);
        const backupPath = backupFile(normalized);
        
        fs.writeFileSync(normalized, content, 'utf-8');
        
        return {
            status: 'success',
            action: existed ? 'overwritten' : 'created',
            file: filePath,
            lines: content.split('\n').length,
            backup: backupPath
        };
    },
    
    // Delete file
    delete_file: async ({ path: filePath }) => {
        const normalized = normalizePath(filePath);
        
        if (!isPathAllowed(normalized)) {
            throw new Error(`Access denied: ${filePath}`);
        }
        
        if (!fs.existsSync(normalized)) {
            throw new Error(`File not found: ${filePath}`);
        }
        
        const backupPath = backupFile(normalized);
        fs.unlinkSync(normalized);
        
        return { status: 'success', action: 'deleted', file: filePath, backup: backupPath };
    },
    
    // Check if file exists
    exists: async ({ path: filePath }) => {
        const normalized = normalizePath(filePath);
        
        if (!isPathAllowed(normalized)) {
            throw new Error(`Access denied: ${filePath}`);
        }
        
        return { exists: fs.existsSync(normalized), path: filePath };
    },
    
    // List directory
    list_dir: async ({ path: dirPath, max_depth = 3 }) => {
        const normalized = normalizePath(dirPath || '.');
        
        if (!isPathAllowed(normalized)) {
            throw new Error(`Access denied: ${dirPath}`);
        }
        
        const getStructure = (dir, depth) => {
            if (depth > max_depth) return { name: '...', type: 'limit_reached' };
            
            const stats = fs.statSync(dir);
            const structure = {
                name: path.basename(dir),
                type: stats.isDirectory() ? 'directory' : 'file'
            };
            
            if (stats.isDirectory()) {
                const ignoreList = ['.git', 'node_modules', 'dist', 'build', '__pycache__', '.DS_Store', '.mcp-backups'];
                try {
                    structure.children = fs.readdirSync(dir)
                        .filter(child => !ignoreList.includes(child))
                        .slice(0, 100)
                        .map(child => getStructure(path.join(dir, child), depth + 1));
                } catch (e) {
                    structure.error = e.message;
                }
            }
            
            return structure;
        };
        
        return getStructure(normalized, 0);
    },
    
    // Get file stats
    stat: async ({ path: filePath }) => {
        const normalized = normalizePath(filePath);
        
        if (!isPathAllowed(normalized)) {
            throw new Error(`Access denied: ${filePath}`);
        }
        
        if (!fs.existsSync(normalized)) {
            throw new Error(`File not found: ${filePath}`);
        }
        
        const stats = fs.statSync(normalized);
        return {
            path: filePath,
            size: stats.size,
            isDirectory: stats.isDirectory(),
            isFile: stats.isFile(),
            modified: stats.mtime.toISOString(),
            created: stats.birthtime.toISOString()
        };
    },
    
    // Run command (for ripgrep, etc.)
    run_command: async ({ command, cwd, timeout = 30000 }) => {
        const normalizedCwd = cwd ? normalizePath(cwd) : process.cwd();
        
        if (cwd && !isPathAllowed(normalizedCwd)) {
            throw new Error(`Access denied: ${cwd}`);
        }
        
        return new Promise((resolve) => {
            const child = spawn(process.platform === 'win32' ? 'cmd' : 'sh', 
                process.platform === 'win32' ? ['/c', command] : ['-c', command], {
                cwd: normalizedCwd,
                timeout,
                env: { ...process.env }
            });
            
            let stdout = '';
            let stderr = '';
            
            child.stdout.on('data', data => stdout += data.toString());
            child.stderr.on('data', data => stderr += data.toString());
            
            child.on('close', code => {
                resolve({
                    status: code === 0 ? 'success' : 'error',
                    exit_code: code,
                    stdout: stdout.substring(0, 100000),
                    stderr: stderr.substring(0, 50000)
                });
            });
            
            child.on('error', err => {
                resolve({ status: 'error', error: err.message });
            });
        });
    },
    
    // List backups for a file
    list_backups: async ({ path: filePath }) => {
        const normalized = normalizePath(filePath);
        const backupDir = path.join(path.dirname(normalized), '.mcp-backups');
        
        if (!fs.existsSync(backupDir)) {
            return { backups: [], message: 'No backups found' };
        }
        
        const fileName = path.basename(normalized);
        const backups = fs.readdirSync(backupDir)
            .filter(b => b.startsWith(fileName + '.'))
            .map(b => {
                const timestamp = parseInt(b.split('.').pop());
                const stat = fs.statSync(path.join(backupDir, b));
                return {
                    name: b,
                    fullPath: path.join(backupDir, b),
                    timestamp,
                    date: new Date(timestamp).toISOString(),
                    size: stat.size
                };
            })
            .sort((a, b) => b.timestamp - a.timestamp);
        
        return { file: filePath, count: backups.length, backups };
    },
    
    // Restore from backup
    restore_backup: async ({ file: filePath, backup: backupPath, confirm = false }) => {
        const normalized = normalizePath(filePath);
        
        if (!isPathAllowed(normalized)) {
            throw new Error(`Access denied: ${filePath}`);
        }
        
        // Find backup
        let resolvedBackupPath;
        if (backupPath) {
            resolvedBackupPath = normalizePath(backupPath);
        } else {
            const backupDir = path.join(path.dirname(normalized), '.mcp-backups');
            const fileName = path.basename(normalized);
            const backups = fs.readdirSync(backupDir)
                .filter(b => b.startsWith(fileName + '.'))
                .sort((a, b) => parseInt(b.split('.').pop()) - parseInt(a.split('.').pop()));
            
            if (backups.length === 0) {
                throw new Error('No backups found');
            }
            resolvedBackupPath = path.join(backupDir, backups[0]);
        }
        
        if (!confirm) {
            return {
                status: 'preview',
                message: 'Set confirm=true to actually restore',
                file: filePath,
                restore_from: resolvedBackupPath
            };
        }
        
        const currentBackup = backupFile(normalized);
        const backupContent = fs.readFileSync(resolvedBackupPath, 'utf-8');
        fs.writeFileSync(normalized, backupContent, 'utf-8');
        
        return {
            status: 'restored',
            file: filePath,
            restored_from: resolvedBackupPath,
            current_state_backed_up_to: currentBackup
        };
    }
};

// =============================================================================
// HTTP Server
// =============================================================================

const server = http.createServer(async (req, res) => {
    // CORS headers for local requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    if (req.method !== 'POST') {
        sendJSON(res, 405, { error: 'Method not allowed' });
        return;
    }
    
    try {
        const body = await parseBody(req);
        const { operation, params } = body;
        
        if (!operation || !operations[operation]) {
            sendJSON(res, 400, { error: `Unknown operation: ${operation}` });
            return;
        }
        
        const result = await operations[operation](params || {});
        sendJSON(res, 200, { success: true, result });
        
    } catch (error) {
        sendJSON(res, 500, { success: false, error: error.message });
    }
});

// =============================================================================
// Start Server
// =============================================================================

server.listen(PORT, HOST, () => {
    console.log(`[Code Contractor Bridge] Running on http://${HOST}:${PORT}`);
    console.log(`[Code Contractor Bridge] Allowed roots: ${ALLOWED_ROOTS.join(', ')}`);
    console.log(`[Code Contractor Bridge] Backups: ${BACKUP_ENABLED ? 'enabled' : 'disabled'}`);
    console.log(`[Code Contractor Bridge] Ready to accept requests from MCP Server`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[Code Contractor Bridge] Shutting down...');
    server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
});
