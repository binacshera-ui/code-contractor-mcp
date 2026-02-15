// Full test script for MCP Server components
const CodeLinter = require('./CodeLinter');
const CodeAnalyzer = require('./CodeAnalyzer');

async function testLinter() {
    console.log('=== Testing CodeLinter ===\n');
    const linter = new CodeLinter();
    
    const validJS = `
const greeting = "Hello World";
function sayHello(name) {
    console.log(greeting + ", " + name);
    return name.toUpperCase();
}
sayHello("User");
`;

    const result = await linter.lintCode(validJS, 'javascript');
    console.log('Valid JS code results:');
    console.log('  Errors:', result.errors.length);
    console.log('  Warnings:', result.warnings.length);
    console.log('  Info:', result.info.length);
    
    if (result.errors.length > 0) {
        console.log('\n  Error details:');
        result.errors.forEach(e => console.log('    -', e.message));
        return false;
    }
    
    console.log('  ✅ Linter works correctly!\n');
    return true;
}

async function testAnalyzer() {
    console.log('=== Testing CodeAnalyzer ===\n');
    
    const code = `class Calculator {
    constructor() {
        this.result = 0;
    }
    
    add(a, b) {
        return a + b;
    }
    
    multiply(a, b) {
        return a * b;
    }
}

function helper(x) {
    return x * 2;
}

const PI = 3.14159;`;

    const analyzer = new CodeAnalyzer('javascript');
    
    // Test extractElement
    console.log('Testing extractElement...');
    const fnResult = analyzer.extractElement(code, 'helper', 'function');
    console.log('  Found', fnResult.length, 'result(s) for "helper" function');
    
    if (fnResult[0].error) {
        console.log('  ❌ Error:', fnResult[0].error);
        return false;
    }
    
    const classResult = analyzer.extractElement(code, 'Calculator', 'class');
    console.log('  Found', classResult.length, 'result(s) for "Calculator" class');
    
    if (classResult[0].error) {
        console.log('  ❌ Error:', classResult[0].error);
        return false;
    }
    
    if (fnResult.length > 1) {
        console.log('  ❌ Duplicates detected!');
        return false;
    }
    
    // Test findUsages
    console.log('\nTesting findUsages...');
    const usages = analyzer.findUsages(code, 'result');
    console.log('  Found', usages.length, 'usages of "result"');
    
    // Test extractImports
    console.log('\nTesting extractImports...');
    const importCode = `const fs = require('fs');
import path from 'path';
import { readFile } from 'fs/promises';`;
    const imports = analyzer.extractImports(importCode);
    console.log('  Found', imports.length, 'imports:', imports.join(', '));
    
    // Test replaceElement
    console.log('\nTesting replaceElement...');
    const newCode = analyzer.replaceElement(code, 'helper', 'function', 
        'function helper(x) {\n    return x * 3; // Modified!\n}');
    console.log('  Replacement successful:', newCode.includes('x * 3'));
    
    console.log('  ✅ CodeAnalyzer works correctly!\n');
    return true;
}

async function main() {
    console.log('🔧 MCP Server Component Tests\n');
    console.log('================================\n');
    
    let allPassed = true;
    
    try {
        if (!await testLinter()) allPassed = false;
    } catch (err) {
        console.log('❌ Linter test failed:', err.message);
        allPassed = false;
    }
    
    try {
        if (!await testAnalyzer()) allPassed = false;
    } catch (err) {
        console.log('❌ Analyzer test failed:', err.message);
        allPassed = false;
    }
    
    console.log('================================');
    if (allPassed) {
        console.log('✅ ALL TESTS PASSED!\n');
    } else {
        console.log('❌ SOME TESTS FAILED!\n');
        process.exit(1);
    }
}

main();
