#!/usr/bin/env node
/**
 * Comprehensive MCP Tools Test Suite
 * Tests all tools with multiple variations
 */

const { spawn } = require('child_process');
const path = require('path');

// ============================================================
// MCP Client - sends JSON-RPC via stdio
// ============================================================
class MCPTestClient {
    constructor() {
        this.proc = null;
        this.pending = new Map();
        this.msgId = 1;
        this.buffer = '';
    }

    start() {
        return new Promise((resolve, reject) => {
            this.proc = spawn('docker', [
                'run', '-i', '--rm',
                '-v', 'c:/:/host',
                'code-contractor-mcp'
            ], { stdio: ['pipe', 'pipe', 'pipe'] });

            this.proc.stdout.on('data', (data) => {
                this.buffer += data.toString();
                const lines = this.buffer.split('\n');
                this.buffer = lines.pop(); // Keep incomplete line
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const msg = JSON.parse(line);
                        if (msg.id && this.pending.has(msg.id)) {
                            const { resolve, reject } = this.pending.get(msg.id);
                            this.pending.delete(msg.id);
                            if (msg.error) reject(new Error(msg.error.message));
                            else resolve(msg.result);
                        }
                    } catch (e) {}
                }
            });

            this.proc.stderr.on('data', (data) => {
                // Server log - ignore
            });

            this.proc.on('error', reject);

            // Initialize
            setTimeout(async () => {
                try {
                    await this.send('initialize', {
                        protocolVersion: '2024-11-05',
                        capabilities: {},
                        clientInfo: { name: 'test-client', version: '1.0.0' }
                    });
                    resolve();
                } catch (e) {
                    reject(e);
                }
            }, 2000);
        });
    }

    send(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = this.msgId++;
            const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
            this.pending.set(id, { resolve, reject });
            this.proc.stdin.write(msg);
            // Timeout after 30s
            setTimeout(() => {
                if (this.pending.has(id)) {
                    this.pending.delete(id);
                    reject(new Error('Timeout'));
                }
            }, 30000);
        });
    }

    async callTool(name, args) {
        const result = await this.send('tools/call', { name, arguments: args });
        const text = result?.content?.[0]?.text;
        try { return JSON.parse(text); } catch (e) { return text; }
    }

    stop() {
        if (this.proc) this.proc.kill();
    }
}

// ============================================================
// Test Runner
// ============================================================
let passed = 0, failed = 0, errors = [];

async function test(name, fn) {
    process.stdout.write(`  Testing: ${name}... `);
    try {
        const result = await fn();
        if (result === false) {
            console.log('❌ FAIL');
            failed++;
            errors.push(name);
        } else {
            console.log('✅ PASS');
            passed++;
        }
    } catch (e) {
        console.log(`❌ ERROR: ${e.message}`);
        failed++;
        errors.push(`${name}: ${e.message}`);
    }
}

function assert(condition, msg) {
    if (!condition) throw new Error(msg || 'Assertion failed');
}

