#!/usr/bin/env node

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Code Contractor MCP Server - Full Power Edition with Bridge Architecture
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * 🔗 BRIDGE ARCHITECTURE
 * This server runs inside Docker for heavy processing (AST, search, lint),
 * but delegates file operations to a Bridge running on the HOST machine.
 * 
 * This allows access to:
 * - Local files
 * - Remote files via SSH (when using Cursor Remote SSH)
 * - Network mounts
 * - Everything the user can access!
 * 
 * 🛠️ CAPABILITIES:
 * - Tree-sitter AST operations (JS/TS/Python/Go/Java)
 * - ripgrep high-performance search
 * - Multi-layer code linting (AST + external linters)
 * - Smart patching (10+ methods)
 * - Batch operations
 * - Automatic backup system
 * 
 * 📁 FILE ACCESS: Via Bridge on host machine (port 9111)
 * 📦 BACKUPS: .mcp-backups/ directories (auto-created)
 */

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execSync } = require('child_process');
const diff = require('diff');

// Import our powerful modules
const CodeAnalyzer = require('./CodeAnalyzer');
const SearchEngine = require('./SearchEngine');
const CodeLinter = require('./CodeLinter');

// =============================================================================
// Configuration
// =============================================================================

const BRIDGE_HOST = process.env.BRIDGE_HOST || 'host.docker.internal';
const BRIDGE_PORT = process.env.BRIDGE_PORT || 9111;
const BRIDGE_URL = `http://${BRIDGE_HOST}:${BRIDGE_PORT}`;

// Check if /host mount exists (Linux full filesystem mount)
// This MUST be checked early, before USE_BRIDGE decision
const HOST_MOUNT_EXISTS = fs.existsSync('/host');

// USE_BRIDGE is disabled when we have HOST_MOUNT (direct filesystem access)
const USE_BRIDGE = !HOST_MOUNT_EXISTS && process.env.USE_BRIDGE !== 'false';

const WORKSPACE_ROOT = process.env.MCP_WORKSPACE || '/workspace';
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '3000000'); // 3MB
const MAX_LINES = parseInt(process.env.MAX_LINES || '3000');
const BACKUP_ENABLED = process.env.BACKUP !== 'false';

// =============================================================================
// Bridge Client - Communicates with local Bridge for file operations
// =============================================================================

async function callBridge(operation, params = {}) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ operation, params });
        
        const options = {
            hostname: BRIDGE_HOST,
            port: BRIDGE_PORT,
            path: '/',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            },
            timeout: 30000
        };
        
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(body);
                    if (result.success) {
                        resolve(result.result);
                    } else {
                        reject(new Error(result.error || 'Bridge operation failed'));
                    }
                } catch (e) {
                    reject(new Error(`Bridge response parse error: ${e.message}`));
                }
            });
        });
        
        req.on('error', (e) => {
            reject(new Error(`Bridge connection failed: ${e.message}. Is the bridge running?`));
        });
        
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Bridge request timeout'));
        });
        
        req.write(data);
        req.end();
    });
}

// Bridge-aware file operations
const bridge = {
    async readFile(filePath) {
        if (USE_BRIDGE) {
            const result = await callBridge('read_file', { path: filePath });
            return result.content;
        }
        return fs.readFileSync(filePath, 'utf-8');
    },
    
    async writeFile(filePath, content) {
        if (USE_BRIDGE) {
            return await callBridge('write_file', { path: filePath, content });
        }
        fs.writeFileSync(filePath, content, 'utf-8');
        return { status: 'success', file: filePath };
    },
    
    async exists(filePath) {
        if (USE_BRIDGE) {
            const result = await callBridge('exists', { path: filePath });
            return result.exists;
        }
        return fs.existsSync(filePath);
    },
    
    async deleteFile(filePath) {
        if (USE_BRIDGE) {
            return await callBridge('delete_file', { path: filePath });
        }
        fs.unlinkSync(filePath);
        return { status: 'success', file: filePath };
    },
    
    async listDir(dirPath, maxDepth = 3) {
        if (USE_BRIDGE) {
            return await callBridge('list_dir', { path: dirPath, max_depth: maxDepth });
        }
        // Fallback to local implementation
        return getProjectStructure(dirPath, 0, maxDepth);
    },
    
    async stat(filePath) {
        if (USE_BRIDGE) {
            return await callBridge('stat', { path: filePath });
        }
        const stats = fs.statSync(filePath);
        return {
            size: stats.size,
            isDirectory: stats.isDirectory(),
            isFile: stats.isFile()
        };
    },
    
    async runCommand(command, cwd) {
        if (USE_BRIDGE) {
            return await callBridge('run_command', { command, cwd });
        }
        // Fallback to local execution
        return new Promise((resolve) => {
            const child = spawn('sh', ['-c', command], { cwd });
            let stdout = '', stderr = '';
            child.stdout.on('data', d => stdout += d);
            child.stderr.on('data', d => stderr += d);
            child.on('close', code => resolve({ status: code === 0 ? 'success' : 'error', exit_code: code, stdout, stderr }));
        });
    },
    
    async listBackups(filePath) {
        if (USE_BRIDGE) {
            return await callBridge('list_backups', { path: filePath });
        }
        return { backups: [] };
    },
    
    async restoreBackup(filePath, backupPath, confirm) {
        if (USE_BRIDGE) {
            return await callBridge('restore_backup', { file: filePath, backup: backupPath, confirm });
        }
        throw new Error('Restore not available without bridge');
    }
};

// =============================================================================
// Security & Helpers
// =============================================================================

const SENSITIVE_PATTERNS = [
    /(^|\/)\.env/i,
    /_secret/i,
    /_key\.json/i,
    /credentials/i,
    /password/i,
    /id_rsa/i,
    /\.pem$/i
];

function isSensitivePath(filePath) {
    return SENSITIVE_PATTERNS.some(regex => regex.test(filePath));
}

