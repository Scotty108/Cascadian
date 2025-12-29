/**
 * Debug astronomical FPMM PnL values
 *
 * Investigate why some wallets show $577B+ PnL from FPMM trades.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.local from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { clickhouse } from '../../lib/clickhouse/client';

async function debugFpmmWallet() {
  // The wallet that showed $577B
  const walletPrefix = '0xb5fc4d5388952dc7a7';

  console.log('=== DEBUGGING ASTRONOMICAL FPMM PnL ===');
  console.log('Wallet (prefix):', walletPrefix);

  // First, get the full wallet address
  const walletQuery = await clickhouse.query({
    query: `
      SELECT DISTINCT lower(trader_wallet) as w
      FROM pm_fpmm_trades
      WHERE lower(trader_wallet) LIKE '${walletPrefix.toLowerCase()}%'
      LIMIT 1
    `,
    format: 'JSONEachRow',
  });
  const walletData = (await walletQuery.json()) as any[];

  if (walletData.length === 0) {
    console.log('Wallet not found');
    return;
  }

  const fullWallet = walletData[0].w;
  console.log('Full wallet:', fullWallet);

  // Get FPMM trade summary
  const fpmmStats = await clickhouse.query({
    query: `
      SELECT
        count() as total_trades,
        countIf(side = 'buy') as buys,
        countIf(side = 'sell') as sells,
        sum(token_amount) as total_tokens,
        sum(usdc_amount) as total_usdc,
        min(token_amount) as min_tokens,
        max(token_amount) as max_tokens,
        min(usdc_amount) as min_usdc,
        max(usdc_amount) as max_usdc
      FROM pm_fpmm_trades
      WHERE lower(trader_wallet) = '${fullWallet}'
        AND is_deleted = 0
    `,
    format: 'JSONEachRow',
  });
  const stats = ((await fpmmStats.json()) as any[])[0];

  console.log('\n=== FPMM TRADE STATS ===');
  console.log('Total trades:', stats.total_trades);
  console.log('Buys:', stats.buys);
  console.log('Sells:', stats.sells);
  console.log('Total tokens:', Number(stats.total_tokens).toLocaleString());
  console.log('Total USDC:', Number(stats.total_usdc).toLocaleString());
  console.log('Token range:', stats.min_tokens, '-', stats.max_tokens);
  console.log('USDC range:', stats.min_usdc, '-', stats.max_usdc);

  // Check for extreme outliers
  console.log('\n=== OUTLIER ANALYSIS ===');
  const outliers = await clickhouse.query({
    query: `
      SELECT
        block_number,
        side,
        token_amount,
        usdc_amount,
        CASE WHEN token_amount > 0 THEN usdc_amount / token_amount ELSE -1 END as calc_price,
        fpmm_pool_address
      FROM pm_fpmm_trades
      WHERE lower(trader_wallet) = '${fullWallet}'
        AND is_deleted = 0
        AND (token_amount > 1000000000 OR usdc_amount > 1000000000 OR
             (token_amount > 0 AND usdc_amount / token_amount > 2))
      ORDER BY token_amount DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });
  const outlierData = (await outliers.json()) as any[];

  if (outlierData.length > 0) {
    console.log('Found', outlierData.length, 'outlier trades:');
    for (const row of outlierData) {
      console.log(
        '  Block:',
        row.block_number,
        '| Side:',
        row.side,
        '| Tokens:',
        Number(row.token_amount).toLocaleString(),
        '| USDC:',
        Number(row.usdc_amount).toLocaleString(),
        '| Price:',
        Number(row.calc_price).toFixed(4)
      );
    }
  } else {
    console.log('No individual outliers found');
  }

  // Check with all filters applied
  console.log('\n=== FILTERED STATS (what V3+FPMM uses) ===');
  const filtered = await clickhouse.query({
    query: `
      SELECT
        count() as filtered_trades,
        sum(token_amount) as filtered_tokens,
        sum(usdc_amount) as filtered_usdc,
        avg(usdc_amount / token_amount) as avg_price
      FROM pm_fpmm_trades t
      INNER JOIN pm_fpmm_pool_map p ON lower(t.fpmm_pool_address) = lower(p.fpmm_pool_address)
      WHERE lower(t.trader_wallet) = '${fullWallet}'
        AND t.is_deleted = 0
        AND p.condition_id IS NOT NULL
        AND p.condition_id != ''
        AND t.token_amount > 0
        AND t.usdc_amount > 0
        AND t.usdc_amount / t.token_amount <= 2
    `,
    format: 'JSONEachRow',
  });
  const filteredStats = ((await filtered.json()) as any[])[0];

  console.log('Filtered trades:', filteredStats.filtered_trades);
  console.log('Filtered tokens:', Number(filteredStats.filtered_tokens).toLocaleString());
  console.log('Filtered USDC:', Number(filteredStats.filtered_usdc).toLocaleString());
  console.log(
    'Avg price:',
    filteredStats.avg_price ? Number(filteredStats.avg_price).toFixed(4) : 'N/A'
  );

  // Check sample of trades with join - look for duplication
  console.log('\n=== CHECKING FOR DUPLICATION IN JOIN ===');
  const joinCheck = await clickhouse.query({
    query: `
      SELECT
        count() as rows_without_join,
        (SELECT count()
         FROM pm_fpmm_trades t
         INNER JOIN pm_fpmm_pool_map p ON lower(t.fpmm_pool_address) = lower(p.fpmm_pool_address)
         WHERE lower(t.trader_wallet) = '${fullWallet}' AND t.is_deleted = 0) as rows_with_join
      FROM pm_fpmm_trades
      WHERE lower(trader_wallet) = '${fullWallet}' AND is_deleted = 0
    `,
    format: 'JSONEachRow',
  });
  const joinData = ((await joinCheck.json()) as any[])[0];
  console.log('Rows without join:', joinData.rows_without_join);
  console.log('Rows with join:', joinData.rows_with_join);
  console.log(
    'Expansion factor:',
    (Number(joinData.rows_with_join) / Number(joinData.rows_without_join)).toFixed(2) + 'x'
  );

  // Check if there are duplicate pool mappings
  console.log('\n=== CHECKING POOL MAP DUPLICATES ===');
  const poolDups = await clickhouse.query({
    query: `
      SELECT
        lower(fpmm_pool_address) as pool,
        count() as mapping_count
      FROM pm_fpmm_pool_map
      GROUP BY lower(fpmm_pool_address)
      HAVING count() > 1
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const poolDupData = (await poolDups.json()) as any[];
  if (poolDupData.length > 0) {
    console.log('Found', poolDupData.length, 'pools with multiple mappings:');
    for (const row of poolDupData) {
      console.log('  Pool:', row.pool.substring(0, 20) + '...', '| Mappings:', row.mapping_count);
    }
  } else {
    console.log('No duplicate pool mappings found');
  }

  // Now run the actual V3+FPMM engine to see the breakdown
  console.log('\n=== RUNNING V3+FPMM ENGINE ===');
  const { computeWalletActivityPnlV3WithFPMMDebug } = await import(
    '../../lib/pnl/uiActivityEngineV3WithFPMM'
  );
  try {
    const result = await computeWalletActivityPnlV3WithFPMMDebug(fullWallet);
    console.log('PnL Total:', result.pnl_activity_total.toLocaleString());
    console.log('Gain:', result.gain_activity.toLocaleString());
    console.log('Loss:', result.loss_activity.toLocaleString());
    console.log('CLOB fills:', result.clob_fills_count);
    console.log('FPMM fills:', result.fpmm_fills_count);
    console.log('Redemptions:', result.redemptions_count);
    console.log('Volume traded:', result.volume_traded.toLocaleString());
    console.log('PnL from CLOB:', result.pnl_from_clob.toLocaleString());
    console.log('PnL from redemptions:', result.pnl_from_redemptions.toLocaleString());
    console.log('PnL from resolution losses:', result.pnl_from_resolution_losses.toLocaleString());
  } catch (e: any) {
    console.log('Engine error:', e.message);
  }

  // Investigate FPMM price distribution to find the culprit
  console.log('\n=== FPMM PRICE DISTRIBUTION (all data) ===');
  const priceDistribution = await clickhouse.query({
    query: `
      SELECT
        CASE
          WHEN t.usdc_amount / t.token_amount < 0.01 THEN '< $0.01'
          WHEN t.usdc_amount / t.token_amount < 0.10 THEN '$0.01-0.10'
          WHEN t.usdc_amount / t.token_amount < 0.50 THEN '$0.10-0.50'
          WHEN t.usdc_amount / t.token_amount < 1.00 THEN '$0.50-1.00'
          WHEN t.usdc_amount / t.token_amount <= 2.00 THEN '$1.00-2.00'
          ELSE '> $2.00'
        END as price_bucket,
        count() as trades,
        sum(t.token_amount) as total_tokens,
        sum(t.usdc_amount) as total_usdc,
        avg(t.usdc_amount / t.token_amount) as avg_price
      FROM pm_fpmm_trades t
      INNER JOIN pm_fpmm_pool_map p ON lower(t.fpmm_pool_address) = lower(p.fpmm_pool_address)
      WHERE lower(t.trader_wallet) = '${fullWallet}'
        AND t.is_deleted = 0
        AND t.token_amount > 0
        AND t.usdc_amount > 0
        AND t.usdc_amount / t.token_amount <= 2
      GROUP BY price_bucket
      ORDER BY price_bucket
    `,
    format: 'JSONEachRow',
  });
  const priceData = (await priceDistribution.json()) as any[];
  console.log('Price bucket distribution:');
  for (const row of priceData) {
    console.log(
      '  ',
      row.price_bucket,
      '| Trades:',
      Number(row.trades).toLocaleString(),
      '| Tokens:',
      Number(row.total_tokens).toLocaleString(),
      '| USDC:',
      '$' + Number(row.total_usdc).toLocaleString()
    );
  }

  // Find the worst resolution outcomes
  console.log('\n=== WORST RESOLUTION OUTCOMES ===');
  console.log('Looking for positions with extreme resolution PnL...');

  // Get all conditions with FPMM activity
  const fpmmConditions = await clickhouse.query({
    query: `
      SELECT
        p.condition_id,
        t.outcome_index,
        countIf(t.side = 'buy') as buy_count,
        countIf(t.side = 'sell') as sell_count,
        sumIf(t.token_amount, t.side = 'buy') as tokens_bought,
        sumIf(t.token_amount, t.side = 'sell') as tokens_sold,
        sumIf(t.usdc_amount, t.side = 'buy') as usdc_spent,
        sumIf(t.usdc_amount, t.side = 'sell') as usdc_received
      FROM pm_fpmm_trades t
      INNER JOIN pm_fpmm_pool_map p ON lower(t.fpmm_pool_address) = lower(p.fpmm_pool_address)
      WHERE lower(t.trader_wallet) = '${fullWallet}'
        AND t.is_deleted = 0
        AND t.token_amount > 0
        AND t.usdc_amount > 0
        AND t.usdc_amount / t.token_amount <= 2
      GROUP BY p.condition_id, t.outcome_index
      HAVING (tokens_bought - tokens_sold) > 1000000  -- Net position > 1M tokens
      ORDER BY (tokens_bought - tokens_sold) DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const conditionsData = (await fpmmConditions.json()) as any[];

  console.log('Top 10 FPMM positions (net tokens > 1M):');
  for (const row of conditionsData) {
    const netPosition = Number(row.tokens_bought) - Number(row.tokens_sold);
    const avgCost = Number(row.usdc_spent) / Number(row.tokens_bought);
    console.log(
      '  Condition:', row.condition_id.substring(0, 16) + '...',
      '| Outcome:', row.outcome_index,
      '| Net:', netPosition.toLocaleString(), 'tokens',
      '| Avg cost: $' + avgCost.toFixed(4)
    );

    // Check resolution for this condition
    const resolution = await clickhouse.query({
      query: `
        SELECT payout_numerators
        FROM pm_condition_resolutions
        WHERE lower(condition_id) = lower('${row.condition_id}')
      `,
      format: 'JSONEachRow',
    });
    const resData = (await resolution.json()) as any[];
    if (resData.length > 0 && resData[0].payout_numerators) {
      const payouts = JSON.parse(resData[0].payout_numerators);
      const payoutPrice = payouts[Number(row.outcome_index)] || 0;
      const impliedPnl = (payoutPrice - avgCost) * netPosition;
      console.log(
        '    → Payout: $' + payoutPrice.toFixed(2),
        '| Implied PnL: $' + impliedPnl.toLocaleString()
      );
    } else {
      console.log('    → Not resolved');
    }
  }
}

debugFpmmWallet().catch(console.error);
