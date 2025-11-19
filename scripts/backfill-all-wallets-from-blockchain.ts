#!/usr/bin/env tsx
/**
 * Phase 2: Backfill ALL Wallets from Blockchain Data
 * Extracts all unique wallets from blockchain tables, then backfills their API data
 *
 * Strategy:
 * 1. Get ALL unique wallets from vw_trades_canonical (blockchain data)
 * 2. For each wallet, fetch positions from Data API
 * 3. Store in api_positions_staging
 * 4. This gives COMPLETE coverage for any wallet that traded on-chain
 *
 * Runtime: 2-4 hours (depending on wallet count and rate limits)
 * Expected: 10K-50K unique wallets
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

// Configuration
const BATCH_SIZE = 100; // Process 100 wallets at a time
const RATE_LIMIT_MS = 100; // 100ms between API calls
const CHECKPOINT_INTERVAL = 500; // Save checkpoint every 500 wallets

interface Position {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  outcome: string;
  outcomeIndex: number;
}

interface Checkpoint {
  lastProcessedWallet: string;
  walletsProcessed: number;
  positionsInserted: number;
  timestamp: Date;
}

// ============================================================================
// CHECKPOINT MANAGEMENT
// ============================================================================

function loadCheckpoint(): Checkpoint | null {
  try {
    const fs = require('fs');
    const data = fs.readFileSync('backfill-wallets-checkpoint.json', 'utf8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function saveCheckpoint(checkpoint: Checkpoint): void {
  const fs = require('fs');
  fs.writeFileSync('backfill-wallets-checkpoint.json', JSON.stringify(checkpoint, null, 2));
}

// ============================================================================
// WALLET EXTRACTION
// ============================================================================

async function getAllWallets(resumeFrom?: string): Promise<string[]> {
  console.log('\n📊 Extracting ALL unique wallets from blockchain data...');

  const query = resumeFrom
    ? `
      SELECT DISTINCT lower(wallet_address_norm) as wallet
      FROM default.vw_trades_canonical
      WHERE lower(wallet_address_norm) > '${resumeFrom}'
      ORDER BY wallet
    `
    : `
      SELECT DISTINCT lower(wallet_address_norm) as wallet
      FROM default.vw_trades_canonical
      ORDER BY wallet
    `;

  const result = await ch.query({
    query,
    format: 'JSONEachRow',
  });

  const data = await result.json<{ wallet: string }>();
  const wallets = data.map(row => row.wallet);

  console.log(`  ✅ Found ${wallets.length} unique wallets${resumeFrom ? ' (resuming)' : ''}`);

  return wallets;
}

// ============================================================================
// API FETCHING
// ============================================================================

async function fetchPositions(wallet: string): Promise<Position[]> {
  const allPositions: Position[] = [];
  let offset = 0;
  const limit = 500;

  try {
    while (true) {
      const params = new URLSearchParams({
        user: wallet.toLowerCase(),
        limit: String(limit),
        offset: String(offset),
      });

      const url = `https://data-api.polymarket.com/positions?${params}`;
      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 404) {
          // No positions for this wallet
          break;
        }
        console.error(`  ⚠️  API error for ${wallet}: ${response.status}`);
        break;
      }

      const positions: Position[] = await response.json();

      if (positions.length === 0) {
        break;
      }

      allPositions.push(...positions);

      if (positions.length < limit) {
        break;
      }

      offset += limit;
    }
  } catch (error) {
    console.error(`  ⚠️  Error fetching positions for ${wallet}:`, error);
  }

  return allPositions;
}

// ============================================================================
// CLICKHOUSE INSERTION
// ============================================================================

async function insertPositions(wallet: string, positions: Position[]): Promise<void> {
  if (positions.length === 0) {
    return;
  }

  const rows = positions.map(p => ({
    wallet_address: wallet.toLowerCase(),
    market: '',
    condition_id: p.conditionId?.toLowerCase().replace('0x', '') || '',
    asset_id: p.asset?.toLowerCase() || '',
    outcome: p.outcomeIndex ?? 0,
    size: p.size ?? 0,
    entry_price: p.avgPrice || null,
    timestamp: new Date(),
  })).filter(r => r.condition_id); // Filter out invalid entries

  if (rows.length === 0) {
    return;
  }

  await ch.insert({
    table: 'default.api_positions_staging',
    values: rows,
    format: 'JSONEachRow',
  });
}

// ============================================================================
// MAIN BACKFILL LOOP
// ============================================================================

async function backfillAllWallets(): Promise<void> {
  console.log('\n' + '═'.repeat(80));
  console.log('🚀 GLOBAL WALLET BACKFILL - ALL BLOCKCHAIN WALLETS');
  console.log('═'.repeat(80));

  // Load checkpoint if exists
  const checkpoint = loadCheckpoint();
  const resumeFrom = checkpoint?.lastProcessedWallet;

  if (resumeFrom) {
    console.log(`\n📍 Resuming from wallet: ${resumeFrom}`);
    console.log(`   Already processed: ${checkpoint.walletsProcessed} wallets`);
    console.log(`   Already inserted: ${checkpoint.positionsInserted} positions`);
  }

  // Get all wallets
  const wallets = await getAllWallets(resumeFrom);

  if (wallets.length === 0) {
    console.log('\n✅ All wallets already processed!');
    return;
  }

  let walletsProcessed = checkpoint?.walletsProcessed || 0;
  let positionsInserted = checkpoint?.positionsInserted || 0;
  let errors = 0;

  console.log(`\n🔄 Starting backfill for ${wallets.length} wallets...`);
  console.log(`   Batch size: ${BATCH_SIZE}`);
  console.log(`   Rate limit: ${RATE_LIMIT_MS}ms between calls`);
  console.log('');

  // Process in batches
  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];

    try {
      // Fetch positions
      const positions = await fetchPositions(wallet);

      // Insert into ClickHouse
      if (positions.length > 0) {
        await insertPositions(wallet, positions);
        positionsInserted += positions.length;
      }

      walletsProcessed++;

      // Progress update
      if (walletsProcessed % 10 === 0) {
        const pct = ((walletsProcessed / (wallets.length + (checkpoint?.walletsProcessed || 0))) * 100).toFixed(1);
        console.log(`  Progress: ${walletsProcessed} wallets | ${positionsInserted} positions | ${pct}% | Errors: ${errors}`);
      }

      // Checkpoint
      if (walletsProcessed % CHECKPOINT_INTERVAL === 0) {
        saveCheckpoint({
          lastProcessedWallet: wallet,
          walletsProcessed: walletsProcessed + (checkpoint?.walletsProcessed || 0),
          positionsInserted,
          timestamp: new Date(),
        });
        console.log(`  💾 Checkpoint saved`);
      }

      // Rate limiting
      await new Promise(r => setTimeout(r, RATE_LIMIT_MS));

    } catch (error) {
      console.error(`  ❌ Error processing ${wallet}:`, error);
      errors++;

      if (errors > 100) {
        console.error('\n❌ Too many errors, stopping backfill');
        break;
      }
    }
  }

  // Final checkpoint
  saveCheckpoint({
    lastProcessedWallet: wallets[wallets.length - 1],
    walletsProcessed: walletsProcessed + (checkpoint?.walletsProcessed || 0),
    positionsInserted,
    timestamp: new Date(),
  });

  console.log('\n' + '═'.repeat(80));
  console.log('✅ GLOBAL WALLET BACKFILL COMPLETE');
  console.log('═'.repeat(80));
  console.log(`\nStatistics:`);
  console.log(`  Wallets processed: ${walletsProcessed}`);
  console.log(`  Positions inserted: ${positionsInserted}`);
  console.log(`  Errors: ${errors}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Run create-unified-trades-view.ts to combine blockchain + API`);
  console.log(`  2. ANY wallet can now query complete data`);
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  try {
    await backfillAllWallets();
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    throw error;
  } finally {
    await ch.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
