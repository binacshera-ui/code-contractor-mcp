---
name: token-efficient-dev
description: Professional workflow for token-efficient development using Code Contractor MCP tools and Cursor built-ins. Use when building systems, refactoring code, navigating large codebases, or when the user wants to optimize token usage. Activates for any coding task involving multiple files or complex changes.
---

# Token-Efficient Development Workflow

Master the art of professional AI-assisted development by combining Code Contractor MCP tools with Cursor's native capabilities for maximum efficiency.

## Core Philosophy

**Token cost hierarchy** (cheapest to most expensive):
1. **Structure only** - get_file_outline (~50 tokens)
2. **Targeted extraction** - extract_code_element (~200 tokens)
3. **Surgical edits** - AST tools, insert_at_line (~100 tokens)
4. **Search operations** - search_code, Grep (~300 tokens)
5. **Full file read** - Cursor Read (~1000+ tokens per 100 lines)
6. **String replace** - Cursor StrReplace (~2x content tokens)

## Reading Code - Priority Order

### Step 1: Always Start with Outline
```
get_file_outline(path: "src/server.js")
```
Returns: function names, classes, line numbers (~50 tokens)
**Never read a file without outlining first!**

### Step 2: Extract Only What You Need
```
extract_code_element(
  path: "src/server.js",
  element_name: "handleRequest",
  type: "function"
)
```
Returns: just that function with context (~200 tokens)

### Step 3: Use Cursor Read Only When Necessary
- Small files (<100 lines)
- Need to see imports/structure
- Config files (package.json, etc.)

## Writing Code - Priority Order

### Priority 1: AST Replace (Best)
```
ast_replace_element(
  path: "src/auth.js",
  element_name: "validateToken",
  element_type: "function",
  new_content: "async function validateToken(token) { ... }"
)
```
**Why best:** Only sends new code, finds function by name (not line numbers)

### Priority 2: Insert Operations
```
insert_at_line(path, line_number, content)
append_to_file(path, content)
prepend_to_file(path, content)
ast_add_import(path, module_source, named_imports)
```
**Why good:** Only sends new content

### Priority 3: Marker-Based
```
insert_relative_to_marker(path, marker: "// API Routes", position: "after", content)
replace_between_markers(path, start_marker, end_marker, content)
```
**Why decent:** Short marker + new content

### Priority 4: Line Range (Risky)
```
replace_line_range(path, start_line, end_line, content)
```
**Caution:** Line numbers can shift - only use immediately after reading

### AVOID: Cursor StrReplace
```
StrReplace(path, old_string, new_string)  // EXPENSIVE!
```
**Why avoid:** Requires sending BOTH old AND new content (2x tokens)

## Search Strategy

### For Symbol Lookup
```
search_code(term: "UserService", mode: "definitions")
```
Returns: only definition locations

### For Impact Analysis
```
find_references(element_name: "processPayment")
```
Returns: grouped by type (definitions, imports, calls, references)

### For Code Patterns
```
search_code(term: "TODO|FIXME", mode: "todos")
search_code(term: "password", mode: "secrets")
```

### For Simple Text
Use Cursor's **Grep** - it's fast and efficient for basic searches.

## Professional Workflow Examples

### Example 1: Add Feature to Existing Code

```
1. get_file_outline("src/api/users.js")
   → See: createUser (line 45), getUser (line 78), updateUser (line 112)

2. extract_code_element("src/api/users.js", "createUser", "function")
   → Read just createUser implementation

3. ast_replace_element("src/api/users.js", "createUser", "function", newCode)
   → Replace with enhanced version

4. ast_add_import("src/api/users.js", "./validators", ["validateEmail"])
   → Add new import at correct location
```

**Total: ~400 tokens** vs **~2000+ tokens** with Read + StrReplace

### Example 2: Refactor Across Multiple Files

```
1. find_references(element_name: "oldFunctionName")
   → Get all files using this function

2. For each file:
   - ast_rename_symbol(path, "oldFunctionName", "newFunctionName")
   → Renames intelligently across the file

3. Verify:
   - search_code(term: "oldFunctionName", mode: "count")
   → Should return 0
```

### Example 3: Understand Large Codebase

```
1. find_large_files(path: "src/", min_lines: 300)
   → Identify complex files needing attention

2. For each large file:
   - get_file_outline(path)
   → Map the structure

3. search_code(term: "export", mode: "definitions", path: "src/")
   → Find all public APIs
```

## Tool Selection Matrix

| Task | Best Tool | Avoid |
|------|-----------|-------|
| See file structure | get_file_outline | Read full file |
| Read one function | extract_code_element | Read full file |
| Replace function | ast_replace_element | StrReplace |
| Add import | ast_add_import | StrReplace |
| Rename symbol | ast_rename_symbol | StrReplace |
| Add new code | insert_at_line | StrReplace |
| Find definitions | search_code(mode:"definitions") | Grep + manual filter |
| Find all usages | find_references | Multiple Grep calls |
| Simple text search | Grep | search_code |
| Run commands | Shell | - |
| Create files | Write | - |
| Delete files | Delete | - |

## Code Quality Checks

### Before Committing
```
lint_code(code: generatedCode, language: "typescript")
```
Validates syntax and patterns before writing to file.

### Find Issues
```
search_code(mode: "secrets")  // Security audit
search_code(mode: "todos")    // Pending work
find_large_files(min_lines: 500)  // Refactoring candidates
```

## Batch Operations

For multiple file changes:
```
batch_smart_apply(operations: [
  { type: "ast_replace_element", file: "a.js", params: {...} },
  { type: "append_to_file", file: "b.js", content: "..." },
  { type: "insert_at_line", file: "c.js", params: {...} }
])
```

## Recovery

All file operations create automatic backups in `.mcp-backups/`:
```
list_backups(path: "src/server.js")
show_diff(current: "src/server.js")
restore_backup(file: "src/server.js", confirm: true)
```

## Summary Rules

1. **Outline before reading** - always use get_file_outline first
2. **Extract, don't read** - use extract_code_element for specific code
3. **AST for writing** - prefer ast_replace_element over StrReplace
4. **Search smart** - use modes (definitions, usages, imports)
5. **Batch when possible** - combine operations
6. **Validate before write** - use lint_code for generated code
7. **Trust backups** - every edit is backed up automatically