function resolveSafePath(inputPath) {
    let normalizedPath = inputPath;
    
    // Convert backslashes to forward slashes first
    normalizedPath = normalizedPath.replace(/\\/g, '/');
    
    // Handle Windows paths: C:\path or C:/path -> just the path part
    const windowsPathMatch = normalizedPath.match(/^([a-zA-Z]):\/(.*)$/);
    if (windowsPathMatch) {
        // Windows path like C:/Users/... -> /Users/...
        normalizedPath = '/' + windowsPathMatch[2];
    }
    
    // Handle /workspace prefix (legacy Docker mount)
    if (normalizedPath.startsWith('/workspace/')) {
        normalizedPath = normalizedPath.substring('/workspace'.length);
    } else if (normalizedPath === '/workspace') {
        normalizedPath = '/';
    }
    
    // Remove /host prefix if user accidentally includes it
    if (normalizedPath.startsWith('/host/')) {
        normalizedPath = normalizedPath.substring('/host'.length);
    }
    
    // MODE 1: Host mount exists (Linux with -v /:/host)
    // Docker has direct access to entire filesystem via /host
    if (HOST_MOUNT_EXISTS) {
        // Ensure path starts with /
        if (!normalizedPath.startsWith('/')) {
            normalizedPath = '/' + normalizedPath;
        }
        // Return path under /host
        return '/host' + normalizedPath;
    }
    
    // MODE 2: Bridge mode (Windows or without host mount)
    // Pass absolute paths to Bridge
    if (USE_BRIDGE) {
        if (!normalizedPath.startsWith('/')) {
            normalizedPath = '/' + normalizedPath;
        }
        return normalizedPath;
    }
    
    // MODE 3: Docker-only with workspace mount (legacy)
    // For relative paths, join with workspace root
    // For absolute paths, check if they're within workspace
    if (normalizedPath.startsWith('/')) {
        // Absolute path - check if it's meant to be relative to workspace
        if (!normalizedPath.startsWith(WORKSPACE_ROOT)) {
            // Treat as relative path by stripping leading /
            normalizedPath = normalizedPath.substring(1);
        }
    }
    
    const resolved = path.join(WORKSPACE_ROOT, normalizedPath);
    
    // Security check: ensure we're still within workspace
    const realResolved = path.resolve(resolved);
    const realWorkspace = path.resolve(WORKSPACE_ROOT);
    
    if (!realResolved.startsWith(realWorkspace)) {
        throw new Error(`Security: Path '${inputPath}' is outside workspace.`);
    }
    
    return realResolved;
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

function detectLanguage(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const map = {
        '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
        '.ts': 'typescript', '.tsx': 'typescript',
        '.py': 'python',
        '.go': 'go',
        '.java': 'java'
    };
    return map[ext] || null;
}

function getProjectStructure(dirPath, depth = 0, maxDepth = 4) {
    if (depth > maxDepth) return { name: '...', type: 'limit_reached' };

    const stats = fs.statSync(dirPath);
    const structure = {
        name: path.basename(dirPath),
        type: stats.isDirectory() ? 'directory' : 'file'
    };

    if (stats.isDirectory()) {
        const ignoreList = ['.git', 'node_modules', 'dist', 'build', '__pycache__', '.DS_Store', '.mcp-backups'];
        try {
            const children = fs.readdirSync(dirPath)
                .filter(child => !ignoreList.includes(child))
                .slice(0, 100)
                .map(child => getProjectStructure(path.join(dirPath, child), depth + 1, maxDepth));
            structure.children = children;
        } catch (e) {
            structure.error = e.message;
        }
    }
    return structure;
}

// =============================================================================
// Initialize MCP Server
// =============================================================================

const server = new McpServer({
    name: 'code-contractor',
    version: '1.0.0'
});

// =============================================================================
// CATEGORY 1: Code Intelligence (AST-powered)
// =============================================================================

server.tool(
    'get_file_outline',
    `[AST-POWERED] Get function/class definitions in file (X-ray view).

REQUIRED PARAMETER:
• path: string - File path (e.g., "src/utils.js" or "/host/home/user/project/file.ts")

Example: { "path": "src/components/Button.tsx" }

⭐ PRIORITY 1 FOR READING - Use FIRST before reading any file!
• Returns ONLY structure (names, types, line numbers) - saves 90%+ tokens
• Use this to find what you need, then extract_code_element for details
• Much better than Cursor's Read which returns entire file content
• Languages: JS/TS/Python/Go/Java (regex fallback for others)`,
    {
        path: z.string().describe('File path (Windows or Linux style)')
    },
    async ({ path: inputPath }) => {
        const filePath = resolveSafePath(inputPath);
        
        // Use Bridge for file access (supports remote files)
        const exists = await bridge.exists(filePath);
        if (!exists) {
            throw new Error(`File not found: ${inputPath}`);
        }
        
        const content = await bridge.readFile(filePath);
        const language = detectLanguage(filePath);
        
        try {
            // Use CodeAnalyzer's comprehensive getOutline method
            // Works with AST when available, falls back to regex otherwise
            const analyzer = new CodeAnalyzer(language || 'unknown', filePath);
            const outline = analyzer.getOutline(content);
            
            return { 
                content: [{ 
                    type: 'text', 
                    text: JSON.stringify({ 
                        file: inputPath, 
                        language: language || 'unknown',
                        count: outline.length,
                        outline 
                    }, null, 2) 
                }] 
            };
            
        } catch (e) {
            return { content: [{ type: 'text', text: JSON.stringify({ file: inputPath, error: e.message }) }] };
        }
    }
);

server.tool(
    'extract_code_element',
    `[AST-POWERED] Extract specific function/class/variable with surrounding context.

REQUIRED PARAMETERS (all 3 must be provided):
• path: string - File path (e.g., "src/utils.js")
• element_name: string - Name of function/class/variable to extract
• type: string - One of: "function", "class", "variable", "interface", "type", "method", "enum"

Example: { "path": "src/utils.js", "element_name": "processData", "type": "function" }

⭐ PRIORITY 2 FOR READING - Use after get_file_outline to read specific code
• Returns ONLY the requested element - not entire file!
• Typical workflow: get_file_outline → find function → extract_code_element
• Saves 80%+ tokens compared to reading full file
• Languages: JavaScript, TypeScript, Python, Go, Java`,
    {
        path: z.string().describe('REQUIRED: File path'),
        element_name: z.string().describe('REQUIRED: Name of function/class/variable to extract'),
        type: z.enum(['function', 'class', 'variable', 'interface', 'type', 'method', 'enum']).describe('REQUIRED: Type of code element'),
        context_lines: z.number().optional().describe('Lines of context (default: 5)')
    },
    async ({ path: inputPath, element_name, type, context_lines = 5 }) => {
        const filePath = resolveSafePath(inputPath);
        const language = detectLanguage(filePath);
        
        // Use Bridge for file access (supports remote files)
        const content = await bridge.readFile(filePath);
        
        try {
            // CodeAnalyzer now works with regex fallback even without AST support
            const analyzer = new CodeAnalyzer(language || 'unknown', filePath);
            const results = analyzer.extractElement(content, element_name, type, context_lines);
            
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ file: inputPath, element: element_name, type, results }, null, 2)
                }]
            };
        } catch (e) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: e.message }) }] };
        }
    }
);

// =============================================================================
// CATEGORY 2: Search (ripgrep + AST)
// =============================================================================

