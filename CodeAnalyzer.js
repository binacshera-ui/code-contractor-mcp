/**
 * CodeAnalyzer.js - Advanced AST-based Code Analysis Engine
 * 
 * Full support for:
 * - JavaScript (ES6+, JSX)
 * - TypeScript (full syntax including interfaces, types, generics)
 * - Python
 * - Go
 * - Java
 * 
 * Features:
 * - Parse code into AST using Tree-sitter
 * - Extract file outline (functions, classes, interfaces, types)
 * - Find symbol usages and definitions
 * - Replace code elements by name
 * - Smart regex fallback for unsupported languages
 */

const Parser = require('tree-sitter');

// Lazy-load language modules to handle missing ones gracefully
let JavaScript, TypeScript, TSX, Python, Go, Java, CSharp, Ruby, C, Cpp, Rust, PHP;

try { JavaScript = require('tree-sitter-javascript'); } catch (e) { JavaScript = null; }
try { 
    const ts = require('tree-sitter-typescript');
    TypeScript = ts.typescript;
    TSX = ts.tsx;
} catch (e) { 
    TypeScript = null; 
    TSX = null;
}
try { Python = require('tree-sitter-python'); } catch (e) { Python = null; }
try { Go = require('tree-sitter-go'); } catch (e) { Go = null; }
try { Java = require('tree-sitter-java'); } catch (e) { Java = null; }
try { CSharp = require('tree-sitter-c-sharp'); } catch (e) { CSharp = null; }
try { Ruby = require('tree-sitter-ruby'); } catch (e) { Ruby = null; }
try { C = require('tree-sitter-c'); } catch (e) { C = null; }
try { Cpp = require('tree-sitter-cpp'); } catch (e) { Cpp = null; }
try { Rust = require('tree-sitter-rust'); } catch (e) { Rust = null; }
try { 
    const phpModule = require('tree-sitter-php');
    PHP = phpModule.php || phpModule;
} catch (e) { PHP = null; }

// Language to Tree-sitter module mapping
function getLanguageModule(language, filePath = '') {
    const lang = language.toLowerCase();
    
    // Check for TSX files
    if ((lang === 'typescript' || lang === 'tsx') && filePath.endsWith('.tsx')) {
        return TSX || TypeScript || JavaScript;
    }
    
    // Check for JSX files
    if ((lang === 'javascript' || lang === 'jsx') && filePath.endsWith('.jsx')) {
        return JavaScript;
    }
    
    switch (lang) {
        case 'typescript':
        case 'ts':
            return TypeScript || JavaScript;
        case 'javascript':
        case 'js':
        case 'jsx':
            return JavaScript;
        case 'python':
        case 'py':
            return Python;
        case 'go':
        case 'golang':
            return Go;
        case 'java':
            return Java;
        case 'csharp':
        case 'c#':
        case 'cs':
            return CSharp;
        case 'ruby':
        case 'rb':
            return Ruby;
        case 'c':
            return C;
        case 'cpp':
        case 'c++':
        case 'cc':
        case 'cxx':
            return Cpp;
        case 'rust':
        case 'rs':
            return Rust;
        case 'php':
            return PHP;
        default:
            return null;
    }
}

/**
 * CodeAnalyzer - AST-based code analysis and manipulation
 */
class CodeAnalyzer {
    constructor(language, filePath = '') {
        this.language = language.toLowerCase();
        this.filePath = filePath;
        
        const langModule = getLanguageModule(this.language, filePath);
        
        if (langModule) {
            this.parser = new Parser();
            this.parser.setLanguage(langModule);
            this.langModule = langModule;
            this.useAST = true;
        } else {
            this.useAST = false;
        }
    }

    /**
     * Parse source code into AST
     */
    parse(sourceCode) {
        if (!this.useAST) {
            throw new Error(`AST not available for language: ${this.language}`);
        }
        return this.parser.parse(sourceCode);
    }

    /**
     * Get comprehensive file outline - ALL definitions
     * Returns: functions, classes, interfaces, types, enums, variables, methods
     */
    getOutline(sourceCode) {
        const outline = [];
        const lines = sourceCode.split('\n');
        
        if (this.useAST) {
            try {
                const tree = this.parse(sourceCode);
                this._collectOutlineFromAST(tree.rootNode, lines, outline, 0);
            } catch (e) {
                // Fall back to regex on AST error
                return this._getOutlineWithRegex(sourceCode);
            }
        } else {
            return this._getOutlineWithRegex(sourceCode);
        }
        
        // Sort by line number
        outline.sort((a, b) => a.line - b.line);
        
        return outline;
    }

    /**
     * Collect outline items from AST recursively
     */
    _collectOutlineFromAST(node, lines, outline, depth) {
        if (!node) return;
        
        const item = this._nodeToOutlineItem(node, lines);
        if (item) {
            item.depth = depth;
            outline.push(item);
        }
        
        // Recurse into children (for nested classes, methods, etc.)
        const childDepth = item ? depth + 1 : depth;
        for (let i = 0; i < node.childCount; i++) {
            this._collectOutlineFromAST(node.child(i), lines, outline, childDepth);
        }
    }

