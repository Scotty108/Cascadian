/**
 * Compare W2 (matches) vs W3 (doesn't match)
 * Understand why W2 matches and W3 doesn't
 *
 * Terminal: Claude 1
 */

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || 'Lbr.jYtw5ikf3',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 120000,
});

const W2 = '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838';
const W3 = '0x418db17eaa8f25eaf2085657d0becd82462c6786';

async function analyzeWallet(wallet: string, label: string, uiPnl: number) {
  console.log('');
  console.log('='.repeat(60));
  console.log(`${label}: UI PnL = $${uiPnl}`);
  console.log('='.repeat(60));

  // 1. Trade summary
  const trades = await client.query({
    query: `
      WITH deduped AS (
        SELECT
          event_id,
          any(side) as side,
          any(usdc_amount)/1e6 as usdc,
          any(token_amount)/1e6 as tokens
        FROM pm_trader_events_v2
        WHERE trader_wallet = {wallet:String} AND is_deleted = 0
        GROUP BY event_id
      )
      SELECT
        SUM(CASE WHEN side = 'buy' THEN usdc ELSE 0 END) as bought,
        SUM(CASE WHEN side = 'sell' THEN usdc ELSE 0 END) as sold,
        SUM(CASE WHEN side = 'buy' THEN tokens ELSE 0 END) as tokens_bought,
        SUM(CASE WHEN side = 'sell' THEN tokens ELSE 0 END) as tokens_sold
      FROM deduped
    `,
    query_params: { wallet },
    format: 'JSONEachRow'
  });
  const t = (await trades.json() as any[])[0];
  console.log(`Trades: Bought $${Number(t?.bought || 0).toFixed(2)}, Sold $${Number(t?.sold || 0).toFixed(2)}`);
  console.log(`Tokens: Bought ${Number(t?.tokens_bought || 0).toFixed(2)}, Sold ${Number(t?.tokens_sold || 0).toFixed(2)}`);
  console.log(`Net Tokens: ${Number((t?.tokens_bought || 0) - (t?.tokens_sold || 0)).toFixed(2)}`);

  // 2. Redemptions
  const redemptions = await client.query({
    query: `
      SELECT
        COUNT(*) as count,
        SUM(toFloat64OrNull(amount_or_payout))/1e6 as total
      FROM pm_ctf_events
      WHERE lower(user_address) = lower({wallet:String})
        AND is_deleted = 0
        AND event_type = 'PayoutRedemption'
    `,
    query_params: { wallet },
    format: 'JSONEachRow'
  });
  const r = (await redemptions.json() as any[])[0];
  console.log(`Redemptions: ${r?.count || 0} events, $${Number(r?.total || 0).toFixed(2)} total`);

  // 3. Unredeemed positions (final shares on winning outcomes)
  const unredeemed = await client.query({
    query: `
      WITH deduped AS (
        SELECT
          event_id,
          any(side) as side,
          any(token_amount)/1e6 as tokens,
          any(t.token_id) as token_id
        FROM pm_trader_events_v2 t
        WHERE trader_wallet = {wallet:String} AND is_deleted = 0
        GROUP BY event_id
      ),
      with_condition AS (
        SELECT
          d.*,
          m.condition_id,
          m.outcome_index
        FROM deduped d
        JOIN pm_token_to_condition_map_v3 m ON toString(d.token_id) = toString(m.token_id_dec)
      ),
      positions AS (
        SELECT
          condition_id,
          outcome_index,
          SUM(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as final_shares
        FROM with_condition
        GROUP BY condition_id, outcome_index
        HAVING final_shares > 0.01  -- Only positive positions
      ),
      with_resolution AS (
        SELECT
          p.*,
          r.payout_numerators
        FROM positions p
        LEFT JOIN pm_condition_resolutions r
          ON lower(p.condition_id) = lower(r.condition_id) AND r.is_deleted = 0
      )
      SELECT
        COUNT(*) as position_count,
        SUM(final_shares) as total_shares,
        SUM(CASE
          WHEN payout_numerators LIKE '[1,%' AND outcome_index = 0 THEN final_shares
          WHEN payout_numerators LIKE '[0,%' AND outcome_index = 1 THEN final_shares
          ELSE 0
        END) as winning_shares
      FROM with_resolution
    `,
    query_params: { wallet },
    format: 'JSONEachRow'
  });
  const u = (await unredeemed.json() as any[])[0];
  console.log(`Positions: ${u?.position_count || 0} with shares`);
  console.log(`Unredeemed winning shares: ${Number(u?.winning_shares || 0).toFixed(2)} (= $${Number(u?.winning_shares || 0).toFixed(2)} value)`);

  // 4. Calculate both methods
  const tradeCash = -(Number(t?.bought || 0)) + Number(t?.sold || 0);
  const redemptionCash = Number(r?.total || 0);
  const winningValue = Number(u?.winning_shares || 0);

  console.log('');
  console.log('PnL Calculations:');
  console.log(`  Method 1 (Trade + Redemption):    ${tradeCash.toFixed(2)} + ${redemptionCash.toFixed(2)} = $${(tradeCash + redemptionCash).toFixed(2)}`);
  console.log(`  Method 2 (+ Unredeemed Winners):  ${tradeCash.toFixed(2)} + ${redemptionCash.toFixed(2)} + ${winningValue.toFixed(2)} = $${(tradeCash + redemptionCash + winningValue).toFixed(2)}`);
  console.log(`  UI PnL: $${uiPnl}`);
}

async function main() {
  await analyzeWallet(W2, 'W2 (MATCHES)', 4404.92);
  await analyzeWallet(W3, 'W3 (FAILS)', 5.44);

  await client.close();
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