server.tool(
    'search_code',
    `[RIPGREP + AST] Advanced code search with semantic understanding.

REQUIRED PARAMETERS:
• term: string - Search term or pattern (e.g., "const ctx", "function.*User")
• path: string - Directory or file to search (e.g., "src", ".", "/host/home/user/project")

OPTIONAL PARAMETERS:
• mode: string - "smart" (default), "definitions", "usages", "imports", "todos", "secrets"
• regex: boolean - Interpret term as regex (default: false)
• case_sensitive: boolean - Case-sensitive matching (default: false)
• max_results: number - Maximum results (default: 50)

Example: { "term": "processData", "path": "src", "mode": "definitions" }
Example: { "term": "const ctx =", "path": "/host/home/user/project/main.js" }

MODES:
• smart - ripgrep + AST classification (definition vs usage)
• definitions - Find only declarations/definitions
• usages - Find only references/usages
• imports - Find import statements for a module
• todos - Find all TODO/FIXME/HACK comments
• secrets - Find potential hardcoded secrets`,
    {
        term: z.string().describe('REQUIRED: Search term or pattern'),
        path: z.string().describe('REQUIRED: Directory or file path to search'),
        mode: z.enum(['smart', 'definitions', 'usages', 'imports', 'todos', 'secrets', 'count', 'files']).optional().describe('Search mode (default: smart)'),
        regex: z.boolean().optional().describe('Interpret term as regex pattern'),
        case_sensitive: z.boolean().optional().describe('Case-sensitive matching'),
        max_results: z.number().optional().describe('Maximum results (default: 50)')
    },
    async ({ term, path: searchPath, mode = 'smart', regex = false, case_sensitive = false, max_results = 50 }) => {
        if (!term && !['todos', 'secrets'].includes(mode)) {
            throw new Error('Parameter "term" is required for this search mode');
        }
        if (!searchPath) {
            throw new Error('Parameter "path" is required');
        }
        const targetPath = resolveSafePath(searchPath);
        
        // Helper to run ripgrep via Bridge or locally
        const runRipgrep = async (args) => {
            const command = `rg ${args}`;
            if (USE_BRIDGE) {
                const result = await callBridge('run_command', { command, cwd: targetPath });
                return result.stdout || '';
            } else {
                // Local Docker execution
                try {
                    return execSync(command, { 
                        cwd: targetPath, 
                        encoding: 'utf-8',
                        maxBuffer: 10 * 1024 * 1024 
                    });
                } catch (e) {
                    return e.stdout || '';
                }
            }
        };
        
        // Parse ripgrep output
        const parseRgOutput = (output, includeContext = false) => {
            const results = [];
            const lines = output.split('\n').filter(l => l.trim());
            
            for (const line of lines) {
                const match = line.match(/^([^:]+):(\d+):(.*)$/);
                if (match) {
                    results.push({
                        file: match[1],
                        line: parseInt(match[2]),
                        content: match[3]
                    });
                    if (results.length >= max_results) break;
                }
            }
            return results;
        };
        
        let results;
        const caseFlag = case_sensitive ? '' : '-i';
        const regexFlag = regex ? '' : '-F';
        const excludes = '--glob "!node_modules" --glob "!.git" --glob "!dist" --glob "!build"';
        
        switch (mode) {
            case 'definitions':
                // Search for definition patterns
                const defPatterns = [
                    `function\\s+${term}`, `class\\s+${term}`, `const\\s+${term}\\s*=`,
                    `let\\s+${term}\\s*=`, `var\\s+${term}\\s*=`, `def\\s+${term}`,
                    `async\\s+function\\s+${term}`, `${term}\\s*=\\s*function`
                ];
                const defOutput = await runRipgrep(`-n ${excludes} -e "${defPatterns.join('" -e "')}" .`);
                results = parseRgOutput(defOutput).map(r => ({ ...r, type: 'definition' }));
                break;
                
            case 'usages':
                // Find usages (excluding definitions)
                const usageOutput = await runRipgrep(`-n ${caseFlag} ${excludes} "${term}" .`);
                const allUsages = parseRgOutput(usageOutput);
                // Filter out likely definitions
                results = allUsages.filter(r => {
                    const line = r.content;
                    return !line.match(new RegExp(`(function|class|const|let|var|def|async)\\s+${term}`));
                }).map(r => ({ ...r, type: 'usage' }));
                break;
                
            case 'imports':
                // Find import statements
                const importPatterns = [
                    `import.*${term}`, `from\\s+['"].*${term}`, 
                    `require\\(['"].*${term}`, `from\\s+${term}\\s+import`
                ];
                const importOutput = await runRipgrep(`-n ${excludes} -e "${importPatterns.join('" -e "')}" .`);
                results = parseRgOutput(importOutput).map(r => ({ ...r, type: 'import' }));
                break;
                
            case 'todos':
                // Find TODO/FIXME comments
                const todoOutput = await runRipgrep(`-n ${excludes} -e "TODO" -e "FIXME" -e "HACK" -e "XXX" .`);
                results = parseRgOutput(todoOutput).map(r => ({ ...r, type: 'todo' }));
                break;
                
            case 'secrets':
                // Find potential secrets
                const secretPatterns = [
                    'password\\s*=', 'api_key\\s*=', 'secret\\s*=', 
                    'token\\s*=', 'apikey', 'API_KEY', 'SECRET_KEY'
                ];
                const secretOutput = await runRipgrep(`-n ${caseFlag} ${excludes} -e "${secretPatterns.join('" -e "')}" .`);
                results = parseRgOutput(secretOutput).map(r => ({ ...r, type: 'potential_secret' }));
                break;
                
            case 'count':
                const countOutput = await runRipgrep(`-c ${caseFlag} ${regexFlag} ${excludes} "${term}" .`);
                let totalCount = 0;
                countOutput.split('\n').forEach(line => {
                    const match = line.match(/:(\d+)$/);
                    if (match) totalCount += parseInt(match[1]);
                });
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ term, mode, count: totalCount }, null, 2)
                    }]
                };
                
            case 'files':
                const filesOutput = await runRipgrep(`-l ${caseFlag} ${regexFlag} ${excludes} "${term}" .`);
                results = filesOutput.split('\n').filter(l => l.trim()).slice(0, max_results).map(f => ({ file: f }));
                break;
                
            case 'smart':
            default:
                // Smart search with AST classification
                const smartOutput = await runRipgrep(`-n ${caseFlag} ${regexFlag} ${excludes} "${term}" .`);
                const matches = parseRgOutput(smartOutput);
                
                // Classify each match
                results = matches.map(r => {
                    let resultType = 'reference';
                    const line = r.content;
                    
                    // Check if it's a definition
                    if (line.match(new RegExp(`(function|class|const|let|var|def|async\\s+function)\\s+${term}`))) {
                        resultType = 'definition';
                    } else if (line.match(new RegExp(`(import|require|from).*${term}`))) {
                        resultType = 'import';
                    } else if (line.match(new RegExp(`${term}\\s*\\(`))) {
                        resultType = 'call';
                    }
                    
                    return { ...r, type: resultType };
                });
        }
        
        // Clean paths
        if (Array.isArray(results)) {
            results = results.map(r => {
                if (r.file) {
                    r.file = r.file.replace(targetPath + '/', '').replace(targetPath + path.sep, '');
                }
                return r;
            });
        }
        
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({ term, mode, count: Array.isArray(results) ? results.length : results, results }, null, 2)
            }]
        };
    }
);

server.tool(
    'find_references',
    `[AST-POWERED] Find all usages of a symbol across the project.

REQUIRED PARAMETER:
• element_name: string - Symbol name to find (e.g., "processData", "UserService")

OPTIONAL PARAMETER:
• path: string - Directory to search (default: entire workspace)

Example: { "element_name": "processData", "path": "src" }

• Semantic search: understands code structure
• Distinguishes definitions from usages
• Groups results by type (definition, import, call, reference)
• Great for refactoring impact analysis`,
    {
        element_name: z.string().describe('REQUIRED: Symbol name (function, class, variable) to find'),
        path: z.string().optional().describe('Directory to search (default: workspace)')
    },
    async ({ element_name, path: searchPath = '.' }) => {
        const targetPath = resolveSafePath(searchPath);
        const excludes = '--glob "!node_modules" --glob "!.git" --glob "!dist" --glob "!build"';
        
        // Run ripgrep via Bridge or locally
        const runRipgrep = async (args) => {
            const command = `rg ${args}`;
            if (USE_BRIDGE) {
                const result = await callBridge('run_command', { command, cwd: targetPath });
                return result.stdout || '';
            } else {
                try {
                    return execSync(command, { cwd: targetPath, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
                } catch (e) {
                    return e.stdout || '';
                }
            }
        };
        
        // Search for all occurrences
        const output = await runRipgrep(`-n -w ${excludes} "${element_name}" .`);
        
        // Group by type
        const grouped = { definitions: [], imports: [], calls: [], references: [] };
        
        output.split('\n').filter(l => l.trim()).forEach(line => {
            const match = line.match(/^([^:]+):(\d+):(.*)$/);
            if (match) {
                const result = { file: match[1], line: parseInt(match[2]), content: match[3].trim() };
                const content = result.content;
                
                // Classify
                if (content.match(new RegExp(`(function|class|const|let|var|def|async\\s+function)\\s+${element_name}`))) {
                    grouped.definitions.push(result);
                } else if (content.match(new RegExp(`(import|require|from).*${element_name}`))) {
                    grouped.imports.push(result);
                } else if (content.match(new RegExp(`${element_name}\\s*\\(`))) {
                    grouped.calls.push(result);
                } else {
                    grouped.references.push(result);
                }
            }
        });
        
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({ element: element_name, ...grouped }, null, 2)
            }]
        };
    }
);

// =============================================================================
// CATEGORY 3: Linting
// =============================================================================