    /**
     * Convert AST node to outline item
     */
    _nodeToOutlineItem(node, lines) {
        const type = node.type;
        const startLine = node.startPosition.row + 1;
        const endLine = node.endPosition.row + 1;
        
        // Get the line content for signature
        const lineContent = lines[node.startPosition.row] || '';
        
        // Helper to get name from node (safe for all tree-sitter grammars)
        const getName = (nameField) => {
            // Try field-based access first (not all grammars support this)
            try {
                if (typeof node.childForFieldName === 'function') {
                    const nameNode = node.childForFieldName(nameField);
                    if (nameNode) return nameNode.text;
                }
            } catch (e) {}
            
            // Fallback: find name in children (handles all grammars)
            const nodeType = node.type;
            const isMethodOrFunc = nodeType.includes('method') || nodeType.includes('function') || nodeType.includes('constructor');
            
            let foundName = null;
            for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i);
                
                // Direct identifier
                if (child.type === 'identifier') {
                    foundName = child.text;
                    if (!isMethodOrFunc) return foundName;
                }
                // PHP uses 'name' nodes
                if (child.type === 'name') return child.text;
                // Ruby uses 'constant' for class names
                if (child.type === 'constant') return child.text;
                // Property identifier (JS/TS)
                if (child.type === 'property_identifier') return child.text;
                // Type identifier for classes/structs/enums (not for method return types)
                if (child.type === 'type_identifier' && !isMethodOrFunc) return child.text;
                // C/C++: function_declarator contains the name
                if (child.type === 'function_declarator') {
                    for (let j = 0; j < child.childCount; j++) {
                        const gc = child.child(j);
                        if (gc.type === 'identifier') return gc.text;
                        if (gc.type === 'field_identifier') return gc.text;
                    }
                }
            }
            return foundName;
        };

        // All languages AST node handling
        switch (type) {
            // Functions (or methods if parent is a class body)
            case 'function_declaration':
            case 'function_definition': {
                const name = getName('name') || getName('id');
                if (name) {
                    // Check if inside a class (Python methods, etc.)
                    const parentType = node.parent?.type || '';
                    const isMethod = parentType === 'block' && node.parent?.parent?.type === 'class_definition' ||
                                     parentType === 'class_body' || parentType === 'class_definition' ||
                                     parentType === 'declaration_list';
                    return {
                        type: isMethod ? 'method' : 'function',
                        name,
                        line: startLine,
                        endLine,
                        signature: this._extractSignature(lineContent, isMethod ? 'method' : 'function')
                    };
                }
                break;
            }
            
            // Arrow functions and function expressions assigned to variables
            case 'lexical_declaration':
            case 'variable_declaration': {
                // Find variable_declarator (may be nested)
                let declarator = null;
                const findDeclarator = (n) => {
                    if (n.type === 'variable_declarator') return n;
                    for (let i = 0; i < n.childCount; i++) {
                        const child = n.child(i);
                        if (child.type === 'variable_declarator') return child;
                        const found = findDeclarator(child);
                        if (found) return found;
                    }
                    return null;
                };
                declarator = findDeclarator(node);
                
                if (declarator) {
                    // Get name - try multiple approaches
                    let nameNode = declarator.childForFieldName('name');
                    if (!nameNode) {
                        for (let i = 0; i < declarator.childCount; i++) {
                            const child = declarator.child(i);
                            if (child.type === 'identifier') {
                                nameNode = child;
                                break;
                            }
                        }
                    }
                    
                    // Get value
                    let valueNode = declarator.childForFieldName('value');
                    if (!valueNode) {
                        for (let i = 0; i < declarator.childCount; i++) {
                            const child = declarator.child(i);
                            if (child.type === 'arrow_function' || 
                                child.type === 'function_expression' || 
                                child.type === 'function') {
                                valueNode = child;
                                break;
                            }
                        }
                    }
                    
                    if (nameNode && valueNode) {
                        const name = nameNode.text;
                        const valueType = valueNode.type;
                        
                        if (valueType === 'arrow_function' || valueType === 'function_expression' || valueType === 'function') {
                            return {
                                type: 'function',
                                name,
                                line: startLine,
                                endLine,
                                signature: this._extractSignature(lineContent, 'arrow'),
                                style: 'arrow'
                            };
                        }
                    }
                }
                break;
            }
            
            // Class declarations
            case 'class_declaration':
            case 'class_definition':
            case 'class': {
                const name = getName('name');
                if (name) {
                    return {
                        type: 'class',
                        name,
                        line: startLine,
                        endLine,
                        signature: this._extractSignature(lineContent, 'class')
                    };
                }
                break;
            }
            
            // Methods (inside classes)
            case 'method_definition':
            case 'method_declaration': {
                const name = getName('name') || getName('key');
                if (name) {
                    return {
                        type: 'method',
                        name,
                        line: startLine,
                        endLine,
                        signature: this._extractSignature(lineContent, 'method')
                    };
                }
                break;
            }
            
            // TypeScript: Interface declarations
            case 'interface_declaration': {
                const name = getName('name');
                if (name) {
                    return {
                        type: 'interface',
                        name,
                        line: startLine,
                        endLine,
                        signature: this._extractSignature(lineContent, 'interface')
                    };
                }
                break;
            }
            
            // TypeScript: Type aliases
            case 'type_alias_declaration': {
                const name = getName('name');
                if (name) {
                    return {
                        type: 'type',
                        name,
                        line: startLine,
                        endLine,
                        signature: this._extractSignature(lineContent, 'type')
                    };
                }
                break;
            }
            
            // TypeScript: Enum declarations
            case 'enum_declaration': {
                const name = getName('name');
                if (name) {
                    return {
                        type: 'enum',
                        name,
                        line: startLine,
                        endLine,
                        signature: this._extractSignature(lineContent, 'enum')
                    };
                }
                break;
            }
            
            // TypeScript: Namespace/Module declarations
            case 'module_declaration':
            case 'namespace_declaration':
            case 'ambient_declaration': {
                const name = getName('name');
                if (name) {
                    return {
                        type: 'namespace',
                        name,
                        line: startLine,
                        endLine,
                        signature: this._extractSignature(lineContent, 'namespace')
                    };
                }
                break;
            }
            
            // Export statements with declarations
            case 'export_statement': {
                // Look for exported arrow functions (export const foo = () => {})
                // In TypeScript AST, this is export_statement -> lexical_declaration -> variable_declarator
                for (let i = 0; i < node.childCount; i++) {
                    const child = node.child(i);
                    
                    // Handle lexical_declaration inside export
                    if (child.type === 'lexical_declaration' || child.type === 'variable_declaration') {
                        // Find variable_declarator
                        for (let j = 0; j < child.childCount; j++) {
                            const declarator = child.child(j);
                            if (declarator.type === 'variable_declarator') {
                                let nameNode = null;
                                let valueNode = null;
                                
                                for (let k = 0; k < declarator.childCount; k++) {
                                    const dc = declarator.child(k);
                                    if (dc.type === 'identifier') nameNode = dc;
                                    if (dc.type === 'arrow_function' || dc.type === 'function_expression') valueNode = dc;
                                }
                                
                                if (nameNode && valueNode) {
                                    return {
                                        type: 'function',
                                        name: nameNode.text,
                                        line: startLine,
                                        endLine,
                                        signature: this._extractSignature(lineContent, 'arrow'),
                                        style: 'arrow',
                                        exported: true
                                    };
                                }
                            }
                        }
                    }
                    
                    // Handle other declarations
                    if (child.type.includes('declaration')) {
                        const item = this._nodeToOutlineItem(child, lines);
                        if (item) {
                            item.exported = true;
                            item.line = startLine;
                            return item;
                        }
                    }
                }
                
                // Default export
                const defaultNode = node.children?.find(c => c.type === 'identifier');
                if (defaultNode && lineContent.includes('export default')) {
                    return {
                        type: 'export',
                        name: defaultNode.text,
                        line: startLine,
                        endLine,
                        signature: lineContent.trim(),
                        style: 'default'
                    };
                }
                break;
            }
            
            // Python class_definition (function_definition handled above at line ~222)
            case 'class_definition': {
                const name = getName('name');
                if (name) {
                    return {
                        type: 'class',
                        name,
                        line: startLine,
                        endLine,
                        signature: this._extractSignature(lineContent, 'class')
                    };
                }
                break;
            }
            
            // Go specific
            case 'function_declaration': {
                const name = getName('name');
                if (name) {
                    return {
                        type: 'function',
                        name,
                        line: startLine,
                        endLine,
                        signature: this._extractSignature(lineContent, 'func')
                    };
                }
                break;
            }
            
            case 'method_declaration': {
                const name = getName('name');
                if (name) {
                    return {
                        type: 'method',
                        name,
                        line: startLine,
                        endLine,
                        signature: this._extractSignature(lineContent, 'func')
                    };
                }
                break;
            }
            
            case 'type_declaration':
            case 'type_spec': {
                const name = getName('name');
                if (name) {
                    return {
                        type: 'type',
                        name,
                        line: startLine,
                        endLine,
                        signature: this._extractSignature(lineContent, 'type')
                    };
                }
                break;
            }
            
            // Java specific
            case 'class_declaration': {
                const name = getName('name');
                if (name) {
                    return {
                        type: 'class',
                        name,
                        line: startLine,
                        endLine,
                        signature: this._extractSignature(lineContent, 'class')
                    };
                }
                break;
            }
            
            case 'interface_declaration': {
                const name = getName('name');
                if (name) {
                    return {
                        type: 'interface',
                        name,
                        line: startLine,
                        endLine,
                        signature: this._extractSignature(lineContent, 'interface')
                    };
                }
                break;
            }
            
            case 'method_declaration': {
                const name = getName('name');
                if (name) {
                    return {
                        type: 'method',
                        name,
                        line: startLine,
                        endLine,
                        signature: this._extractSignature(lineContent, 'method')
                    };
                }
                break;
            }
            
            case 'constructor_declaration': {
                return {
                    type: 'constructor',
                    name: 'constructor',
                    line: startLine,
                    endLine,
                    signature: this._extractSignature(lineContent, 'constructor')
                };
            }
            
            case 'enum_declaration': {
                const name = getName('name');
                if (name) {
                    return {
                        type: 'enum',
                        name,
                        line: startLine,
                        endLine,
                        signature: this._extractSignature(lineContent, 'enum')
                    };
                }
                break;
            }

            // ===== Rust =====
            case 'function_item': {
                const name = getName('name');
                if (name) return { type: 'function', name, line: startLine, endLine, signature: this._extractSignature(lineContent, 'fn') };
                break;
            }
            case 'struct_item': {
                const name = getName('name');
                if (name) return { type: 'struct', name, line: startLine, endLine, signature: this._extractSignature(lineContent, 'struct') };
                break;
            }
            case 'enum_item': {
                const name = getName('name');
                if (name) return { type: 'enum', name, line: startLine, endLine, signature: this._extractSignature(lineContent, 'enum') };
                break;
            }
            case 'trait_item': {
                const name = getName('name');
                if (name) return { type: 'trait', name, line: startLine, endLine, signature: this._extractSignature(lineContent, 'trait') };
                break;
            }
            case 'impl_item': {
                const name = getName('type') || getName('name');
                if (name) return { type: 'impl', name, line: startLine, endLine, signature: this._extractSignature(lineContent, 'impl') };
                break;
            }

            // ===== Ruby =====
            case 'method': {
                const name = getName('name');
                if (name) {
                    const parentType = node.parent?.type || '';
                    const isClassMethod = parentType === 'body_statement' || parentType === 'class' || parentType === 'module';
                    return { type: isClassMethod ? 'method' : 'function', name, line: startLine, endLine, signature: this._extractSignature(lineContent, 'def') };
                }
                break;
            }
            case 'singleton_method': {
                const name = getName('name');
                if (name) return { type: 'method', name, line: startLine, endLine, signature: this._extractSignature(lineContent, 'def') };
                break;
            }
            // Ruby: 'class' node (not class_declaration)
            // Also used as top-level 'class' keyword by some grammars
            // Already handled by case 'class': above for JS/TS

            // ===== Ruby module =====
            case 'module': {
                const name = getName('name');
                if (name) return { type: 'module', name, line: startLine, endLine, signature: this._extractSignature(lineContent, 'module') };
                break;
            }

            // ===== C/C++ =====
            case 'class_specifier': {
                const name = getName('name');
                if (name) return { type: 'class', name, line: startLine, endLine, signature: this._extractSignature(lineContent, 'class') };
                break;
            }
            case 'struct_specifier': {
                const name = getName('name');
                if (name) return { type: 'struct', name, line: startLine, endLine, signature: this._extractSignature(lineContent, 'struct') };
                break;
            }
            case 'union_specifier': {
                const name = getName('name');
                if (name) return { type: 'union', name, line: startLine, endLine, signature: this._extractSignature(lineContent, 'union') };
                break;
            }
            case 'type_definition': {
                const name = getName('declarator') || getName('name');
                if (name) return { type: 'type', name, line: startLine, endLine, signature: this._extractSignature(lineContent, 'typedef') };
                break;
            }
            case 'preproc_def': {
                const name = getName('name');
                if (name) return { type: 'macro', name, line: startLine, endLine, signature: lineContent.trim() };
                break;
            }

            // ===== PHP =====
            case 'function_definition': // PHP uses same as Python - already handled above
            case 'namespace_definition': {
                const name = getName('name');
                if (name) return { type: 'namespace', name, line: startLine, endLine, signature: this._extractSignature(lineContent, 'namespace') };
                break;
            }

            // ===== C# =====
            case 'namespace_declaration': {
                const name = getName('name');
                if (name) return { type: 'namespace', name, line: startLine, endLine, signature: this._extractSignature(lineContent, 'namespace') };
                break;
            }
            case 'struct_declaration': {
                const name = getName('name');
                if (name) return { type: 'struct', name, line: startLine, endLine, signature: this._extractSignature(lineContent, 'struct') };
                break;
            }
            case 'property_declaration': {
                const name = getName('name');
                if (name) return { type: 'property', name, line: startLine, endLine, signature: this._extractSignature(lineContent, 'property') };
                break;
            }
            case 'delegate_declaration': {
                const name = getName('name');
                if (name) return { type: 'delegate', name, line: startLine, endLine, signature: this._extractSignature(lineContent, 'delegate') };
                break;
            }
        }
        
        return null;
    }

    /**
     * Extract clean signature from line
     */
    _extractSignature(line, type) {
        let sig = line.trim();
        
        // Remove trailing { and whitespace
        sig = sig.replace(/\s*\{?\s*$/, '');
        
        // Limit length
        if (sig.length > 120) {
            sig = sig.substring(0, 117) + '...';
        }
        
        return sig;
    }

    /**
     * Comprehensive regex-based outline extraction
     * Fallback when AST is not available
     */
    _getOutlineWithRegex(sourceCode) {
        const lines = sourceCode.split('\n');
        const outline = [];
        const seenLines = new Set();
        
        // Comprehensive patterns for all supported languages
        const patterns = [
            // JavaScript/TypeScript Functions
            { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/m, type: 'function' },
            { regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[=:][^=]*=>/m, type: 'function', style: 'arrow' },
            { regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function/m, type: 'function' },
            { regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*async\s*\(/m, type: 'function', style: 'arrow' },
            
            // Classes
            { regex: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/m, type: 'class' },
            
            // TypeScript Interfaces
            { regex: /^(?:export\s+)?interface\s+(\w+)/m, type: 'interface' },
            
            // TypeScript Type Aliases
            { regex: /^(?:export\s+)?type\s+(\w+)\s*(?:<[^>]*>)?\s*=/m, type: 'type' },
            
            // TypeScript Enums
            { regex: /^(?:export\s+)?(?:const\s+)?enum\s+(\w+)/m, type: 'enum' },
            
            // TypeScript Namespaces
            { regex: /^(?:export\s+)?(?:declare\s+)?(?:namespace|module)\s+(\w+)/m, type: 'namespace' },
            
            // Class Methods (various styles)
            { regex: /^\s+(?:public|private|protected|static|async|readonly|\s)*(\w+)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/m, type: 'method' },
            { regex: /^\s+(?:public|private|protected|static|async|readonly|\s)*(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/m, type: 'method', style: 'arrow' },
            
            // Python
            { regex: /^(?:async\s+)?def\s+(\w+)/m, type: 'function' },
            { regex: /^class\s+(\w+)/m, type: 'class' },
            
            // Go
            { regex: /^func\s+(\w+)/m, type: 'function' },
            { regex: /^func\s+\([^)]+\)\s+(\w+)/m, type: 'method' },
            { regex: /^type\s+(\w+)\s+(?:struct|interface)/m, type: 'type' },
            
            // Java
            { regex: /^\s*(?:public|private|protected|static|final|abstract|\s)*class\s+(\w+)/m, type: 'class' },
            { regex: /^\s*(?:public|private|protected|static|final|abstract|\s)*interface\s+(\w+)/m, type: 'interface' },
            { regex: /^\s*(?:public|private|protected|static|final|abstract|synchronized|\s)+(?:<[^>]+>\s+)?(\w+)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{/m, type: 'method' },
            { regex: /^\s*(?:public|private|protected|\s)*enum\s+(\w+)/m, type: 'enum' },
            
            // Rust
            { regex: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/m, type: 'function' },
            { regex: /^(?:pub\s+)?struct\s+(\w+)/m, type: 'struct' },
            { regex: /^(?:pub\s+)?enum\s+(\w+)/m, type: 'enum' },
            { regex: /^(?:pub\s+)?trait\s+(\w+)/m, type: 'trait' },
            { regex: /^impl(?:<[^>]+>)?\s+(?:(\w+)|for\s+(\w+))/m, type: 'impl' },
            
            // C/C++
            { regex: /^(?:static\s+)?(?:inline\s+)?(?:const\s+)?(?:\w+\s+)+(\w+)\s*\([^)]*\)\s*(?:const)?\s*\{/m, type: 'function' },
            { regex: /^(?:class|struct)\s+(\w+)/m, type: 'class' },
            { regex: /^typedef\s+(?:struct\s+)?(?:\{[^}]*\}\s+)?(\w+)/m, type: 'type' },
            
            // PHP
            { regex: /^(?:public|private|protected|static|\s)*function\s+(\w+)/m, type: 'function' },
            { regex: /^(?:abstract\s+)?class\s+(\w+)/m, type: 'class' },
            { regex: /^interface\s+(\w+)/m, type: 'interface' },
            { regex: /^trait\s+(\w+)/m, type: 'trait' },
            
            // Ruby
            { regex: /^(?:def\s+)?(?:self\.)?(\w+(?:\?|!)?)\s*(?:\([^)]*\))?\s*$/m, type: 'method' },
            { regex: /^class\s+(\w+)/m, type: 'class' },
            { regex: /^module\s+(\w+)/m, type: 'module' },
        ];
        
        lines.forEach((line, idx) => {
            const lineNum = idx + 1;
            const trimmedLine = line.trim();
            
            // Skip comments and empty lines
            if (!trimmedLine || 
                trimmedLine.startsWith('//') || 
                trimmedLine.startsWith('#') ||
                trimmedLine.startsWith('/*') ||
                trimmedLine.startsWith('*') ||
                trimmedLine.startsWith('"""') ||
                trimmedLine.startsWith("'''")) {
                return;
            }
            
            for (const pattern of patterns) {
                const match = line.match(pattern.regex);
                if (match) {
                    const name = match[1] || match[2];
                    
                    // Skip common false positives
                    if (!name || 
                        name === 'if' || 
                        name === 'for' || 
                        name === 'while' || 
                        name === 'switch' ||
                        name === 'return' ||
                        name === 'throw' ||
                        name === 'new' ||
                        name === 'try' ||
                        name === 'catch') {
                        continue;
                    }
                    
                    // Avoid duplicates
                    const key = `${lineNum}:${name}`;
                    if (seenLines.has(key)) continue;
                    seenLines.add(key);
                    
                    outline.push({
                        type: pattern.type,
                        name,
                        line: lineNum,
                        signature: this._extractSignature(line, pattern.type),
                        style: pattern.style
                    });
                    break; // Only match first pattern
                }
            }
        });
        
        return outline;
    }

    /**
     * Extract code element with surrounding context
     */
    extractElement(sourceCode, targetName, type, contextLines = 5) {
        const results = [];
        const lines = sourceCode.split('\n');
        const seenLocations = new Set();

        if (this.useAST) {
            try {
                const tree = this.parse(sourceCode);
                this._findElementInAST(tree.rootNode, targetName, type, lines, results, seenLocations, contextLines);
            } catch (e) {
                // Fall back to regex
                return this._extractElementWithRegex(sourceCode, targetName, type, contextLines);
            }
        } else {
            return this._extractElementWithRegex(sourceCode, targetName, type, contextLines);
        }

        if (results.length === 0) {
            return [];
        }

        return results;
    }

    /**
     * Find element in AST
     */
    _findElementInAST(node, targetName, type, lines, results, seenLocations, contextLines) {
        if (!node) return;

        const item = this._nodeToOutlineItem(node, lines);
        
        if (item && item.name === targetName) {
            // Check if type matches
            const typeMatches = (
                (type === 'function' && (item.type === 'function' || item.type === 'method')) ||
                (type === 'class' && item.type === 'class') ||
                (type === 'interface' && item.type === 'interface') ||
                (type === 'type' && (item.type === 'type' || item.type === 'interface')) ||
                (type === 'variable' && item.type === 'variable') ||
                type === item.type
            );
            
            if (typeMatches) {
                const locationKey = `${node.startPosition.row}:${node.endPosition.row}`;
                
                if (!seenLocations.has(locationKey)) {
                    seenLocations.add(locationKey);
                    
                    const startLine = Math.max(0, node.startPosition.row - contextLines);
                    const endLine = Math.min(lines.length - 1, node.endPosition.row + contextLines);
                    
                    results.push({
                        type: item.type,
                        name: targetName,
                        location: `Lines ${startLine + 1}-${endLine + 1}`,
                        startLine: startLine + 1,
                        endLine: endLine + 1,
                        content: lines.slice(startLine, endLine + 1).join('\n')
                    });
                }
            }
        }

        // Recurse
        for (let i = 0; i < node.childCount; i++) {
            this._findElementInAST(node.child(i), targetName, type, lines, results, seenLocations, contextLines);
        }
    }

    /**
     * Extract element using regex fallback
     */
    _extractElementWithRegex(sourceCode, targetName, type, contextLines) {
        const lines = sourceCode.split('\n');
        const results = [];
        const escapedName = targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // Build regex based on type
        let patterns = [];
        switch (type) {
            case 'function':
                patterns = [
                    new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${escapedName}\\s*[(<]`, 'm'),
                    new RegExp(`^(?:export\\s+)?(?:const|let|var)\\s+${escapedName}\\s*=\\s*(?:async\\s+)?(?:\\([^)]*\\)|[^=])\\s*=>`, 'm'),
                    new RegExp(`^(?:export\\s+)?(?:const|let|var)\\s+${escapedName}\\s*=\\s*(?:async\\s+)?function`, 'm'),
                    new RegExp(`^(?:async\\s+)?def\\s+${escapedName}\\s*\\(`, 'm'),
                    new RegExp(`^func\\s+${escapedName}\\s*\\(`, 'm'),
                ];
                break;
            case 'class':
                patterns = [
                    new RegExp(`^(?:export\\s+)?(?:abstract\\s+)?class\\s+${escapedName}`, 'm'),
                    new RegExp(`^class\\s+${escapedName}`, 'm'),
                ];
                break;
            case 'interface':
                patterns = [
                    new RegExp(`^(?:export\\s+)?interface\\s+${escapedName}`, 'm'),
                ];
                break;
            case 'type':
                patterns = [
                    new RegExp(`^(?:export\\s+)?type\\s+${escapedName}\\s*(?:<[^>]*>)?\\s*=`, 'm'),
                    new RegExp(`^type\\s+${escapedName}\\s+(?:struct|interface)`, 'm'),
                ];
                break;
            default:
                patterns = [
                    new RegExp(`\\b${escapedName}\\b`),
                ];
        }
        
        lines.forEach((line, idx) => {
            for (const pattern of patterns) {
                if (pattern.test(line)) {
                    const startLine = Math.max(0, idx - contextLines);
                    const endLine = Math.min(lines.length - 1, idx + contextLines + 20); // Include body
                    
                    results.push({
                        type,
                        name: targetName,
                        location: `Lines ${startLine + 1}-${endLine + 1}`,
                        startLine: startLine + 1,
                        endLine: endLine + 1,
                        content: lines.slice(startLine, endLine + 1).join('\n')
                    });
                    return; // Found, stop searching patterns
                }
            }
        });

        if (results.length === 0) {
            return [];
        }

        return results;
    }

    /**
     * Find usages (references) of an identifier
     */
    findUsages(sourceCode, targetName) {
        const lines = sourceCode.split('\n');
        const usages = [];
        const seenLines = new Set();
        
        if (this.useAST) {
            try {
                const tree = this.parse(sourceCode);
                this._findUsagesInAST(tree.rootNode, targetName, lines, usages, seenLines);
            } catch (e) {
                // Fall back to text search
                return this._findUsagesWithRegex(sourceCode, targetName);
            }
        } else {
            return this._findUsagesWithRegex(sourceCode, targetName);
        }

        return usages;
    }

    /**
     * Find usages in AST
     */
    _findUsagesInAST(node, targetName, lines, usages, seenLines) {
        if (!node) return;

        if (node.type === 'identifier' && node.text === targetName) {
            const lineNum = node.startPosition.row + 1;
            
            if (!seenLines.has(lineNum)) {
                seenLines.add(lineNum);
                
                // Classify usage type
                const parentType = node.parent?.type || '';
                const isDefinition = 
                    parentType === 'function_declaration' ||
                    parentType === 'class_declaration' ||
                    parentType === 'interface_declaration' ||
                    parentType === 'type_alias_declaration' ||
                    parentType === 'variable_declarator';
                
                usages.push({
                    line: lineNum,
                    column: node.startPosition.column + 1,
                    code: lines[node.startPosition.row].trim(),
                    type: isDefinition ? 'definition' : 'usage'
                });
            }
        }

        for (let i = 0; i < node.childCount; i++) {
            this._findUsagesInAST(node.child(i), targetName, lines, usages, seenLines);
        }
    }

    /**
     * Find usages using regex
     */
    _findUsagesWithRegex(sourceCode, targetName) {
        const lines = sourceCode.split('\n');
        const usages = [];
        const escapedName = targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escapedName}\\b`, 'g');
        
        lines.forEach((line, idx) => {
            // Skip comments
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*')) {
                return;
            }
            
            if (regex.test(line)) {
                usages.push({
                    line: idx + 1,
                    code: trimmed
                });
            }
            regex.lastIndex = 0; // Reset regex
        });
        
        return usages;
    }

    /**
     * Replace an element (function/class/interface) with new content
     */
    replaceElement(sourceCode, targetName, type, newContent) {
        if (this.useAST) {
            try {
                const tree = this.parse(sourceCode);
                const node = this._findElementNode(tree.rootNode, targetName, type);
                
                if (node) {
                    return sourceCode.slice(0, node.startIndex) + newContent + sourceCode.slice(node.endIndex);
                }
            } catch (e) {
                // Fall back to regex
            }
        }
        
        // Regex fallback
        return this._replaceElementWithRegex(sourceCode, targetName, type, newContent);
    }

    /**
     * Find element node in AST
     */
    _findElementNode(node, targetName, type) {
        if (!node) return null;

        const lines = [''];  // Dummy for nodeToOutlineItem
        const item = this._nodeToOutlineItem(node, lines);
        
        if (item && item.name === targetName) {
            const typeMatches = (
                (type === 'function' && (item.type === 'function' || item.type === 'method')) ||
                (type === 'method' && (item.type === 'method' || item.type === 'function')) ||
                (type === 'class' && item.type === 'class') ||
                (type === 'interface' && item.type === 'interface') ||
                (type === 'type' && (item.type === 'type' || item.type === 'interface')) ||
                (type === 'enum' && item.type === 'enum') ||
                type === item.type
            );
            
            if (typeMatches) {
                return node;
            }
        }

        for (let i = 0; i < node.childCount; i++) {
            const found = this._findElementNode(node.child(i), targetName, type);
            if (found) return found;
        }

        return null;
    }

    /**
     * Replace element using regex
     */
    _replaceElementWithRegex(sourceCode, targetName, type, newContent) {
        const lines = sourceCode.split('\n');
        const escapedName = targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const lang = this.language;
        
        // Build start patterns for ALL languages
        const startPatterns = [];
        
        switch (type) {
            case 'function':
                // JS/TS: function name, async function name, const name =, export function
                startPatterns.push(new RegExp(`^\\s*(?:export\\s+)?(?:async\\s+)?function\\s+${escapedName}\\b`));
                startPatterns.push(new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${escapedName}\\s*=`));
                // Python: def name
                startPatterns.push(new RegExp(`^\\s*(?:async\\s+)?def\\s+${escapedName}\\s*\\(`));
                // Go: func name
                startPatterns.push(new RegExp(`^\\s*func\\s+${escapedName}\\s*\\(`));
                // Java/C#: public/private/static returnType name(
                startPatterns.push(new RegExp(`^\\s*(?:public|private|protected|static|final|abstract|synchronized|\\w+\\s+)*\\w+\\s+${escapedName}\\s*\\(`));
                break;
            case 'method':
                // JS/TS class method: name( or async name(
                startPatterns.push(new RegExp(`^\\s*(?:async\\s+)?${escapedName}\\s*\\(`));
                startPatterns.push(new RegExp(`^\\s*(?:static\\s+)?(?:async\\s+)?${escapedName}\\s*\\(`));
                // Python: def name(self
                startPatterns.push(new RegExp(`^\\s*(?:async\\s+)?def\\s+${escapedName}\\s*\\(`));
                // Go: func (receiver) name
                startPatterns.push(new RegExp(`^\\s*func\\s+\\([^)]+\\)\\s+${escapedName}\\s*\\(`));
                // Java: public/private type name(
                startPatterns.push(new RegExp(`^\\s*(?:public|private|protected|static|final|abstract|synchronized|\\w+\\s+)*\\w+\\s+${escapedName}\\s*\\(`));
                break;
            case 'class':
                startPatterns.push(new RegExp(`^\\s*(?:export\\s+)?(?:abstract\\s+)?class\\s+${escapedName}\\b`));
                // Python class
                startPatterns.push(new RegExp(`^\\s*class\\s+${escapedName}\\s*[:(]`));
                // Java: public class
                startPatterns.push(new RegExp(`^\\s*(?:public|private|protected|abstract|final|static)?\\s*class\\s+${escapedName}\\b`));
                break;
            case 'interface':
                startPatterns.push(new RegExp(`^\\s*(?:export\\s+)?interface\\s+${escapedName}\\b`));
                // Go/Java interface
                startPatterns.push(new RegExp(`^\\s*(?:public\\s+)?interface\\s+${escapedName}\\b`));
                // Go: type Name interface
                startPatterns.push(new RegExp(`^\\s*type\\s+${escapedName}\\s+interface\\b`));
                break;
            case 'type':
                startPatterns.push(new RegExp(`^\\s*(?:export\\s+)?type\\s+${escapedName}\\b`));
                // Go: type Name struct
                startPatterns.push(new RegExp(`^\\s*type\\s+${escapedName}\\s+`));
                break;
            case 'enum':
                startPatterns.push(new RegExp(`^\\s*(?:export\\s+)?enum\\s+${escapedName}\\b`));
                startPatterns.push(new RegExp(`^\\s*(?:public\\s+)?enum\\s+${escapedName}\\b`));
                break;
            default:
                // Try all common patterns as fallback
                startPatterns.push(new RegExp(`^\\s*(?:export\\s+)?(?:async\\s+)?function\\s+${escapedName}\\b`));
                startPatterns.push(new RegExp(`^\\s*(?:async\\s+)?def\\s+${escapedName}\\s*\\(`));
                startPatterns.push(new RegExp(`^\\s*func\\s+${escapedName}\\s*\\(`));
                startPatterns.push(new RegExp(`^\\s*(?:export\\s+)?class\\s+${escapedName}\\b`));
                startPatterns.push(new RegExp(`^\\s*class\\s+${escapedName}\\s*[:(]`));
                break;
        }
        
        // Find start line using any matching pattern
        let startIdx = -1;
        for (let i = 0; i < lines.length; i++) {
            for (const pattern of startPatterns) {
                if (pattern.test(lines[i])) {
                    startIdx = i;
                    break;
                }
            }
            if (startIdx !== -1) break;
        }
        
        if (startIdx === -1) {
            throw new Error(`Element '${targetName}' of type '${type}' not found.`);
        }
        
        // Detect block style: braces ({}) or indentation (Python)
        const isPythonStyle = lang === 'python' || /^\s*(?:async\s+)?def\s/.test(lines[startIdx]) || /^\s*class\s/.test(lines[startIdx]);
        
        let endIdx = startIdx;
        
        if (isPythonStyle && !lines[startIdx].includes('{')) {
            // Python-style: indentation-based block detection
            const baseIndent = lines[startIdx].match(/^(\s*)/)[1].length;
            
            for (let i = startIdx + 1; i < lines.length; i++) {
                const line = lines[i];
                // Empty lines are part of the block
                if (line.trim() === '') {
                    endIdx = i;
                    continue;
                }
                const indent = line.match(/^(\s*)/)[1].length;
                if (indent <= baseIndent) {
                    // Went back to same or lower indentation - block ended at previous line
                    // Trim trailing empty lines
                    while (endIdx > startIdx && lines[endIdx].trim() === '') endIdx--;
                    break;
                }
                endIdx = i;
            }
        } else {
            // Brace-based block detection (JS/TS/Go/Java/C#)
            let braceCount = 0;
            let foundBrace = false;
            
            for (let i = startIdx; i < lines.length; i++) {
                const line = lines[i];
                for (const char of line) {
                    if (char === '{') { braceCount++; foundBrace = true; }
                    else if (char === '}') { braceCount--; }
                }
                
                if (foundBrace && braceCount === 0) {
                    endIdx = i;
                    break;
                }
            }
        }
        
        // Replace
        const before = lines.slice(0, startIdx).join('\n');
        const after = lines.slice(endIdx + 1).join('\n');
        
        return before + (before ? '\n' : '') + newContent + (after ? '\n' : '') + after;
    }

    /**
     * Extract all imports from file
     */
    extractImports(sourceCode) {
        const imports = [];
        const lines = sourceCode.split('\n');
        
        // Comprehensive import patterns
        const patterns = [
            // ES6 imports
            /^import\s+(?:(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/,
            /^import\s+['"]([^'"]+)['"]/,
            // CommonJS
            /require\s*\(\s*['"]([^'"]+)['"]\s*\)/,
            // Python
            /^from\s+([\w.]+)\s+import/,
            /^import\s+([\w.]+)/,
            // Go
            /^\s*"([^"]+)"/,
            // Java
            /^import\s+([\w.]+);/,
        ];
        
        lines.forEach(line => {
            const trimmed = line.trim();
            for (const pattern of patterns) {
                const match = trimmed.match(pattern);
                if (match) {
                    imports.push(match[1]);
                    break;
                }
            }
        });
        
        return [...new Set(imports)]; // Remove duplicates
    }
}

module.exports = CodeAnalyzer;
