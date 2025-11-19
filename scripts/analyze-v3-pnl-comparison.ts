#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

const xcnstrategy = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

interface WalletPnLMetrics {
  wallet_address: string;
  month: string;
  resolved_trades: number;
  total_pnl: number;
  avg_pnl: number;
  win_rate: number;
  max_single_pnl: number;
  min_single_pnl: number;
}

interface CohortMetrics {
  month: string;
  avg_resolved_trades: number;
  avg_total_pnl: number;
  avg_pnl_per_trade: number;
  avg_win_rate: number;
}

async function main() {
  console.log('🔍 PM Trades V3 - PnL Comparison Analysis (v2 vs v3)');
  console.log('='.repeat(100));
  console.log('');
  console.log('📊 Analyzing last 12 months of data...');
  console.log('');

  // Step 1: Identify top wallets for cohort analysis
  console.log('📋 Building wallet cohorts...');
  console.log('─'.repeat(100));

  const topVolumeQuery = `
    SELECT
      lower(wallet_address) as wallet_address,
      SUM(usd_value) as total_volume
    FROM vw_trades_canonical_v3_preview
    WHERE timestamp >= now() - INTERVAL 12 MONTH
    GROUP BY wallet_address
    ORDER BY total_volume DESC
    LIMIT 20
  `;

  const topVolumeResult = await clickhouse.query({ query: topVolumeQuery, format: 'JSONEachRow' });
  const topVolumeWallets = (await topVolumeResult.json() as any[]).map(r => r.wallet_address as string);

  console.log(`✅ Top 20 wallets by volume (12mo): ${topVolumeWallets.length} wallets`);

  // For top PnL wallets, we need to compute PnL first using v3 (our best current data)
  const topPnLQuery = `
    WITH wallet_pnl AS (
      SELECT
        lower(t.wallet_address) as wallet_address,
        SUM(
          CASE
            WHEN gr.winning_outcome_index IS NOT NULL
            THEN
              CASE
                WHEN t.trade_direction = 'buy' AND t.canonical_outcome_index = gr.winning_outcome_index
                THEN t.shares - (t.price * t.shares)
                WHEN t.trade_direction = 'sell' AND t.canonical_outcome_index = gr.winning_outcome_index
                THEN (t.price * t.shares) - t.shares
                WHEN t.trade_direction = 'buy' AND t.canonical_outcome_index != gr.winning_outcome_index
                THEN -(t.price * t.shares)
                WHEN t.trade_direction = 'sell' AND t.canonical_outcome_index != gr.winning_outcome_index
                THEN (t.price * t.shares)
                ELSE 0
              END
            ELSE 0
          END
        ) as total_pnl
      FROM vw_trades_canonical_v3_preview t
      LEFT JOIN gamma_resolved mr
        ON t.canonical_condition_id = gr.condition_id
      WHERE t.timestamp >= now() - INTERVAL 12 MONTH
        AND t.canonical_condition_id IS NOT NULL
        AND t.canonical_condition_id != ''
        AND t.canonical_condition_id != '0000000000000000000000000000000000000000000000000000000000000000'
      GROUP BY wallet_address
    )
    SELECT wallet_address, total_pnl
    FROM wallet_pnl
    ORDER BY total_pnl DESC
    LIMIT 20
  `;

  const topPnLResult = await clickhouse.query({ query: topPnLQuery, format: 'JSONEachRow' });
  const topPnLWallets = (await topPnLResult.json() as any[]).map(r => r.wallet_address as string);

  console.log(`✅ Top 20 wallets by PnL (12mo): ${topPnLWallets.length} wallets`);
  console.log('');

  // Step 2: Compute PnL metrics for xcnstrategy (v2 vs v3)
  console.log('📊 XCNSTRATEGY WALLET - V2 vs V3 COMPARISON');
  console.log('─'.repeat(100));
  console.log(`Wallet: ${xcnstrategy}`);
  console.log('');

  const xcnV2Metrics = await computeWalletPnL(xcnstrategy, 'v2');
  const xcnV3Metrics = await computeWalletPnL(xcnstrategy, 'v3');

  printWalletComparison(xcnV2Metrics, xcnV3Metrics, 'xcnstrategy');

  // Step 3: Compute cohort aggregates
  console.log('');
  console.log('📊 TOP 20 VOLUME COHORT - V2 vs V3 COMPARISON');
  console.log('─'.repeat(100));

  const volumeCohortV2 = await computeCohortPnL(topVolumeWallets, 'v2');
  const volumeCohortV3 = await computeCohortPnL(topVolumeWallets, 'v3');

  printCohortComparison(volumeCohortV2, volumeCohortV3, 'Top 20 Volume');

  console.log('');
  console.log('📊 TOP 20 PNL COHORT - V2 vs V3 COMPARISON');
  console.log('─'.repeat(100));

  const pnlCohortV2 = await computeCohortPnL(topPnLWallets, 'v2');
  const pnlCohortV3 = await computeCohortPnL(topPnLWallets, 'v3');

  printCohortComparison(pnlCohortV2, pnlCohortV3, 'Top 20 PnL');

  console.log('');
  console.log('='.repeat(100));
  console.log('✅ PNL COMPARISON ANALYSIS COMPLETE');
  console.log('='.repeat(100));
}

