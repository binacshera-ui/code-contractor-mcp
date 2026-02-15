/**
 * CodeAnalyzer.js - AST-based Code Analysis Engine
 * 
 * Provides Tree-sitter powered code analysis and manipulation:
 * - Parse code into AST
 * - Execute semantic queries
 * - Extract code elements with context
 * - Find symbol usages
 * - Replace code elements by name
 * 
 * Supported: JavaScript, TypeScript, Python, Go, Java
 */

const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const Python = require('tree-sitter-python');
const Go = require('tree-sitter-go');
const Java = require('tree-sitter-java');

// Language to Tree-sitter module mapping
const languageMap = {
    javascript: JavaScript,
    typescript: JavaScript, // JS grammar handles TS reasonably well
    python: Python,
    go: Go,
    java: Java
};

/**
 * CodeAnalyzer - AST-based code analysis and manipulation
 */
class CodeAnalyzer {
    constructor(language) {
        // Normalize language name
        const langKey = language.toLowerCase();
        if (!languageMap[langKey]) {
            throw new Error(`Unsupported language for AST analysis: '${language}'.`);
        }
        this.parser = new Parser();
        this.parser.setLanguage(languageMap[langKey]);
        this.language = langKey;
    }

    /**
     * Parse source code into AST
     */
    parse(sourceCode) {
        return this.parser.parse(sourceCode);
    }

    /**
     * Execute a Tree-sitter query on the AST
     */
    query(tree, queryString) {
        const query = new Parser.Query(languageMap[this.language], queryString);
        const matches = query.matches(tree.rootNode);
        return matches.map(match => match.captures).flat();
    }

    /**
     * Replace text at a specific AST node location
     */
    replaceNodeText(sourceCode, nodeToReplace, newText) {
        if (!nodeToReplace || typeof nodeToReplace.startIndex !== 'number' || typeof nodeToReplace.endIndex !== 'number') {
            throw new Error("Invalid node provided for replacement.");
        }
        return sourceCode.slice(0, nodeToReplace.startIndex) + newText + sourceCode.slice(nodeToReplace.endIndex);
    }

    /**
     * Extract code element with surrounding context
     * @param {string} sourceCode - Full source code
     * @param {string} targetName - Name of function/class/variable to find
     * @param {string} type - 'function' | 'class' | 'variable'
     * @param {number} contextLines - Lines of context before/after
     */
    extractElement(sourceCode, targetName, type, contextLines = 5) {
        const tree = this.parse(sourceCode);
        const lines = sourceCode.split('\n');
        const results = [];
        const seenLocations = new Set(); // Prevent duplicates

        // Build query based on language and type
        let queryString = '';
        
        if (this.language === 'javascript' || this.language === 'typescript') {
            if (type === 'function') {
                // Supports regular functions, arrow functions, and class methods
                queryString = `
                    (function_declaration name: (identifier) @name (#eq? @name "${targetName}")) @def
                    (variable_declarator name: (identifier) @name (#eq? @name "${targetName}") value: [(arrow_function) (function_expression)]) @def
                    (method_definition name: (property_identifier) @name (#eq? @name "${targetName}")) @def
                `;
            } else if (type === 'class') {
                queryString = `(class_declaration name: (identifier) @name (#eq? @name "${targetName}")) @def`;
            } else { // variable
                queryString = `(variable_declarator name: (identifier) @name (#eq? @name "${targetName}")) @def`;
            }
        } else if (this.language === 'python') {
            if (type === 'function') {
                queryString = `(function_definition name: (identifier) @name (#eq? @name "${targetName}")) @def`;
            } else if (type === 'class') {
                queryString = `(class_definition name: (identifier) @name (#eq? @name "${targetName}")) @def`;
            } else {
                queryString = `(assignment left: (identifier) @name (#eq? @name "${targetName}")) @def`;
            }
        } else {
            // Generic fallback for other languages
            queryString = `(identifier) @name (#eq? @name "${targetName}")`;
        }

        try {
            const query = new Parser.Query(languageMap[this.language], queryString);
            const matches = query.matches(tree.rootNode);

            matches.forEach(match => {
                // Find the @def capture
                const defCapture = match.captures.find(c => c.name === 'def');
                const node = defCapture ? defCapture.node : match.captures[0]?.node;
                
                if (node) {
                    // Create unique location key
                    const locationKey = `${node.startPosition.row}:${node.endPosition.row}`;
                    
                    // Skip duplicates
                    if (seenLocations.has(locationKey)) {
                        return;
                    }
                    seenLocations.add(locationKey);
                    
                    const startLine = Math.max(0, node.startPosition.row - contextLines);
                    const endLine = Math.min(lines.length - 1, node.endPosition.row + contextLines);
                    
                    const snippet = lines.slice(startLine, endLine + 1).join('\n');
                    
                    results.push({
                        type: type,
                        name: targetName,
                        location: `Lines ${startLine + 1}-${endLine + 1}`,
                        content: snippet
                    });
                }
            });
        } catch (e) {
            return [{ error: `AST Query failed: ${e.message}` }];
        }

        if (results.length === 0) {
            return [{ message: `Element '${targetName}' of type '${type}' not found.` }];
        }

        return results;
    }

