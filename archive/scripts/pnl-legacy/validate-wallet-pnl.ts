#!/usr/bin/env node
import { config } from 'dotenv';
import { clickhouse } from '../lib/clickhouse/client.js';

// Load environment variables
config({ path: '.env.local' });

const TEST_WALLETS = [
  { address: '0xe29aaa4696b824ae186075a4a1220262f2f7612f', markets: 44, volume: '$24M' },
  { address: '0xd38ad20037839959d89165cf448568d584b28d26', markets: 99, volume: '$22M' },
  { address: '0x614ef98a8be021de3a974942b2fb98794ff34f1b', markets: 139, volume: '$14M' },
  { address: '0x5e0220909135c88382a2128e1e8ef1278567817e', markets: 98, volume: '$13M' },
];

interface WalletPnL {
  trader_wallet: string;
  resolved_markets: number;
  total_cash_flow: number;
  total_resolution_value: number;
  realized_pnl: number;
}

interface MarketPnL {
  condition_id: string;
  market_pnl: number;
}

async function getWalletPnL(wallet: string): Promise<WalletPnL | null> {
  const query = `
    WITH per_outcome AS (
        SELECT
            t.trader_wallet,
            m.condition_id,
            m.outcome_index,
            sum(CASE WHEN lower(t.side) = 'buy'
                     THEN -(t.usdc_amount / 1000000)
                     ELSE +(t.usdc_amount / 1000000) END) as cash_delta,
            sum(CASE WHEN lower(t.side) = 'buy'
                     THEN +(t.token_amount / 1000000)
                     ELSE -(t.token_amount / 1000000) END) as final_shares
        FROM pm_trader_events_v2 t
        JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
        WHERE t.trader_wallet = '${wallet}'
        GROUP BY t.trader_wallet, m.condition_id, m.outcome_index
    ),
    with_resolution AS (
        SELECT
            p.*,
            CASE
                WHEN r.payout_numerators LIKE '[0,%' AND p.outcome_index = 0 THEN 0.0
                WHEN r.payout_numerators LIKE '[0,%' AND p.outcome_index = 1 THEN 1.0
                WHEN r.payout_numerators LIKE '[1,%' AND p.outcome_index = 0 THEN 1.0
                WHEN r.payout_numerators LIKE '[1,%' AND p.outcome_index = 1 THEN 0.0
                ELSE 0.0
            END as resolved_price
        FROM per_outcome p
        INNER JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id
    )
    SELECT
        trader_wallet,
        count(DISTINCT condition_id) as resolved_markets,
        round(sum(cash_delta), 2) as total_cash_flow,
        round(sum(final_shares * resolved_price), 2) as total_resolution_value,
        round(sum(cash_delta + final_shares * resolved_price), 2) as realized_pnl
    FROM with_resolution
    GROUP BY trader_wallet;
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json<WalletPnL>();
  return rows.length > 0 ? rows[0] : null;
}

async function getTopWinsAndLosses(wallet: string): Promise<{ wins: MarketPnL[], losses: MarketPnL[] }> {
  const query = `
    WITH per_outcome AS (
        SELECT
            m.condition_id,
            m.outcome_index,
            sum(CASE WHEN lower(t.side) = 'buy'
                     THEN -(t.usdc_amount / 1000000)
                     ELSE +(t.usdc_amount / 1000000) END) as cash_delta,
            sum(CASE WHEN lower(t.side) = 'buy'
                     THEN +(t.token_amount / 1000000)
                     ELSE -(t.token_amount / 1000000) END) as final_shares
        FROM pm_trader_events_v2 t
        JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
        WHERE t.trader_wallet = '${wallet}'
        GROUP BY m.condition_id, m.outcome_index
    ),
    with_resolution AS (
        SELECT
            p.*,
            CASE
                WHEN r.payout_numerators LIKE '[0,%' AND p.outcome_index = 0 THEN 0.0
                WHEN r.payout_numerators LIKE '[0,%' AND p.outcome_index = 1 THEN 1.0
                WHEN r.payout_numerators LIKE '[1,%' AND p.outcome_index = 0 THEN 1.0
                WHEN r.payout_numerators LIKE '[1,%' AND p.outcome_index = 1 THEN 0.0
                ELSE 0.0
            END as resolved_price
        FROM per_outcome p
        INNER JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id
    ),
    per_market AS (
        SELECT
            condition_id,
            round(sum(cash_delta + final_shares * resolved_price), 2) as market_pnl
        FROM with_resolution
        GROUP BY condition_id
    )
    SELECT condition_id, market_pnl
    FROM per_market
    ORDER BY market_pnl DESC;
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json<MarketPnL>();

  const wins = rows.filter(r => r.market_pnl > 0).slice(0, 3);
  const losses = rows.filter(r => r.market_pnl < 0).slice(-3).reverse();

  return { wins, losses };
}

