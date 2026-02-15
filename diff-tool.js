#!/usr/bin/env node
/**
 * 🔍 MCP Backup & Diff Tool
 * 
 * Simple CLI tool for managing backups and viewing changes.
 * Works with the MCP server's backup system.
 * 
 * Usage:
 *   node diff-tool.js list <file>           - List all backups for a file
 *   node diff-tool.js diff <file> [backup]  - Show diff (latest backup if not specified)
 *   node diff-tool.js restore <file> [backup] - Restore from backup
 *   node diff-tool.js preview <file>        - Interactive preview (list + diff)
 */

const fs = require('fs');
const path = require('path');

const BACKUP_DIR = '.mcp-backups';

// ANSI Colors
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
    bold: '\x1b[1m'
};

function colorize(text, color) {
    return `${colors[color]}${text}${colors.reset}`;
}

/**
 * Find backups for a file
 */
function findBackups(filePath) {
    const dir = path.dirname(filePath);
    const fileName = path.basename(filePath);
    const backupDir = path.join(dir, BACKUP_DIR);
    
    if (!fs.existsSync(backupDir)) {
        return [];
    }
    
    const backups = fs.readdirSync(backupDir)
        .filter(f => f.startsWith(fileName + '.'))
        .map(f => {
            const timestamp = parseInt(f.split('.').pop());
            const fullPath = path.join(backupDir, f);
            const stat = fs.statSync(fullPath);
            return {
                name: f,
                path: fullPath,
                timestamp,
                date: new Date(timestamp),
                size: stat.size
            };
        })
        .sort((a, b) => b.timestamp - a.timestamp);
    
    return backups;
}

/**
 * Generate unified diff between two texts
 */
function generateDiff(oldText, newText, oldName = 'backup', newName = 'current') {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    
    const output = [];
    output.push(colorize(`--- ${oldName}`, 'red'));
    output.push(colorize(`+++ ${newName}`, 'green'));
    
    // Simple line-by-line diff (for visual purposes)
    const maxLines = Math.max(oldLines.length, newLines.length);
    let inHunk = false;
    let hunkStart = -1;
    let hunkLines = [];
    
    for (let i = 0; i < maxLines; i++) {
        const oldLine = oldLines[i];
        const newLine = newLines[i];
        
        if (oldLine === newLine) {
            if (inHunk) {
                // Add context line in hunk
                hunkLines.push(` ${oldLine || ''}`);
            }
        } else {
            if (!inHunk) {
                inHunk = true;
                hunkStart = i;
                // Add some context before
                for (let j = Math.max(0, i - 3); j < i; j++) {
                    hunkLines.push(` ${oldLines[j] || newLines[j] || ''}`);
                }
            }
            
            if (oldLine !== undefined && (newLine === undefined || oldLine !== newLine)) {
                hunkLines.push(colorize(`-${oldLine}`, 'red'));
            }
            if (newLine !== undefined && (oldLine === undefined || oldLine !== newLine)) {
                hunkLines.push(colorize(`+${newLine}`, 'green'));
            }
        }
        
        // Flush hunk after some unchanged lines
        if (inHunk && oldLine === newLine) {
            let contextCount = 0;
            for (let j = i + 1; j < Math.min(i + 4, maxLines); j++) {
                if (oldLines[j] === newLines[j]) contextCount++;
            }
            if (contextCount >= 3 || i === maxLines - 1) {
                output.push(colorize(`@@ -${hunkStart + 1},${hunkLines.filter(l => !l.startsWith('+')).length} +${hunkStart + 1},${hunkLines.filter(l => !l.startsWith('-')).length} @@`, 'cyan'));
                output.push(...hunkLines);
                output.push('');
                inHunk = false;
                hunkLines = [];
            }
        }
    }
    
    // Flush remaining hunk
    if (hunkLines.length > 0) {
        output.push(colorize(`@@ -${hunkStart + 1},${hunkLines.filter(l => !l.startsWith('+')).length} +${hunkStart + 1},${hunkLines.filter(l => !l.startsWith('-')).length} @@`, 'cyan'));
        output.push(...hunkLines);
    }
    
    return output.join('\n');
}

/**
 * List backups command
 */
function listBackups(filePath) {
    const backups = findBackups(filePath);
    
    if (backups.length === 0) {
        console.log(colorize(`No backups found for: ${filePath}`, 'yellow'));
        return;
    }
    
    console.log(colorize(`\n📁 Backups for: ${path.basename(filePath)}`, 'bold'));
    console.log(colorize('─'.repeat(60), 'gray'));
    
    backups.forEach((b, i) => {
        const age = formatAge(b.timestamp);
        const sizeStr = formatSize(b.size);
        const marker = i === 0 ? colorize(' (latest)', 'green') : '';
        
        console.log(`  ${colorize(`[${i + 1}]`, 'cyan')} ${b.date.toLocaleString()}  ${colorize(sizeStr, 'gray')}  ${colorize(age, 'yellow')}${marker}`);
    });
    
    console.log(colorize('─'.repeat(60), 'gray'));
    console.log(`  Total: ${backups.length} backup(s)\n`);
    
    return backups;
}

/**
 * Show diff command
 */
