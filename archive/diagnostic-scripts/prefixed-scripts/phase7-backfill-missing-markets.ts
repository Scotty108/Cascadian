import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const CHECKPOINT_FILE = '.phase7-checkpoint.json';
const POLYMARKET_API = 'https://gamma-api.polymarket.com';
const RATE_LIMIT_DELAY = 1000; // 1 second between requests

interface ResolutionData {
  ctf_hex64: string;
  market_hex64: string;
  payout_numerators: number[];
  payout_denominator: number;
  resolved_at: string | null;
  status: 'pending' | 'fetched' | 'inserted' | 'failed';
  error?: string;
  shares: number;
}

interface Checkpoint {
  items: ResolutionData[];
  last_updated: string;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function loadCheckpoint(): Promise<Checkpoint | null> {
  if (existsSync(CHECKPOINT_FILE)) {
    try {
      const data = readFileSync(CHECKPOINT_FILE, 'utf8');
      return JSON.parse(data);
    } catch (e) {
      console.log('⚠️  Checkpoint file corrupted, starting fresh');
      return null;
    }
  }
  return null;
}

function saveCheckpoint(checkpoint: Checkpoint): void {
  checkpoint.last_updated = new Date().toISOString();
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
}

async function fetchPolymarketResolution(ctf_hex64: string, retries = 3): Promise<any> {
  const url = `${POLYMARKET_API}/markets?condition_id=0x${ctf_hex64}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`   Fetching ${ctf_hex64.substring(0, 20)}... (attempt ${attempt}/${retries})`);

      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 404) {
          console.log(`   ⚠️  Market not found (404)`);
          return null;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // Polymarket API returns array of markets
      if (Array.isArray(data) && data.length > 0) {
        const market = data[0];

        // Check if market is resolved
        if (!market.closed || !market.resolved) {
          console.log(`   ⚠️  Market not resolved yet`);
          return null;
        }

        console.log(`   ✅ Found resolved market: ${market.question?.substring(0, 50)}...`);

        return {
          payout_numerators: market.outcome_prices || [],
          payout_denominator: 1,
          resolved_at: market.end_date_iso || new Date().toISOString()
        };
      }

      console.log(`   ⚠️  No markets found in response`);
      return null;

    } catch (error) {
      console.log(`   ❌ Attempt ${attempt} failed: ${error.message}`);

      if (attempt < retries) {
        const backoff = Math.pow(2, attempt) * 1000;
        console.log(`   Waiting ${backoff}ms before retry...`);
        await sleep(backoff);
      } else {
        throw error;
      }
    }
  }

  return null;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PHASE 7: BACKFILL MISSING MARKETS FROM POLYMARKET API');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Step 1: Load or identify missing CTF IDs
  console.log('Step 1: Identifying missing CTF IDs...\n');

  let checkpoint = await loadCheckpoint();

  if (checkpoint) {
    console.log(`   ✅ Loaded checkpoint with ${checkpoint.items.length} items`);
    console.log(`   Last updated: ${checkpoint.last_updated}`);

    const pending = checkpoint.items.filter(i => i.status === 'pending').length;
    const fetched = checkpoint.items.filter(i => i.status === 'fetched').length;
    const inserted = checkpoint.items.filter(i => i.status === 'inserted').length;
    const failed = checkpoint.items.filter(i => i.status === 'failed').length;

    console.log(`   Status: ${pending} pending, ${fetched} fetched, ${inserted} inserted, ${failed} failed\n`);
  } else {
    console.log('   No checkpoint found, querying database...\n');

    const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

    const missingQuery = await clickhouse.query({
      query: `
        WITH burns AS (
          SELECT DISTINCT
            lpad(lower(hex(bitShiftRight(reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))), 8))), 64, '0') AS ctf_hex64,
            sum(toFloat64(reinterpretAsUInt256(reverse(unhex(substring(value, 3))))) / 1e6) AS total_shares
          FROM erc1155_transfers
          WHERE lower(from_address) = lower('${wallet}')
            AND lower(to_address) = '0x0000000000000000000000000000000000000000'
          GROUP BY ctf_hex64
        )
        SELECT
          b.ctf_hex64,
          b.total_shares,
          t.pps,
          length(coalesce(t.pps, [])) AS pps_len
        FROM burns b
        LEFT JOIN token_per_share_payout t ON t.condition_id_ctf = b.ctf_hex64
        WHERE pps_len = 0 OR t.pps IS NULL
        ORDER BY b.total_shares DESC
      `,
      format: 'JSONEachRow'
    });

    const missing: any[] = await missingQuery.json();

    console.log(`   Found ${missing.length} CTF IDs with missing resolution data\n`);

    checkpoint = {
      items: missing.map(m => ({
        ctf_hex64: m.ctf_hex64,
        market_hex64: m.ctf_hex64, // Identity fallback
        payout_numerators: [],
        payout_denominator: 1,
        resolved_at: null,
        status: 'pending' as const,
        shares: Number(m.total_shares)
      })),
      last_updated: new Date().toISOString()
    };

    saveCheckpoint(checkpoint);
    console.log(`   ✅ Checkpoint created\n`);
  }

  // Step 2: Fetch resolution data from Polymarket API
  console.log('Step 2: Fetching resolution data from Polymarket API...\n');

  const pendingItems = checkpoint.items.filter(i => i.status === 'pending');

  if (pendingItems.length === 0) {
    console.log('   ✅ All items already fetched\n');
  } else {
    console.log(`   Processing ${pendingItems.length} items...\n`);

    for (let i = 0; i < pendingItems.length; i++) {
      const item = pendingItems[i];

      console.log(`\n   [${i + 1}/${pendingItems.length}] CTF: ${item.ctf_hex64.substring(0, 20)}... (${item.shares.toLocaleString()} shares)`);

      try {
        const resolution = await fetchPolymarketResolution(item.ctf_hex64);

        if (resolution) {
          item.payout_numerators = resolution.payout_numerators;
          item.payout_denominator = resolution.payout_denominator;
          item.resolved_at = resolution.resolved_at;
          item.status = 'fetched';

          console.log(`   ✅ Fetched: [${item.payout_numerators.join(', ')}] / ${item.payout_denominator}`);
        } else {
          item.status = 'failed';
          item.error = 'Market not found or not resolved';

          console.log(`   ⚠️  Skipping: ${item.error}`);
        }

        saveCheckpoint(checkpoint);

        // Rate limit protection
        await sleep(RATE_LIMIT_DELAY);

      } catch (error) {
        item.status = 'failed';
        item.error = error.message;

        console.log(`   ❌ Failed: ${error.message}`);
        saveCheckpoint(checkpoint);
      }
    }

    console.log('\n   ✅ Fetch phase complete\n');
  }

  // Step 3: Insert into market_resolutions_final
  console.log('Step 3: Inserting resolution data into ClickHouse...\n');

  const fetchedItems = checkpoint.items.filter(i => i.status === 'fetched');

  if (fetchedItems.length === 0) {
    console.log('   ⚠️  No items to insert\n');
  } else {
    console.log(`   Inserting ${fetchedItems.length} markets...\n`);

    for (const item of fetchedItems) {
      try {
        console.log(`   Inserting ${item.ctf_hex64.substring(0, 20)}...`);

        await clickhouse.command({
          query: `
            INSERT INTO market_resolutions_final (
              condition_id_norm,
              payout_numerators,
              payout_denominator,
              resolved_at
            ) VALUES (
              '${item.market_hex64}',
              [${item.payout_numerators.join(', ')}],
              ${item.payout_denominator},
              ${item.resolved_at ? `'${item.resolved_at}'` : 'NULL'}
            )
          `
        });

        item.status = 'inserted';
        saveCheckpoint(checkpoint);

        console.log(`   ✅ Inserted`);

      } catch (error) {
        console.log(`   ❌ Insert failed: ${error.message}`);
        item.error = `Insert failed: ${error.message}`;
        saveCheckpoint(checkpoint);
      }
    }

    console.log('\n   ✅ Insert phase complete\n');
  }

  // Step 4: Summary
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PHASE 7 SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const inserted = checkpoint.items.filter(i => i.status === 'inserted').length;
  const failed = checkpoint.items.filter(i => i.status === 'failed').length;
  const pending = checkpoint.items.filter(i => i.status === 'pending' || i.status === 'fetched').length;

  console.log(`   Total CTF IDs processed: ${checkpoint.items.length}`);
  console.log(`   ✅ Successfully inserted: ${inserted}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   ⏳ Pending: ${pending}\n`);

  if (inserted > 0) {
    console.log('   🎯 Next steps:');
    console.log('   1. Re-run Phase 3 (PPS rebuild): npx tsx phase3-rebuild-pps.ts');
    console.log('   2. Re-run Phase 4 (Burns valuation): npx tsx phase4-burns-valuation.ts');
    console.log('   3. Check if gap is closed\n');
  }

  if (failed > 0) {
    console.log('   ⚠️  Failed items:');
    checkpoint.items.filter(i => i.status === 'failed').forEach((item, i) => {
      console.log(`   ${i + 1}. ${item.ctf_hex64.substring(0, 20)}... - ${item.error}`);
    });
    console.log();
  }

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