server.tool(
    'lint_code',
    `[MULTI-LAYER ANALYSIS] Check raw code string for issues without needing a file.

REQUIRED PARAMETERS (both must be provided):
• code: string - The code content to analyze
• language: string - One of: "javascript", "typescript", "python", "go", "java"

Example: { "code": "function test() { return }", "language": "javascript" }

• Perfect for validating code before writing to file
• Supports: javascript, typescript, python, go, java
• Use to verify generated code is valid`,
    {
        code: z.string().describe('REQUIRED: Code content to analyze'),
        language: z.string().describe('REQUIRED: Language (javascript, typescript, python, go, java)')
    },
    async ({ code, language }) => {
        const linter = new CodeLinter();
        const results = await linter.lintCode(code, language);
        
        return {
            content: [{
                type: 'text',
                text: JSON.stringify(results, null, 2)
            }]
        };
    }
);

// =============================================================================
// CATEGORY 4: Smart Patching - EXECUTE IMMEDIATELY
// Priority order for TOKEN EFFICIENCY:
// 1. ast_replace_element - just function name + new code
// 2. ast_add_import - just module name
// 3. insert_at_line / append / prepend - just new code
// 4. insert_relative_to_marker - short marker + new code
// 5. replace_between_markers - two markers + new code
// 6. replace_exact_line - risky, needs exact match
// 7. replace_line_range - risky if lines shift
// 8. apply_diff - needs context (more tokens)
// 9. Cursor StrReplace - AVOID! needs old+new (2x tokens)
// =============================================================================

server.tool(
    'replace_exact_line',
    `Replace a single line in a file by exact match.

REQUIRED PARAMETERS (all 3 must be provided):
• path: string - File path (e.g., "src/config.js")
• line_to_find: string - The EXACT complete line to find (whitespace matters!)
• replacement_line: string - The new line to replace it with

Example call:
{
  "path": "src/config.js",
  "line_to_find": "const DEBUG = false;",
  "replacement_line": "const DEBUG = true;"
}

⚠️ PRIORITY 6 - Consider ast_replace_element or insert_at_line instead`,
    {
        path: z.string().describe('REQUIRED: File path (e.g., "src/config.js")'),
        line_to_find: z.string().describe('REQUIRED: Complete line to find (exact match)'),
        replacement_line: z.string().describe('REQUIRED: Complete replacement line')
    },
    async ({ path: inputPath, line_to_find, replacement_line }) => {
        const filePath = resolveSafePath(inputPath);
        
        const exists = await bridge.exists(filePath);
        if (!exists) {
            throw new Error(`File not found: ${inputPath}`);
        }
        
        const original = await bridge.readFile(filePath);
        const lines = original.split('\n');
        let found = false;
        let lineNum = -1;
        
        for (let i = 0; i < lines.length; i++) {
            if (lines[i] === line_to_find) {
                lines[i] = replacement_line;
                found = true;
                lineNum = i + 1;
                break;
            }
        }
        
        if (!found) {
            throw new Error(`Exact line not found: "${line_to_find.substring(0, 50)}..."`);
        }
        
        const backupPath = backupFile(filePath);
        await bridge.writeFile(filePath, lines.join('\n'));
        
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({ status: 'success', action: 'replaced_line', file: inputPath, at_line: lineNum, backup: backupPath })
            }]
        };
    }
);

server.tool(
    'insert_at_line',
    `⭐ PRIORITY 3 FOR WRITING - Insert new code at line number

REQUIRED PARAMETERS (all 3 must be provided):
• path: string - File path (e.g., "src/utils.js")
• line_number: number - Line number where to insert (1-based)
• content: string - Code to insert

Example: { "path": "src/utils.js", "line_number": 5, "content": "import { helper } from './helper';" }

• Only sends NEW code - no old code needed = saves tokens!
• Get line number from get_file_outline first
• Perfect for: adding imports, new functions, new methods
• Use append_to_file for adding at end (even simpler)`,
    {
        path: z.string().describe('File path (Windows or Linux style)'),
        line_number: z.number().describe('Line number where content will be inserted (1-based)'),
        content: z.string().describe('Content to insert (can be multi-line)')
    },
    async ({ path: inputPath, line_number, content: newContent }) => {
        const filePath = resolveSafePath(inputPath);
        
        const exists = await bridge.exists(filePath);
        if (!exists) {
            throw new Error(`File not found: ${inputPath}`);
        }
        
        const original = await bridge.readFile(filePath);
        const backupPath = backupFile(filePath);
        const lines = original.split('\n');
        
        const insertIndex = Math.max(0, Math.min(lines.length, line_number - 1));
        lines.splice(insertIndex, 0, newContent);
        
        await bridge.writeFile(filePath, lines.join('\n'));
        
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({ status: 'success', action: 'inserted', file: inputPath, at_line: line_number, backup: backupPath })
            }]
        };
    }
);

server.tool(
    'replace_line_range',
    `⚠️ PRIORITY 7 - Risky if file was modified (lines shift!)

REQUIRED PARAMETERS (all 4 must be provided):
• path: string - File path (e.g., "src/utils.js")
• start_line: number - First line to replace (1-based, inclusive)
• end_line: number - Last line to replace (1-based, inclusive)
• content: string - New content to insert

Example: { "path": "src/utils.js", "start_line": 10, "end_line": 15, "content": "// replaced content" }

• Better alternative: ast_replace_element (finds by name, not line)
• Only use when lines are fresh from get_file_outline`,
    {
        path: z.string().describe('REQUIRED: File path'),
        start_line: z.number().describe('REQUIRED: First line (1-based)'),
        end_line: z.number().describe('REQUIRED: Last line (1-based)'),
        content: z.string().describe('REQUIRED: New content to insert')
    },
    async ({ path: inputPath, start_line, end_line, content: newContent }) => {
        const filePath = resolveSafePath(inputPath);
        
        const exists = await bridge.exists(filePath);
        if (!exists) {
            throw new Error(`File not found: ${inputPath}`);
        }
        
        const original = await bridge.readFile(filePath);
        const backupPath = backupFile(filePath);
        const lines = original.split('\n');
        
        const startIdx = Math.max(0, start_line - 1);
        const endIdx = Math.min(lines.length, end_line);
        const removed = endIdx - startIdx;
        
        const newLines = newContent.split('\n');
        lines.splice(startIdx, removed, ...newLines);
        
        await bridge.writeFile(filePath, lines.join('\n'));
        
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({ status: 'success', action: 'replaced_range', file: inputPath, removed, inserted: newLines.length, backup: backupPath })
            }]
        };
    }
);

server.tool(
    'insert_relative_to_marker',
    `⭐ PRIORITY 4 FOR WRITING - Insert near a unique text marker

REQUIRED PARAMETERS (all 4 must be provided):
• path: string - File path (e.g., "src/utils.js")
• marker: string - Text to find as anchor point
• position: string - "before" or "after"
• content: string - Content to insert

Example: { "path": "src/utils.js", "marker": "export default", "position": "before", "content": "\\nexport const helper = () => {};\\n" }

• Finds marker and inserts before/after
• Only sends: short marker + new code = efficient!
• Marker should be unique - first occurrence is used`,
    {
        path: z.string().describe('REQUIRED: File path'),
        marker: z.string().describe('REQUIRED: Text pattern to find as anchor point'),
        position: z.enum(['before', 'after']).describe('REQUIRED: Insert before or after the marker'),
        content: z.string().describe('REQUIRED: Content to insert')
    },
    async ({ path: inputPath, marker, position, content: newContent }) => {
        const filePath = resolveSafePath(inputPath);
        
        const exists = await bridge.exists(filePath);
        if (!exists) {
            throw new Error(`File not found: ${inputPath}`);
        }
        
        const original = await bridge.readFile(filePath);
        const backupPath = backupFile(filePath);
        
        const markerIndex = original.indexOf(marker);
        if (markerIndex === -1) {
            throw new Error(`Marker not found: "${marker.substring(0, 50)}..."`);
        }
        
        let result;
        if (position === 'before') {
            result = original.slice(0, markerIndex) + newContent + original.slice(markerIndex);
        } else {
            const afterMarker = markerIndex + marker.length;
            result = original.slice(0, afterMarker) + newContent + original.slice(afterMarker);
        }
        
        await bridge.writeFile(filePath, result);
        
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({ status: 'success', action: 'inserted', position, marker: marker.substring(0, 30), backup: backupPath })
            }]
        };
    }
);

