#!/usr/bin/env npx tsx

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

interface FileAudit {
  path: string;
  hasConditionIdQuery: boolean;
  hasTokenFilter: boolean;
  needsPatch: boolean;
  lineNumbers: number[];
}

function scanDirectory(dir: string, results: FileAudit[] = [], baseDir = ''): FileAudit[] {
  const entries = readdirSync(dir);
  
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    
    // Skip node_modules, .git, etc.
    if (entry.startsWith('.') || entry === 'node_modules') continue;
    
    if (stat.isDirectory()) {
      scanDirectory(fullPath, results, baseDir || dir);
    } else if (entry.endsWith('.ts') || entry.endsWith('.sql') || entry.endsWith('.md')) {
      const content = readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      
      // Check for condition_id queries
      const hasConditionIdQuery = content.includes('condition_id') && 
                                   (content.includes('FROM default.trades_raw') ||
                                    content.includes('FROM trades_raw') ||
                                    content.includes('JOIN default.trades_raw') ||
                                    content.includes('JOIN trades_raw'));
      
      if (hasConditionIdQuery) {
        // Check for token filter
        const hasTokenFilter = 
          content.includes("length(replaceAll(condition_id, '0x', '')) = 64") ||
          content.includes('length(replaceAll(condition_id, "0x", "")) = 64');
        
        // Find line numbers with condition_id queries
        const lineNumbers: number[] = [];
        lines.forEach((line, i) => {
          if (line.toLowerCase().includes('condition_id') && 
              (line.toLowerCase().includes('from') || line.toLowerCase().includes('where'))) {
            lineNumbers.push(i + 1);
          }
        });
        
        results.push({
          path: fullPath.replace(baseDir || dir, '').replace(/^\//, ''),
          hasConditionIdQuery,
          hasTokenFilter,
          needsPatch: !hasTokenFilter,
          lineNumbers
        });
      }
    }
  }
  
  return results;
}

async function main() {
  console.log('=== TOKEN FILTER AUDIT ===\n');
  
  console.log('Scanning scripts/ directory...\n');
  const scriptsResults = scanDirectory('./scripts');
  
  console.log('Scanning docs/ directory...\n');
  const docsResults = scanDirectory('./docs');
  
  console.log('Scanning lib/ directory...\n');
  const libResults = scanDirectory('./lib');
  
  const allResults = [...scriptsResults, ...docsResults, ...libResults];
  
  const needsPatch = allResults.filter(r => r.needsPatch);
  const hasFilter = allResults.filter(r => !r.needsPatch);
  
  console.log(`--- SUMMARY ---\n`);
  console.log(`Total files with condition_id queries: ${allResults.length}`);
  console.log(`Has token filter: ${hasFilter.length}`);
  console.log(`Needs patch: ${needsPatch.length}\n`);
  
  if (needsPatch.length > 0) {
    console.log(`--- FILES NEEDING PATCH (${needsPatch.length}) ---\n`);
    needsPatch.forEach((file, i) => {
      console.log(`${i + 1}. ${file.path}`);
      console.log(`   Lines with condition_id: ${file.lineNumbers.join(', ')}`);
      console.log(`   Action: Add WHERE length(replaceAll(condition_id, '0x', '')) = 64\n`);
    });
  } else {
    console.log('✅ All files have token filter!\n');
  }
  
  if (hasFilter.length > 0) {
    console.log(`--- FILES WITH FILTER (${hasFilter.length}) ---\n`);
    hasFilter.slice(0, 5).forEach((file, i) => {
      console.log(`${i + 1}. ${file.path} ✓`);
    });
    if (hasFilter.length > 5) {
      console.log(`   ... and ${hasFilter.length - 5} more\n`);
    }
  }
  
  // Save results
  const fs = require('fs');
  fs.writeFileSync('token-filter-audit-results.json', JSON.stringify({
    timestamp: new Date().toISOString(),
    total: allResults.length,
    hasFilter: hasFilter.length,
    needsPatch: needsPatch.length,
    files: allResults
  }, null, 2));
  
  console.log('\nResults saved to: token-filter-audit-results.json\n');
}

main().catch(console.error);
