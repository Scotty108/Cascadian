/**
 * Step 1: Compute Omega leaderboard top 50 from ledger data
 * Since no precomputed omega tables exist, we compute on-the-fly.
 */
import fs from 'fs';
import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  const LIMIT = 50;

  // Compute omega from pm_cascadian_pnl_v2 which has condition-level realized PnL
  // Omega = sum(gains) / abs(sum(losses))
  const sql = `
    WITH wallet_pnl AS (
      SELECT
        lower(trader_wallet) as wallet,
        sum(realized_pnl) as net_pnl,
        sumIf(realized_pnl, realized_pnl > 0) as total_gains,
        sumIf(realized_pnl, realized_pnl < 0) as total_losses,
        count() as condition_count
      FROM pm_cascadian_pnl_v2
      WHERE realized_pnl != 0
      GROUP BY lower(trader_wallet)
      HAVING condition_count >= 10
    )
    SELECT
      wallet as wallet_address,
      net_pnl,
      total_gains,
      abs(total_losses) as total_losses_abs,
      condition_count,
      if(total_losses_abs > 0, total_gains / total_losses_abs, 0) as omega_ratio,
      if(condition_count > 0, (total_gains + total_losses) / condition_count, 0) as avg_pnl_per_condition
    FROM wallet_pnl
    WHERE total_losses < -100  -- Must have at least $100 in losses for meaningful omega
    ORDER BY omega_ratio DESC
    LIMIT ${LIMIT}
  `;

  console.log('Computing Omega leaderboard top 50 from pm_cascadian_pnl_v2...');
  const result = await clickhouse.query({ query: sql, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  if (rows.length === 0) {
    console.log('No rows returned from pm_cascadian_pnl_v2, trying pm_unified_ledger_v8_tbl...');

    // Fallback: compute from ledger directly using V29-style realized PnL
    const fallbackSql = `
      SELECT
        lower(wallet_address) as wallet_address,
        count(DISTINCT condition_id) as condition_count
      FROM pm_unified_ledger_v8_tbl
      WHERE condition_id != ''
      GROUP BY lower(wallet_address)
      HAVING condition_count >= 10
      ORDER BY condition_count DESC
      LIMIT ${LIMIT}
    `;

    const fallbackResult = await clickhouse.query({ query: fallbackSql, format: 'JSONEachRow' });
    const fallbackRows = await fallbackResult.json() as any[];

    console.log(`Found ${fallbackRows.length} wallets with 10+ conditions`);

    fs.writeFileSync(
      'tmp/omega_top50_raw.json',
      JSON.stringify({
        generated_at: new Date().toISOString(),
        note: 'Fallback - wallets by condition count, omega not computed',
        rows: fallbackRows
      }, null, 2)
    );

    const wallets = fallbackRows.map((r: any) => r.wallet_address.toLowerCase());
    fs.writeFileSync('tmp/omega_top50_wallets.json', JSON.stringify(wallets, null, 2));
    console.log(`Wrote tmp/omega_top50_wallets.json with ${wallets.length} wallets`);
    return;
  }

  fs.writeFileSync(
    'tmp/omega_top50_raw.json',
    JSON.stringify({ generated_at: new Date().toISOString(), rows }, null, 2)
  );
  console.log(`Wrote tmp/omega_top50_raw.json with ${rows.length} rows`);

  // Also extract wallet list
  const wallets = rows.map((r: any) => r.wallet_address.toLowerCase());
  fs.writeFileSync('tmp/omega_top50_wallets.json', JSON.stringify(wallets, null, 2));
  console.log(`Wrote tmp/omega_top50_wallets.json with ${wallets.length} wallets`);

  // Show top 5
  console.log('\nTop 5 by Omega:');
  for (const r of rows.slice(0, 5)) {
    console.log(`  ${r.wallet_address.slice(0,10)}... omega=${Number(r.omega_ratio).toFixed(2)} net=$${Number(r.net_pnl).toFixed(0)} conds=${r.condition_count}`);
  }
}

main().catch(console.error);