async function computeWalletPnL(walletAddress: string, version: 'v2' | 'v3'): Promise<WalletPnLMetrics[]> {
  const conditionIdColumn = version === 'v2' ? 'condition_id_norm_v2' : 'canonical_condition_id';
  const outcomeIndexColumn = version === 'v2' ? 'outcome_index_v2' : 'canonical_outcome_index';

  const query = `
    SELECT
      toYYYYMM(t.timestamp) as month,
      lower(t.wallet_address) as wallet_address,

      -- Count of resolved trades
      COUNT(*) as resolved_trades,

      -- Total PnL
      SUM(
        CASE
          WHEN gr.winning_outcome_index IS NOT NULL
          THEN
            CASE
              WHEN t.trade_direction = 'buy' AND t.${outcomeIndexColumn} = gr.winning_outcome_index
              THEN t.shares - (t.price * t.shares)
              WHEN t.trade_direction = 'sell' AND t.${outcomeIndexColumn} = gr.winning_outcome_index
              THEN (t.price * t.shares) - t.shares
              WHEN t.trade_direction = 'buy' AND t.${outcomeIndexColumn} != gr.winning_outcome_index
              THEN -(t.price * t.shares)
              WHEN t.trade_direction = 'sell' AND t.${outcomeIndexColumn} != gr.winning_outcome_index
              THEN (t.price * t.shares)
              ELSE 0
            END
          ELSE 0
        END
      ) as total_pnl,

      -- Win rate (percentage of profitable trades)
      AVG(
        CASE
          WHEN gr.winning_outcome_index IS NOT NULL
          THEN
            CASE
              WHEN (t.trade_direction = 'buy' AND t.${outcomeIndexColumn} = gr.winning_outcome_index) OR
                   (t.trade_direction = 'sell' AND t.${outcomeIndexColumn} != gr.winning_outcome_index)
              THEN 1.0
              ELSE 0.0
            END
          ELSE 0.0
        END
      ) * 100 as win_rate,

      -- Max/Min single trade PnL
      MAX(
        CASE
          WHEN gr.winning_outcome_index IS NOT NULL
          THEN
            CASE
              WHEN t.trade_direction = 'buy' AND t.${outcomeIndexColumn} = gr.winning_outcome_index
              THEN t.shares - (t.price * t.shares)
              WHEN t.trade_direction = 'sell' AND t.${outcomeIndexColumn} = gr.winning_outcome_index
              THEN (t.price * t.shares) - t.shares
              WHEN t.trade_direction = 'buy' AND t.${outcomeIndexColumn} != gr.winning_outcome_index
              THEN -(t.price * t.shares)
              WHEN t.trade_direction = 'sell' AND t.${outcomeIndexColumn} != gr.winning_outcome_index
              THEN (t.price * t.shares)
              ELSE 0
            END
          ELSE 0
        END
      ) as max_single_pnl,

      MIN(
        CASE
          WHEN gr.winning_outcome_index IS NOT NULL
          THEN
            CASE
              WHEN t.trade_direction = 'buy' AND t.${outcomeIndexColumn} = gr.winning_outcome_index
              THEN t.shares - (t.price * t.shares)
              WHEN t.trade_direction = 'sell' AND t.${outcomeIndexColumn} = gr.winning_outcome_index
              THEN (t.price * t.shares) - t.shares
              WHEN t.trade_direction = 'buy' AND t.${outcomeIndexColumn} != gr.winning_outcome_index
              THEN -(t.price * t.shares)
              WHEN t.trade_direction = 'sell' AND t.${outcomeIndexColumn} != gr.winning_outcome_index
              THEN (t.price * t.shares)
              ELSE 0
            END
          ELSE 0
        END
      ) as min_single_pnl

    FROM vw_trades_canonical_v3_preview t
    LEFT JOIN gamma_resolved mr
      ON t.${conditionIdColumn} = gr.condition_id
    WHERE lower(t.wallet_address) = {wallet:String}
      AND t.timestamp >= now() - INTERVAL 12 MONTH
      AND t.${conditionIdColumn} IS NOT NULL
      AND t.${conditionIdColumn} != ''
      AND t.${conditionIdColumn} != '0000000000000000000000000000000000000000000000000000000000000000'
      AND gr.winning_outcome_index IS NOT NULL
    GROUP BY month, wallet_address
    ORDER BY month
  `;

  const result = await clickhouse.query({
    query,
    query_params: { wallet: walletAddress.toLowerCase() },
    format: 'JSONEachRow'
  });

  const data = await result.json() as any[];

  return data.map(row => ({
    wallet_address: row.wallet_address,
    month: String(row.month),
    resolved_trades: parseInt(row.resolved_trades),
    total_pnl: parseFloat(row.total_pnl),
    avg_pnl: parseFloat(row.total_pnl) / parseInt(row.resolved_trades),
    win_rate: parseFloat(row.win_rate),
    max_single_pnl: parseFloat(row.max_single_pnl),
    min_single_pnl: parseFloat(row.min_single_pnl)
  }));
}