async function main() {
  console.log('🔍 Validating PnL for test wallets using canonical formula\n');
  console.log('Canonical Formula:');
  console.log('- Units: micro-units (÷ 1,000,000)');
  console.log('- Side: lowercase buy/sell');
  console.log('- outcome_index: 0=Yes, 1=No');
  console.log('- Resolution: [0,1]=outcome 1 wins, [1,0]=outcome 0 wins');
  console.log('- Fees: ZERO\n');
  console.log('═'.repeat(100));

  const results: any[] = [];

  for (const wallet of TEST_WALLETS) {
    console.log(`\n📊 Wallet: ${wallet.address}`);
    console.log(`Expected: ${wallet.markets} markets, ${wallet.volume} volume\n`);

    try {
      const pnl = await getWalletPnL(wallet.address);

      if (!pnl) {
        console.log('❌ No PnL data found for this wallet');
        results.push({
          wallet: wallet.address,
          markets: 0,
          realized_pnl: 0,
          top_win: 'N/A',
          top_loss: 'N/A',
        });
        continue;
      }

      console.log(`Resolved Markets: ${pnl.resolved_markets}`);
      console.log(`Total Cash Flow: $${pnl.total_cash_flow.toLocaleString()}`);
      console.log(`Total Resolution Value: $${pnl.total_resolution_value.toLocaleString()}`);
      console.log(`Realized PnL: $${pnl.realized_pnl.toLocaleString()}`);

      const { wins, losses } = await getTopWinsAndLosses(wallet.address);

      console.log('\n✅ Top 3 Wins:');
      wins.forEach((w, i) => {
        console.log(`  ${i + 1}. $${w.market_pnl.toLocaleString()} (${w.condition_id.substring(0, 12)}...)`);
      });

      console.log('\n❌ Top 3 Losses:');
      losses.forEach((l, i) => {
        console.log(`  ${i + 1}. $${l.market_pnl.toLocaleString()} (${l.condition_id.substring(0, 12)}...)`);
      });

      results.push({
        wallet: wallet.address,
        markets: pnl.resolved_markets,
        realized_pnl: pnl.realized_pnl,
        top_win: wins[0] ? `$${wins[0].market_pnl.toLocaleString()}` : 'N/A',
        top_loss: losses[0] ? `$${losses[0].market_pnl.toLocaleString()}` : 'N/A',
      });

    } catch (error) {
      console.error(`❌ Error processing wallet: ${error}`);
      results.push({
        wallet: wallet.address,
        markets: 'ERROR',
        realized_pnl: 'ERROR',
        top_win: 'ERROR',
        top_loss: 'ERROR',
      });
    }
  }

  console.log('\n\n' + '═'.repeat(100));
  console.log('📋 SUMMARY TABLE\n');
  console.log('| Wallet | Markets | Realized PnL | Top Win | Top Loss |');
  console.log('|--------|---------|--------------|---------|----------|');

  results.forEach(r => {
    const wallet = `${r.wallet.substring(0, 10)}...`;
    const markets = typeof r.markets === 'number' ? r.markets.toString() : r.markets;
    const pnl = typeof r.realized_pnl === 'number' ? `$${r.realized_pnl.toLocaleString()}` : r.realized_pnl;
    console.log(`| ${wallet} | ${markets} | ${pnl} | ${r.top_win} | ${r.top_loss} |`);
  });

  console.log('\n' + '═'.repeat(100));
}

main().catch(console.error);
