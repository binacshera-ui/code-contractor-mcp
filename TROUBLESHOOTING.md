# Troubleshooting Guide

## Common Issues

### 1. "Missing program", "Missing identifier" errors in lint

**Symptom:** Linter returns hundreds of "Missing X" errors on valid code.

**Cause:** Tree-sitter 0.20.x API difference - `node.isMissing` is a **function**, not a property.

**Fix:**
```javascript
// WRONG
if (node.isMissing) { ... }

// CORRECT
const isMissing = typeof node.isMissing === 'function' ? node.isMissing() : false;
if (isMissing) { ... }
```

### 2. "node.childForFieldName is not a function"

**Symptom:** AST operations fail with this error.

**Cause:** Tree-sitter 0.20.x uses direct property access instead of `childForFieldName()`.

**Fix:**
```javascript
// WRONG
const body = node.childForFieldName('body');

// CORRECT
const body = node.bodyNode; // Direct property access
// OR use helper:
const getField = (node, fieldName) => {
    const propName = fieldName + 'Node';
    if (node[propName]) return node[propName];
    if (typeof node.childForFieldName === 'function') {
        return node.childForFieldName(fieldName);
    }
    return null;
};
```

### 3. Windows paths not working

**Symptom:** "File not found" or "Path outside workspace" errors.

**Cause:** Server runs in Linux Docker container.

**Fix:**
```javascript
// WRONG
"C:\\Users\\me\\project\\file.js"

// CORRECT
"/workspace/project/file.js"
// or relative:
"project/file.js"
```

### 4. Duplicate results from extractElement

**Symptom:** Same code element returned multiple times.

**Cause:** AST query returns multiple matches without deduplication.

**Fix:**
```javascript
const seenLocations = new Set();
matches.forEach(match => {
    const locationKey = `${node.startPosition.row}:${node.endPosition.row}`;
    if (seenLocations.has(locationKey)) return;
    seenLocations.add(locationKey);
    // ... process result
});
```

### 5. Changes not taking effect

**Symptom:** Fixed code but server still behaves the same.

**Cause:** Docker container hasn't been rebuilt/restarted.

**Fix:**
```bash
# Rebuild Docker image
docker build -t code-contractor-mcp .

# Or restart container
docker restart <container_id>
```

## Debugging Tips

### Check Tree-sitter Node Properties
```javascript
const node = tree.rootNode.child(0);
console.log('Available fields:', node.fields);
console.log('isMissing type:', typeof node.isMissing);
console.log('childCount:', node.childCount);
```

### Check File Paths
```javascript
const resolved = path.resolve(WORKSPACE_ROOT, inputPath);
console.log('Resolved path:', resolved);
console.log('Exists:', fs.existsSync(resolved));
```

## Tree-sitter 0.20.x Field Names

| Node Type | Properties |
|-----------|------------|
| function_declaration | `nameNode`, `parametersNode`, `bodyNode` |
| class_declaration | `nameNode`, `bodyNode` |
| variable_declarator | `nameNode`, `valueNode` |
| if_statement | `conditionNode`, `consequenceNode`, `alternativeNode` |
