import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const CHECKPOINT_FILE = '.phase7-step2-checkpoint.json';
const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';
const RATE_LIMIT_DELAY = 1000; // 1s between requests
const CONCURRENCY = 3;

interface TargetCTF {
  ctf64: string;
  total_shares: number;
  status: 'pending' | 'resolved' | 'unresolved' | 'failed';
  payout_numerators?: number[];
  payout_denominator?: number;
  resolved_at?: string;
  error?: string;
  attempts: {
    strategy: string;
    result: string;
    timestamp: string;
  }[];
}

interface Checkpoint {
  targets: TargetCTF[];
  last_updated: string;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(res => setTimeout(res, ms));
}

function loadCheckpoint(): Checkpoint | null {
  if (existsSync(CHECKPOINT_FILE)) {
    try {
      return JSON.parse(readFileSync(CHECKPOINT_FILE, 'utf8'));
    } catch (e) {
      console.log('⚠️  Checkpoint corrupted, starting fresh');
      return null;
    }
  }
  return null;
}

function saveCheckpoint(checkpoint: Checkpoint): void {
  checkpoint.last_updated = new Date().toISOString();
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
}

// Strategy 1: Query Gamma API by condition_id
async function tryGammaByCondition(ctf64: string): Promise<any> {
  const url = `${GAMMA_API}/markets?condition_id=0x${ctf64}`;
  const response = await fetch(url);

  if (!response.ok) return null;

  const data = await response.json();

  if (Array.isArray(data) && data.length > 0) {
    const market = data[0];

    if (market.closed && market.resolved && market.outcome_prices) {
      return {
        payout_numerators: market.outcome_prices,
        payout_denominator: 1,
        resolved_at: market.end_date_iso || new Date().toISOString()
      };
    }
  }

  return null;
}

// Strategy 2: Query CLOB API markets endpoint
async function tryClobMarkets(ctf64: string): Promise<any> {
  const url = `${CLOB_API}/markets/${ctf64}`;
  const response = await fetch(url);

  if (!response.ok) return null;

  const market = await response.json();

  if (market.closed && market.resolved && market.outcome_prices) {
    return {
      payout_numerators: market.outcome_prices,
      payout_denominator: 1,
      resolved_at: market.end_date_iso || new Date().toISOString()
    };
  }

  return null;
}

