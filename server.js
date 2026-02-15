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
const USE_BRIDGE = process.env.USE_BRIDGE !== 'false';

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
    
    // Auto-translate Windows paths to internal paths
    // Example: "C:\Users\user\project" -> "/workspace/Users/user/project"
    // Example: "c:/Users/user/project" -> "/workspace/Users/user/project"
    const windowsPathMatch = normalizedPath.match(/^([a-zA-Z]):[\\\/](.*)$/);
    if (windowsPathMatch) {
        // Extract path after drive letter, convert backslashes to forward slashes
        const pathAfterDrive = windowsPathMatch[2].replace(/\\/g, '/');
        normalizedPath = pathAfterDrive;
    }
    
    // Also handle paths that already start with /workspace
    if (normalizedPath.startsWith('/workspace/')) {
        normalizedPath = normalizedPath.substring('/workspace/'.length);
    } else if (normalizedPath.startsWith('/workspace')) {
        normalizedPath = normalizedPath.substring('/workspace'.length) || '.';
    }
    
    // Convert any remaining backslashes to forward slashes
    normalizedPath = normalizedPath.replace(/\\/g, '/');
    
    // Remove leading slash if present (we'll add it via WORKSPACE_ROOT)
    if (normalizedPath.startsWith('/')) {
        normalizedPath = normalizedPath.substring(1);
    }
    
    const resolved = path.resolve(WORKSPACE_ROOT, normalizedPath);
    if (!resolved.startsWith(WORKSPACE_ROOT)) {
        throw new Error(`Security: Path '${inputPath}' is outside workspace`);
    }
    return resolved;
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
// CATEGORY 1: Navigation & Reading
// =============================================================================

server.tool(
    'get_file_tree',
    `[ISOLATED DOCKER ENV] Get file tree structure for code exploration.
• Accepts Windows paths (C:\\Users\\...) OR Linux paths - auto-converts!
• Filters out node_modules, .git, dist, build automatically
• Use for understanding project structure before editing
• Examples: "C:\\Users\\user\\project" or "Users/user/project" both work`,
    {
        path: z.string().optional().describe('Path (Windows like C:\\path or Linux like path/to/dir). Default: workspace root'),
        max_depth: z.number().optional().describe('Directory depth limit (default: 3)')
    },
    async ({ path: inputPath = '.', max_depth = 3 }) => {
        try {
            const tree = await bridge.listDir(inputPath, max_depth);
            return { content: [{ type: 'text', text: JSON.stringify(tree, null, 2) }] };
        } catch (e) {
            // Fallback to local if bridge fails
            const targetPath = resolveSafePath(inputPath);
            const tree = getProjectStructure(targetPath, 0, max_depth);
            return { content: [{ type: 'text', text: JSON.stringify(tree, null, 2) }] };
        }
    }
);

