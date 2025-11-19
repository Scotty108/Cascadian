import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('REBUILDING P&L VIEW WITH CORRECT WINNING_INDEX MATCHING');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Creating fixed view...\n');

  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW realized_pnl_by_market_final AS
      WITH
        -- Dedupe resolutions (take latest)
        resolutions_deduped AS (
          SELECT
            condition_id_norm,
            argMax(winning_index, updated_at) AS winning_index,
            argMax(payout_numerators, updated_at) AS payout_numerators,
            argMax(payout_denominator, updated_at) AS payout_denominator,
            argMax(winning_outcome, updated_at) AS winning_outcome
          FROM market_resolutions_final
          GROUP BY condition_id_norm
        ),
        -- Calculate cashflows with correct token mapping
        clob_cashflows AS (
          SELECT
            lower(cf.proxy_wallet) AS wallet,
            lower(replaceAll(cf.condition_id, '0x', '')) AS condition_id_norm,
            ctm.outcome_index AS outcome_idx,
            sum((if(cf.side = 'BUY', -1, 1) * cf.price * cf.size) / 1000000.0) AS cashflow,
            sum((if(cf.side = 'BUY', 1, -1) * cf.size) / 1000000.0) AS net_shares
          FROM clob_fills AS cf
          INNER JOIN ctf_token_map AS ctm ON cf.asset_id = ctm.token_id
          GROUP BY wallet, condition_id_norm, outcome_idx
        )
      SELECT
        cc.wallet,
        cc.condition_id_norm,
        cc.outcome_idx,
        cc.net_shares,
        cc.cashflow,
        res.winning_outcome,
        res.winning_index,
        res.payout_numerators,
        res.payout_denominator,
        -- Correct matching: compare outcome_idx (numeric) to winning_index (numeric)
        if(cc.outcome_idx = res.winning_index, 1, 0) AS is_winning_outcome,
        -- Correct P&L: cashflow + (shares * payout for this outcome)
        -- Use arrayElement with 1-based indexing: outcome_idx + 1
        cc.cashflow + if(
          cc.outcome_idx = res.winning_index,
          cc.net_shares * (arrayElement(res.payout_numerators, cc.outcome_idx + 1) / res.payout_denominator),
          0
        ) AS realized_pnl_usd
      FROM clob_cashflows AS cc
      INNER JOIN resolutions_deduped AS res ON cc.condition_id_norm = res.condition_id_norm
    `
  });

  console.log('✅ View created\n');

  // Test the fix
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('Testing with wallet:', wallet);
  console.log();

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
  console.log('RESULTS AFTER FIX');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.table({
    'Before token fix': '$34,990.56',
    'After token fix (broken view)': '$-46,997.48',
    'After view fix': `$${totalPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    'Dome target': '$87,030.51',
    'Gap': `$${(87030.51 - totalPnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  });

  console.log();

  if (totalPnl >= 75000 && totalPnl <= 90000) {
    console.log('✅ SUCCESS - P&L in expected range!');
    console.log('   Both fixes worked:\n');
    console.log('   1. ctf_token_map now has correct ERC-1155 decoded mappings');
    console.log('   2. P&L view now uses numeric winning_index matching\n');
  } else if (totalPnl > 50000) {
    console.log('✅ MAJOR IMPROVEMENT!');
    console.log(`   Gained: $${(totalPnl - 34990.56).toLocaleString('en-US', { maximumFractionDigits: 2 })}\n`);
  } else {
    console.log('⚠️  Still investigating...\n');
  }

  // Sample breakdown
  console.log('Sample markets (top 10 by P&L):');
  const breakdown = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        outcome_idx,
        winning_index,
        is_winning_outcome,
        net_shares,
        cashflow,
        realized_pnl_usd
      FROM realized_pnl_by_market_final
      WHERE lower(wallet) = lower('${wallet}')
      ORDER BY realized_pnl_usd DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const markets = await breakdown.json();
  markets.forEach((m: any, i: number) => {
    const match = m.is_winning_outcome ? '✓' : '✗';
    console.log(`  ${i + 1}. ${m.condition_id_norm.substring(0, 12)}... [${match}] outcome=${m.outcome_idx} winning=${m.winning_index} : $${Number(m.realized_pnl_usd).toFixed(2)}`);
  });
}

main().catch(console.error);
