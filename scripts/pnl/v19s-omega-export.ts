/**
 * V19s Omega Export for Copy-Trading
 *
 * Uses pm_unified_ledger_v6 (same as V19s engine) to compute:
 * - Omega ratio (total_gain / total_loss)
 * - Average % return per trade
 * - # of events (unique condition_ids)
 *
 * User can filter in spreadsheet (e.g., Omega > 2)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';
import * as fs from 'fs';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
});

async function main() {
  console.log('=== V19s Omega Export (pm_unified_ledger_v6) ===\n');

  // Compute per-wallet metrics using V19s methodology
  // cash_flow = negative for buys, positive for sells
  // pnl per position = cash_flow + (final_tokens * resolution_price)
  // Use two-phase approach: first get active wallets, then compute metrics
  // Phase 1: Get active wallets from CLV table (pre-computed, fast)
  const activeWalletsQuery = `
    SELECT DISTINCT lower(wallet) as wallet
    FROM pm_trade_clv_features_60d
    WHERE trade_time >= now() - INTERVAL 60 DAY
    LIMIT 10000
  `;

  console.log('Phase 1: Getting active wallets from CLV table...');
  const activeResult = await ch.query({ query: activeWalletsQuery, format: 'JSONEachRow' });
  const activeWallets = (await activeResult.json() as any[]).map(r => r.wallet);
  console.log(`Found ${activeWallets.length} active wallets`);

  // Phase 2: Compute metrics using V19s methodology for these wallets
  // Break into batches to avoid memory issues
  const batchSize = 500;
  const allResults: any[] = [];

  for (let i = 0; i < Math.min(activeWallets.length, 5000); i += batchSize) {
    const batch = activeWallets.slice(i, i + batchSize);
    const walletList = batch.map(w => `'${w}'`).join(',');

    console.log(`Phase 2: Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(Math.min(activeWallets.length, 5000)/batchSize)}...`);

    const query = `
      WITH
        now() AS t_now,

        -- Get resolution prices
        resolutions AS (
          SELECT
            condition_id,
            outcome_index,
            any(resolved_price) AS resolution_price
          FROM vw_pm_resolution_prices
          GROUP BY condition_id, outcome_index
        ),

        -- Aggregate positions per wallet from ledger v6
        positions AS (
          SELECT
            lower(wallet_address) AS wallet,
            condition_id,
            outcome_index,
            sum(usdc_delta) AS cash_flow,
            sum(token_delta) AS final_tokens,
            count() AS trade_count,
            max(event_time) AS last_trade
          FROM pm_unified_ledger_v6
          WHERE lower(wallet_address) IN (${walletList})
            AND event_time >= t_now - INTERVAL 60 DAY
            AND source_type = 'CLOB'
            AND condition_id IS NOT NULL
            AND condition_id != ''
          GROUP BY wallet, condition_id, outcome_index
        ),

        -- Join with resolutions and compute PnL
        position_pnl AS (
          SELECT
            p.wallet,
            p.condition_id,
            p.outcome_index,
            p.cash_flow,
            p.final_tokens,
            p.trade_count,
            p.last_trade,
            r.resolution_price,
            CASE
              WHEN r.resolution_price IS NOT NULL THEN
                p.cash_flow + (p.final_tokens * r.resolution_price)
              ELSE
                0
            END AS realized_pnl,
            r.resolution_price IS NOT NULL AS is_resolved
          FROM positions p
          LEFT JOIN resolutions r
            ON p.condition_id = r.condition_id
            AND p.outcome_index = r.outcome_index
        )

      SELECT
        wallet,
        count() AS n_positions,
        uniqExact(condition_id) AS n_events,
        sum(trade_count) AS n_trades,
        countIf(is_resolved) AS n_resolved,
        countIf(realized_pnl > 0 AND is_resolved) AS n_wins,
        countIf(realized_pnl <= 0 AND is_resolved) AS n_losses,
        round(countIf(realized_pnl > 0 AND is_resolved) / nullIf(countIf(is_resolved), 0) * 100, 1) AS win_pct,
        round(sumIf(realized_pnl, realized_pnl > 0) / nullIf(abs(sumIf(realized_pnl, realized_pnl < 0)), 0), 2) AS omega,
        round(sum(realized_pnl) / nullIf(countIf(is_resolved), 0), 2) AS avg_pnl_per_position,
        round(sum(realized_pnl), 2) AS pnl_60d,
        round(sumIf(realized_pnl, realized_pnl > 0), 2) AS total_gain,
        round(abs(sumIf(realized_pnl, realized_pnl < 0)), 2) AS total_loss,
        max(last_trade) AS last_active

      FROM position_pnl
      GROUP BY wallet
      HAVING
        n_events >= 5
        AND omega > 1
        AND omega < 100
        AND n_resolved >= 3
        AND pnl_60d > 0
        AND last_active >= t_now - INTERVAL 14 DAY
    `;

    try {
      const result = await ch.query({ query, format: 'JSONEachRow' });
      const batchResults = await result.json() as any[];
      allResults.push(...batchResults);
    } catch (err) {
      console.log(`  Batch error (skipping): ${(err as Error).message.slice(0, 100)}`);
    }
  }

  // Sort by TOTAL PNL (biggest winners), not omega
  // Filter: omega > 1 (profitable) and pnl > $100
  const rows = allResults
    .filter(r => r.pnl_60d >= 100)  // At least $100 profit
    .sort((a, b) => b.pnl_60d - a.pnl_60d)  // Sort by total P&L
    .slice(0, 100);

  console.log(`\nFound ${allResults.length} wallets with Omega > 1`);

  // Get Tier info
  console.log('Getting tier info...');
  const tierQuery = `SELECT wallet, confidence_tier FROM pm_wallet_external_activity_60d`;
  const tierResult = await ch.query({ query: tierQuery, format: 'JSONEachRow' });
  const tiers = await tierResult.json() as any[];
  const tierMap = new Map(tiers.map(t => [t.wallet, t.confidence_tier]));

  // Add tier to sorted results
  const rowsWithTier = rows.map(r => ({
    ...r,
    tier: tierMap.get(r.wallet) || 'Unknown',
  }));

  // Display
  console.log(`\nTop 30 by P&L (V19s ledger, ${rowsWithTier.length} qualified):\n`);
  console.log('Wallet                                     | Events | Resol | Win% | Omega  | Avg PnL | Total PnL | Tier');
  console.log('-------------------------------------------|--------|-------|------|--------|---------|-----------|-----');

  for (const r of rowsWithTier.slice(0, 30)) {
    console.log(
      `${r.wallet} | ${String(r.n_events).padStart(6)} | ${String(r.n_resolved).padStart(5)} | ${String(r.win_pct || 0).padStart(4)}% | ${String(r.omega).padStart(6)}x | ${('$' + (r.avg_pnl_per_position || 0)).padStart(7)} | ${('$' + Number(r.pnl_60d).toLocaleString()).padStart(9)} | ${r.tier}`
    );
  }

  // Export CSV
  const dateStr = new Date().toISOString().slice(0, 10);
  const csvPath = `exports/copytrade/v19s_omega_export_${dateStr}.csv`;

  const header = 'wallet,n_events,n_trades,n_positions,n_resolved,n_wins,n_losses,win_pct,omega,avg_pnl_per_position,pnl_60d,total_gain,total_loss,tier,profile_url';
  const csvRows = rowsWithTier.map(r =>
    [
      r.wallet,
      r.n_events,
      r.n_trades,
      r.n_positions,
      r.n_resolved,
      r.n_wins,
      r.n_losses,
      r.win_pct || 0,
      r.omega,
      r.avg_pnl_per_position || 0,
      r.pnl_60d,
      r.total_gain,
      r.total_loss,
      r.tier,
      `https://polymarket.com/profile/${r.wallet}`,
    ].join(',')
  );

  fs.writeFileSync(csvPath, [header, ...csvRows].join('\n'));
  console.log(`\nExported ${rowsWithTier.length} wallets to: ${csvPath}`);

  // JSON
  const jsonPath = `exports/copytrade/v19s_omega_export_${dateStr}.json`;
  fs.writeFileSync(jsonPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    data_source: 'pm_unified_ledger_v6 (V19s methodology)',
    filters: {
      omega: '> 1 (profitable)',
      events: '>= 5 markets',
      resolved: '>= 3 positions resolved',
      pnl: '> 0',
      active: 'within 14 days',
    },
    note: 'Filter in spreadsheet: Omega > 2 for higher quality, Tier = A for CLOB-only',
    wallets: rowsWithTier,
  }, null, 2));
  console.log(`Exported to: ${jsonPath}`);

  // Stats
  const tierACount = rowsWithTier.filter(r => r.tier === 'A').length;
  const tierBCount = rowsWithTier.filter(r => r.tier === 'B').length;
  console.log(`\nTier breakdown: A=${tierACount}, B=${tierBCount}, Other=${rowsWithTier.length - tierACount - tierBCount}`);

  console.log('\n=== Done ===');
  console.log('\nTip: In Google Sheets, filter by:');
  console.log('  - Omega > 2 for high-quality');
  console.log('  - Tier = A for CLOB-only (cleaner data)');

  await ch.close();
}

main().catch(console.error);
