#!/usr/bin/env npx tsx
/**
 * Setup Supermemory GitHub Connector
 *
 * Usage:
 *   npx tsx scripts/setup-supermemory-github.ts
 *
 * This script will:
 * 1. Create a GitHub connection (get OAuth link)
 * 2. After you complete OAuth, list available repos
 * 3. Configure which repos to sync
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const API_KEY = process.env.SUPERMEMORY_API_KEY;
const BASE_URL = 'https://api.supermemory.ai/v3';

if (!API_KEY) {
  console.error('❌ SUPERMEMORY_API_KEY not found in environment');
  process.exit(1);
}

async function apiCall(endpoint: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }

  return res.json();
}

async function createGitHubConnection() {
  console.log('📡 Creating GitHub connection...\n');

  const connection = await apiCall('/connections', {
    method: 'POST',
    body: JSON.stringify({
      provider: 'github',
      redirectUrl: 'https://cascadian.vercel.app/auth/callback',
      containerTags: ['cascadian', 'github-sync'],
      metadata: {
        source: 'cascadian-setup-script',
        createdAt: new Date().toISOString(),
      }
    }),
  });

  console.log('✅ Connection created!');
  console.log(`   Connection ID: ${connection.id}`);
  console.log(`   Expires in: ${connection.expiresIn}s\n`);
  console.log('🔗 Open this URL to authorize GitHub:\n');
  console.log(`   ${connection.authLink}\n`);
  console.log('After authorizing, run this script again with the connection ID:');
  console.log(`   npx tsx scripts/setup-supermemory-github.ts --list-repos ${connection.id}\n`);

  return connection;
}

async function listRepos(connectionId: string) {
  console.log(`📂 Fetching repos for connection ${connectionId}...\n`);

  const { resources } = await apiCall(`/connections/${connectionId}/resources?page=1&per_page=100`);

  console.log('Available repositories:\n');
  resources.forEach((repo: any, i: number) => {
    console.log(`  ${i + 1}. ${repo.name || repo.id}`);
  });

  console.log('\nTo sync specific repos, run:');
  console.log(`   npx tsx scripts/setup-supermemory-github.ts --sync ${connectionId} repo1,repo2\n`);

  return resources;
}

async function syncRepos(connectionId: string, repoIds: string[]) {
  console.log(`🔄 Configuring sync for ${repoIds.length} repos...\n`);

  const result = await apiCall(`/connections/${connectionId}/configure`, {
    method: 'POST',
    body: JSON.stringify({
      resources: repoIds,
    }),
  });

  console.log('✅ Sync configured!');
  console.log(`   Success: ${result.success}`);

  return result;
}

async function listConnections() {
  console.log('📋 Listing existing connections...\n');

  const { connections } = await apiCall('/connections');

  if (!connections || connections.length === 0) {
    console.log('No connections found.\n');
    return [];
  }

  connections.forEach((conn: any, i: number) => {
    console.log(`  ${i + 1}. [${conn.provider}] ${conn.id}`);
    console.log(`     Status: ${conn.status}`);
    console.log(`     Created: ${conn.createdAt}\n`);
  });

  return connections;
}

// Main
const args = process.argv.slice(2);

(async () => {
  try {
    if (args[0] === '--list') {
      await listConnections();
    } else if (args[0] === '--list-repos' && args[1]) {
      await listRepos(args[1]);
    } else if (args[0] === '--sync' && args[1] && args[2]) {
      const repoIds = args[2].split(',');
      await syncRepos(args[1], repoIds);
    } else {
      // Default: create new connection
      console.log('Supermemory GitHub Connector Setup\n');
      console.log('Commands:');
      console.log('  (no args)           - Create new GitHub connection');
      console.log('  --list              - List existing connections');
      console.log('  --list-repos <id>   - List repos for a connection');
      console.log('  --sync <id> <repos> - Sync specific repos (comma-separated)\n');

      await createGitHubConnection();
    }
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
})();