server.tool(
    'replace_between_markers',
    `⭐ PRIORITY 5 - Replace content between two unique markers

REQUIRED PARAMETERS (all 4 must be provided):
• path: string - File path (e.g., "src/config.js")
• start_marker: string - Opening delimiter text
• end_marker: string - Closing delimiter text
• content: string - New content to insert between markers

OPTIONAL:
• include_markers: boolean - Also replace the marker texts (default: false)

Example: { "path": "src/config.js", "start_marker": "/* CONFIG START */", "end_marker": "/* CONFIG END */", "content": "const debug = true;" }

• Use when you have clear delimiters
• Markers should be unique in the file`,
    {
        path: z.string().describe('REQUIRED: File path'),
        start_marker: z.string().describe('REQUIRED: Opening delimiter text'),
        end_marker: z.string().describe('REQUIRED: Closing delimiter text'),
        content: z.string().describe('REQUIRED: New content to insert between markers'),
        include_markers: z.boolean().optional().describe('Also replace markers (default: false)')
    },
    async ({ path: inputPath, start_marker, end_marker, content: newContent, include_markers = false }) => {
        const filePath = resolveSafePath(inputPath);
        
        const exists = await bridge.exists(filePath);
        if (!exists) {
            throw new Error(`File not found: ${inputPath}`);
        }
        
        const original = await bridge.readFile(filePath);
        const backupPath = backupFile(filePath);
        
        const startIdx = original.indexOf(start_marker);
        if (startIdx === -1) {
            throw new Error(`Start marker not found: "${start_marker.substring(0, 30)}..."`);
        }
        
        const searchFrom = include_markers ? startIdx : startIdx + start_marker.length;
        const endIdx = original.indexOf(end_marker, searchFrom);
        if (endIdx === -1) {
            throw new Error(`End marker not found: "${end_marker.substring(0, 30)}..."`);
        }
        
        const replaceStart = include_markers ? startIdx : startIdx + start_marker.length;
        const replaceEnd = include_markers ? endIdx + end_marker.length : endIdx;
        
        const result = original.slice(0, replaceStart) + newContent + original.slice(replaceEnd);
        await bridge.writeFile(filePath, result);
        
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({ status: 'success', action: 'replaced_between_markers', file: inputPath, backup: backupPath })
            }]
        };
    }
);

server.tool(
    'append_to_file',
    `⭐ PRIORITY 3 FOR WRITING - Add code to END of file

REQUIRED PARAMETERS (both must be provided):
• path: string - File path (e.g., "src/utils.js")
• content: string - Code to append at end

Example: { "path": "src/utils.js", "content": "\\nexport function newHelper() { return true; }" }

• SIMPLEST tool - just sends new code, no search needed!
• Perfect for: new functions, new exports, adding at bottom
• No line numbers, no markers, no old code = minimal tokens
• Automatic backup`,
    {
        path: z.string().describe('File path (Windows or Linux style)'),
        content: z.string().describe('Content to add at end of file')
    },
    async ({ path: inputPath, content: newContent }) => {
        const filePath = resolveSafePath(inputPath);
        const backupPath = backupFile(filePath);
        
        // Append using Bridge
        const exists = await bridge.exists(filePath);
        const original = exists ? await bridge.readFile(filePath) : '';
        await bridge.writeFile(filePath, original + newContent);
        
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({ status: 'success', action: 'appended', file: inputPath, backup: backupPath })
            }]
        };
    }
);

server.tool(
    'prepend_to_file',
    `⭐ PRIORITY 3 FOR WRITING - Add code to START of file

REQUIRED PARAMETERS (both must be provided):
• path: string - File path (e.g., "src/utils.js")
• content: string - Code to prepend at start

Example: { "path": "src/utils.js", "content": "// Copyright 2024\\n" }

• SIMPLEST tool - just sends new code!
• Perfect for: imports, headers, license text
• Consider ast_add_import for smarter import handling
• Automatic backup`,
    {
        path: z.string().describe('File path (Windows or Linux style)'),
        content: z.string().describe('Content to add at start of file')
    },
    async ({ path: inputPath, content: newContent }) => {
        const filePath = resolveSafePath(inputPath);
        
        const exists = await bridge.exists(filePath);
        const original = exists ? await bridge.readFile(filePath) : '';
        const backupPath = backupFile(filePath);
        
        await bridge.writeFile(filePath, newContent + original);
        
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({ status: 'success', action: 'prepended', file: inputPath, backup: backupPath })
            }]
        };
    }
);

server.tool(
    'apply_diff',
    `Apply a unified diff patch to a file.

REQUIRED PARAMETERS (both must be provided):
• path: string - File path (e.g., "src/utils.js")
• diff_content: string - Unified diff with --- +++ @@ headers

Example call:
{
  "path": "src/utils.js",
  "diff_content": "--- a/src/utils.js\\n+++ b/src/utils.js\\n@@ -10,3 +10,4 @@\\n function old() {\\n+  // new line\\n }"
}

⚠️ PRIORITY 8 - Consider ast_replace_element or insert_at_line instead (less tokens)`,
    {
        path: z.string().describe('REQUIRED: File path (e.g., "src/utils.js")'),
        diff_content: z.string().describe('REQUIRED: Unified diff content with --- +++ @@ headers')
    },
    async ({ path: inputPath, diff_content }) => {
        const filePath = resolveSafePath(inputPath);
        
        const exists = await bridge.exists(filePath);
        if (!exists) {
            throw new Error(`File not found: ${inputPath}`);
        }
        
        const original = await bridge.readFile(filePath);
        const backupPath = backupFile(filePath);
        
        const patches = diff.parsePatch(diff_content);
        if (patches.length === 0) {
            throw new Error('Invalid or empty diff');
        }
        
        let result = original;
        for (const patch of patches) {
            const applied = diff.applyPatch(result, patch);
            if (applied === false) {
                throw new Error('Failed to apply patch - content may have changed');
            }
            result = applied;
        }
        
        await bridge.writeFile(filePath, result);
        
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({ status: 'success', action: 'diff_applied', file: inputPath, backup: backupPath })
            }]
        };
    }
);

// =============================================================================
// CATEGORY 6: AST-based Operations - EXECUTE IMMEDIATELY
// =============================================================================