function showDiff(filePath, backupIndex = 0) {
    const backups = findBackups(filePath);
    
    if (backups.length === 0) {
        console.log(colorize(`No backups found for: ${filePath}`, 'yellow'));
        return false;
    }
    
    if (!fs.existsSync(filePath)) {
        console.log(colorize(`Current file not found: ${filePath}`, 'red'));
        return false;
    }
    
    const backup = backups[backupIndex];
    if (!backup) {
        console.log(colorize(`Invalid backup index: ${backupIndex + 1}`, 'red'));
        return false;
    }
    
    const oldContent = fs.readFileSync(backup.path, 'utf8');
    const newContent = fs.readFileSync(filePath, 'utf8');
    
    if (oldContent === newContent) {
        console.log(colorize('\n✓ No changes - files are identical\n', 'green'));
        return true;
    }
    
    console.log(colorize(`\n📊 Changes since: ${backup.date.toLocaleString()}`, 'bold'));
    console.log(colorize('═'.repeat(60), 'gray'));
    console.log(generateDiff(oldContent, newContent, 
        `backup (${formatAge(backup.timestamp)})`,
        'current'));
    console.log(colorize('═'.repeat(60), 'gray'));
    
    // Stats
    const oldLines = oldContent.split('\n').length;
    const newLines = newContent.split('\n').length;
    const added = Math.max(0, newLines - oldLines);
    const removed = Math.max(0, oldLines - newLines);
    
    console.log(`\n  ${colorize(`+${added}`, 'green')} added, ${colorize(`-${removed}`, 'red')} removed\n`);
    
    return true;
}

/**
 * Restore from backup
 */
function restoreBackup(filePath, backupIndex = 0) {
    const backups = findBackups(filePath);
    
    if (backups.length === 0) {
        console.log(colorize(`No backups found for: ${filePath}`, 'yellow'));
        return false;
    }
    
    const backup = backups[backupIndex];
    if (!backup) {
        console.log(colorize(`Invalid backup index: ${backupIndex + 1}`, 'red'));
        return false;
    }
    
    // Create backup of current state before restoring
    if (fs.existsSync(filePath)) {
        const currentContent = fs.readFileSync(filePath, 'utf8');
        const backupDir = path.join(path.dirname(filePath), BACKUP_DIR);
        const newBackupPath = path.join(backupDir, `${path.basename(filePath)}.${Date.now()}`);
        fs.writeFileSync(newBackupPath, currentContent);
        console.log(colorize(`  ✓ Backed up current state`, 'gray'));
    }
    
    // Restore
    const backupContent = fs.readFileSync(backup.path, 'utf8');
    fs.writeFileSync(filePath, backupContent);
    
    console.log(colorize(`\n✓ Restored ${path.basename(filePath)} from backup`, 'green'));
    console.log(colorize(`  Backup date: ${backup.date.toLocaleString()}`, 'gray'));
    console.log('');
    
    return true;
}

/**
 * Interactive preview
 */
function previewFile(filePath) {
    console.log(colorize('\n🔍 MCP Backup Preview', 'bold'));
    console.log(colorize('═'.repeat(60), 'gray'));
    
    const backups = listBackups(filePath);
    
    if (backups && backups.length > 0) {
        console.log(colorize('\n📊 Latest Changes:', 'bold'));
        showDiff(filePath, 0);
    }
    
    console.log(colorize('\nCommands:', 'bold'));
    console.log(`  ${colorize('diff', 'cyan')} <file> [n]     - Show diff with backup #n`);
    console.log(`  ${colorize('restore', 'cyan')} <file> [n]  - Restore from backup #n`);
    console.log('');
}

// Helper functions
function formatAge(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

function formatSize(bytes) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// Export functions for use as a module
module.exports = {
    findBackups,
    generateDiff,
    listBackups,
    showDiff,
    restoreBackup,
    previewFile
};

// CLI (only run if called directly)
if (require.main === module) {
    const args = process.argv.slice(2);
    const command = args[0];
    const targetFile = args[1];

    if (!command) {
        console.log(colorize('\n🔍 MCP Backup & Diff Tool\n', 'bold'));
        console.log('Usage:');
        console.log(`  ${colorize('list', 'cyan')} <file>           - List all backups`);
        console.log(`  ${colorize('diff', 'cyan')} <file> [n]       - Show diff (with backup #n)`);
        console.log(`  ${colorize('restore', 'cyan')} <file> [n]    - Restore from backup #n`);
        console.log(`  ${colorize('preview', 'cyan')} <file>        - Interactive preview`);
        console.log('');
        process.exit(0);
    }

    if (!targetFile) {
        console.log(colorize('Error: Please specify a file path', 'red'));
        process.exit(1);
    }

    const fullPath = path.resolve(targetFile);

    switch (command) {
        case 'list':
        case 'ls':
            listBackups(fullPath);
            break;
        case 'diff':
        case 'd':
            showDiff(fullPath, parseInt(args[2] || '1') - 1);
            break;
        case 'restore':
        case 'r':
            restoreBackup(fullPath, parseInt(args[2] || '1') - 1);
            break;
        case 'preview':
        case 'p':
            previewFile(fullPath);
            break;
        default:
            console.log(colorize(`Unknown command: ${command}`, 'red'));
            process.exit(1);
    }
}