// Strategy 3: Check if CTF is actually a proxy for another market ID
async function tryBridgeLookup(ctf64: string): Promise<string | null> {
  const result = await clickhouse.query({
    query: `
      SELECT market_hex64, source
      FROM ctf_to_market_bridge_mat
      WHERE lower(ctf_hex64) = lower('${ctf64}')
        AND source != 'erc1155_identity'
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });

  const rows: any[] = await result.json();

  if (rows.length > 0 && rows[0].market_hex64 !== ctf64) {
    return rows[0].market_hex64;
  }

  return null;
}

async function processTarget(target: TargetCTF): Promise<void> {
  console.log(`\n[${target.ctf64.substring(0, 20)}...] ${target.total_shares.toLocaleString()} shares`);

  // Strategy 1: Gamma API by condition_id
  try {
    console.log('   Strategy 1: Gamma API by condition_id...');
    const result = await tryGammaByCondition(target.ctf64);

    target.attempts.push({
      strategy: 'gamma_by_condition',
      result: result ? 'found' : 'not_found',
      timestamp: new Date().toISOString()
    });

    if (result) {
      target.status = 'resolved';
      target.payout_numerators = result.payout_numerators;
      target.payout_denominator = result.payout_denominator;
      target.resolved_at = result.resolved_at;
      console.log(`   ✅ Resolved: [${result.payout_numerators.join(', ')}] / ${result.payout_denominator}`);
      return;
    }

    console.log('   ❌ Not found');
  } catch (error) {
    console.log(`   ⚠️  Error: ${error.message}`);
    target.attempts.push({
      strategy: 'gamma_by_condition',
      result: `error: ${error.message}`,
      timestamp: new Date().toISOString()
    });
  }

  await sleep(RATE_LIMIT_DELAY);

  // Strategy 2: CLOB markets endpoint
  try {
    console.log('   Strategy 2: CLOB markets endpoint...');
    const result = await tryClobMarkets(target.ctf64);

    target.attempts.push({
      strategy: 'clob_markets',
      result: result ? 'found' : 'not_found',
      timestamp: new Date().toISOString()
    });

    if (result) {
      target.status = 'resolved';
      target.payout_numerators = result.payout_numerators;
      target.payout_denominator = result.payout_denominator;
      target.resolved_at = result.resolved_at;
      console.log(`   ✅ Resolved: [${result.payout_numerators.join(', ')}] / ${result.payout_denominator}`);
      return;
    }

    console.log('   ❌ Not found');
  } catch (error) {
    console.log(`   ⚠️  Error: ${error.message}`);
    target.attempts.push({
      strategy: 'clob_markets',
      result: `error: ${error.message}`,
      timestamp: new Date().toISOString()
    });
  }

  await sleep(RATE_LIMIT_DELAY);

  // Strategy 3: Bridge lookup (check if there's a non-identity mapping)
  try {
    console.log('   Strategy 3: Bridge lookup...');
    const altMarketId = await tryBridgeLookup(target.ctf64);

    if (altMarketId) {
      console.log(`   Found alt market ID: ${altMarketId.substring(0, 20)}...`);
      console.log('   Trying Gamma API with alt ID...');

      const result = await tryGammaByCondition(altMarketId);

      target.attempts.push({
        strategy: 'bridge_lookup',
        result: result ? `found_via_${altMarketId.substring(0, 10)}` : 'not_found',
        timestamp: new Date().toISOString()
      });

      if (result) {
        target.status = 'resolved';
        target.payout_numerators = result.payout_numerators;
        target.payout_denominator = result.payout_denominator;
        target.resolved_at = result.resolved_at;
        console.log(`   ✅ Resolved: [${result.payout_numerators.join(', ')}] / ${result.payout_denominator}`);
        return;
      }

      console.log('   ❌ Alt ID also not resolved');
    } else {
      console.log('   ❌ No alt market ID in bridge');
      target.attempts.push({
        strategy: 'bridge_lookup',
        result: 'no_alt_id',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.log(`   ⚠️  Error: ${error.message}`);
    target.attempts.push({
      strategy: 'bridge_lookup',
      result: `error: ${error.message}`,
      timestamp: new Date().toISOString()
    });
  }

  // All strategies failed
  target.status = 'unresolved';
  console.log('   ⚠️  Market unresolved - all strategies exhausted');
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PHASE 7.2: COMPREHENSIVE BACKFILL (MULTI-STRATEGY)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load or create checkpoint
  let checkpoint = loadCheckpoint();

  if (!checkpoint) {
    console.log('Creating checkpoint from phase7_missing_ctf64...\n');

    const csv = readFileSync('tmp/phase7_missing_ctf64.csv', 'utf8');
    const lines = csv.split('\n').slice(1).filter(l => l.trim());

    checkpoint = {
      targets: lines.map(l => {
        const [ctf64, shares] = l.split(',');
        return {
          ctf64,
          total_shares: parseFloat(shares),
          status: 'pending' as const,
          attempts: []
        };
      }),
      last_updated: new Date().toISOString()
    };

    saveCheckpoint(checkpoint);
    console.log(`✅ Checkpoint created with ${checkpoint.targets.length} targets\n`);
  } else {
    console.log(`✅ Loaded checkpoint with ${checkpoint.targets.length} targets\n`);

    const resolved = checkpoint.targets.filter(t => t.status === 'resolved').length;
    const unresolved = checkpoint.targets.filter(t => t.status === 'unresolved').length;
    const pending = checkpoint.targets.filter(t => t.status === 'pending').length;

    console.log(`   Status: ${resolved} resolved, ${unresolved} unresolved, ${pending} pending\n`);
  }

  // Process pending targets
  const pending = checkpoint.targets.filter(t => t.status === 'pending');

  if (pending.length === 0) {
    console.log('✅ All targets processed\n');
  } else {
    console.log(`Processing ${pending.length} pending targets...\n`);

    for (const target of pending) {
      await processTarget(target);
      saveCheckpoint(checkpoint);
      await sleep(RATE_LIMIT_DELAY);
    }
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('PHASE 7.2 SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const resolved = checkpoint.targets.filter(t => t.status === 'resolved');
  const unresolved = checkpoint.targets.filter(t => t.status === 'unresolved');

  console.log(`   Total: ${checkpoint.targets.length}`);
  console.log(`   ✅ Resolved: ${resolved.length}`);
  console.log(`   ⚠️  Unresolved: ${unresolved.length}\n`);

  if (resolved.length > 0) {
    console.log('   Next: Phase 7.3 (insert resolution data)\n');
  } else if (unresolved.length === checkpoint.targets.length) {
    console.log('   ⚠️  No markets resolved - these may be genuinely unresolved\n');
    console.log('   This explains the P&L gap. These positions are OPEN, not CLOSED.\n');
    console.log('   Next: Check unrealized P&L (Phase 6)\n');
  }

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