server.tool(
    'read_file',
    `[ISOLATED DOCKER ENV] Read file content with optional line range.
• Accepts Windows paths (C:\\path) OR Linux paths - auto-converts!
• Blocks files >3000 lines without range (use line_start/line_end)
• Examples: "C:\\Users\\user\\file.js" or "Users/user/file.js" both work
• Returns JSON with file metadata + content`,
    {
        path: z.string().describe('File path (Windows C:\\path\\file.js or Linux path/file.js)'),
        line_start: z.number().optional().describe('Start line number (1-based, inclusive)'),
        line_end: z.number().optional().describe('End line number (1-based, inclusive)'),
        force_full: z.boolean().optional().describe('Force full read even for large files')
    },
    async ({ path: inputPath, line_start, line_end, force_full = false }) => {
        if (isSensitivePath(inputPath)) {
            throw new Error(`Security: Access to sensitive file '${inputPath}' is prohibited`);
        }
        
        try {
            // Try bridge first
            let content = await bridge.readFile(inputPath);
            const totalLines = content.split('\n').length;
            
            // Block large files unless range specified or force
            if (!force_full && totalLines > MAX_LINES && !line_start && !line_end) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            status: 'TRUNCATED',
                            file: inputPath,
                            total_lines: totalLines,
                            limit: MAX_LINES,
                            message: `File too large (${totalLines} lines). Use line_start/line_end or extract_code_element.`
                        })
                    }]
                };
            }
            
            if (line_start !== undefined || line_end !== undefined) {
                const lines = content.split('\n');
                const start = Math.max(0, (line_start || 1) - 1);
                const end = Math.min(lines.length, line_end || lines.length);
                content = lines.slice(start, end).join('\n');
            }
            
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ file: inputPath, total_lines: totalLines, content })
                }]
            };
        } catch (e) {
            // Fallback to local
            const filePath = resolveSafePath(inputPath);
            if (!fs.existsSync(filePath)) {
                throw new Error(`File not found: ${inputPath}`);
            }
            let content = fs.readFileSync(filePath, 'utf-8');
            const totalLines = content.split('\n').length;
            
            if (!force_full && totalLines > MAX_LINES && !line_start && !line_end) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            status: 'TRUNCATED',
                            file: inputPath,
                            total_lines: totalLines,
                            limit: MAX_LINES,
                            message: `File too large (${totalLines} lines). Use line_start/line_end or extract_code_element.`
                        })
                    }]
                };
            }
            
            if (line_start !== undefined || line_end !== undefined) {
                const lines = content.split('\n');
                const start = Math.max(0, (line_start || 1) - 1);
                const end = Math.min(lines.length, line_end || lines.length);
                content = lines.slice(start, end).join('\n');
            }
            
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ file: inputPath, total_lines: totalLines, content })
                }]
            };
        }
    }
);

