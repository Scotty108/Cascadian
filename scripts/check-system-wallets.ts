import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function checkSystemWallets() {
  // Look at trade count distribution among CLOB-only eligible wallets active in 30 days
  const q = `
    SELECT
      CASE
        WHEN trade_count >= 100000 THEN '100K+ trades (market maker)'
        WHEN trade_count >= 50000 THEN '50K-100K trades (likely bot)'
        WHEN trade_count >= 10000 THEN '10K-50K trades (power user/bot)'
        WHEN trade_count >= 1000 THEN '1K-10K trades (active trader)'
        WHEN trade_count >= 100 THEN '100-1K trades (regular)'
        ELSE '<100 trades (casual)'
      END as trade_tier,
      count() as wallets,
      round(avg(net_pnl_simple), 0) as avg_pnl,
      round(min(net_pnl_simple), 0) as min_pnl,
      round(max(net_pnl_simple), 0) as max_pnl
    FROM pm_wallet_clob_eligibility_v1
    WHERE is_clob_only = 1
      AND last_trade >= now() - INTERVAL 30 DAY
    GROUP BY trade_tier
    ORDER BY
      CASE trade_tier
        WHEN '100K+ trades (market maker)' THEN 1
        WHEN '50K-100K trades (likely bot)' THEN 2
        WHEN '10K-50K trades (power user/bot)' THEN 3
        WHEN '1K-10K trades (active trader)' THEN 4
        WHEN '100-1K trades (regular)' THEN 5
        ELSE 6
      END
  `;

  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const rows = await r.json() as any[];

  console.log('Trade Count Distribution (CLOB-only, 30d active):');
  console.log('='.repeat(80));
  for (const row of rows) {
    console.log(`${row.trade_tier.padEnd(35)} | ${String(row.wallets).padStart(8)} wallets | avg PnL: $${Number(row.avg_pnl).toLocaleString().padStart(12)} | range: $${Number(row.min_pnl).toLocaleString()} to $${Number(row.max_pnl).toLocaleString()}`);
  }

  // Check known system wallet patterns
  console.log('\n\nHigh-volume wallets (potential system wallets):');
  console.log('='.repeat(80));

  const bigQ = `
    SELECT
      wallet_address,
      trade_count,
      unique_tokens,
      round(net_pnl_simple, 0) as pnl,
      round(usdc_spent / 1000000, 1) as volume_m
    FROM pm_wallet_clob_eligibility_v1
    WHERE is_clob_only = 1
      AND last_trade >= now() - INTERVAL 30 DAY
      AND trade_count >= 50000
    ORDER BY trade_count DESC
    LIMIT 20
  `;

  const bigR = await clickhouse.query({ query: bigQ, format: 'JSONEachRow' });
  const bigRows = await bigR.json() as any[];

  for (const row of bigRows) {
    console.log(`${row.wallet_address} | ${Number(row.trade_count).toLocaleString().padStart(10)} trades | ${row.unique_tokens} tokens | PnL: $${Number(row.pnl).toLocaleString().padStart(12)} | Vol: $${row.volume_m}M`);
  }

  // Show final filtered count
  console.log('\n\nFiltered Leaderboard Summary (excluding 10K+ trades):');
  console.log('='.repeat(80));

  const filterQ = `
    SELECT
      count() as total_wallets,
      countIf(net_pnl_simple > 0) as winners,
      countIf(net_pnl_simple <= 0) as losers,
      round(avg(net_pnl_simple), 0) as avg_pnl,
      round(max(net_pnl_simple), 0) as top_pnl
    FROM pm_wallet_clob_eligibility_v1
    WHERE is_clob_only = 1
      AND last_trade >= now() - INTERVAL 30 DAY
      AND trade_count < 10000
  `;

  const filterR = await clickhouse.query({ query: filterQ, format: 'JSONEachRow' });
  const filterRows = await filterR.json() as any[];
  const f = filterRows[0];

  console.log(`Total wallets: ${Number(f.total_wallets).toLocaleString()}`);
  console.log(`Winners: ${Number(f.winners).toLocaleString()} | Losers: ${Number(f.losers).toLocaleString()}`);
  console.log(`Average PnL: $${Number(f.avg_pnl).toLocaleString()}`);
  console.log(`Top PnL: $${Number(f.top_pnl).toLocaleString()}`);
}

checkSystemWallets();
