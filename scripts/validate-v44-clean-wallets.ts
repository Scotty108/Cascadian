/**
 * Validate V44 formula on CLOB-only non-phantom wallets
 * These wallets should have sells <= buys * 1.01
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function validateCleanWallets() {
  console.log('Validating V44 formula on non-phantom wallets...\n');

  // Get 30 random non-phantom wallets with 50+ trades
  const sampleQuery = `
    WITH
      wallet_inventory AS (
        SELECT
          lower(trader_wallet) as wallet,
          count() as trades,
          sumIf(token_amount, side = 'buy') / 1e6 as total_bought,
          sumIf(token_amount, side = 'sell') / 1e6 as total_sold
        FROM pm_trader_events_v3
        GROUP BY wallet
        HAVING trades BETWEEN 50 AND 500
          AND total_sold <= total_bought * 1.01  -- NO phantom inventory
      )
    SELECT wallet, trades
    FROM wallet_inventory
    ORDER BY rand()
    LIMIT 30
  `;

  const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
  const wallets = await sampleResult.json() as any[];

  console.log(`Found ${wallets.length} clean wallets to test\n`);

  const results: any[] = [];

  for (const { wallet, trades } of wallets) {
    // Calculate V44 PnL
    const pnlQuery = `
      WITH
        self_fill_txs AS (
          SELECT transaction_hash
          FROM pm_trader_events_v3
          WHERE lower(trader_wallet) = '${wallet}'
          GROUP BY transaction_hash
          HAVING countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0
        ),

        canonical AS (
          SELECT t.token_id, t.side, t.usdc_amount / 1e6 as usdc, t.token_amount / 1e6 as tokens
          FROM pm_trader_events_v3 t
          WHERE lower(t.trader_wallet) = '${wallet}'
            AND (t.transaction_hash NOT IN (SELECT transaction_hash FROM self_fill_txs) OR t.role = 'taker')
        ),

        trades_mapped AS (
          SELECT m.condition_id, m.outcome_index, c.side, c.usdc, c.tokens
          FROM canonical c
          JOIN pm_token_to_condition_map_v5 m ON c.token_id = m.token_id_dec
          WHERE m.condition_id != ''
        ),

        positions AS (
          SELECT condition_id, outcome_index,
            sumIf(tokens, side = 'buy') - sumIf(tokens, side = 'sell') as net_tokens,
            sumIf(usdc, side = 'sell') - sumIf(usdc, side = 'buy') as cash_flow
          FROM trades_mapped
          GROUP BY condition_id, outcome_index
        )

      SELECT
        sum(p.cash_flow) as cash_flow,
        sumIf(p.net_tokens, p.net_tokens > 0 AND toInt64OrNull(JSONExtractString(r.payout_numerators, p.outcome_index + 1)) = 1) as long_wins,
        sumIf(-p.net_tokens, p.net_tokens < 0 AND toInt64OrNull(JSONExtractString(r.payout_numerators, p.outcome_index + 1)) = 1) as short_losses
      FROM positions p
      LEFT JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id AND r.is_deleted = 0
    `;

    const pnlResult = await clickhouse.query({ query: pnlQuery, format: 'JSONEachRow' });
    const pnlData = (await pnlResult.json() as any[])[0] || {};

    const cashFlow = Number(pnlData.cash_flow) || 0;
    const longWins = Number(pnlData.long_wins) || 0;
    const shortLosses = Number(pnlData.short_losses) || 0;
    const v44Pnl = cashFlow + longWins - shortLosses;

    // Get API PnL from correct endpoint (returns time series, take last value)
    let apiPnl = 0;
    try {
      const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
      if (res.ok) {
        const data = await res.json() as Array<{t: number; p: number}>;
        if (data && data.length > 0) {
          apiPnl = data[data.length - 1].p || 0;
        }
      }
    } catch (e) {
      // API failed
    }

    const error = v44Pnl - apiPnl;
    const withinDollar = Math.abs(error) <= 1;
    const withinTenDollars = Math.abs(error) <= 10;

    results.push({
      wallet: wallet.slice(0, 10) + '...',
      trades,
      v44: v44Pnl.toFixed(2),
      api: apiPnl.toFixed(2),
      error: error.toFixed(2),
      withinDollar: withinDollar ? 'Y' : 'N',
      withinTen: withinTenDollars ? 'Y' : 'N'
    });

    process.stdout.write('.');

    // Rate limit API calls
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('\n\nResults:\n');
  console.table(results);

  const withinDollar = results.filter(r => r.withinDollar === 'Y').length;
  const withinTen = results.filter(r => r.withinTen === 'Y').length;

  console.log(`\nSummary:`);
  console.log(`  Within $1:  ${withinDollar}/${results.length} (${(100*withinDollar/results.length).toFixed(0)}%)`);
  console.log(`  Within $10: ${withinTen}/${results.length} (${(100*withinTen/results.length).toFixed(0)}%)`);
}

validateCleanWallets().catch(console.error);