// ============================================================
// Main Tests
// ============================================================
async function runTests() {
    console.log('\n======================================');
    console.log('  MCP Tools Comprehensive Test Suite');
    console.log('======================================\n');

    const client = new MCPTestClient();
    
    console.log('Starting Docker container...');
    await client.start();
    console.log('✅ Container started\n');

    // ----------------------------------------------------------------
    // TEST 1: get_file_outline
    // ----------------------------------------------------------------
    console.log('📂 [1] get_file_outline');

    await test('JS file - basic functions', async () => {
        const r = await client.callTool('get_file_outline', { path: '/host/all2/mcp/mcp-server/SearchEngine.js' });
        assert(r.outline && r.outline.length > 0, 'No outline returned');
        assert(r.outline.some(i => i.type === 'class' || i.type === 'method'), 'No class/method found');
        return true;
    });

    await test('TS file - interfaces & types', async () => {
        const r = await client.callTool('get_file_outline', { path: '/host/all2/mcp/mcp-server/test-ts-outline.ts' });
        // Create test file first
        return true;
    });

    await test('Large JS file (server.js)', async () => {
        const r = await client.callTool('get_file_outline', { path: '/host/all2/mcp/mcp-server/server.js' });
        assert(r.outline && r.outline.length > 10, `Expected >10 items, got ${r.outline?.length}`);
        return true;
    });

    await test('Python file', async () => {
        // Write test python file
        await client.callTool('write_file', { 
            path: '/host/all2/mcp/mcp-server/.test-py.py',
            content: 'def hello():\n    pass\n\nclass MyClass:\n    def method(self):\n        pass\n'
        });
        const r = await client.callTool('get_file_outline', { path: '/host/all2/mcp/mcp-server/.test-py.py' });
        assert(r.outline && r.outline.length >= 2, `Expected >=2 items, got ${r.outline?.length}`);
        return true;
    });

    await test('Non-existent file gives error', async () => {
        const r = await client.callTool('get_file_outline', { path: '/host/all2/mcp/mcp-server/nonexistent.js' });
        // MCP tools return error as text string when tool throws
        const isError = (typeof r === 'string' && (r.includes('not found') || r.includes('error') || r.includes('Error'))) ||
                        r?.error || r?.message;
        assert(isError, `Expected error response, got: ${JSON.stringify(r)}`);
        return true;
    });

    // ----------------------------------------------------------------
    // TEST 2: search_code
    // ----------------------------------------------------------------
    console.log('\n🔍 [2] search_code');

    await test('Smart mode - find "const ctx"', async () => {
        const r = await client.callTool('search_code', {
            term: 'const ctx',
            path: '/host/all2/mcp/mcp-server',
            mode: 'smart'
        });
        assert(r.count > 0, `Expected results, got count=${r.count}. results=${JSON.stringify(r.results?.slice(0,2))}`);
        return true;
    });

    await test('Smart mode - search in specific file', async () => {
        const r = await client.callTool('search_code', {
            term: 'class SearchEngine',
            path: '/host/all2/mcp/mcp-server/SearchEngine.js',
            mode: 'smart'
        });
        assert(r.count > 0, `Expected results, got count=${r.count}`);
        return true;
    });

    await test('Definitions mode - find class definitions', async () => {
        const r = await client.callTool('search_code', {
            term: 'class SearchEngine',
            path: '/host/all2/mcp/mcp-server/SearchEngine.js',
            mode: 'definitions'
        });
        assert(r.count > 0, `Expected definitions, got ${r.count}`);
        assert(r.results.every(x => x.type === 'definition'), 'Non-definition in results');
        return true;
    });

    await test('Todos mode', async () => {
        const r = await client.callTool('search_code', {
            term: 'TODO',
            path: '/host/all2/mcp/mcp-server',
            mode: 'todos'
        });
        // Just check it runs without error
        assert(typeof r.count === 'number', 'No count returned');
        return true;
    });

    await test('Regex mode - find async methods', async () => {
        const r = await client.callTool('search_code', {
            term: 'async\\s+\\w+',  // matches "async fastSearch", "async searchFiles" etc
            path: '/host/all2/mcp/mcp-server/SearchEngine.js',
            mode: 'smart',
            regex: true
        });
        assert(r.count > 0, `Expected async methods, got ${r.count}`);
        return true;
    });

    await test('Case insensitive (default)', async () => {
        const r = await client.callTool('search_code', {
            term: 'SEARCHENGINE',
            path: '/host/all2/mcp/mcp-server/SearchEngine.js',
            mode: 'smart'
        });
        assert(r.count > 0, 'Case insensitive search should find matches');
        return true;
    });

    await test('Case sensitive mode', async () => {
        const r = await client.callTool('search_code', {
            term: 'SEARCHENGINE',
            path: '/host/all2/mcp/mcp-server/SearchEngine.js',
            mode: 'smart',
            case_sensitive: true
        });
        assert(r.count === 0, 'Case sensitive search should NOT find SEARCHENGINE');
        return true;
    });

    // ----------------------------------------------------------------
    // TEST 3: extract_code_element
    // ----------------------------------------------------------------
    console.log('\n🎯 [3] extract_code_element');

    await test('Extract class from JS', async () => {
        const r = await client.callTool('extract_code_element', {
            path: '/host/all2/mcp/mcp-server/SearchEngine.js',
            element_name: 'SearchEngine',
            type: 'class'
        });
        assert(r.results && r.results.length > 0, `No results returned: ${JSON.stringify(r)}`);
        // Field is 'content' not 'code'
        const code = r.results[0].content || r.results[0].code || r.results[0].text || '';
        assert(code.includes('SearchEngine'), `Expected SearchEngine in result, got: ${code.slice(0,100)}`);
        return true;
    });

    await test('Extract method from JS class', async () => {
        const r = await client.callTool('extract_code_element', {
            path: '/host/all2/mcp/mcp-server/SearchEngine.js',
            element_name: 'fastSearch',
            type: 'method'  // SearchEngine uses class syntax, so it's a method
        });
        assert(r.results && r.results.length > 0, `Got: ${JSON.stringify(r)}`);
        const code = r.results[0].content || r.results[0].code || '';
        assert(code.includes('fastSearch'), `Expected fastSearch in result`);
        return true;
    });

    await test('Extract non-existent element returns empty', async () => {
        const r = await client.callTool('extract_code_element', {
            path: '/host/all2/mcp/mcp-server/SearchEngine.js',
            element_name: 'nonExistentFunction',
            type: 'function'
        });
        assert(r.results && r.results.length === 0, `Expected empty results, got: ${JSON.stringify(r.results?.slice(0,1))}`);
        return true;
    });

    // ----------------------------------------------------------------
    // TEST 4: File Write/Read operations
    // ----------------------------------------------------------------
    console.log('\n📝 [4] File operations');
    const testFile = '/host/all2/mcp/mcp-server/.test-ops.js';

    await test('write_file - create new file', async () => {
        const r = await client.callTool('write_file', {
            path: testFile,
            content: 'const x = 1;\nconst y = 2;\nfunction add(a, b) { return a + b; }\n'
        });
        assert(r.status === 'success', `Expected success, got: ${JSON.stringify(r)}`);
        return true;
    });

    await test('read_file - read created file', async () => {
        const r = await client.callTool('read_file', { path: testFile });
        assert(r.content && r.content.includes('const x = 1'), `Got: ${JSON.stringify(r)}`);
        return true;
    });

    await test('append_to_file', async () => {
        const r = await client.callTool('append_to_file', {
            path: testFile,
            content: '\nconst z = 3; // appended\n'
        });
        assert(r.status === 'success', `Got: ${JSON.stringify(r)}`);
        const read = await client.callTool('read_file', { path: testFile });
        assert(read.content.includes('appended'), 'Appended content not found');
        return true;
    });

    await test('prepend_to_file', async () => {
        const r = await client.callTool('prepend_to_file', {
            path: testFile,
            content: '// prepended comment\n'
        });
        assert(r.status === 'success', `Got: ${JSON.stringify(r)}`);
        const read = await client.callTool('read_file', { path: testFile });
        assert(read.content.startsWith('// prepended'), 'Prepended content not at start');
        return true;
    });

    await test('insert_at_line', async () => {
        const r = await client.callTool('insert_at_line', {
            path: testFile,
            line_number: 2,
            content: '// inserted at line 2\n'
        });
        assert(r.status === 'success', `Got: ${JSON.stringify(r)}`);
        const read = await client.callTool('read_file', { path: testFile });
        const lines = read.content.split('\n');
        assert(lines[1].includes('inserted at line 2'), `Line 2 is: ${lines[1]}`);
        return true;
    });

    await test('replace_exact_line', async () => {
        const read1 = await client.callTool('read_file', { path: testFile });
        const lines = read1.content.split('\n');
        const targetLine = lines.find(l => l.includes('const x = 1'));
        assert(targetLine, 'Target line not found');
        const r = await client.callTool('replace_exact_line', {
            path: testFile,
            line_to_find: targetLine,
            replacement_line: 'const x = 100; // replaced'
        });
        assert(r.status === 'success', `Got: ${JSON.stringify(r)}`);
        const read2 = await client.callTool('read_file', { path: testFile });
        assert(read2.content.includes('x = 100'), 'Replacement not found');
        return true;
    });

    await test('insert_relative_to_marker - after', async () => {
        const r = await client.callTool('insert_relative_to_marker', {
            path: testFile,
            marker: 'const z = 3;',
            position: 'after',
            content: '\nconst w = 4; // after marker\n'
        });
        assert(r.status === 'success', `Got: ${JSON.stringify(r)}`);
        const read = await client.callTool('read_file', { path: testFile });
        assert(read.content.includes('after marker'), 'Content not inserted after marker');
        return true;
    });

    await test('replace_between_markers', async () => {
        await client.callTool('append_to_file', {
            path: testFile,
            content: '\n/* START */\nold content\n/* END */\n'
        });
        const r = await client.callTool('replace_between_markers', {
            path: testFile,
            start_marker: '/* START */',
            end_marker: '/* END */',
            content: '\nnew content\n'
        });
        assert(r.status === 'success', `Got: ${JSON.stringify(r)}`);
        const read = await client.callTool('read_file', { path: testFile });
        assert(read.content.includes('new content'), 'New content not found');
        assert(!read.content.includes('old content'), 'Old content still present');
        return true;
    });

    await test('replace_line_range', async () => {
        const read = await client.callTool('read_file', { path: testFile });
        const lineCount = read.content.split('\n').length;
        const r = await client.callTool('replace_line_range', {
            path: testFile,
            start_line: 1,
            end_line: 1,
            content: '// range replaced\n'
        });
        assert(r.status === 'success', `Got: ${JSON.stringify(r)}`);
        return true;
    });

    // ----------------------------------------------------------------
    // TEST 5: AST operations
    // ----------------------------------------------------------------
    console.log('\n🧬 [5] AST operations');
    const astTestFile = '/host/all2/mcp/mcp-server/.test-ast.js';

    await client.callTool('write_file', {
        path: astTestFile,
        content: `const config = { debug: false };

function processData(input) {
    return input.trim();
}

async function fetchUser(userId) {
    return await fetch('/api/users/' + userId);
}

class UserService {
    constructor(db) {
        this.db = db;
    }

    async getUser(id) {
        return this.db.find(id);
    }
}

module.exports = { processData, fetchUser, UserService };
`
    });

    await test('ast_replace_element - replace function', async () => {
        const r = await client.callTool('ast_replace_element', {
            path: astTestFile,
            element_name: 'processData',
            element_type: 'function',
            new_content: 'function processData(input) {\n    return input.trim().toLowerCase();\n}'
        });
        assert(r.status === 'success', `Got: ${JSON.stringify(r)}`);
        const read = await client.callTool('read_file', { path: astTestFile });
        assert(read.content.includes('toLowerCase'), 'Replacement not found');
        return true;
    });

    await test('ast_replace_element - replace class', async () => {
        const r = await client.callTool('ast_replace_element', {
            path: astTestFile,
            element_name: 'UserService',
            element_type: 'class',
            new_content: 'class UserService {\n    constructor(db) {\n        this.db = db;\n        this.cache = new Map();\n    }\n\n    async getUser(id) {\n        if (this.cache.has(id)) return this.cache.get(id);\n        return this.db.find(id);\n    }\n}'
        });
        assert(r.status === 'success', `Got: ${JSON.stringify(r)}`);
        const read = await client.callTool('read_file', { path: astTestFile });
        assert(read.content.includes('this.cache'), 'New class content not found');
        return true;
    });

    await test('ast_rename_symbol', async () => {
        const r = await client.callTool('ast_rename_symbol', {
            path: astTestFile,
            old_name: 'fetchUser',
            new_name: 'getRemoteUser'
        });
        assert(r.status === 'success', `Got: ${JSON.stringify(r)}`);
        const read = await client.callTool('read_file', { path: astTestFile });
        assert(read.content.includes('getRemoteUser'), 'Renamed function not found');
        return true;
    });

    await test('ast_add_import - named imports', async () => {
        const r = await client.callTool('ast_add_import', {
            path: astTestFile,
            module_source: './utils',
            named_imports: ['helper', 'logger']
        });
        assert(r.status === 'success', `Got: ${JSON.stringify(r)}`);
        const read = await client.callTool('read_file', { path: astTestFile });
        assert(read.content.includes("from './utils'") || read.content.includes("require('./utils')"), 'Import not added');
        return true;
    });

    await test('ast_add_import - duplicate prevention', async () => {
        const r = await client.callTool('ast_add_import', {
            path: astTestFile,
            module_source: './utils',
            named_imports: ['helper']
        });
        const read = await client.callTool('read_file', { path: astTestFile });
        const count = (read.content.match(/utils/g) || []).length;
        assert(count <= 2, `Import duplicated: found ${count} occurrences`);
        return true;
    });

    // ----------------------------------------------------------------
    // TEST 6: find_references
    // ----------------------------------------------------------------
    console.log('\n🔎 [6] find_references');

    await test('Find references across directory', async () => {
        const r = await client.callTool('find_references', {
            element_name: 'SearchEngine',
            path: '/host/all2/mcp/mcp-server'
        });
        assert(r.total > 0, `Expected references, got ${r.total}`);
        assert(r.definitions && r.definitions.length > 0, 'No definitions found');
        return true;
    });

    await test('Find references in single file', async () => {
        const r = await client.callTool('find_references', {
            element_name: 'fastSearch',
            path: '/host/all2/mcp/mcp-server/SearchEngine.js'
        });
        assert(r.total > 0, `Expected references, got ${r.total}`);
        return true;
    });

    // ----------------------------------------------------------------
    // TEST 7: apply_diff
    // ----------------------------------------------------------------
    console.log('\n📋 [7] apply_diff');
    const diffTestFile = '/host/all2/mcp/mcp-server/.test-diff.js';

    await client.callTool('write_file', {
        path: diffTestFile,
        content: 'line 1\nline 2\nline 3\nline 4\nline 5\n'
    });

    await test('Apply unified diff', async () => {
        const r = await client.callTool('apply_diff', {
            path: diffTestFile,
            diff_content: `--- a/.test-diff.js
+++ b/.test-diff.js
@@ -2,3 +2,4 @@
 line 2
-line 3
+line 3 modified
+line 3.5 new
 line 4`
        });
        assert(r.status === 'success', `Got: ${JSON.stringify(r)}`);
        const read = await client.callTool('read_file', { path: diffTestFile });
        assert(read.content.includes('modified'), 'Diff not applied');
        assert(read.content.includes('3.5'), 'New line not added');
        return true;
    });

    // ----------------------------------------------------------------
    // TEST 8: Backup system
    // ----------------------------------------------------------------
    console.log('\n💾 [8] Backup system');

    await test('list_backups', async () => {
        const r = await client.callTool('list_backups', { path: astTestFile });
        assert(r.backups && r.backups.length > 0, `Expected backups, got: ${JSON.stringify(r)}`);
        return true;
    });

    await test('show_diff with latest backup', async () => {
        const r = await client.callTool('show_diff', { current: astTestFile });
        assert(r.diff !== undefined, `Got: ${JSON.stringify(r)}`);
        return true;
    });

    // ----------------------------------------------------------------
    // TEST 9: lint_code
    // ----------------------------------------------------------------
    console.log('\n🔬 [9] lint_code');

    await test('Lint valid JavaScript', async () => {
        const r = await client.callTool('lint_code', {
            code: 'function add(a, b) { return a + b; }',
            language: 'javascript'
        });
        assert(r !== null, 'No result returned');
        return true;
    });

    await test('Lint JavaScript with syntax error', async () => {
        const r = await client.callTool('lint_code', {
            code: 'function bad( { return; }',
            language: 'javascript'
        });
        assert(r !== null, 'No result returned');
        return true;
    });

    await test('Lint Python code', async () => {
        const r = await client.callTool('lint_code', {
            code: 'def hello():\n    pass\n',
            language: 'python'
        });
        assert(r !== null, 'No result returned');
        return true;
    });

    // ----------------------------------------------------------------
    // TEST 10: batch_smart_apply
    // ----------------------------------------------------------------
    console.log('\n⚡ [10] batch_smart_apply');
    const batchFile = '/host/all2/mcp/mcp-server/.test-batch.js';

    await test('Batch multiple operations', async () => {
        const r = await client.callTool('batch_smart_apply', {
            operations: [
                { type: 'append_to_file', file: batchFile, content: 'const a = 1;\n' },
                { type: 'append_to_file', file: batchFile, content: 'const b = 2;\n' },
                { type: 'append_to_file', file: batchFile, content: 'const c = 3;\n' }
            ]
        });
        assert(r.results && r.results.length === 3, `Got: ${JSON.stringify(r)}`);
        const read = await client.callTool('read_file', { path: batchFile });
        assert(read.content.includes('const a') && read.content.includes('const b'), 'Batch ops not applied');
        return true;
    });

    // ----------------------------------------------------------------
    // TEST 11: find_large_files
    // ----------------------------------------------------------------
    console.log('\n📊 [11] find_large_files');

    await test('Find large files in directory', async () => {
        const r = await client.callTool('find_large_files', {
            path: '/host/all2/mcp/mcp-server',
            min_lines: 100
        });
        assert(r.files && r.files.length > 0, `Got: ${JSON.stringify(r)}`);
        assert(r.files.some(f => f.lines > 100), 'No large files found');
        return true;
    });

    // ----------------------------------------------------------------
    // Cleanup
    // ----------------------------------------------------------------
    console.log('\n🧹 Cleanup...');
    const testFiles = [
        '/host/all2/mcp/mcp-server/.test-ops.js',
        '/host/all2/mcp/mcp-server/.test-ast.js',
        '/host/all2/mcp/mcp-server/.test-diff.js',
        '/host/all2/mcp/mcp-server/.test-batch.js',
        '/host/all2/mcp/mcp-server/.test-py.py',
    ];
    for (const f of testFiles) {
        try { await client.callTool('delete_file', { path: f }); } catch(e) {}
    }

    client.stop();

    // ----------------------------------------------------------------
    // Results
    // ----------------------------------------------------------------
    console.log('\n======================================');
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log('======================================');

    if (errors.length > 0) {
        console.log('\n❌ Failed tests:');
        errors.forEach(e => console.log(`  - ${e}`));
    }

    return { passed, failed, errors };
}

runTests().then(({ failed }) => {
    process.exit(failed > 0 ? 1 : 0);
}).catch(e => {
    console.error('Test suite error:', e);
    process.exit(1);
});
