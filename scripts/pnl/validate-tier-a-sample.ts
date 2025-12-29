/**
 * Validate V20 engine on a sample of Tier A wallets
 * These are supposed to be "safe for metrics" wallets
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';
import { calculateV20PnL } from '../../lib/pnl/uiActivityEngineV20';

async function main() {
  console.log('\n=== Tier A Sample Validation ===\n');

  // Get a sample of Tier A wallets with significant activity
  console.log('Fetching Tier A sample (50+ CLOB events, >$1000 volume)...');
  const sampleResult = await clickhouse.query({
    query: `
      SELECT
        wallet_address,
        clob_event_count,
        clob_usdc_volume,
        taker_count,
        maker_count,
        unresolved_pct
      FROM trader_strict_classifier_v1
      WHERE tier = 'A'
        AND clob_event_count >= 50
        AND clob_usdc_volume > 1000
      ORDER BY rand()
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const wallets = await sampleResult.json() as any[];

  console.log(`Got ${wallets.length} wallets\n`);

  // Test each wallet with V20
  console.log('Testing V20 engine on each wallet...');
  console.log('wallet | CLOB events | V7 rows | V20 PnL | positions | resolved');
  console.log('-'.repeat(90));

  for (const w of wallets) {
    const wallet = w.wallet_address;

    // Get V7 row count
    const v7Result = await clickhouse.query({
      query: `SELECT count() as cnt FROM pm_unified_ledger_v7 WHERE lower(wallet_address) = lower('${wallet}')`,
      format: 'JSONEachRow'
    });
    const v7Rows = ((await v7Result.json()) as any[])[0]?.cnt || 0;

    // Get V20 PnL
    let v20Pnl = 0;
    let positions = 0;
    let resolved = 0;

    try {
      const result = await calculateV20PnL(wallet);
      v20Pnl = result.total_pnl;
      positions = result.positions;
      resolved = result.resolved;
    } catch (e) {
      console.log(`${wallet.slice(0, 10)}... | ${w.clob_event_count} | ERROR: ${e}`);
      continue;
    }

    const pnlStr = v20Pnl >= 0 ? `+$${v20Pnl.toLocaleString()}` : `-$${Math.abs(v20Pnl).toLocaleString()}`;
    console.log(`${wallet.slice(0, 10)}... | ${w.clob_event_count.toString().padStart(5)} | ${v7Rows.toString().padStart(5)} | ${pnlStr.padStart(15)} | ${positions.toString().padStart(5)} | ${resolved.toString().padStart(5)}`);
  }

  // Get count of Tier A with significant activity
  console.log('\n=== Tier A Counts ===');
  const countResult = await clickhouse.query({
    query: `
      SELECT
        countIf(clob_event_count >= 20 AND clob_usdc_volume > 500) as eligible_20_500,
        countIf(clob_event_count >= 50 AND clob_usdc_volume > 1000) as eligible_50_1000,
        countIf(clob_event_count >= 100 AND clob_usdc_volume > 5000) as eligible_100_5000
      FROM trader_strict_classifier_v1
      WHERE tier = 'A'
    `,
    format: 'JSONEachRow'
  });
  const counts = ((await countResult.json()) as any[])[0];
  console.log(`Tier A with >=20 events, >$500 volume: ${counts.eligible_20_500.toLocaleString()}`);
  console.log(`Tier A with >=50 events, >$1000 volume: ${counts.eligible_50_1000.toLocaleString()}`);
  console.log(`Tier A with >=100 events, >$5000 volume: ${counts.eligible_100_5000.toLocaleString()}`);
}

main().catch(console.error);