    /**
     * Find usages (references) of an identifier in code
     * Filters out definitions, returns only usage locations
     */
    findUsages(sourceCode, targetName) {
        const tree = this.parse(sourceCode);
        const lines = sourceCode.split('\n');
        const usages = [];

        // Query for identifier usage vs definition
        let queryString = '';
        if (this.language === 'javascript' || this.language === 'typescript') {
            queryString = `(identifier) @ref (#eq? @ref "${targetName}")`;
        } else if (this.language === 'python') {
            queryString = `(identifier) @ref (#eq? @ref "${targetName}")`;
        } else {
            queryString = `(identifier) @ref (#eq? @ref "${targetName}")`;
        }

        try {
            const query = new Parser.Query(languageMap[this.language], queryString);
            const matches = query.matches(tree.rootNode);

            matches.forEach(match => {
                const node = match.captures[0].node;
                
                // Basic filtering: skip if part of definition
                const parentType = node.parent ? node.parent.type : '';
                const isDefinition = parentType === 'function_declaration' || 
                                     parentType === 'variable_declarator' ||
                                     parentType === 'class_declaration';

                if (!isDefinition) {
                    usages.push({
                        line: node.startPosition.row + 1,
                        code: lines[node.startPosition.row].trim()
                    });
                }
            });
        } catch (e) {
            // Fallback to text search on AST error
            lines.forEach((line, idx) => {
                if (line.includes(targetName) && !line.trim().startsWith('//') && !line.trim().startsWith('#')) {
                    usages.push({ line: idx + 1, code: line.trim() });
                }
            });
        }
        return usages;
    }

    /**
     * Extract all imported paths from file (imports/requires)
     */
    extractImports(sourceCode) {
        const tree = this.parse(sourceCode);
        const imports = [];
        
        let queryString = '';
        if (this.language === 'javascript' || this.language === 'typescript') {
            // Supports import...from and require()
            queryString = `
                (import_statement source: (string) @path)
                (call_expression function: (identifier) @callee (#eq? @callee "require") arguments: (arguments (string) @path))
            `;
        } else if (this.language === 'python') {
            // Supports from X import and import X
            queryString = `
                (import_from_statement module_name: (dotted_name) @path)
                (import_statement name: (dotted_name) @path)
            `;
        }

        if (queryString) {
            try {
                const query = new Parser.Query(languageMap[this.language], queryString);
                const matches = query.matches(tree.rootNode);
                matches.forEach(match => {
                    const node = match.captures[0].node;
                    // Remove quotes if present
                    const rawPath = node.text.replace(/['"]/g, ''); 
                    imports.push(rawPath);
                });
            } catch (e) {}
        }
        return imports;
    }

    /**
     * Replace an entire element (function/class/variable) with new content
     * Uses AST identification - no need to know exact current content
     */
    replaceElement(sourceCode, targetName, type, newContent) {
        const tree = this.parse(sourceCode);
        
        // Use same query logic as extractElement
        let queryString = '';
        if (this.language === 'javascript' || this.language === 'typescript') {
            if (type === 'function') {
                queryString = `
                    (function_declaration name: (identifier) @name (#eq? @name "${targetName}")) @target
                    (variable_declarator name: (identifier) @name (#eq? @name "${targetName}") value: [(arrow_function) (function_expression)]) @target
                    (method_definition name: (property_identifier) @name (#eq? @name "${targetName}")) @target
                `;
            } else if (type === 'class') {
                queryString = `(class_declaration name: (identifier) @name (#eq? @name "${targetName}")) @target`;
            }
        } else if (this.language === 'python') {
            if (type === 'function') {
                queryString = `(function_definition name: (identifier) @name (#eq? @name "${targetName}")) @target`;
            } else if (type === 'class') {
                queryString = `(class_definition name: (identifier) @name (#eq? @name "${targetName}")) @target`;
            }
        } else {
            // Fallback for other languages
            queryString = `(function_definition name: (identifier) @name (#eq? @name "${targetName}")) @target`;
        }

        try {
            const query = new Parser.Query(languageMap[this.language], queryString);
            const matches = query.matches(tree.rootNode);
            
            // Take first match (usually the definition)
            const match = matches.find(m => m.captures.some(c => c.name === 'target'));
            
            if (!match) {
                throw new Error(`Element '${targetName}' of type '${type}' not found for replacement.`);
            }

            const nodeToReplace = match.captures.find(c => c.name === 'target').node;
            
            // Use helper function for text replacement
            return this.replaceNodeText(sourceCode, nodeToReplace, newContent);

        } catch (e) {
            throw new Error(`AST Replacement failed: ${e.message}`);
        }
    }
}

module.exports = CodeAnalyzer;
