/**
 * Quick sample of conserving wallets with their PnL
 * Focused on wallets with mostly resolved positions
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  console.log('\n=== Quick Conserving Wallet Sample ===\n');

  // First, get count of conserving wallets
  console.log('Step 1: Count conserving wallets...');
  const countResult = await clickhouse.query({
    query: `
      SELECT count() as cnt
      FROM (
        SELECT wallet_address
        FROM (
          SELECT
            wallet_address,
            condition_id,
            outcome_index,
            sum(token_delta) as sum_tokens
          FROM pm_unified_ledger_v9_clob_tbl
          WHERE source_type = 'CLOB'
            AND condition_id IS NOT NULL
            AND condition_id != ''
          GROUP BY wallet_address, condition_id, outcome_index
        )
        GROUP BY wallet_address
        HAVING min(sum_tokens) >= -1000
      )
    `,
    format: 'JSONEachRow'
  });
  const count = ((await countResult.json()) as any[])[0]?.cnt || 0;
  console.log(`Conserving wallets: ${count.toLocaleString()}\n`);

  // Step 2: Get sample of conserving wallets with their simple metrics
  console.log('Step 2: Sample conserving wallets with activity and resolved positions...');

  const sampleQuery = `
    SELECT
      wallet_address,
      round(sum(usdc_delta), 2) as net_cash_flow,
      round(sum(abs(usdc_delta)), 2) as volume,
      count() as event_count,
      countDistinct(condition_id) as markets
    FROM pm_unified_ledger_v9_clob_tbl
    WHERE source_type = 'CLOB'
      AND condition_id IS NOT NULL
      AND wallet_address IN (
        SELECT wallet_address
        FROM (
          SELECT
            wallet_address,
            condition_id,
            outcome_index,
            sum(token_delta) as sum_tokens
          FROM pm_unified_ledger_v9_clob_tbl
          WHERE source_type = 'CLOB'
            AND condition_id IS NOT NULL
            AND condition_id != ''
          GROUP BY wallet_address, condition_id, outcome_index
        )
        GROUP BY wallet_address
        HAVING min(sum_tokens) >= -1000
      )
    GROUP BY wallet_address
    HAVING volume >= 5000 AND markets >= 10
    ORDER BY net_cash_flow DESC
    LIMIT 25
  `;

  const sampleResult = await clickhouse.query({
    query: sampleQuery,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 180 }
  });
  const samples = await sampleResult.json() as any[];

  console.log(`\nTop 25 conserving wallets by net cash flow:\n`);
  console.log('wallet | net_cash_flow | volume | events | markets');
  console.log('-'.repeat(80));

  for (const r of samples) {
    const cashStr = Number(r.net_cash_flow) >= 0
      ? `+$${Number(r.net_cash_flow).toLocaleString()}`
      : `-$${Math.abs(Number(r.net_cash_flow)).toLocaleString()}`;
    console.log(
      `${r.wallet_address.slice(0, 10)}... | ${cashStr.padStart(14)} | $${Number(r.volume).toLocaleString().padStart(10)} | ${r.event_count.toString().padStart(5)} | ${r.markets.toString().padStart(4)}`
    );
  }

  // Step 3: Test one wallet with V11_POLY
  if (samples.length > 0) {
    console.log('\n\n=== Testing Top Wallet with V11_POLY ===');
    const testWallet = samples[0].wallet_address;
    console.log(`Wallet: ${testWallet}`);

    // Import and test
    const { loadPolymarketPnlEventsForWallet } = await import('../../lib/pnl/polymarketEventLoader');
    const { computeWalletPnlFromEvents } = await import('../../lib/pnl/polymarketSubgraphEngine');

    try {
      const loadResult = await loadPolymarketPnlEventsForWallet(testWallet, {
        includeSyntheticRedemptions: true,
      });
      const pnlResult = computeWalletPnlFromEvents(testWallet, loadResult.events);

      console.log(`V11_POLY Realized PnL: $${pnlResult.realizedPnl.toLocaleString()}`);
      console.log(`V11_POLY Volume: $${pnlResult.volume.toLocaleString()}`);
      console.log(`Events: ${loadResult.events.length}`);
      console.log(`Gap stats: ${JSON.stringify(loadResult.gapStats)}`);
    } catch (e: any) {
      console.log(`ERROR: ${e.message}`);
    }
  }

  console.log('\n');
}

main().catch(console.error);
