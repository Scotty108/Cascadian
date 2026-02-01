#!/usr/bin/env npx tsx
/**
 * Backfill Supermemory with Cascadian context
 *
 * Strategy: Stay under 200K tokens (~800KB) to leave headroom in 1M free tier
 *
 * Priority tiers:
 * 1. Core docs (CLAUDE.md, RULES.md, key references)
 * 2. Architecture docs (product spec, data architecture)
 * 3. Git history summaries (commits, not full diffs)
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

dotenv.config({ path: '.env.local' });

const API_KEY = process.env.SUPERMEMORY_API_KEY;
const BASE_URL = 'https://api.supermemory.ai/v3';
const CONTAINER_TAG = 'cascadian_codebase';

// Rough estimate: 1 token ≈ 4 chars
const estimateTokens = (text: string) => Math.ceil(text.length / 4);

// Track total tokens
let totalTokens = 0;
const TOKEN_BUDGET = 200_000; // 200K tokens, leaving 800K for ongoing use

interface DocToSync {
  path: string;
  priority: 1 | 2 | 3;
  type: 'doc' | 'git_summary';
  maxTokens?: number;
}

// Priority 1: Essential context (always sync)
const PRIORITY_1_DOCS: DocToSync[] = [
  { path: 'CLAUDE.md', priority: 1, type: 'doc' },
  { path: 'RULES.md', priority: 1, type: 'doc' },
  { path: 'docs/READ_ME_FIRST_PNL.md', priority: 1, type: 'doc' },
  { path: 'docs/systems/database/STABLE_PACK_REFERENCE.md', priority: 1, type: 'doc' },
  { path: 'docs/systems/database/TABLE_RELATIONSHIPS.md', priority: 1, type: 'doc' },
];

// Priority 2: Architecture (sync if budget allows)
const PRIORITY_2_DOCS: DocToSync[] = [
  { path: 'docs/PRODUCT_SPEC.md', priority: 2, type: 'doc' },
  { path: 'docs/architecture/POLYMARKET_DATA_ARCHITECTURE_SPEC.md', priority: 2, type: 'doc' },
  { path: 'docs/operations/DEVELOPMENT_GUIDE.md', priority: 2, type: 'doc' },
  { path: 'docs/operations/NEVER_DO_THIS_AGAIN.md', priority: 2, type: 'doc' },
  { path: 'docs/features/leaderboard-metrics.md', priority: 2, type: 'doc' },
];

// Priority 3: Git history (summarized)
const GIT_SUMMARIES: DocToSync[] = [
  { path: 'git:recent_commits', priority: 3, type: 'git_summary', maxTokens: 10000 },
  { path: 'git:recent_prs', priority: 3, type: 'git_summary', maxTokens: 5000 },
];

async function addDocument(content: string, metadata: Record<string, string>) {
  const tokens = estimateTokens(content);

  if (totalTokens + tokens > TOKEN_BUDGET) {
    console.log(`⚠️  Skipping ${metadata.source} - would exceed budget (${tokens} tokens)`);
    return null;
  }

  const res = await fetch(`${BASE_URL}/documents`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content,
      containerTag: CONTAINER_TAG,
      metadata: {
        ...metadata,
        backfill_date: new Date().toISOString(),
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`❌ Failed to add ${metadata.source}: ${text}`);
    return null;
  }

  totalTokens += tokens;
  const result = await res.json();
  console.log(`✅ Added ${metadata.source} (~${tokens} tokens) - ID: ${result.id}`);
  return result;
}

function readFile(filePath: string): string | null {
  const fullPath = path.join(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) {
    console.log(`⚠️  File not found: ${filePath}`);
    return null;
  }
  return fs.readFileSync(fullPath, 'utf-8');
}

function getRecentCommits(limit = 50): string {
  try {
    const log = execSync(
      `git log --oneline --no-merges -${limit} --format="%h %s"`,
      { encoding: 'utf-8', maxBuffer: 1024 * 1024 }
    );
    return `Recent Git Commits (last ${limit}):\n\n${log}`;
  } catch (e) {
    console.error('Failed to get git commits:', e);
    return '';
  }
}

function getRecentCommitDetails(days = 14): string {
  try {
    const log = execSync(
      `git log --since="${days} days ago" --no-merges --format="## %h - %s%n%nDate: %ai%nAuthor: %an%n%n%b%n---" | head -c 20000`,
      { encoding: 'utf-8', maxBuffer: 1024 * 1024 }
    );
    return `Git Commit Details (last ${days} days):\n\n${log}`;
  } catch (e) {
    console.error('Failed to get commit details:', e);
    return '';
  }
}

function getMajorChangeSummary(): string {
  // Get files changed most frequently in last 30 days
  try {
    const hotFiles = execSync(
      `git log --since="30 days ago" --name-only --pretty=format: | sort | uniq -c | sort -rn | head -20`,
      { encoding: 'utf-8', maxBuffer: 1024 * 1024 }
    );

    const branches = execSync(
      `git branch -a --format='%(refname:short)' | head -10`,
      { encoding: 'utf-8' }
    );

    return `## Codebase Activity Summary

### Most Changed Files (last 30 days):
${hotFiles}

### Active Branches:
${branches}
`;
  } catch (e) {
    return '';
  }
}

async function syncDoc(doc: DocToSync) {
  if (doc.type === 'doc') {
    const content = readFile(doc.path);
    if (!content) return;

    await addDocument(content, {
      source: doc.path,
      type: 'documentation',
      priority: String(doc.priority),
    });
  } else if (doc.type === 'git_summary') {
    let content = '';

    if (doc.path === 'git:recent_commits') {
      content = getRecentCommits(100) + '\n\n' + getMajorChangeSummary();
    } else if (doc.path === 'git:recent_prs') {
      content = getRecentCommitDetails(14);
    }

    if (content && doc.maxTokens) {
      // Truncate to max tokens
      const maxChars = doc.maxTokens * 4;
      if (content.length > maxChars) {
        content = content.slice(0, maxChars) + '\n\n[...truncated]';
      }
    }

    if (content) {
      await addDocument(content, {
        source: doc.path,
        type: 'git_history',
        priority: String(doc.priority),
      });
    }
  }
}

async function main() {
  console.log('🚀 Starting Supermemory backfill for Cascadian\n');
  console.log(`Token budget: ${TOKEN_BUDGET.toLocaleString()} tokens (~${(TOKEN_BUDGET * 4 / 1024).toFixed(0)}KB)\n`);

  // Sync in priority order
  console.log('--- Priority 1: Essential Context ---');
  for (const doc of PRIORITY_1_DOCS) {
    await syncDoc(doc);
  }

  console.log('\n--- Priority 2: Architecture ---');
  for (const doc of PRIORITY_2_DOCS) {
    await syncDoc(doc);
  }

  console.log('\n--- Priority 3: Git History ---');
  for (const doc of GIT_SUMMARIES) {
    await syncDoc(doc);
  }

  console.log('\n========================================');
  console.log(`Total tokens used: ${totalTokens.toLocaleString()} / ${TOKEN_BUDGET.toLocaleString()}`);
  console.log(`Remaining budget: ${(TOKEN_BUDGET - totalTokens).toLocaleString()} tokens`);
  console.log(`Free tier remaining: ~${(1_000_000 - totalTokens).toLocaleString()} tokens`);
  console.log('========================================\n');
}

main().catch(console.error);
