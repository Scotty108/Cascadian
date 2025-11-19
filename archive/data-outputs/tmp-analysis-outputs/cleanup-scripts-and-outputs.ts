#!/usr/bin/env npx tsx
/**
 * Phase 2B: Cleanup Scripts and Output Files
 * Organizes .ts, .txt, .sql, .json, .csv files from root
 */

import { readdirSync, statSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

// Files to keep in root (config files)
const keepInRoot = [
  // Config files
  'next.config.mjs',
  'next-env.d.ts',
  'postcss.config.js',
  'tailwind.config.ts',
  'tsconfig.json',
  'tsconfig.tsbuildinfo',
  'vitest.config.ts',
  'jest.config.js',
  // Package files
  'package.json',
  'package-lock.json',
  // Vercel
  'vercel.json',
  '.vercelignore',
];

// Get all files by extension
function getFilesByExtension(ext: string): string[] {
  try {
    return readdirSync('.')
      .filter(f => f.endsWith(ext) && statSync(f).isFile())
      .filter(f => !keepInRoot.includes(f));
  } catch {
    return [];
  }
}

const tsFiles = getFilesByExtension('.ts');
const txtFiles = getFilesByExtension('.txt');
const sqlFiles = getFilesByExtension('.sql');
const jsonFiles = getFilesByExtension('.json');
const csvFiles = getFilesByExtension('.csv');

console.log(`\n📊 Files to Organize:`);
console.log(`.ts scripts: ${tsFiles.length}`);
console.log(`.txt outputs: ${txtFiles.length}`);
console.log(`.sql queries: ${sqlFiles.length}`);
console.log(`.json data: ${jsonFiles.length}`);
console.log(`.csv data: ${csvFiles.length}`);
console.log(`Total: ${tsFiles.length + txtFiles.length + sqlFiles.length + jsonFiles.length + csvFiles.length}`);

// Categorization
const moves: { file: string; dest: string }[] = [];

// .ts files -> scripts/
tsFiles.forEach(file => {
  // Check if it looks like an investigation/debug script
  if (
    file.match(/^\d+-/) || // Numbered scripts (01-, 02-, etc.)
    file.includes('check-') ||
    file.includes('verify-') ||
    file.includes('analyze-') ||
    file.includes('test-') ||
    file.includes('debug-') ||
    file.includes('diagnose-') ||
    file.includes('investigate-') ||
    file.includes('tmp-') ||
    file.includes('tmp_') ||
    file.includes('backfill-') ||
    file.includes('build-') ||
    file.includes('create-') ||
    file.includes('fix-') ||
    file.includes('fetch-') ||
    file.includes('query-') ||
    file.includes('validate-') ||
    file.includes('compare-')
  ) {
    moves.push({ file, dest: 'scripts' });
  } else {
    // Other .ts files also go to scripts
    moves.push({ file, dest: 'scripts' });
  }
});

// .txt files -> scripts/outputs/
txtFiles.forEach(file => {
  moves.push({ file, dest: 'scripts/outputs' });
});

// .sql files -> scripts/sql/
sqlFiles.forEach(file => {
  moves.push({ file, dest: 'scripts/sql' });
});

// .json files -> scripts/outputs/ (unless it's package-related)
jsonFiles.forEach(file => {
  if (!file.includes('package')) {
    moves.push({ file, dest: 'scripts/outputs' });
  }
});

// .csv files -> scripts/outputs/
csvFiles.forEach(file => {
  moves.push({ file, dest: 'scripts/outputs' });
});

// Group by destination
const byDestination = new Map<string, string[]>();
moves.forEach(({ file, dest }) => {
  if (!byDestination.has(dest)) byDestination.set(dest, []);
  byDestination.get(dest)!.push(file);
});

console.log(`\n📦 Move Plan:`);
byDestination.forEach((files, dest) => {
  console.log(`${dest}: ${files.length} files`);
});

// Execute moves
console.log(`\n🚀 Executing moves...`);
let movedCount = 0;
let errorCount = 0;

byDestination.forEach((files, dest) => {
  console.log(`\n📁 ${dest} (${files.length} files)`);

  files.forEach(file => {
    try {
      const targetPath = join(dest, file);

      // Check if file already exists in destination
      if (existsSync(targetPath)) {
        console.log(`   ⚠️  Already exists: ${file} (skipping)`);
        return;
      }

      execSync(`mv "${file}" "${targetPath}"`, { stdio: 'pipe' });
      movedCount++;
    } catch (error) {
      console.log(`   ❌ ${file}: ${error}`);
      errorCount++;
    }
  });

  console.log(`   ✅ Moved ${files.length - errorCount} files`);
});

console.log(`\n✨ Cleanup Complete!`);
console.log(`Moved: ${movedCount} files`);
console.log(`Errors: ${errorCount} files`);

// Verify
const remainingTs = getFilesByExtension('.ts');
const remainingTxt = getFilesByExtension('.txt');
const remainingSql = getFilesByExtension('.sql');
const remainingJson = getFilesByExtension('.json');
const remainingCsv = getFilesByExtension('.csv');

console.log(`\n📊 Root Directory After Cleanup:`);
console.log(`.ts files: ${remainingTs.length} (should be 0-2)`);
console.log(`.txt files: ${remainingTxt.length} (should be 0)`);
console.log(`.sql files: ${remainingSql.length} (should be 0)`);
console.log(`.json files: ${remainingJson.length} (should be 0-2, package files only)`);
console.log(`.csv files: ${remainingCsv.length} (should be 0)`);

if (remainingTs.length > 0) {
  console.log(`\nRemaining .ts files:`);
  remainingTs.forEach(f => console.log(`   - ${f}`));
}

console.log(`\n✅ Phase 2B Complete - All scripts and outputs organized`);
