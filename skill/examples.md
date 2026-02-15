# Workflow Examples

## Example 1: Add Authentication to Existing API

**Task:** Add JWT authentication to an Express API

### Inefficient Approach (2500+ tokens)
```
1. Read("src/server.js")           // 800 tokens
2. Read("src/routes/users.js")     // 600 tokens
3. StrReplace for middleware       // 400 tokens (old+new)
4. StrReplace for route            // 400 tokens (old+new)
5. StrReplace for import           // 300 tokens (old+new)
```

### Efficient Approach (600 tokens)
```
1. get_file_outline("src/server.js")
   → middleware (line 15), routes (line 45)
   
2. ast_add_import("src/server.js", "jsonwebtoken", ["verify"])

3. insert_relative_to_marker(
     "src/server.js",
     marker: "// Middleware",
     position: "after",
     content: "\nconst authMiddleware = (req, res, next) => {...}\n"
   )

4. ast_replace_element(
     "src/routes/users.js",
     "getUser",
     "function",
     "async function getUser(req, res) { /* with auth check */ }"
   )
```

---

## Example 2: Refactor Function Across Codebase

**Task:** Rename `getUserData` to `fetchUserProfile` everywhere

### Inefficient Approach
```
1. Grep for "getUserData"
2. Read each file
3. StrReplace in each file
4. Repeat until done
→ ~5000 tokens for 10 files
```

### Efficient Approach
```
1. find_references(element_name: "getUserData")
   → definitions: [src/api/users.js:45]
   → imports: [src/pages/profile.js:3, src/pages/settings.js:3]
   → calls: [src/components/UserCard.js:23, ...]

2. For definition file:
   ast_rename_symbol("src/api/users.js", "getUserData", "fetchUserProfile")

3. For each import/usage file:
   ast_rename_symbol(file, "getUserData", "fetchUserProfile")

4. Verify: search_code(term: "getUserData", mode: "count")
   → Should return 0
```
→ ~800 tokens total

---

## Example 3: Debug Large File

**Task:** Find and fix bug in 2000-line server.js

### Inefficient Approach
```
1. Read entire file (2000 lines = ~8000 tokens)
2. Read again after change
→ 16000+ tokens
```

### Efficient Approach
```
1. get_file_outline("server.js")
   → See all 50 functions with line numbers (~100 tokens)

2. search_code(term: "error|Error", path: "server.js", mode: "smart")
   → Find error handling locations (~200 tokens)

3. extract_code_element("server.js", "handlePayment", "function")
   → Read just the suspicious function (~300 tokens)

4. ast_replace_element("server.js", "handlePayment", "function", fixedCode)
   → Replace with fix (~200 tokens)
```
→ ~800 tokens total

---

## Example 4: Generate New Feature Module

**Task:** Create a new notification system module

```
1. lint_code(generatedCode, "typescript")
   → Validate before writing

2. Write("src/notifications/index.ts", moduleCode)
   → Create main file

3. ast_add_import(
     "src/server.ts",
     "./notifications",
     ["NotificationService"]
   )

4. insert_relative_to_marker(
     "src/server.ts",
     marker: "// Initialize services",
     position: "after",
     content: "\nconst notifications = new NotificationService();\n"
   )
```

---

## Example 5: Security Audit

**Task:** Find and fix security issues

```
1. search_code(mode: "secrets")
   → Find hardcoded credentials

2. search_code(term: "eval|exec", mode: "smart")
   → Find dangerous functions

3. For each issue:
   - extract_code_element to see context
   - ast_replace_element to fix

4. lint_code to verify fixes
```

---

## Example 6: Understand New Codebase

**Task:** Map unknown project structure

```
1. find_large_files(path: "src/", min_lines: 200)
   → Identify core files

2. For each core file:
   get_file_outline(file)
   → Map functions/classes

3. search_code(term: "export", mode: "definitions")
   → Find public API

4. find_references(element_name: "MainClass")
   → Understand usage patterns
```

---

## Token Savings Summary

| Task | Inefficient | Efficient | Savings |
|------|-------------|-----------|---------|
| Add auth | 2500 | 600 | 76% |
| Rename function | 5000 | 800 | 84% |
| Debug large file | 16000 | 800 | 95% |
| New module | 1500 | 500 | 67% |

**Average savings: 80%+**