async function computeCohortPnL(walletAddresses: string[], version: 'v2' | 'v3'): Promise<CohortMetrics[]> {
  const conditionIdColumn = version === 'v2' ? 'condition_id_norm_v2' : 'canonical_condition_id';
  const outcomeIndexColumn = version === 'v2' ? 'outcome_index_v2' : 'canonical_outcome_index';

  const walletsParam = walletAddresses.map(w => `'${w.toLowerCase()}'`).join(',');

  const query = `
    WITH wallet_monthly_pnl AS (
      SELECT
        toYYYYMM(t.timestamp) as month,
        lower(t.wallet_address) as wallet_address,
        COUNT(*) as resolved_trades,
        SUM(
          CASE
            WHEN gr.winning_outcome_index IS NOT NULL
            THEN
              CASE
                WHEN t.trade_direction = 'buy' AND t.${outcomeIndexColumn} = gr.winning_outcome_index
                THEN t.shares - (t.price * t.shares)
                WHEN t.trade_direction = 'sell' AND t.${outcomeIndexColumn} = gr.winning_outcome_index
                THEN (t.price * t.shares) - t.shares
                WHEN t.trade_direction = 'buy' AND t.${outcomeIndexColumn} != gr.winning_outcome_index
                THEN -(t.price * t.shares)
                WHEN t.trade_direction = 'sell' AND t.${outcomeIndexColumn} != gr.winning_outcome_index
                THEN (t.price * t.shares)
                ELSE 0
              END
            ELSE 0
          END
        ) as total_pnl,
        AVG(
          CASE
            WHEN gr.winning_outcome_index IS NOT NULL
            THEN
              CASE
                WHEN (t.trade_direction = 'buy' AND t.${outcomeIndexColumn} = gr.winning_outcome_index) OR
                     (t.trade_direction = 'sell' AND t.${outcomeIndexColumn} != gr.winning_outcome_index)
                THEN 1.0
                ELSE 0.0
              END
            ELSE 0.0
          END
        ) * 100 as win_rate
      FROM vw_trades_canonical_v3_preview t
      LEFT JOIN gamma_resolved mr
        ON t.${conditionIdColumn} = gr.condition_id
      WHERE lower(t.wallet_address) IN (${walletsParam})
        AND t.timestamp >= now() - INTERVAL 12 MONTH
        AND t.${conditionIdColumn} IS NOT NULL
        AND t.${conditionIdColumn} != ''
        AND t.${conditionIdColumn} != '0000000000000000000000000000000000000000000000000000000000000000'
        AND gr.winning_outcome_index IS NOT NULL
      GROUP BY month, wallet_address
    )
    SELECT
      month,
      AVG(resolved_trades) as avg_resolved_trades,
      AVG(total_pnl) as avg_total_pnl,
      AVG(total_pnl / resolved_trades) as avg_pnl_per_trade,
      AVG(win_rate) as avg_win_rate
    FROM wallet_monthly_pnl
    GROUP BY month
    ORDER BY month
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json() as any[];

  return data.map(row => ({
    month: String(row.month),
    avg_resolved_trades: parseFloat(row.avg_resolved_trades),
    avg_total_pnl: parseFloat(row.avg_total_pnl),
    avg_pnl_per_trade: parseFloat(row.avg_pnl_per_trade),
    avg_win_rate: parseFloat(row.avg_win_rate)
  }));
}

function printWalletComparison(v2Data: WalletPnLMetrics[], v3Data: WalletPnLMetrics[], walletName: string) {
  console.log(`Month      Resolved Trades       Total PnL            Avg PnL/Trade        Win Rate           Status`);
  console.log(`           v2      v3    Δ        v2         v3        v2       v3         v2%    v3%    Δ`);
  console.log('─'.repeat(100));

  // Create a map for easy lookup
  const v2Map = new Map(v2Data.map(d => [d.month, d]));
  const v3Map = new Map(v3Data.map(d => [d.month, d]));

  const allMonths = new Set([...v2Data.map(d => d.month), ...v3Data.map(d => d.month)]);
  const sortedMonths = Array.from(allMonths).sort();

  let totalDanger = 0;
  let totalWarning = 0;

  for (const month of sortedMonths) {
    const v2 = v2Map.get(month);
    const v3 = v3Map.get(month);

    if (!v2 && !v3) continue;

    const v2Trades = v2?.resolved_trades ?? 0;
    const v3Trades = v3?.resolved_trades ?? 0;
    const tradeDelta = v3Trades - v2Trades;

    const v2TotalPnL = v2?.total_pnl ?? 0;
    const v3TotalPnL = v3?.total_pnl ?? 0;

    const v2AvgPnL = v2?.avg_pnl ?? 0;
    const v3AvgPnL = v3?.avg_pnl ?? 0;

    const v2WinRate = v2?.win_rate ?? 0;
    const v3WinRate = v3?.win_rate ?? 0;
    const winRateDelta = v3WinRate - v2WinRate;

    // Flag dangerous changes
    const pnlChangePct = v2TotalPnL !== 0 ? Math.abs((v3TotalPnL - v2TotalPnL) / v2TotalPnL * 100) : 0;
    let status = '';

    if (pnlChangePct > 50) {
      status = '🔴 DANGER';
      totalDanger++;
    } else if (pnlChangePct > 10) {
      status = '⚠️  WARNING';
      totalWarning++;
    } else if (Math.abs(tradeDelta) > 0 || pnlChangePct > 0) {
      status = '✅ OK';
    }

    console.log(
      `${month}  ` +
      `${v2Trades.toString().padStart(6)}  ${v3Trades.toString().padStart(6)}  ${tradeDelta >= 0 ? '+' : ''}${tradeDelta.toString().padStart(4)}  ` +
      `${formatUSD(v2TotalPnL).padStart(10)}  ${formatUSD(v3TotalPnL).padStart(10)}  ` +
      `${formatUSD(v2AvgPnL).padStart(8)}  ${formatUSD(v3AvgPnL).padStart(8)}  ` +
      `${v2WinRate.toFixed(1).padStart(5)}  ${v3WinRate.toFixed(1).padStart(5)}  ${winRateDelta >= 0 ? '+' : ''}${winRateDelta.toFixed(1).padStart(5)}  ` +
      `${status}`
    );
  }

  console.log('');
  console.log(`Summary: ${totalDanger} dangerous changes, ${totalWarning} warnings`);
}

function printCohortComparison(v2Data: CohortMetrics[], v3Data: CohortMetrics[], cohortName: string) {
  console.log(`Month      Avg Resolved Trades   Avg Total PnL        Avg PnL/Trade        Avg Win Rate       Status`);
  console.log(`           v2      v3    Δ        v2         v3        v2       v3         v2%    v3%    Δ`);
  console.log('─'.repeat(100));

  const v2Map = new Map(v2Data.map(d => [d.month, d]));
  const v3Map = new Map(v3Data.map(d => [d.month, d]));

  const allMonths = new Set([...v2Data.map(d => d.month), ...v3Data.map(d => d.month)]);
  const sortedMonths = Array.from(allMonths).sort();

  let totalDanger = 0;
  let totalWarning = 0;

  for (const month of sortedMonths) {
    const v2 = v2Map.get(month);
    const v3 = v3Map.get(month);

    if (!v2 && !v3) continue;

    const v2Trades = v2?.avg_resolved_trades ?? 0;
    const v3Trades = v3?.avg_resolved_trades ?? 0;
    const tradeDelta = v3Trades - v2Trades;

    const v2TotalPnL = v2?.avg_total_pnl ?? 0;
    const v3TotalPnL = v3?.avg_total_pnl ?? 0;

    const v2AvgPnL = v2?.avg_pnl_per_trade ?? 0;
    const v3AvgPnL = v3?.avg_pnl_per_trade ?? 0;

    const v2WinRate = v2?.avg_win_rate ?? 0;
    const v3WinRate = v3?.avg_win_rate ?? 0;
    const winRateDelta = v3WinRate - v2WinRate;

    const pnlChangePct = v2TotalPnL !== 0 ? Math.abs((v3TotalPnL - v2TotalPnL) / v2TotalPnL * 100) : 0;
    let status = '';

    if (pnlChangePct > 50) {
      status = '🔴 DANGER';
      totalDanger++;
    } else if (pnlChangePct > 10) {
      status = '⚠️  WARNING';
      totalWarning++;
    } else if (Math.abs(tradeDelta) > 0 || pnlChangePct > 0) {
      status = '✅ OK';
    }

    console.log(
      `${month}  ` +
      `${v2Trades.toFixed(1).padStart(6)}  ${v3Trades.toFixed(1).padStart(6)}  ${tradeDelta >= 0 ? '+' : ''}${tradeDelta.toFixed(1).padStart(6)}  ` +
      `${formatUSD(v2TotalPnL).padStart(10)}  ${formatUSD(v3TotalPnL).padStart(10)}  ` +
      `${formatUSD(v2AvgPnL).padStart(8)}  ${formatUSD(v3AvgPnL).padStart(8)}  ` +
      `${v2WinRate.toFixed(1).padStart(5)}  ${v3WinRate.toFixed(1).padStart(5)}  ${winRateDelta >= 0 ? '+' : ''}${winRateDelta.toFixed(1).padStart(5)}  ` +
      `${status}`
    );
  }

  console.log('');
  console.log(`Summary: ${totalDanger} dangerous changes, ${totalWarning} warnings`);
}

function formatUSD(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1000000) {
    return `${sign}$${(abs / 1000000).toFixed(1)}M`;
  } else if (abs >= 1000) {
    return `${sign}$${(abs / 1000).toFixed(1)}K`;
  } else {
    return `${sign}$${abs.toFixed(0)}`;
  }
}

main().catch(console.error);