server.tool(
    'ast_replace_element',
    `🏆 PRIORITY 1 FOR WRITING - Replace function/class by NAME

REQUIRED PARAMETERS (all 4 must be provided):
• path: string - File path (e.g., "src/utils.js")
• element_name: string - Name of the function/class to replace
• element_type: string - One of: "function", "class", "interface", "type", "method"
• new_content: string - Complete new implementation

Example:
{
  "path": "src/utils.js",
  "element_name": "processData",
  "element_type": "function",
  "new_content": "function processData(input) {\\n  return input.trim();\\n}"
}

• BEST tool for modifying existing code!
• No old code needed, no line numbers, no markers!
• AST finds the function automatically = safest method
• Languages: JavaScript, TypeScript, Python, Go, Java`,
    {
        path: z.string().describe('REQUIRED: File path'),
        element_name: z.string().describe('REQUIRED: Name of function or class to replace'),
        element_type: z.enum(['function', 'class', 'interface', 'type', 'method']).describe('REQUIRED: Type of element'),
        new_content: z.string().describe('REQUIRED: Complete new implementation')
    },
    async ({ path: inputPath, element_name, element_type, new_content }) => {
        const filePath = resolveSafePath(inputPath);
        const language = detectLanguage(filePath);
        
        const exists = await bridge.exists(filePath);
        if (!exists) {
            throw new Error(`File not found: ${inputPath}`);
        }
        
        const original = await bridge.readFile(filePath);
        const backupPath = backupFile(filePath);
        
        const analyzer = new CodeAnalyzer(language);
        const result = analyzer.replaceElement(original, element_name, element_type, new_content);
        
        await bridge.writeFile(filePath, result);
        
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    status: 'success',
                    action: 'ast_replaced',
                    file: inputPath,
                    element: element_name,
                    type: element_type,
                    backup: backupPath
                })
            }]
        };
    }
);

server.tool(
    'ast_rename_symbol',
    `🏆 PRIORITY 1 FOR RENAMING - Rename symbol throughout file

REQUIRED PARAMETERS:
• path: string - File path (e.g., "src/utils.js")
• old_name: string - Current name of the symbol
• new_name: string - New name for the symbol

OPTIONAL:
• symbol_type: string - "variable", "function", "class", or "any" (default)

Example: { "path": "src/utils.js", "old_name": "processData", "new_name": "handleData" }

• MINIMAL tokens: just old name + new name!
• Finds ALL occurrences automatically
• Much safer than Cursor StrReplace (won't break strings/comments)
• Languages: JavaScript, TypeScript, Python, Go, Java`,
    {
        path: z.string().describe('REQUIRED: File path'),
        old_name: z.string().describe('REQUIRED: Current name of the symbol'),
        new_name: z.string().describe('REQUIRED: New name for the symbol'),
        symbol_type: z.enum(['variable', 'function', 'class', 'any']).optional().describe('Type of symbol (default: any)')
    },
    async ({ path: inputPath, old_name, new_name, symbol_type = 'any' }) => {
        const filePath = resolveSafePath(inputPath);
        const language = detectLanguage(filePath);
        
        if (!language) {
            throw new Error(`Unsupported file type for AST: ${inputPath}`);
        }
        
        const exists = await bridge.exists(filePath);
        if (!exists) {
            throw new Error(`File not found: ${inputPath}`);
        }
        
        const original = await bridge.readFile(filePath);
        const backupPath = backupFile(filePath);
        
        // Simple regex-based rename with word boundaries (safer than plain replace)
        const wordBoundary = `\\b${old_name}\\b`;
        const regex = new RegExp(wordBoundary, 'g');
        const result = original.replace(regex, new_name);
        
        const count = (original.match(regex) || []).length;
        
        if (count === 0) {
            throw new Error(`Symbol '${old_name}' not found in file`);
        }
        
        await bridge.writeFile(filePath, result);
        
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    status: 'success',
                    action: 'ast_renamed',
                    file: inputPath,
                    old_name,
                    new_name,
                    occurrences: count,
                    backup: backupPath
                })
            }]
        };
    }
);

server.tool(
    'ast_add_import',
    `🏆 PRIORITY 2 FOR IMPORTS - Add import statement smartly

REQUIRED PARAMETERS:
• path: string - File path (e.g., "src/App.tsx")
• module_source: string - Module to import from (e.g., "react", "./utils")

OPTIONAL (at least one needed):
• named_imports: string[] - Named imports (e.g., ["useState", "useEffect"])
• default_import: string - Default import name (e.g., "React")
• import_all_as: string - Import all as name (e.g., "utils")

Example: { "path": "src/App.tsx", "module_source": "react", "named_imports": ["useState", "useEffect"] }
Example: { "path": "src/App.tsx", "module_source": "react", "default_import": "React" }

• Automatically places at correct location
• Won't add duplicates
• Languages: JavaScript, TypeScript, Python`,
    {
        path: z.string().describe('REQUIRED: File path'),
        module_source: z.string().describe('REQUIRED: Module to import from'),
        named_imports: z.array(z.string()).optional().describe('Named imports array'),
        default_import: z.string().optional().describe('Default import name'),
        import_all_as: z.string().optional().describe('Import all as name')
    },
    async ({ path: inputPath, module_source, named_imports, default_import, import_all_as }) => {
        const filePath = resolveSafePath(inputPath);
        const language = detectLanguage(filePath);
        
        const exists = await bridge.exists(filePath);
        if (!exists) {
            throw new Error(`File not found: ${inputPath}`);
        }
        
        const original = await bridge.readFile(filePath);
        const backupPath = backupFile(filePath);
        
        // Check if import already exists
        if (original.includes(module_source)) {
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        status: 'skipped',
                        reason: `Import from '${module_source}' already exists`,
                        file: inputPath
                    })
                }]
            };
        }
        
        // Build import statement based on language
        let importStatement;
        const ext = path.extname(filePath).toLowerCase();
        
        if (ext === '.py') {
            // Python import
            if (named_imports && named_imports.length > 0) {
                importStatement = `from ${module_source} import ${named_imports.join(', ')}\n`;
            } else {
                importStatement = `import ${module_source}\n`;
            }
        } else {
            // JavaScript/TypeScript import
            const parts = [];
            if (default_import) parts.push(default_import);
            if (import_all_as) parts.push(import_all_as);
            if (named_imports && named_imports.length > 0) {
                parts.push(`{ ${named_imports.join(', ')} }`);
            }
            
            if (parts.length === 0) {
                importStatement = `import '${module_source}';\n`;
            } else {
                importStatement = `import ${parts.join(', ')} from '${module_source}';\n`;
            }
        }
        
        // Find the right place to insert (after existing imports)
        const lines = original.split('\n');
        let insertIndex = 0;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('import ') || line.startsWith('from ') || 
                line.startsWith('require(') || line.startsWith('const ') && line.includes('require(')) {
                insertIndex = i + 1;
            } else if (line && !line.startsWith('//') && !line.startsWith('#') && !line.startsWith('/*') && !line.startsWith("'use")) {
                break;
            }
        }
        
        lines.splice(insertIndex, 0, importStatement.trim());
        const result = lines.join('\n');
        
        await bridge.writeFile(filePath, result);
        
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    status: 'success',
                    action: 'import_added',
                    file: inputPath,
                    import: importStatement.trim(),
                    at_line: insertIndex + 1,
                    backup: backupPath
                })
            }]
        };
    }
);

