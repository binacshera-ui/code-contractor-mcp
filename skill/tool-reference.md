# Tool Reference - Complete Guide

## Code Contractor MCP Tools

### Reading Tools

#### get_file_outline
**Priority: 1 (ALWAYS USE FIRST)**
```
get_file_outline(path: string)
```
- Returns: function/class names, types, line numbers, signatures
- Token cost: ~50 tokens regardless of file size
- Languages: JS/TS/Python/Go/Java (regex fallback for others)

#### extract_code_element
**Priority: 2 (Use after outline)**
```
extract_code_element(
  path: string,
  element_name: string,
  type: "function" | "class" | "variable",
  context_lines?: number = 5
)
```
- Returns: just the requested element with surrounding context
- Token cost: ~200 tokens (element size + context)

### Writing Tools

#### ast_replace_element
**Priority: 1 FOR WRITING**
```
ast_replace_element(
  path: string,
  element_name: string,
  element_type: "function" | "class",
  new_content: string
)
```
- Finds element by AST (not line numbers!)
- Auto-backup before change
- Languages: JS/TS/Python/Go/Java

#### ast_rename_symbol
**Priority: 1 FOR RENAMING**
```
ast_rename_symbol(
  path: string,
  old_name: string,
  new_name: string,
  symbol_type?: "variable" | "function" | "class" | "any"
)
```
- Renames throughout file using AST
- Scope-aware (won't rename unrelated symbols)

#### ast_add_import
**Priority: 2 FOR IMPORTS**
```
ast_add_import(
  path: string,
  module_source: string,
  named_imports?: string[],
  default_import?: string
)
```
- Adds at correct location
- Won't add duplicates
- Languages: JS/TS/Python

#### insert_at_line
**Priority: 3**
```
insert_at_line(path: string, line_number: number, content: string)
```
- Get line numbers from get_file_outline
- Good for: adding functions, imports at specific locations

#### append_to_file / prepend_to_file
**Priority: 3**
```
append_to_file(path: string, content: string)
prepend_to_file(path: string, content: string)
```
- Simplest operations - just add content

#### insert_relative_to_marker
**Priority: 4**
```
insert_relative_to_marker(
  path: string,
  marker: string,
  position: "before" | "after",
  content: string
)
```
- Find unique text, insert relative to it
- Good for: adding code after specific comments/sections

#### replace_between_markers
**Priority: 5**
```
replace_between_markers(
  path: string,
  start_marker: string,
  end_marker: string,
  content: string,
  include_markers?: boolean = false
)
```
- Replace content between two markers
- Good for: template sections, config blocks

### Search Tools

#### search_code
```
search_code(
  term?: string,
  path?: string = ".",
  mode?: "smart" | "definitions" | "usages" | "imports" | "todos" | "secrets" | "count" | "files",
  regex?: boolean = false,
  case_sensitive?: boolean = false,
  max_results?: number = 50
)
```

**Modes:**
- `smart` - Classifies results as definition/usage/import/call
- `definitions` - Only function/class/variable declarations
- `usages` - Only references (excludes definitions)
- `imports` - Only import/require statements
- `todos` - Find TODO/FIXME/HACK comments
- `secrets` - Find potential hardcoded secrets
- `count` - Just count matches (fastest)
- `files` - List files containing term

#### find_references
```
find_references(element_name: string, path?: string)
```
- Groups by: definitions, imports, calls, references
- Great for refactoring impact analysis

#### find_large_files
```
find_large_files(path?: string, min_lines?: number = 500)
```
- Find files exceeding line threshold
- Identifies refactoring candidates

### Validation Tools

#### lint_code
```
lint_code(code: string, language: string)
```
- Validate code without writing to file
- Multi-layer: syntax + patterns + AST
- Use before writing generated code

### Batch Operations

#### batch_smart_apply
```
batch_smart_apply(operations: [
  {
    type: "ast_replace_element" | "insert_at_line" | "append_to_file" | ...,
    file: string,
    content?: string,
    params?: object
  }
])
```
- Execute multiple operations in sequence
- All backed up before execution

### Backup Tools

#### list_backups
```
list_backups(path: string)
```
- Show all backups for a file

#### show_diff
```
show_diff(current: string, backup?: string, context_lines?: number = 3)
```
- Compare current file with backup
- Uses latest backup if not specified

#### restore_backup
```
restore_backup(file: string, backup?: string, confirm?: boolean = false)
```
- Preview mode by default
- Set confirm=true to actually restore

---

## Cursor Built-in Tools (When to Use)

### Read
- Small files (<100 lines)
- Config files
- When you need complete context

### Write
- Create new files
- Complete file rewrites

### Delete
- Remove files

### StrReplace
**USE SPARINGLY** - requires both old and new content
- Only for: unique one-line changes
- Prefer: AST tools for code, insert tools for additions

### Grep
- Simple text search
- When search_code modes aren't needed

### Shell
- Run commands
- Git operations
- npm/pip commands

### Glob
- Find files by pattern
- Quick file discovery
