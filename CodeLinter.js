/**
 * CodeLinter.js - Comprehensive Code Analysis System
 * 
 * Analysis Layers:
 * 1. Syntax Validation (Tree-sitter) - Parse errors, syntax issues
 * 2. Pattern Detection - Common bug patterns via regex
 * 3. AST Analysis (Tree-sitter) - Static analysis
 * 4. External Linters (ESLint, flake8, pylint) - Language-specific checks
 * 
 * Supported: JavaScript, TypeScript, Python, Go, Java
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const CodeAnalyzer = require('./CodeAnalyzer');

// File extension to language mapping
const EXTENSION_TO_LANGUAGE = {
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.go': 'go',
    '.java': 'java'
};

// Common bug patterns by language
const BUG_PATTERNS = {
    javascript: [
        { pattern: /==\s*null(?!\s*=)/g, severity: 'warning', message: 'Use === instead of == for null comparison', rule: 'eqeqeq' },
        { pattern: /==\s*undefined(?!\s*=)/g, severity: 'warning', message: 'Use === instead of == for undefined comparison', rule: 'eqeqeq' },
        { pattern: /!=\s*null(?!\s*=)/g, severity: 'warning', message: 'Use !== instead of != for null comparison', rule: 'eqeqeq' },
        { pattern: /console\.(log|warn|error|debug|info)\s*\(/g, severity: 'info', message: 'Console statement found (remove in production)', rule: 'no-console' },
        { pattern: /debugger\s*;?/g, severity: 'warning', message: 'Debugger statement found', rule: 'no-debugger' },
        { pattern: /alert\s*\(/g, severity: 'warning', message: 'Alert statement found', rule: 'no-alert' },
        { pattern: /eval\s*\(/g, severity: 'error', message: 'eval() is dangerous - avoid using it', rule: 'no-eval' },
        { pattern: /new\s+Function\s*\(/g, severity: 'error', message: 'new Function() is similar to eval - avoid it', rule: 'no-new-func' },
        { pattern: /setTimeout\s*\(\s*["'`]/g, severity: 'warning', message: 'setTimeout with string is like eval', rule: 'no-implied-eval' },
        { pattern: /setInterval\s*\(\s*["'`]/g, severity: 'warning', message: 'setInterval with string is like eval', rule: 'no-implied-eval' },
        { pattern: /var\s+\w+\s*=/g, severity: 'info', message: 'Consider using let/const instead of var', rule: 'no-var' },
        { pattern: /\[\s*\]\s*==\s*\[\s*\]/g, severity: 'error', message: 'Array comparison with == always returns false', rule: 'no-self-compare' },
        { pattern: /\{\s*\}\s*==\s*\{\s*\}/g, severity: 'error', message: 'Object comparison with == always returns false', rule: 'no-self-compare' },
        { pattern: /=\s*=\s*=/g, severity: 'error', message: 'Triple assignment - probably a typo', rule: 'syntax-error' },
        { pattern: /\(\s*\)\s*=>/g, severity: 'info', message: 'Empty arrow function parameters', rule: 'style' },
        { pattern: /catch\s*\(\s*\w+\s*\)\s*\{\s*\}/g, severity: 'warning', message: 'Empty catch block - errors are silently ignored', rule: 'no-empty-catch' },
        { pattern: /throw\s+["'`][^"'`]*["'`]/g, severity: 'warning', message: 'Throw string instead of Error object', rule: 'no-throw-literal' },
        { pattern: /async\s+function\s+\w+\s*\([^)]*\)\s*\{[^}]*\}(?!\s*\.catch)/g, severity: 'info', message: 'Async function without error handling', rule: 'async-error-handling' },
        { pattern: /password\s*[:=]\s*["'`][^"'`]+["'`]/gi, severity: 'error', message: 'Hardcoded password detected!', rule: 'security' },
        { pattern: /api[_-]?key\s*[:=]\s*["'`][^"'`]+["'`]/gi, severity: 'error', message: 'Hardcoded API key detected!', rule: 'security' },
        { pattern: /secret\s*[:=]\s*["'`][^"'`]+["'`]/gi, severity: 'error', message: 'Hardcoded secret detected!', rule: 'security' },
    ],
    typescript: [], // Inherits from javascript + additions
    python: [
        { pattern: /print\s*\(/g, severity: 'info', message: 'Print statement found (use logging in production)', rule: 'no-print' },
        { pattern: /except\s*:/g, severity: 'warning', message: 'Bare except clause - catches all exceptions including KeyboardInterrupt', rule: 'bare-except' },
        { pattern: /except\s+Exception\s*:/g, severity: 'info', message: 'Catching broad Exception - be more specific', rule: 'broad-except' },
        { pattern: /import\s+\*/g, severity: 'warning', message: 'Wildcard import - pollutes namespace', rule: 'wildcard-import' },
        { pattern: /==\s*None/g, severity: 'warning', message: 'Use "is None" instead of "== None"', rule: 'none-comparison' },
        { pattern: /!=\s*None/g, severity: 'warning', message: 'Use "is not None" instead of "!= None"', rule: 'none-comparison' },
        { pattern: /==\s*True/g, severity: 'warning', message: 'Use "if x:" instead of "if x == True:"', rule: 'bool-comparison' },
        { pattern: /==\s*False/g, severity: 'warning', message: 'Use "if not x:" instead of "if x == False:"', rule: 'bool-comparison' },
        { pattern: /exec\s*\(/g, severity: 'error', message: 'exec() is dangerous - avoid using it', rule: 'no-exec' },
        { pattern: /eval\s*\(/g, severity: 'error', message: 'eval() is dangerous - avoid using it', rule: 'no-eval' },
        { pattern: /password\s*=\s*["'][^"']+["']/gi, severity: 'error', message: 'Hardcoded password detected!', rule: 'security' },
        { pattern: /api[_-]?key\s*=\s*["'][^"']+["']/gi, severity: 'error', message: 'Hardcoded API key detected!', rule: 'security' },
        { pattern: /global\s+\w+/g, severity: 'warning', message: 'Global variable modification', rule: 'global-variable' },
        { pattern: /\[\s*\]\s*\*\s*\d+/g, severity: 'warning', message: 'List multiplication creates references, not copies', rule: 'mutable-default' },
        { pattern: /def\s+\w+\s*\([^)]*=\s*\[\s*\]/g, severity: 'error', message: 'Mutable default argument (use None instead)', rule: 'mutable-default-arg' },
        { pattern: /def\s+\w+\s*\([^)]*=\s*\{\s*\}/g, severity: 'error', message: 'Mutable default argument (use None instead)', rule: 'mutable-default-arg' },
    ],
    go: [
        { pattern: /fmt\.Print/g, severity: 'info', message: 'fmt.Print found (use logging in production)', rule: 'no-print' },
        { pattern: /panic\s*\(/g, severity: 'warning', message: 'panic() found - handle errors gracefully', rule: 'no-panic' },
        { pattern: /\s+_\s*,\s*_\s*:?=/g, severity: 'warning', message: 'Multiple ignored return values', rule: 'ignored-returns' },
        { pattern: /if\s+err\s*!=\s*nil\s*\{\s*\}/g, severity: 'error', message: 'Empty error handling block', rule: 'empty-error-handling' },
        { pattern: /\berr\b[^!]*\n[^}]*(?!if\s+err)/g, severity: 'warning', message: 'Error not checked after assignment', rule: 'unchecked-error' },
    ],
    java: [
        { pattern: /System\.out\.print/g, severity: 'info', message: 'System.out found (use logging framework)', rule: 'no-sysout' },
        { pattern: /System\.err\.print/g, severity: 'info', message: 'System.err found (use logging framework)', rule: 'no-syserr' },
        { pattern: /e\.printStackTrace\s*\(\s*\)/g, severity: 'warning', message: 'printStackTrace() - use proper logging', rule: 'no-printstacktrace' },
        { pattern: /catch\s*\(\s*Exception\s+\w+\s*\)\s*\{\s*\}/g, severity: 'error', message: 'Empty catch block', rule: 'empty-catch' },
        { pattern: /catch\s*\(\s*Throwable\s+\w+\s*\)/g, severity: 'warning', message: 'Catching Throwable is too broad', rule: 'catch-throwable' },
        { pattern: /==\s*null/g, severity: 'info', message: 'Consider using Objects.isNull() or Optional', rule: 'null-check' },
        { pattern: /\.equals\s*\(\s*null\s*\)/g, severity: 'error', message: 'equals(null) always returns false', rule: 'equals-null' },
        { pattern: /new\s+String\s*\(\s*["']/g, severity: 'warning', message: 'Unnecessary String constructor', rule: 'unnecessary-constructor' },
        { pattern: /new\s+Integer\s*\(/g, severity: 'warning', message: 'Use Integer.valueOf() instead (deprecated constructor)', rule: 'deprecated-constructor' },
    ]
};

// TypeScript inherits from JavaScript with additions
BUG_PATTERNS.typescript = [
    ...BUG_PATTERNS.javascript,
    { pattern: /@ts-ignore/g, severity: 'warning', message: '@ts-ignore suppresses type checking', rule: 'ts-ignore' },
    { pattern: /@ts-nocheck/g, severity: 'warning', message: '@ts-nocheck disables all type checking', rule: 'ts-nocheck' },
    { pattern: /as\s+any/g, severity: 'warning', message: 'Type assertion to any - loses type safety', rule: 'no-any' },
    { pattern: /:\s*any\b/g, severity: 'info', message: 'Explicit any type - consider being more specific', rule: 'no-explicit-any' },
];

// External linter commands by language
const LINTER_COMMANDS = {
    javascript: {
        command: 'npx',
        args: ['eslint', '--format', 'json', '--no-eslintrc', '--env', 'es2022,node', '--parser-options', 'ecmaVersion:2022'],
        parseOutput: parseESLintOutput
    },
    typescript: {
        command: 'npx',
        args: ['eslint', '--format', 'json', '--no-eslintrc', '--env', 'es2022,node', '--parser-options', 'ecmaVersion:2022'],
        parseOutput: parseESLintOutput
    },
    python: {
        command: 'python3',
        args: ['-m', 'flake8', '--format', '%(path)s:%(row)d:%(col)d: %(code)s %(text)s'],
        parseOutput: parseFlake8Output
    },
    go: {
        command: 'go',
        args: ['vet'],
        parseOutput: parseGoVetOutput
    }
};

/**
 * CodeLinter - Main linting class
 */
class CodeLinter {
    constructor(options = {}) {
        this.timeout = options.timeout || 60000;
        this.maxFileSize = options.maxFileSize || 1024 * 1024; // 1MB
        this.enableLinters = options.enableLinters !== false;
        this.enablePatterns = options.enablePatterns !== false;
        this.enableSyntax = options.enableSyntax !== false;
        this.enableAST = options.enableAST !== false;
    }

    // ========================================================
    // Public API
    // ========================================================

    /**
     * Comprehensive linting of a single file
     * @param {string} filePath - Path to file
     * @param {string} content - File content (optional - will read from disk)
     * @returns {Promise<LintResult>}
     */
    async lintFile(filePath, content = null) {
        const ext = path.extname(filePath).toLowerCase();
        const language = EXTENSION_TO_LANGUAGE[ext];

        if (!language) {
            return {
                file: filePath,
                language: null,
                supported: false,
                errors: [],
                warnings: [],
                info: [],
                summary: { total: 0, errors: 0, warnings: 0, info: 0 }
            };
        }

        // Read content if not provided
        if (content === null) {
            try {
                content = fs.readFileSync(filePath, 'utf-8');
            } catch (e) {
                return {
                    file: filePath,
                    language,
                    supported: true,
                    errors: [{ line: 0, message: `Cannot read file: ${e.message}`, rule: 'file-read-error', severity: 'error' }],
                    warnings: [],
                    info: [],
                    summary: { total: 1, errors: 1, warnings: 0, info: 0 }
                };
            }
        }

        // Check file size
        if (content.length > this.maxFileSize) {
            return {
                file: filePath,
                language,
                supported: true,
                errors: [],
                warnings: [{ line: 0, message: `File too large (${Math.round(content.length/1024)}KB) - skipped detailed analysis`, rule: 'file-size', severity: 'warning' }],
                info: [],
                summary: { total: 1, errors: 0, warnings: 1, info: 0 }
            };
        }

        const allIssues = [];

        // Layer 1: Syntax validation with Tree-sitter
        if (this.enableSyntax) {
            const syntaxIssues = await this.checkSyntax(content, language, filePath);
            allIssues.push(...syntaxIssues);
        }

        // Layer 2: Bug pattern detection
        if (this.enablePatterns) {
            const patternIssues = this.checkPatterns(content, language, filePath);
            allIssues.push(...patternIssues);
        }

        // Layer 3: Advanced AST analysis
        if (this.enableAST) {
            const astIssues = await this.checkAST(content, language, filePath);
            allIssues.push(...astIssues);
        }

        // Layer 4: External linter (if available)
        if (this.enableLinters) {
            try {
                const linterIssues = await this.runLinter(filePath, content, language);
                allIssues.push(...linterIssues);
            } catch (e) {
                // Linter not available - don't fail
            }
        }

        // Format and return results
        return this._formatResults(filePath, language, allIssues);
    }

    /**
     * Lint an entire directory
     * @param {string} dirPath - Directory path
     * @param {Object} options - Options
     * @returns {Promise<ProjectLintResult>}
     */
    async lintDirectory(dirPath, options = {}) {
        const {
            extensions = ['.js', '.jsx', '.ts', '.tsx', '.py', '.go', '.java'],
            exclude = ['node_modules', '.git', 'dist', 'build', '__pycache__', 'venv', '.venv'],
            maxFiles = 100
        } = options;

        const files = this._findFiles(dirPath, extensions, exclude, maxFiles);
        const results = [];
        const summary = {
            totalFiles: files.length,
            filesWithIssues: 0,
            totalErrors: 0,
            totalWarnings: 0,
            totalInfo: 0,
            byLanguage: {},
            topIssues: []
        };

        for (const file of files) {
            const result = await this.lintFile(file);
            results.push(result);

            if (result.summary.total > 0) {
                summary.filesWithIssues++;
            }
            summary.totalErrors += result.summary.errors;
            summary.totalWarnings += result.summary.warnings;
            summary.totalInfo += result.summary.info;

            // Statistics by language
            if (result.language) {
                if (!summary.byLanguage[result.language]) {
                    summary.byLanguage[result.language] = { files: 0, errors: 0, warnings: 0 };
                }
                summary.byLanguage[result.language].files++;
                summary.byLanguage[result.language].errors += result.summary.errors;
                summary.byLanguage[result.language].warnings += result.summary.warnings;
            }
        }

        // Find most common issues
        const issueCount = {};
        for (const result of results) {
            for (const issue of [...result.errors, ...result.warnings]) {
                const key = issue.rule || issue.message;
                issueCount[key] = (issueCount[key] || 0) + 1;
            }
        }
        summary.topIssues = Object.entries(issueCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([rule, count]) => ({ rule, count }));

        return {
            directory: dirPath,
            results,
            summary
        };
    }

    /**
     * Lint code string (without file)
     */
    async lintCode(code, language) {
        const tempFile = `temp_lint_${Date.now()}.${this._getExtension(language)}`;
        return this.lintFile(tempFile, code);
    }

    // ========================================================
    // Layer 1: Syntax Validation (Tree-sitter)
    // ========================================================

    async checkSyntax(content, language, filePath) {
        const issues = [];

        try {
            const analyzer = new CodeAnalyzer(language);
            const tree = analyzer.parse(content);

            // Find ERROR nodes in tree
            const findErrors = (node, depth = 0) => {
                if (!node) return;
                
                // IMPORTANT: isMissing is a function in tree-sitter 0.20.x
                const isMissing = typeof node.isMissing === 'function' ? node.isMissing() : false;
                const isError = node.type === 'ERROR';
                
                if (isError || isMissing) {
                    const line = node.startPosition.row + 1;
                    const col = node.startPosition.column + 1;
                    
                    // Try to understand the error
                    let message = 'Syntax error';
                    if (isMissing) {
                        message = `Missing ${node.type}`;
                    } else {
                        // Get context
                        const lines = content.split('\n');
                        const errorLine = lines[node.startPosition.row] || '';
                        message = `Syntax error near: "${errorLine.trim().substring(0, 50)}"`;
                    }

                    issues.push({
                        line,
                        column: col,
                        message,
                        severity: 'error',
                        rule: 'syntax-error',
                        source: 'tree-sitter'
                    });
                }

                // Recurse on children
                for (let i = 0; i < node.childCount; i++) {
                    const child = node.child(i);
                    if (child) findErrors(child, depth + 1);
                }
            };

            findErrors(tree.rootNode);

        } catch (e) {
            // Tree-sitter completely failed - probably severe syntax error
            issues.push({
                line: 1,
                column: 1,
                message: `Critical syntax error: ${e.message}`,
                severity: 'error',
                rule: 'parse-error',
                source: 'tree-sitter'
            });
        }

        return issues;
    }

    // ========================================================
    // Layer 2: Bug Pattern Detection
    // ========================================================

    checkPatterns(content, language, filePath) {
        const issues = [];
        const patterns = BUG_PATTERNS[language] || [];
        const lines = content.split('\n');

        for (const { pattern, severity, message, rule } of patterns) {
            // Reset regex state
            pattern.lastIndex = 0;

            let match;
            while ((match = pattern.exec(content)) !== null) {
                // Calculate line number
                const beforeMatch = content.substring(0, match.index);
                const line = (beforeMatch.match(/\n/g) || []).length + 1;
                const lineStart = beforeMatch.lastIndexOf('\n') + 1;
                const column = match.index - lineStart + 1;

                // Check if inside a comment
                const currentLine = lines[line - 1] || '';
                if (this._isInComment(currentLine, column, language)) {
                    continue;
                }

                issues.push({
                    line,
                    column,
                    message,
                    severity,
                    rule,
                    source: 'pattern-detector',
                    match: match[0].substring(0, 50)
                });
            }
        }

        return issues;
    }

    // ========================================================
    // Layer 3: Advanced AST Analysis
    // ========================================================

    async checkAST(content, language, filePath) {
        const issues = [];

        try {
            const analyzer = new CodeAnalyzer(language);
            const tree = analyzer.parse(content);
            const lines = content.split('\n');

            // Language-specific checks
            if (language === 'javascript' || language === 'typescript') {
                issues.push(...this._checkJSAST(tree, lines, content));
            } else if (language === 'python') {
                issues.push(...this._checkPythonAST(tree, lines, content));
            }

        } catch (e) {
            // AST analysis failed - skip
        }

        return issues;
    }

    _checkJSAST(tree, lines, content) {
        const issues = [];
        
        // Helper - tree-sitter 0.20.x uses properties like bodyNode
        const getField = (node, fieldName) => {
            const propName = fieldName + 'Node';
            if (node[propName]) return node[propName];
            if (typeof node.childForFieldName === 'function') {
                return node.childForFieldName(fieldName);
            }
            return null;
        };

        const walk = (node) => {
            if (!node) return;
            
            // Check empty functions
            if (node.type === 'function_declaration' || node.type === 'arrow_function') {
                const body = getField(node, 'body');
                if (body && body.type === 'statement_block' && body.childCount <= 2) {
                    const bodyText = content.substring(body.startIndex, body.endIndex).trim();
                    if (bodyText === '{}' || bodyText === '{ }') {
                        issues.push({
                            line: node.startPosition.row + 1,
                            column: node.startPosition.column + 1,
                            message: 'Empty function body',
                            severity: 'warning',
                            rule: 'no-empty-function',
                            source: 'ast-analysis'
                        });
                    }
                }
            }

            // Check if without else with return
            if (node.type === 'if_statement') {
                const consequence = getField(node, 'consequence');
                const alternative = getField(node, 'alternative');
                
                if (consequence && !alternative) {
                    const consText = content.substring(consequence.startIndex, consequence.endIndex);
                    if (consText.includes('return') && !consText.includes('else')) {
                        // Return in if without else - could be problematic
                    }
                }
            }

            // Check unused variables (simple)
            if (node.type === 'variable_declarator') {
                const nameNode = getField(node, 'name');
                if (nameNode) {
                    const varName = nameNode.text;
                    // Check if variable appears again in code
                    const regex = new RegExp(`\\b${varName}\\b`, 'g');
                    const matches = content.match(regex);
                    if (matches && matches.length === 1) {
                        issues.push({
                            line: node.startPosition.row + 1,
                            column: node.startPosition.column + 1,
                            message: `Variable '${varName}' is declared but never used`,
                            severity: 'warning',
                            rule: 'no-unused-vars',
                            source: 'ast-analysis'
                        });
                    }
                }
            }

            // Recurse
            for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i);
                if (child) walk(child);
            }
        };

        walk(tree.rootNode);
        return issues;
    }

    _checkPythonAST(tree, lines, content) {
        const issues = [];
        
        // Helper function
        const getField = (node, fieldName) => {
            const propName = fieldName + 'Node';
            if (node[propName]) return node[propName];
            if (typeof node.childForFieldName === 'function') {
                return node.childForFieldName(fieldName);
            }
            return null;
        };

        const walk = (node) => {
            if (!node) return;
            
            // Check functions without docstring
            if (node.type === 'function_definition') {
                const body = getField(node, 'body');
                if (body && body.childCount > 0) {
                    const firstChild = body.child(0);
                    if (firstChild && firstChild.type !== 'expression_statement') {
                        issues.push({
                            line: node.startPosition.row + 1,
                            column: node.startPosition.column + 1,
                            message: 'Function missing docstring',
                            severity: 'info',
                            rule: 'missing-docstring',
                            source: 'ast-analysis'
                        });
                    }
                }
            }

            // Check code after return
            if (node.type === 'return_statement') {
                const parent = node.parent;
                if (parent) {
                    const siblings = [];
                    for (let i = 0; i < parent.childCount; i++) {
                        siblings.push(parent.child(i));
                    }
                    const returnIndex = siblings.indexOf(node);
                    if (returnIndex < siblings.length - 1) {
                        const nextNode = siblings[returnIndex + 1];
                        if (nextNode && nextNode.type !== '}' && nextNode.type !== 'comment') {
                            issues.push({
                                line: nextNode.startPosition.row + 1,
                                column: nextNode.startPosition.column + 1,
                                message: 'Unreachable code after return statement',
                                severity: 'warning',
                                rule: 'unreachable-code',
                                source: 'ast-analysis'
                            });
                        }
                    }
                }
            }

            // Recurse
            for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i);
                if (child) walk(child);
            }
        };

        walk(tree.rootNode);
        return issues;
    }

    // ========================================================
    // Layer 4: External Linters
    // ========================================================

    async runLinter(filePath, content, language) {
        const config = LINTER_COMMANDS[language];
        if (!config) {
            return [];
        }

        // Create temp file if needed
        let tempFile = null;
        let targetFile = filePath;

        if (!fs.existsSync(filePath)) {
            tempFile = path.join('/tmp', `lint_${Date.now()}${this._getExtension(language)}`);
            fs.writeFileSync(tempFile, content, 'utf-8');
            targetFile = tempFile;
        }

        try {
            const args = [...config.args, targetFile];
            const output = await this._execCommand(config.command, args);
            return config.parseOutput(output, filePath);
        } catch (e) {
            // Linter returned non-zero (has issues) or not installed
            if (e.stdout) {
                return config.parseOutput(e.stdout, filePath);
            }
            return [];
        } finally {
            // Cleanup
            if (tempFile && fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
            }
        }
    }

    // ========================================================
    // Helper Functions
    // ========================================================

    _formatResults(filePath, language, allIssues) {
        // Remove duplicates
        const seen = new Set();
        const unique = allIssues.filter(issue => {
            const key = `${issue.line}:${issue.column}:${issue.rule}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        // Sort by severity and line
        const severityOrder = { error: 0, warning: 1, info: 2 };
        unique.sort((a, b) => {
            const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
            if (sevDiff !== 0) return sevDiff;
            return a.line - b.line;
        });

        // Split by severity
        const errors = unique.filter(i => i.severity === 'error');
        const warnings = unique.filter(i => i.severity === 'warning');
        const info = unique.filter(i => i.severity === 'info');

        return {
            file: filePath,
            language,
            supported: true,
            errors,
            warnings,
            info,
            summary: {
                total: unique.length,
                errors: errors.length,
                warnings: warnings.length,
                info: info.length
            }
        };
    }

    _findFiles(dirPath, extensions, exclude, maxFiles) {
        const files = [];

        const walk = (dir) => {
            if (files.length >= maxFiles) return;

            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                
                for (const entry of entries) {
                    if (files.length >= maxFiles) break;

                    const fullPath = path.join(dir, entry.name);
                    
                    if (entry.isDirectory()) {
                        if (!exclude.includes(entry.name)) {
                            walk(fullPath);
                        }
                    } else if (entry.isFile()) {
                        const ext = path.extname(entry.name).toLowerCase();
                        if (extensions.includes(ext)) {
                            files.push(fullPath);
                        }
                    }
                }
            } catch (e) {
                // Permission denied or other error
            }
        };

        walk(dirPath);
        return files;
    }

    _isInComment(line, column, language) {
        const beforeColumn = line.substring(0, column);
        
        if (['javascript', 'typescript', 'java', 'go'].includes(language)) {
            return beforeColumn.includes('//') || beforeColumn.includes('/*');
        }
        if (language === 'python') {
            return beforeColumn.includes('#');
        }
        return false;
    }

    _getExtension(language) {
        const map = {
            javascript: '.js',
            typescript: '.ts',
            python: '.py',
            go: '.go',
            java: '.java'
        };
        return map[language] || '.txt';
    }

    _execCommand(command, args) {
        return new Promise((resolve, reject) => {
            const child = spawn(command, args, { 
                shell: false,
                timeout: this.timeout
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', d => stdout += d.toString());
            child.stderr.on('data', d => stderr += d.toString());

            child.on('error', reject);
            child.on('close', code => {
                if (code === 0) {
                    resolve(stdout);
                } else {
                    const err = new Error(`Command failed with code ${code}`);
                    err.stdout = stdout;
                    err.stderr = stderr;
                    reject(err);
                }
            });
        });
    }

    // ========================================================
    // Static Convenience Methods
    // ========================================================

    static async lint(fileOrCode, options = {}) {
        const linter = new CodeLinter(options);
        
        if (fs.existsSync(fileOrCode)) {
            return linter.lintFile(fileOrCode);
        }
        
        // It's code, not a file
        const language = options.language || 'javascript';
        return linter.lintCode(fileOrCode, language);
    }

    static async lintProject(dirPath, options = {}) {
        const linter = new CodeLinter(options);
        return linter.lintDirectory(dirPath, options);
    }
}

// ========================================================
// Linter Output Parsers
// ========================================================

function parseESLintOutput(output, originalFile) {
    const issues = [];
    try {
        const results = JSON.parse(output);
        for (const file of results) {
            for (const msg of file.messages || []) {
                issues.push({
                    line: msg.line || 1,
                    column: msg.column || 1,
                    message: msg.message,
                    severity: msg.severity === 2 ? 'error' : 'warning',
                    rule: msg.ruleId || 'eslint',
                    source: 'eslint'
                });
            }
        }
    } catch (e) {
        // JSON parse failed
    }
    return issues;
}

function parseFlake8Output(output, originalFile) {
    const issues = [];
    const lines = output.trim().split('\n');
    
    for (const line of lines) {
        const match = line.match(/^(.+):(\d+):(\d+):\s*(\w+)\s+(.+)$/);
        if (match) {
            const [, , lineNum, col, code, message] = match;
            issues.push({
                line: parseInt(lineNum, 10),
                column: parseInt(col, 10),
                message,
                severity: code.startsWith('E') ? 'error' : 'warning',
                rule: code,
                source: 'flake8'
            });
        }
    }
    return issues;
}

function parseGoVetOutput(output, originalFile) {
    const issues = [];
    const lines = output.trim().split('\n');
    
    for (const line of lines) {
        const match = line.match(/^(.+):(\d+):(\d+):\s*(.+)$/);
        if (match) {
            const [, , lineNum, col, message] = match;
            issues.push({
                line: parseInt(lineNum, 10),
                column: parseInt(col, 10),
                message,
                severity: 'warning',
                rule: 'go-vet',
                source: 'go-vet'
            });
        }
    }
    return issues;
}

module.exports = CodeLinter;