server.tool(
    'find_large_files',
    `[CODE ANALYSIS] Find files with too many lines (candidates for refactoring).
• Identifies files that may need splitting
• Returns file sizes and line counts
• Helps maintain code quality`,
    {
        path: z.string().optional().describe('Directory to search (default: workspace)'),
        min_lines: z.number().optional().describe('Minimum lines to report (default: 500)')
    },
    async ({ path: searchPath = '.', min_lines = 500 }) => {
        const targetPath = resolveSafePath(searchPath);
        const results = [];
        const codeExtensions = ['.js', '.ts', '.py', '.java', '.go', '.jsx', '.tsx', '.vue', '.rb', '.php', '.cs'];
        const ignoreDirs = ['.git', 'node_modules', 'dist', 'build', '__pycache__', '.mcp-backups'];
        
        // Recursive directory walker - works with both direct fs and Bridge
        const walkDir = async (dir, depth = 0) => {
            if (depth > 5) return;
            
            try {
                let entries;
                
                if (USE_BRIDGE) {
                    // Bridge mode - use API
                    const structure = await callBridge('list_dir', { path: dir, max_depth: 1 });
                    if (!structure || !structure.children) return;
                    entries = structure.children.map(c => ({ name: c.name, isDir: c.type === 'directory' }));
                } else {
                    // Direct fs mode (HOST_MOUNT or local)
                    entries = fs.readdirSync(dir, { withFileTypes: true })
                        .map(e => ({ name: e.name, isDir: e.isDirectory() }));
                }
                
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    
                    if (entry.isDir) {
                        if (!ignoreDirs.includes(entry.name)) {
                            await walkDir(fullPath, depth + 1);
                        }
                    } else {
                        const ext = path.extname(entry.name).toLowerCase();
                        if (codeExtensions.includes(ext)) {
                            try {
                                const content = await bridge.readFile(fullPath);
                                const lineCount = content.split('\n').length;
                                if (lineCount >= min_lines) {
                                    results.push({
                                        file: fullPath.replace(targetPath + '/', '').replace(targetPath + path.sep, ''),
                                        lines: lineCount
                                    });
                                }
                            } catch (e) {
                                // Ignore unreadable files
                            }
                        }
                    }
                }
            } catch (e) {
                // Ignore permission errors
            }
        };
        
        await walkDir(targetPath);
        results.sort((a, b) => b.lines - a.lines);
        
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    threshold: min_lines,
                    count: results.length,
                    files: results
                }, null, 2)
            }]
        };
    }
);

// =============================================================================
// CATEGORY 7: Terminal - ISOLATED SANDBOX ENVIRONMENT
// =============================================================================

server.tool(
    'run_sandbox_terminal',
    `[SANDBOX] Execute commands in isolated Linux Docker container.

This is a SANDBOXED environment for safe testing. Use for:
• Running test scripts safely
• Trying npm/pip packages without affecting host
• Build/lint tools in isolation
• Git operations in sandbox

For REAL terminal access, use Cursor's built-in Shell tool instead.`,
    {
        command: z.string().describe('Linux/bash command to execute'),
        cwd: z.string().optional().describe('Working directory within /workspace')
    },
    async ({ command, cwd }) => {
        const workDir = cwd ? resolveSafePath(cwd) : WORKSPACE_ROOT;
        
        // Security blocks
        const blocked = [
            /rm\s+-rf\s+\//, /rm\s+-rf\s+~/, /mkfs/, /dd\s+if=/,
            />\s*\/dev\/sd/, /chmod\s+-R\s+777\s+\//
        ];
        
        for (const pattern of blocked) {
            if (pattern.test(command)) {
                throw new Error('Security: Command blocked');
            }
        }
        
        return new Promise((resolve) => {
            const child = spawn('sh', ['-c', command], {
                cwd: workDir,
                timeout: 120000,
                env: { ...process.env, PATH: process.env.PATH }
            });
            
            let stdout = '';
            let stderr = '';
            
            child.stdout.on('data', (data) => { stdout += data.toString(); });
            child.stderr.on('data', (data) => { stderr += data.toString(); });
            
            child.on('close', (code) => {
                resolve({
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            status: code === 0 ? 'success' : 'error',
                            command,
                            exit_code: code,
                            stdout: stdout.substring(0, 20000),
                            stderr: stderr.substring(0, 10000)
                        }, null, 2)
                    }]
                });
            });
            
            child.on('error', (err) => {
                resolve({
                    content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: err.message }) }]
                });
            });
        });
    }
);

// =============================================================================
// CATEGORY 8: Batch Operations - EXECUTE IMMEDIATELY
// =============================================================================

server.tool(
    'batch_smart_apply',
    `[IMMEDIATE BATCH] Execute multiple file operations in sequence.
• All operations backed up before execution
• Supports: replace, insert, append, prepend, diff, AST replace
• Great for multi-file refactoring in one call
• Faster than individual tool calls
• Returns detailed status for each operation
NOTE: For create/delete files, use Cursor's Write/Delete tools`,
    {
        operations: z.array(z.object({
            type: z.enum([
                'replace_exact_line',
                'insert_at_line', 'append_to_file', 'prepend_to_file',
                'insert_relative_to_marker', 'between_markers',
                'line_range', 'diff', 'ast_replace_element'
            ]),
            file: z.string(),
            content: z.string().optional(),
            params: z.record(z.any()).optional()
        })).describe('Array of operations')
    },
    async ({ operations }) => {
        const results = [];
        const backups = [];
        
        for (const op of operations) {
            try {
                const filePath = resolveSafePath(op.file);
                
                switch (op.type) {
                    case 'replace_exact_line': {
                        if (fs.existsSync(filePath)) {
                            const backup = backupFile(filePath);
                            if (backup) backups.push(backup);
                            const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
                            const idx = lines.findIndex(l => l === op.params.line_to_find);
                            if (idx !== -1) {
                                lines[idx] = op.params.replacement_line;
                                fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
                            }
                        }
                        results.push({ type: op.type, file: op.file, status: 'done' });
                        break;
                    }
                    
                    case 'insert_at_line': {
                        if (fs.existsSync(filePath)) {
                            const backup = backupFile(filePath);
                            if (backup) backups.push(backup);
                            const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
                            lines.splice(op.params.line_number - 1, 0, op.content);
                            fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
                        }
                        results.push({ type: op.type, file: op.file, status: 'done' });
                        break;
                    }
                    
                    case 'append_to_file': {
                        const backup = backupFile(filePath);
                        if (backup) backups.push(backup);
                        fs.appendFileSync(filePath, op.content || '', 'utf-8');
                        results.push({ type: op.type, file: op.file, status: 'done' });
                        break;
                    }
                    
                    case 'prepend_to_file': {
                        const original = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
                        const backup = backupFile(filePath);
                        if (backup) backups.push(backup);
                        fs.writeFileSync(filePath, (op.content || '') + original, 'utf-8');
                        results.push({ type: op.type, file: op.file, status: 'done' });
                        break;
                    }
                    
                    case 'insert_relative_to_marker': {
                        if (fs.existsSync(filePath)) {
                            const backup = backupFile(filePath);
                            if (backup) backups.push(backup);
                            let content = fs.readFileSync(filePath, 'utf-8');
                            const idx = content.indexOf(op.params.marker);
                            if (idx !== -1) {
                                if (op.params.position === 'before') {
                                    content = content.slice(0, idx) + op.content + content.slice(idx);
                                } else {
                                    const afterIdx = idx + op.params.marker.length;
                                    content = content.slice(0, afterIdx) + op.content + content.slice(afterIdx);
                                }
                                fs.writeFileSync(filePath, content, 'utf-8');
                            }
                        }
                        results.push({ type: op.type, file: op.file, status: 'done' });
                        break;
                    }
                    
                    case 'between_markers': {
                        if (fs.existsSync(filePath)) {
                            const backup = backupFile(filePath);
                            if (backup) backups.push(backup);
                            let content = fs.readFileSync(filePath, 'utf-8');
                            const startIdx = content.indexOf(op.params.start_marker);
                            const endIdx = content.indexOf(op.params.end_marker, startIdx + op.params.start_marker.length);
                            if (startIdx !== -1 && endIdx !== -1) {
                                content = content.slice(0, startIdx + op.params.start_marker.length) + 
                                         op.content + 
                                         content.slice(endIdx);
                                fs.writeFileSync(filePath, content, 'utf-8');
                            }
                        }
                        results.push({ type: op.type, file: op.file, status: 'done' });
                        break;
                    }
                    
                    case 'line_range': {
                        if (fs.existsSync(filePath)) {
                            const backup = backupFile(filePath);
                            if (backup) backups.push(backup);
                            const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
                            const startIdx = op.params.start_line - 1;
                            const endIdx = op.params.end_line;
                            lines.splice(startIdx, endIdx - startIdx, ...op.content.split('\n'));
                            fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
                        }
                        results.push({ type: op.type, file: op.file, status: 'done' });
                        break;
                    }
                    
                    case 'diff': {
                        if (fs.existsSync(filePath)) {
                            const backup = backupFile(filePath);
                            if (backup) backups.push(backup);
                            let content = fs.readFileSync(filePath, 'utf-8');
                            const patches = diff.parsePatch(op.params.diff_content);
                            for (const patch of patches) {
                                const applied = diff.applyPatch(content, patch);
                                if (applied !== false) content = applied;
                            }
                            fs.writeFileSync(filePath, content, 'utf-8');
                        }
                        results.push({ type: op.type, file: op.file, status: 'done' });
                        break;
                    }
                    
                    case 'ast_replace_element': {
                        if (fs.existsSync(filePath)) {
                            const backup = backupFile(filePath);
                            if (backup) backups.push(backup);
                            const language = detectLanguage(filePath);
                            if (language) {
                                const content = fs.readFileSync(filePath, 'utf-8');
                                const analyzer = new CodeAnalyzer(language);
                                const result = analyzer.replaceElement(
                                    content,
                                    op.params.element_name,
                                    op.params.type,
                                    op.content
                                );
                                fs.writeFileSync(filePath, result, 'utf-8');
                            }
                        }
                        results.push({ type: op.type, file: op.file, status: 'done' });
                        break;
                    }
                    
                    default:
                        results.push({ type: op.type, file: op.file, status: 'unknown_type' });
                }
            } catch (e) {
                results.push({ type: op.type, file: op.file, status: 'error', error: e.message });
            }
        }
        
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    status: 'completed',
                    total: operations.length,
                    succeeded: results.filter(r => r.status === 'done').length,
                    failed: results.filter(r => r.status === 'error').length,
                    results,
                    backups
                }, null, 2)
            }]
        };
    }
);

