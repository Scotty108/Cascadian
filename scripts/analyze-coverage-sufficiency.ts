import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function analyzeCoverageSufficiency() {
  console.log('=== COVERAGE SUFFICIENCY ANALYSIS ===\n');

  // 1. Coverage by DOLLAR VOLUME
  console.log('1. COVERAGE BY DOLLAR VOLUME:');
  const volumeQuery = `
    SELECT
      sum(toFloat64(shares) * toFloat64(entry_price)) as total_volume,
      sumIf(toFloat64(shares) * toFloat64(entry_price), r.condition_id_norm IS NOT NULL) as covered_volume,
      round(covered_volume / total_volume * 100, 2) as coverage_pct
    FROM default.vw_trades_canonical t
    LEFT JOIN default.market_resolutions_final r
      ON lower(replaceAll(t.condition_id_norm, '0x', '')) = lower(r.condition_id_norm)
  `;
  
  const volumeResult = await client.query({ query: volumeQuery, format: 'JSONEachRow' });
  const volumeData = await volumeResult.json();
  console.log(JSON.stringify(volumeData, null, 2));
  console.log();

  // 2. Coverage by RECENCY
  console.log('2. COVERAGE BY RECENCY:');
  const recencyQuery = `
    WITH time_buckets AS (
      SELECT
        CASE
          WHEN timestamp >= now() - INTERVAL 30 DAY THEN '30_days'
          WHEN timestamp >= now() - INTERVAL 90 DAY THEN '90_days'
          WHEN timestamp >= now() - INTERVAL 365 DAY THEN '365_days'
          ELSE 'older'
        END as time_bucket,
        toFloat64(shares) * toFloat64(entry_price) as volume,
        r.condition_id_norm IS NOT NULL as has_resolution
      FROM default.vw_trades_canonical t
      LEFT JOIN default.market_resolutions_final r
        ON lower(replaceAll(t.condition_id_norm, '0x', '')) = lower(r.condition_id_norm)
    )
    SELECT
      time_bucket,
      count() as trade_count,
      sum(volume) as total_volume,
      countIf(has_resolution) as trades_with_resolution,
      sumIf(volume, has_resolution) as volume_with_resolution,
      round(trades_with_resolution / trade_count * 100, 2) as trade_coverage_pct,
      round(volume_with_resolution / total_volume * 100, 2) as volume_coverage_pct
    FROM time_buckets
    GROUP BY time_bucket
    ORDER BY
      CASE time_bucket
        WHEN '30_days' THEN 1
        WHEN '90_days' THEN 2
        WHEN '365_days' THEN 3
        ELSE 4
      END
  `;
  
  const recencyResult = await client.query({ query: recencyQuery, format: 'JSONEachRow' });
  const recencyData = await recencyResult.json();
  console.log(JSON.stringify(recencyData, null, 2));
  console.log();

  // 3. Audit wallet analysis
  console.log('3. AUDIT WALLET ANALYSIS:');
  
  const auditWallets = [
    '0x2f27c4d0ea1c63dfd50045b089a1e8cf78b27ba6',
    '0x430baa7807b9c81f5762f66cf936f5b2bb2f3af6',
    '0xa88cc4ada4ac33c78c93dfb92e859db8d1c2ceae',
    '0x8ce4f2aa72f71c41f44fe7b9c34d16b4e53e5c20',
    '0xd16c3e2a169c08158f5f6c4e01e516652044f873',
    '0x0d61a6b3f5db24f69e4adda56f8f7f4c6d6f29bb',
    '0x0000000000000000000000000000000000000000',
    '0x7a3c2c3a4e2e2e5e5e5e5e5e5e5e5e5e5e5e5e5e',
    '0xF5B36F1e5fAa1e19Ff0C93C1eEBC87E8a091FA36',
    '0x92d936Fc447FaE4e0A1a9c1e6C3B5f4b4c4c4c4c',
    '0x1234567890123456789012345678901234567890',
    '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
  ];

  for (const wallet of auditWallets) {
    const walletPrefix = wallet.slice(0, 10);
    const walletQuery = `
      WITH wallet_positions AS (
        SELECT
          t.condition_id_norm,
          t.direction,
          sum(toFloat64(t.shares)) as net_shares,
          sum(toFloat64(t.shares) * toFloat64(t.entry_price)) as cost_basis,
          r.condition_id_norm IS NOT NULL as has_resolution,
          r.winning_outcome_index,
          r.payout_numerators
        FROM default.vw_trades_canonical t
        LEFT JOIN default.market_resolutions_final r
          ON lower(replaceAll(t.condition_id_norm, '0x', '')) = lower(r.condition_id_norm)
        WHERE lower(t.wallet_address) = lower('${wallet}')
        GROUP BY t.condition_id_norm, t.direction, r.condition_id_norm, r.winning_outcome_index, r.payout_numerators
        HAVING net_shares != 0
      )
      SELECT
        count() as open_positions,
        countIf(has_resolution) as open_with_resolution,
        round(countIf(has_resolution) / count() * 100, 2) as resolution_coverage_pct
      FROM wallet_positions
    `;
    
    try {
      const walletResult = await client.query({ query: walletQuery, format: 'JSONEachRow' });
      const walletData = await walletResult.json();
      console.log(`Wallet ${walletPrefix}...:`);
      console.log(JSON.stringify(walletData, null, 2));
    } catch (err: any) {
      console.log(`Wallet ${walletPrefix}...: ERROR - ${err.message}`);
    }
  }
  console.log();

  // 4. P&L Component Requirements
  console.log('4. P&L COMPONENT REQUIREMENTS:\n');
  
  console.log('REALIZED P&L:');
  const realizedQuery = `
    SELECT
      count() as closed_positions,
      count(DISTINCT condition_id_norm) as unique_markets,
      sum(toFloat64(shares) * toFloat64(entry_price)) as total_volume,
      'NO RESOLUTIONS NEEDED - Pure buy/sell spreads' as requirement
    FROM default.vw_trades_canonical
    WHERE direction IN ('BUY', 'SELL')
  `;
  const realizedResult = await client.query({ query: realizedQuery, format: 'JSONEachRow' });
  const realizedData = await realizedResult.json();
  console.log(JSON.stringify(realizedData, null, 2));
  console.log();

  console.log('UNREALIZED P&L:');
  const unrealizedQuery = `
    WITH open_positions AS (
      SELECT
        condition_id_norm,
        sum(toFloat64(shares)) as net_shares,
        sum(toFloat64(shares) * toFloat64(entry_price)) as cost_basis
      FROM default.vw_trades_canonical
      GROUP BY condition_id_norm
      HAVING net_shares != 0
    )
    SELECT
      count() as open_positions,
      sum(cost_basis) as total_exposure,
      'REQUIRES: Midprices for open markets OR resolutions for closed markets' as requirement
    FROM open_positions
  `;
  const unrealizedResult = await client.query({ query: unrealizedQuery, format: 'JSONEachRow' });
  const unrealizedData = await unrealizedResult.json();
  console.log(JSON.stringify(unrealizedData, null, 2));
  console.log();

  console.log('REDEMPTION P&L:');
  const redemptionQuery = `
    WITH open_positions AS (
      SELECT
        t.condition_id_norm,
        sum(toFloat64(t.shares)) as net_shares,
        r.condition_id_norm IS NOT NULL as has_resolution
      FROM default.vw_trades_canonical t
      LEFT JOIN default.market_resolutions_final r
        ON lower(replaceAll(t.condition_id_norm, '0x', '')) = lower(r.condition_id_norm)
      GROUP BY t.condition_id_norm, r.condition_id_norm
      HAVING net_shares != 0
    )
    SELECT
      count() as open_positions,
      countIf(has_resolution) as redeemable_positions,
      round(countIf(has_resolution) / count() * 100, 2) as redemption_coverage_pct,
      'REQUIRES: Resolutions + payout vectors' as requirement
    FROM open_positions
  `;
  const redemptionResult = await client.query({ query: redemptionQuery, format: 'JSONEachRow' });
  const redemptionData = await redemptionResult.json();
  console.log(JSON.stringify(redemptionData, null, 2));
  console.log();

  // 5. Open vs Closed market analysis
  console.log('5. OPEN VS CLOSED MARKET ANALYSIS:');
  const openClosedQuery = `
    WITH position_status AS (
      SELECT
        t.condition_id_norm,
        sum(toFloat64(t.shares)) as net_shares,
        sum(toFloat64(t.shares) * toFloat64(t.entry_price)) as cost_basis,
        r.condition_id_norm IS NOT NULL as has_resolution
      FROM default.vw_trades_canonical t
      LEFT JOIN default.market_resolutions_final r
        ON lower(replaceAll(t.condition_id_norm, '0x', '')) = lower(r.condition_id_norm)
      GROUP BY t.condition_id_norm, r.condition_id_norm
      HAVING net_shares != 0
    )
    SELECT
      CASE WHEN has_resolution THEN 'CLOSED' ELSE 'OPEN' END as market_status,
      count() as position_count,
      sum(cost_basis) as total_exposure,
      round(sum(cost_basis) / (SELECT sum(cost_basis) FROM position_status) * 100, 2) as exposure_pct
    FROM position_status
    GROUP BY market_status
  `;
  const openClosedResult = await client.query({ query: openClosedQuery, format: 'JSONEachRow' });
  const openClosedData = await openClosedResult.json();
  console.log(JSON.stringify(openClosedData, null, 2));
  console.log();

  await client.close();
}

analyzeCoverageSufficiency().catch(console.error);
