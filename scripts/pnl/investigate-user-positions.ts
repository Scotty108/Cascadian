/**
 * Investigate pm_user_positions_v2 for failing wallets
 */

import { clickhouse } from '../../lib/clickhouse/client';

const FAILING_WALLETS = [
  '0xdcd7007b1a0b1e118684c47f6aaf8ba1b032a2d2', // V23c=$0, UI=-$293.91
  '0xa3bf25c42944c5f929aa1f694faa7881e3dcf76b', // V23c=$0, UI=-$243.67
  '0x54468955422da412126f2764ddc00002ef4c5f61', // V23c=$0, UI=$0.41
  '0x89d4601845f6da77555e00f7ed0782deeab901fb', // V23c=+$72, UI=-$76 (sign error)
  '0xdefb6fd2927beea366f06d0f5bae33243e1a29d4', // V23c=-$0.20, UI=-$94.65
];

async function investigate() {
  // Check pm_user_positions_v2 schema
  console.log('=== pm_user_positions_v2 SCHEMA ===');
  const schemaResult = await clickhouse.query({
    query: `DESCRIBE pm_user_positions_v2`,
    format: 'JSONEachRow'
  });
  const schema = await schemaResult.json() as any[];
  for (const col of schema) {
    console.log(`  ${col.name}: ${col.type}`);
  }

  console.log('\n=== SAMPLE DATA (3 rows) ===');
  const sampleResult = await clickhouse.query({
    query: `SELECT * FROM pm_user_positions_v2 LIMIT 3`,
    format: 'JSONEachRow'
  });
  const samples = await sampleResult.json() as any[];
  for (const row of samples) {
    console.log(row);
  }

  // Check each failing wallet
  for (const wallet of FAILING_WALLETS) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`WALLET: ${wallet}`);
    console.log('='.repeat(80));

    // Check pm_user_positions_v2 (by proxy_wallet and user)
    const posResult = await clickhouse.query({
      query: `
        SELECT
          user,
          proxy_wallet,
          token_id,
          avg_price / 1e6 as avg_price_usd,
          realized_pnl / 1e6 as realized_pnl_usd,
          unrealized_pnl / 1e6 as unrealized_pnl_usd,
          amount / 1e6 as amount_tokens,
          total_bought / 1e6 as total_bought_tokens,
          total_sold / 1e6 as total_sold_tokens
        FROM pm_user_positions_v2
        WHERE lower(proxy_wallet) = lower('${wallet}')
           OR lower(user) = lower('${wallet}')
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const posRows = await posResult.json() as any[];
    console.log(`\npm_user_positions_v2 rows: ${posRows.length}`);
    if (posRows.length > 0) {
      console.log('Sample position:', posRows[0]);

      // Sum PnL from all positions
      const sumResult = await clickhouse.query({
        query: `
          SELECT
            count() as position_count,
            sum(realized_pnl) / 1e6 as total_realized_pnl,
            sum(unrealized_pnl) / 1e6 as total_unrealized_pnl,
            (sum(realized_pnl) + sum(unrealized_pnl)) / 1e6 as total_pnl
          FROM pm_user_positions_v2
          WHERE lower(proxy_wallet) = lower('${wallet}')
             OR lower(user) = lower('${wallet}')
        `,
        format: 'JSONEachRow'
      });
      const sumRows = await sumResult.json() as any[];
      console.log('TOTAL from pm_user_positions_v2:', sumRows[0]);
    }

    // Check pm_unified_ledger_v7
    const ledgerResult = await clickhouse.query({
      query: `
        SELECT count() as cnt, sum(usdc_delta) as total_usdc
        FROM pm_unified_ledger_v7
        WHERE lower(wallet_address) = lower('${wallet}')
      `,
      format: 'JSONEachRow'
    });
    const ledgerRows = await ledgerResult.json() as any[];
    console.log(`pm_unified_ledger_v7:`, ledgerRows[0]);

    // Check pm_trader_events_v2
    const traderResult = await clickhouse.query({
      query: `
        SELECT count() as cnt, sum(usdc_amount)/1e6 as total_usdc
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
          AND is_deleted = 0
      `,
      format: 'JSONEachRow'
    });
    const traderRows = await traderResult.json() as any[];
    console.log(`pm_trader_events_v2:`, traderRows[0]);
  }
}

investigate().catch(console.error);