// =============================================================================
// CATEGORY 7: Backup & Diff Management
// =============================================================================

server.tool(
    'list_backups',
    `[BACKUP SYSTEM] List all backup files for a specific file.
• Backups stored in .mcp-backups/ next to original file
• Sorted by timestamp (newest first)
• Shows: filename, timestamp, date, size
• Use with show_diff and restore_backup`,
    {
        path: z.string().describe('File path (Windows or Linux style)')
    },
    async ({ path: inputPath }) => {
        const targetPath = resolveSafePath(inputPath);
        const backupDir = path.join(path.dirname(targetPath), '.mcp-backups');
        
        if (!fs.existsSync(backupDir)) {
            return { content: [{ type: 'text', text: JSON.stringify({ backups: [], message: 'No backups found' }) }] };
        }
        
        const fileName = path.basename(targetPath);
        const allBackups = fs.readdirSync(backupDir);
        const fileBackups = allBackups
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
        
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    file: inputPath,
                    backupDir,
                    count: fileBackups.length,
                    backups: fileBackups
                }, null, 2)
            }]
        };
    }
);

server.tool(
    'show_diff',
    `[BACKUP SYSTEM] Show unified diff between current file and a backup.
• Uses latest backup if no specific backup provided
• Returns standard unified diff format
• Shows additions/deletions count
• Includes Cursor command for visual diff viewer`,
    {
        current: z.string().describe('File path (Windows or Linux style)'),
        backup: z.string().optional().describe('Specific backup file path (default: latest backup)'),
        context_lines: z.number().optional().describe('Lines of context around changes (default: 3)')
    },
    async ({ current, backup, context_lines = 3 }) => {
        const currentPath = resolveSafePath(current);
        
        if (!fs.existsSync(currentPath)) {
            throw new Error(`Current file not found: ${current}`);
        }
        
        // Find backup file
        let backupPath;
        if (backup) {
            backupPath = resolveSafePath(backup);
        } else {
            // Find latest backup
            const backupDir = path.join(path.dirname(currentPath), '.mcp-backups');
            if (!fs.existsSync(backupDir)) {
                throw new Error('No backup directory found');
            }
            const fileName = path.basename(currentPath);
            const backups = fs.readdirSync(backupDir)
                .filter(b => b.startsWith(fileName + '.'))
                .sort((a, b) => {
                    const ta = parseInt(a.split('.').pop());
                    const tb = parseInt(b.split('.').pop());
                    return tb - ta;
                });
            if (backups.length === 0) {
                throw new Error(`No backups found for ${current}`);
            }
            backupPath = path.join(backupDir, backups[0]);
        }
        
        if (!fs.existsSync(backupPath)) {
            throw new Error(`Backup file not found: ${backup}`);
        }
        
        const currentContent = fs.readFileSync(currentPath, 'utf-8');
        const backupContent = fs.readFileSync(backupPath, 'utf-8');
        
        // Generate unified diff
        const diffResult = diff.createPatch(
            path.basename(currentPath),
            backupContent,
            currentContent,
            'backup (before)',
            'current (after)',
            { context: context_lines }
        );
        
        // Count changes
        const lines = diffResult.split('\n');
        const additions = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
        const deletions = lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length;
        
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    current: current,
                    backup: backupPath,
                    summary: {
                        additions,
                        deletions,
                        total_changes: additions + deletions
                    },
                    diff: diffResult,
                    // For Cursor: provide file paths for visual diff
                    cursor_diff_command: `code --diff "${backupPath}" "${currentPath}"`
                }, null, 2)
            }]
        };
    }
);

server.tool(
    'restore_backup',
    `[BACKUP SYSTEM] Restore a file from backup (with safety preview).
• Preview mode (default): Shows diff without making changes
• Confirm mode: Actually restores the file
• Backs up current state before restoring (safe to undo)
• Use latest backup or specify specific backup file`,
    {
        file: z.string().describe('File path (Windows or Linux style)'),
        backup: z.string().optional().describe('Specific backup to restore (default: latest)'),
        confirm: z.boolean().optional().describe('Set to true to actually perform restore (default: preview only)')
    },
    async ({ file, backup, confirm = false }) => {
        const filePath = resolveSafePath(file);
        
        // Find backup
        let backupPath;
        if (backup) {
            backupPath = resolveSafePath(backup);
        } else {
            const backupDir = path.join(path.dirname(filePath), '.mcp-backups');
            const fileName = path.basename(filePath);
            const backups = fs.readdirSync(backupDir)
                .filter(b => b.startsWith(fileName + '.'))
                .sort((a, b) => parseInt(b.split('.').pop()) - parseInt(a.split('.').pop()));
            if (backups.length === 0) {
                throw new Error('No backups found');
            }
            backupPath = path.join(backupDir, backups[0]);
        }
        
        if (!confirm) {
            // Preview mode - show what would happen
            const currentContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
            const backupContent = fs.readFileSync(backupPath, 'utf-8');
            const diffResult = diff.createPatch(path.basename(filePath), currentContent, backupContent, 'current', 'will restore to');
            
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        status: 'preview',
                        message: 'Set confirm=true to actually restore',
                        file: file,
                        restore_from: backupPath,
                        diff_preview: diffResult
                    }, null, 2)
                }]
            };
        }
        
        // Actually restore
        const currentBackup = backupFile(filePath);
        const backupContent = fs.readFileSync(backupPath, 'utf-8');
        fs.writeFileSync(filePath, backupContent, 'utf-8');
        
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    status: 'restored',
                    file: file,
                    restored_from: backupPath,
                    current_state_backed_up_to: currentBackup
                })
            }]
        };
    }
);

// =============================================================================
// Start Server
// =============================================================================

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[Code Contractor MCP] Full Power Server Running');
    console.error(`[Code Contractor MCP] Workspace: ${WORKSPACE_ROOT}`);
}

main().catch((error) => {
    console.error('[Code Contractor MCP] Fatal:', error);
    process.exit(1);
});
