import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('P&L VALIDATION AFTER ctf_token_map REBUILD');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Wallet: ${wallet}\n`);
  console.log('Baseline comparison:');
  console.log('  - Before fix: $34,990.56');
  console.log('  - Dome target: $87,030.51');
  console.log('  - Expected after fix: $75K-$90K\n');

  console.log('Querying realized_pnl_by_market_final...\n');

  const result = await clickhouse.query({
    query: `
      SELECT sum(realized_pnl_usd) as total_pnl
      FROM realized_pnl_by_market_final
      WHERE lower(wallet) = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });

  const data = await result.json();
  const totalPnl = Number(data[0].total_pnl);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('RESULTS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.table({
    'Before Fix': '$34,990.56',
    'After Fix': `$${totalPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    'Dome Target': '$87,030.51',
    'Gap Closed': `$${(totalPnl - 34990.56).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    'Remaining Gap': `$${(87030.51 - totalPnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    'Progress': `${((totalPnl - 34990.56) / (87030.51 - 34990.56) * 100).toFixed(1)}%`
  });

  console.log();

  if (totalPnl >= 75000 && totalPnl <= 90000) {
    console.log('✅ SUCCESS - P&L in expected range!');
    console.log('   The fix worked - token mappings were the root cause.\n');
  } else if (totalPnl > 34990.56) {
    console.log('✅ PARTIAL SUCCESS - P&L improved significantly!');
    console.log(`   Gained: $${(totalPnl - 34990.56).toLocaleString('en-US', { maximumFractionDigits: 2 })}\n`);
  } else {
    console.log('⚠️  WARNING - P&L did not improve as expected');
    console.log('   Need to investigate further.\n');
  }

  // Get market-level breakdown
  console.log('Top 10 markets by P&L:');
  const breakdown = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        realized_pnl_usd,
        net_shares,
        cashflow
      FROM realized_pnl_by_market_final
      WHERE lower(wallet) = lower('${wallet}')
      ORDER BY realized_pnl_usd DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const markets = await breakdown.json();

  markets.forEach((m: any, i: number) => {
    console.log(`  ${i + 1}. ${m.condition_id_norm.substring(0, 12)}... : $${Number(m.realized_pnl_usd).toFixed(2)}`);
  });
}

main().catch(console.error);