server.tool(
    'get_file_outline',
    `[AST-POWERED] Get function/class definitions in file (X-ray view).
• Uses Tree-sitter AST for accurate parsing (JS/TS/Python/Go/Java)
• Returns: name, type, line number, signature
• Perfect for understanding file structure before targeted edits
• Fallback to regex for unsupported languages`,
    {
        path: z.string().describe('File path (Windows or Linux style)')
    },
    async ({ path: inputPath }) => {
        const filePath = resolveSafePath(inputPath);
        
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${inputPath}`);
        }
        
        const content = fs.readFileSync(filePath, 'utf-8');
        const language = detectLanguage(filePath);
        
        if (!language) {
            // Regex fallback
            const lines = content.split('\n');
            const outline = [];
            const patterns = [
                /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
                /^(?:export\s+)?class\s+(\w+)/,
                /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(/,
                /^def\s+(\w+)/,
                /^class\s+(\w+)/,
                /^func\s+(\w+)/
            ];
            
            lines.forEach((line, idx) => {
                const trimmed = line.trim();
                for (const pattern of patterns) {
                    const match = trimmed.match(pattern);
                    if (match) {
                        outline.push({ line: idx + 1, name: match[1], signature: trimmed.split('{')[0].trim() });
                        break;
                    }
                }
            });
            
            return { content: [{ type: 'text', text: JSON.stringify({ file: inputPath, outline }) }] };
        }
        
        try {
            const analyzer = new CodeAnalyzer(language);
            const tree = analyzer.parse(content);
            const lines = content.split('\n');
            const outline = [];
            
            const definitionTypes = [
                'function_declaration', 'function_definition',
                'class_declaration', 'class_definition',
                'method_definition'
            ];
            
            const collectDefs = (node) => {
                if (!node) return;
                
                if (definitionTypes.includes(node.type)) {
                    // tree-sitter 0.20.x uses properties like nameNode, idNode instead of childForFieldName
                    const nameNode = node.nameNode || 
                                     node.idNode ||
                                     (node.namedChildCount > 0 && 
                                      node.namedChild(0)?.type === 'identifier' ? node.namedChild(0) : null) ||
                                     (node.namedChildCount > 0 && 
                                      node.namedChild(0)?.type === 'property_identifier' ? node.namedChild(0) : null);
                    
                    const name = nameNode ? nameNode.text : '(anonymous)';
                    outline.push({
                        type: node.type.replace('_declaration', '').replace('_definition', ''),
                        name,
                        line: node.startPosition.row + 1,
                        signature: lines[node.startPosition.row]?.trim().split('{')[0].trim()
                    });
                }
                for (let i = 0; i < node.childCount; i++) {
                    const child = node.child(i);
                    if (child) collectDefs(child);
                }
            };
            
            collectDefs(tree.rootNode);
            return { content: [{ type: 'text', text: JSON.stringify({ file: inputPath, language, outline }) }] };
            
        } catch (e) {
            return { content: [{ type: 'text', text: JSON.stringify({ file: inputPath, error: e.message }) }] };
        }
    }
);

server.tool(
    'extract_code_element',
    `[AST-POWERED] Extract specific function/class/variable with surrounding context.
• Uses Tree-sitter AST to find exact element boundaries
• Includes configurable context lines before/after
• Supports: function, class, variable declarations
• Better than line-based search - understands code structure
• Languages: JavaScript, TypeScript, Python, Go, Java`,
    {
        path: z.string().describe('File path (Windows or Linux style)'),
        element_name: z.string().describe('Name of function/class/variable to extract'),
        type: z.enum(['function', 'class', 'variable']).describe('Type of code element'),
        context_lines: z.number().optional().describe('Lines of context around element (default: 5)')
    },
    async ({ path: inputPath, element_name, type, context_lines = 5 }) => {
        const filePath = resolveSafePath(inputPath);
        const language = detectLanguage(filePath);
        
        if (!language) {
            throw new Error(`Unsupported file type for AST: ${inputPath}`);
        }
        
        const content = fs.readFileSync(filePath, 'utf-8');
        
        try {
            const analyzer = new CodeAnalyzer(language);
            const results = analyzer.extractElement(content, element_name, type, context_lines);
            
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ file: inputPath, element: element_name, results })
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
    `[RIPGREP + AST] High-performance code search with semantic understanding.
• FAST mode: Pure ripgrep - blazing fast text search
• SMART mode: ripgrep + AST classification (definition vs usage)
• DEFINITIONS mode: Find only declarations/definitions
• USAGES mode: Find only references/usages
• Automatically filters binary files, node_modules, .git`,
    {
        term: z.string().describe('Search term or pattern'),
        path: z.string().optional().describe('Search scope (default: entire workspace)'),
        mode: z.enum(['fast', 'smart', 'definitions', 'usages']).optional().describe('Search strategy (default: fast)'),
        regex: z.boolean().optional().describe('Interpret term as regex pattern'),
        case_sensitive: z.boolean().optional().describe('Case-sensitive matching'),
        max_results: z.number().optional().describe('Maximum results to return (default: 50)')
    },
    async ({ term, path: searchPath = '.', mode = 'fast', regex = false, case_sensitive = false, max_results = 50 }) => {
        const targetPath = resolveSafePath(searchPath);
        const engine = new SearchEngine({ maxResults: max_results });
        
        let results;
        
        switch (mode) {
            case 'smart':
                results = await engine.smartSearch(targetPath, term, {
                    regex,
                    caseSensitive: case_sensitive,
                    maxResults: max_results,
                    classifyResults: true
                });
                break;
            case 'definitions':
                results = await engine.findDefinitions(targetPath, term, { maxResults: max_results });
                break;
            case 'usages':
                results = await engine.findUsages(targetPath, term, { maxResults: max_results });
                break;
            default:
                results = await engine.fastSearch(targetPath, term, {
                    regex,
                    caseSensitive: case_sensitive,
                    maxResults: max_results
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
                text: JSON.stringify({ term, mode, count: results.length, results }, null, 2)
            }]
        };
    }
);

server.tool(
    'find_references',
    `[AST-POWERED] Find all usages of a symbol across the project.
• Semantic search: understands code structure
• Distinguishes definitions from usages
• Groups results by type (definition, import, call, reference)
• Great for refactoring impact analysis`,
    {
        element_name: z.string().describe('Symbol name (function, class, variable) to find'),
        path: z.string().optional().describe('Limit search to specific directory')
    },
    async ({ element_name, path: searchPath = '.' }) => {
        const targetPath = resolveSafePath(searchPath);
        const engine = new SearchEngine({ maxResults: 100 });
        
        // Use smart search to find and classify
        const results = await engine.smartSearch(targetPath, element_name, {
            classifyResults: true,
            wholeWord: true,
            groupByType: true
        });
        
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({ element: element_name, results }, null, 2)
            }]
        };
    }
);

// =============================================================================
// CATEGORY 3: Linting
// =============================================================================

server.tool(
    'lint_file',
    `[MULTI-LAYER ANALYSIS] Check file for syntax errors, bugs, and code issues.
• Layer 1: AST syntax validation (Tree-sitter)
• Layer 2: Language-specific linters (ESLint, flake8, pylint)
• Layer 3: Common bug pattern detection
• Returns: errors, warnings, info with line numbers
• Complementary to Cursor's ReadLints - more comprehensive`,
    {
        path: z.string().describe('File path (Windows or Linux style)')
    },
    async ({ path: inputPath }) => {
        const filePath = resolveSafePath(inputPath);
        
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${inputPath}`);
        }
        
        const linter = new CodeLinter();
        const results = await linter.lintFile(filePath);
        
        return {
            content: [{
                type: 'text',
                text: JSON.stringify(results, null, 2)
            }]
        };
    }
);

server.tool(
    'lint_code',
    `[MULTI-LAYER ANALYSIS] Check raw code string for issues without needing a file.
• Perfect for validating code before writing to file
• Same multi-layer analysis as lint_file
• Supports: javascript, typescript, python, go, java
• Use to verify generated code is valid`,
    {
        code: z.string().describe('Code content to analyze'),
        language: z.string().describe('Language: javascript, typescript, python, go, java')
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
// CATEGORY 4: File Operations - EXECUTE IMMEDIATELY
// =============================================================================

server.tool(
    'create_file',
    `[IMMEDIATE EXECUTION] Create a new file or overwrite existing.
• Automatic backup before overwrite (.mcp-backups/)
• Creates parent directories if needed
• EXECUTES IMMEDIATELY - no confirmation dialog
• Faster than Cursor's Write for bulk operations
• Use for generating new files or complete rewrites`,
    {
        path: z.string().describe('File path (Windows or Linux style)'),
        content: z.string().describe('Full file content')
    },
    async ({ path: inputPath, content }) => {
        try {
            const result = await bridge.writeFile(inputPath, content);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        status: 'success',
                        action: result.action || 'created',
                        file: inputPath,
                        lines: content.split('\n').length,
                        backup: result.backup
                    })
                }]
            };
        } catch (e) {
            // Fallback to local
            const filePath = resolveSafePath(inputPath);
            const existed = fs.existsSync(filePath);
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const backupPath = backupFile(filePath);
            fs.writeFileSync(filePath, content, 'utf-8');
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        status: 'success',
                        action: existed ? 'overwritten' : 'created',
                        file: inputPath,
                        lines: content.split('\n').length,
                        backup: backupPath
                    })
                }]
            };
        }
    }
);

server.tool(
    'delete_file',
    `[IMMEDIATE EXECUTION] Delete a file with automatic backup.
• Creates backup before deletion (.mcp-backups/)
• Recoverable via restore_backup tool
• EXECUTES IMMEDIATELY - no confirmation dialog`,
    {
        path: z.string().describe('File path (Windows or Linux style)')
    },
    async ({ path: inputPath }) => {
        try {
            const result = await bridge.deleteFile(inputPath);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(result)
                }]
            };
        } catch (e) {
            // Fallback to local
            const filePath = resolveSafePath(inputPath);
            if (!fs.existsSync(filePath)) {
                throw new Error(`File not found: ${inputPath}`);
            }
            const backupPath = backupFile(filePath);
            fs.unlinkSync(filePath);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ status: 'success', action: 'deleted', file: inputPath, backup: backupPath })
                }]
        };
    }
);

// =============================================================================
// CATEGORY 5: Smart Patching - EXECUTE IMMEDIATELY
// =============================================================================

server.tool(
    'simple_replace',
    `[IMMEDIATE EXECUTION] Find and replace text in file - lighter than Cursor's StrReplace.
• Automatic backup before change
• Option to replace all occurrences or just first
• Reports number of replacements made
• Better for simple text substitutions without line tracking
• Use Cursor's StrReplace for complex multi-line changes`,
    {
        path: z.string().describe('File path (Windows or Linux style)'),
        find: z.string().describe('Exact text to find'),
        replace_with: z.string().describe('Replacement text'),
        all: z.boolean().optional().describe('Replace all occurrences (default: true)')
    },
    async ({ path: inputPath, find, replace_with, all = true }) => {
        const filePath = resolveSafePath(inputPath);
        
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${inputPath}`);
        }
        
        const original = fs.readFileSync(filePath, 'utf-8');
        const backupPath = backupFile(filePath);
        
        let content, count;
        if (all) {
            const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(escaped, 'g');
            count = (original.match(regex) || []).length;
            content = original.split(find).join(replace_with);
        } else {
            count = original.includes(find) ? 1 : 0;
            content = original.replace(find, replace_with);
        }
        
        if (count === 0) {
            return { content: [{ type: 'text', text: JSON.stringify({ status: 'no_change', reason: 'Text not found' }) }] };
        }
        
        fs.writeFileSync(filePath, content, 'utf-8');
        
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({ status: 'success', action: 'replaced', file: inputPath, occurrences: count, backup: backupPath })
            }]
        };
    }
);

server.tool(
    'replace_exact_line',
    `[IMMEDIATE EXECUTION] Replace a line that matches exactly (including whitespace).
• Strict matching - must match entire line exactly
• Good for single-line configuration changes
• Automatic backup before change
• Throws error if line not found (safe)`,
    {
        path: z.string().describe('File path (Windows or Linux style)'),
        line_to_find: z.string().describe('Complete line to find (exact match required)'),
        replacement_line: z.string().describe('Complete replacement line')
    },
    async ({ path: inputPath, line_to_find, replacement_line }) => {
        const filePath = resolveSafePath(inputPath);
        
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${inputPath}`);
        }
        
        const original = fs.readFileSync(filePath, 'utf-8');
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
        fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
        
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
    `[IMMEDIATE EXECUTION] Insert content at specific line number.
• Line numbers are 1-based (first line = 1)
• Content inserted BEFORE the specified line
• Automatic backup before change
• Use for adding imports, new functions at specific locations`,
    {
        path: z.string().describe('File path (Windows or Linux style)'),
        line_number: z.number().describe('Line number where content will be inserted (1-based)'),
        content: z.string().describe('Content to insert (can be multi-line)')
    },
    async ({ path: inputPath, line_number, content: newContent }) => {
        const filePath = resolveSafePath(inputPath);
        
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${inputPath}`);
        }
        
        const original = fs.readFileSync(filePath, 'utf-8');
        const backupPath = backupFile(filePath);
        const lines = original.split('\n');
        
        const insertIndex = Math.max(0, Math.min(lines.length, line_number - 1));
        lines.splice(insertIndex, 0, newContent);
        
        fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
        
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
    `[IMMEDIATE EXECUTION] Replace a range of lines with new content.
• Line numbers are 1-based and inclusive
• Removes lines from start to end, inserts new content
• Perfect for replacing entire functions/blocks by line range
• Combine with get_file_outline to find line ranges`,
    {
        path: z.string().describe('File path (Windows or Linux style)'),
        start_line: z.number().describe('First line to replace (1-based, inclusive)'),
        end_line: z.number().describe('Last line to replace (1-based, inclusive)'),
        content: z.string().describe('New content to insert (can be multi-line)')
    },
    async ({ path: inputPath, start_line, end_line, content: newContent }) => {
        const filePath = resolveSafePath(inputPath);
        
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${inputPath}`);
        }
        
        const original = fs.readFileSync(filePath, 'utf-8');
        const backupPath = backupFile(filePath);
        const lines = original.split('\n');
        
        const startIdx = Math.max(0, start_line - 1);
        const endIdx = Math.min(lines.length, end_line);
        const removed = endIdx - startIdx;
        
        const newLines = newContent.split('\n');
        lines.splice(startIdx, removed, ...newLines);
        
        fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
        
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
    `[IMMEDIATE EXECUTION] Insert content before or after a marker text.
• Finds first occurrence of marker string
• Inserts content immediately before/after marker
• Good for adding code near specific patterns
• Example: Insert after "// IMPORTS" comment`,
    {
        path: z.string().describe('File path (Windows or Linux style)'),
        marker: z.string().describe('Text pattern to find as anchor point'),
        position: z.enum(['before', 'after']).describe('Insert before or after the marker'),
        content: z.string().describe('Content to insert (can be multi-line)')
    },
    async ({ path: inputPath, marker, position, content: newContent }) => {
        const filePath = resolveSafePath(inputPath);
        
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${inputPath}`);
        }
        
        const original = fs.readFileSync(filePath, 'utf-8');
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
        
        fs.writeFileSync(filePath, result, 'utf-8');
        
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
    `[IMMEDIATE EXECUTION] Replace content between two marker texts.
• Finds first occurrence of start_marker, then end_marker
• Replaces everything between them (exclusive by default)
• include_markers=true also replaces the markers themselves
• Great for template sections with delimiters`,
    {
        path: z.string().describe('File path (Windows or Linux style)'),
        start_marker: z.string().describe('Opening delimiter text'),
        end_marker: z.string().describe('Closing delimiter text'),
        content: z.string().describe('New content to insert between markers'),
        include_markers: z.boolean().optional().describe('Also replace the marker texts (default: false)')
    },
    async ({ path: inputPath, start_marker, end_marker, content: newContent, include_markers = false }) => {
        const filePath = resolveSafePath(inputPath);
        
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${inputPath}`);
        }
        
        const original = fs.readFileSync(filePath, 'utf-8');
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
        fs.writeFileSync(filePath, result, 'utf-8');
        
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
    `[IMMEDIATE EXECUTION] Append content to end of file.
• Adds content at the very end of file
• Creates file if doesn't exist
• Automatic backup for existing files
• Use for adding new functions, exports at file end`,
    {
        path: z.string().describe('File path (Windows or Linux style)'),
        content: z.string().describe('Content to add at end of file')
    },
    async ({ path: inputPath, content: newContent }) => {
        const filePath = resolveSafePath(inputPath);
        const backupPath = backupFile(filePath);
        
        fs.appendFileSync(filePath, newContent, 'utf-8');
        
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
    `[IMMEDIATE EXECUTION] Prepend content to start of file.
• Adds content at the very beginning of file
• Creates file if doesn't exist
• Automatic backup for existing files
• Use for adding imports, file headers, licenses`,
    {
        path: z.string().describe('File path (Windows or Linux style)'),
        content: z.string().describe('Content to add at start of file')
    },
    async ({ path: inputPath, content: newContent }) => {
        const filePath = resolveSafePath(inputPath);
        
        const original = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
        const backupPath = backupFile(filePath);
        
        fs.writeFileSync(filePath, newContent + original, 'utf-8');
        
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
    `[IMMEDIATE EXECUTION] Apply unified diff patch to file.
• Accepts standard unified diff format
• Validates patch can be applied cleanly
• Automatic backup before applying
• Fails safely if content has changed`,
    {
        path: z.string().describe('File path (Windows or Linux style)'),
        diff_content: z.string().describe('Unified diff content (with --- +++ @@ headers)')
    },
    async ({ path: inputPath, diff_content }) => {
        const filePath = resolveSafePath(inputPath);
        
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${inputPath}`);
        }
        
        const original = fs.readFileSync(filePath, 'utf-8');
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
        
        fs.writeFileSync(filePath, result, 'utf-8');
        
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
    `[AST-POWERED IMMEDIATE] Replace function/class by name - no need to know exact current content.
• Finds element using Tree-sitter AST (not text matching)
• Replaces entire function/class with new implementation
• Perfect for refactoring when you don't know current code exactly
• Languages: JavaScript, TypeScript, Python, Go, Java
• Much safer than text-based replacement`,
    {
        path: z.string().describe('File path (Windows or Linux style)'),
        element_name: z.string().describe('Name of function or class to replace'),
        element_type: z.enum(['function', 'class']).describe('Type of element'),
        new_content: z.string().describe('Complete new implementation')
    },
    async ({ path: inputPath, element_name, element_type, new_content }) => {
        const filePath = resolveSafePath(inputPath);
        const language = detectLanguage(filePath);
        
        if (!language) {
            throw new Error(`Unsupported file type for AST: ${inputPath}`);
        }
        
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${inputPath}`);
        }
        
        const original = fs.readFileSync(filePath, 'utf-8');
        const backupPath = backupFile(filePath);
        
        const analyzer = new CodeAnalyzer(language);
        const result = analyzer.replaceElement(original, element_name, element_type, new_content);
        
        fs.writeFileSync(filePath, result, 'utf-8');
        
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

// =============================================================================
// CATEGORY 7: Terminal - ISOLATED SANDBOX ENVIRONMENT
// =============================================================================

server.tool(
    'run_terminal',
    `[⚠️ ISOLATED DOCKER SANDBOX] Execute command in isolated Linux container.

🔒 ISOLATION: Runs inside Docker container - NOT connected to user's machine!
• Cannot access Windows filesystem outside /workspace mount
• Cannot install software on user's machine
• Cannot run Windows commands (cmd, powershell)
• All changes are contained within Docker container

✅ GOOD FOR:
• Running linters, formatters, build tools on project files
• Git operations within /workspace
• npm/pip install within the project
• Testing scripts in controlled environment
• File operations within /workspace

❌ NOT FOR:
• Installing system-wide software (use Cursor's Shell instead)
• Running Windows commands
• Accessing user's full system
• Long-running servers (container may restart)

💡 FOR REAL TERMINAL: Use Cursor's built-in Shell tool instead!`,
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
• Supports: create, delete, replace, insert, append, prepend, diff, AST replace
• Great for multi-file refactoring in one call
• Faster than individual tool calls
• Returns detailed status for each operation`,
    {
        operations: z.array(z.object({
            type: z.enum([
                'create_file', 'delete_file',
                'simple_replace', 'replace_exact_line',
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
                    case 'create_file': {
                        const dir = path.dirname(filePath);
                        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                        const backup = backupFile(filePath);
                        if (backup) backups.push(backup);
                        fs.writeFileSync(filePath, op.content || '', 'utf-8');
                        results.push({ type: op.type, file: op.file, status: 'done' });
                        break;
                    }
                    
                    case 'delete_file': {
                        if (fs.existsSync(filePath)) {
                            const backup = backupFile(filePath);
                            if (backup) backups.push(backup);
                            fs.unlinkSync(filePath);
                        }
                        results.push({ type: op.type, file: op.file, status: 'done' });
                        break;
                    }
                    
                    case 'simple_replace': {
                        if (fs.existsSync(filePath)) {
                            const backup = backupFile(filePath);
                            if (backup) backups.push(backup);
                            let content = fs.readFileSync(filePath, 'utf-8');
                            content = content.split(op.params.find).join(op.params.replace_with);
                            fs.writeFileSync(filePath, content, 'utf-8');
                        }
                        results.push({ type: op.type, file: op.file, status: 'done' });
                        break;
                    }
                    
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
