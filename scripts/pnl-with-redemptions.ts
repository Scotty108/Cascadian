/**
 * PnL with Redemptions
 *
 * Simple formula: PnL = Cash In - Cash Out
 * Where:
 * - Cash Out = sum of all CLOB buys
 * - Cash In = sum of all CLOB sells + sum of all redemptions
 *
 * This should give us the correct realized PnL.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function fetchApiPnl(wallet: string): Promise<number | null> {
  try {
    const url = `https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet.toLowerCase()}`;
    const response = await fetch(url);
    if (response.ok) {
      const data = (await response.json()) as Array<{ t: number; p: number }>;
      if (data && data.length > 0) return data[data.length - 1].p;
    }
  } catch {}
  return null;
}

async function main() {
  const wallet = process.argv[2] || '0x1f3178c3f82eee8e67018473b8fc33b3dc7806cb';

  console.log(`\n=== PNL WITH REDEMPTIONS FOR ${wallet} ===\n`);

  const apiPnl = await fetchApiPnl(wallet);
  console.log(`API PnL: $${apiPnl?.toFixed(2) ?? 'N/A'}`);

  // Get CLOB cash flows
  const clobResult = await clickhouse.query({
    query: `
      SELECT
        side,
        sum(max_usdc) / 1e6 as total_usdc
      FROM (
        SELECT
          side,
          max(usdc_amount) as max_usdc
        FROM pm_trader_events_v3
        WHERE lower(trader_wallet) = '${wallet.toLowerCase()}'
        GROUP BY event_id, side
      )
      GROUP BY side
    `,
    format: 'JSONEachRow',
  });

  const clobRows = await clobResult.json() as any[];
  let clobBuys = 0;
  let clobSells = 0;
  for (const row of clobRows) {
    if (row.side.toLowerCase() === 'buy') clobBuys = row.total_usdc;
    else clobSells = row.total_usdc;
  }

  console.log(`\nCLOB Buys (cash out):  $${clobBuys.toFixed(2)}`);
  console.log(`CLOB Sells (cash in):  $${clobSells.toFixed(2)}`);

  // Get redemption cash flows
  const redemptionResult = await clickhouse.query({
    query: `
      SELECT sum(toFloat64OrZero(amount_or_payout))/1e6 as total_redemptions
      FROM pm_ctf_events
      WHERE lower(user_address) = '${wallet.toLowerCase()}'
        AND event_type = 'PayoutRedemption'
        AND is_deleted = 0
    `,
    format: 'JSONEachRow',
  });

  const redemptionRows = await redemptionResult.json() as any[];
  const totalRedemptions = redemptionRows[0]?.total_redemptions ?? 0;

  console.log(`Redemptions (cash in): $${totalRedemptions.toFixed(2)}`);

  // Total cash flows
  const totalCashOut = clobBuys;
  const totalCashIn = clobSells + totalRedemptions;
  const realizedPnl = totalCashIn - totalCashOut;

  console.log(`\n=== REALIZED PNL ===`);
  console.log(`Total Cash In:  $${totalCashIn.toFixed(2)} (sells + redemptions)`);
  console.log(`Total Cash Out: $${totalCashOut.toFixed(2)} (buys)`);
  console.log(`Realized PnL:   $${realizedPnl.toFixed(2)}`);
  console.log(`API PnL:        $${apiPnl?.toFixed(2) ?? 'N/A'}`);
  console.log(`Difference:     $${apiPnl !== null ? (realizedPnl - apiPnl).toFixed(2) : 'N/A'}`);

  // Check for unrealized positions (tokens held that haven't been redeemed)
  // These would be in unresolved markets
  const positionsResult = await clickhouse.query({
    query: `
      SELECT
        m.condition_id,
        m.outcome_index,
        sum(CASE WHEN t.side = 'buy' THEN max_tokens ELSE -max_tokens END) as net_tokens,
        sum(CASE WHEN t.side = 'buy' THEN -max_usdc ELSE max_usdc END) as net_cash
      FROM (
        SELECT
          event_id,
          side,
          token_id,
          max(token_amount) as max_tokens,
          max(usdc_amount) as max_usdc
        FROM pm_trader_events_v3
        WHERE lower(trader_wallet) = '${wallet.toLowerCase()}'
        GROUP BY event_id, side, token_id
      ) t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      GROUP BY m.condition_id, m.outcome_index
      HAVING abs(net_tokens) > 0.001e6
    `,
    format: 'JSONEachRow',
  });

  const positionRows = await positionsResult.json() as any[];
  console.log(`\n=== OPEN POSITIONS (net tokens != 0) ===`);
  console.log(`Found ${positionRows.length} positions with non-zero token balance`);

  // Check resolution status for these positions
  if (positionRows.length > 0) {
    const conditionIds = positionRows.map((r: any) => `'${r.condition_id}'`).join(',');
    const resResult = await clickhouse.query({
      query: `
        SELECT lower(condition_id) as condition_id, norm_prices, resolved_at
        FROM pm_condition_resolutions_norm
        WHERE lower(condition_id) IN (${conditionIds})
      `,
      format: 'JSONEachRow',
    });

    const resRows = await resResult.json() as any[];
    const resMap = new Map<string, { prices: number[]; resolved: boolean }>();
    for (const row of resRows) {
      resMap.set(row.condition_id, { prices: row.norm_prices, resolved: row.resolved_at !== null });
    }

    let unrealizedValue = 0;
    for (const pos of positionRows) {
      const netTokens = pos.net_tokens / 1e6;
      const res = resMap.get(pos.condition_id.toLowerCase());
      const isResolved = res?.resolved ?? false;
      const resPrice = res?.prices?.[pos.outcome_index] ?? 0;

      const value = netTokens > 0 ? netTokens * resPrice : 0;

      if (Math.abs(netTokens) > 0.1) {
        console.log(
          `  ${pos.condition_id.substring(0, 20)}...[${pos.outcome_index}]: ` +
          `${netTokens.toFixed(2)} tokens, ` +
          `resolved=${isResolved}, res_price=${resPrice}, value=$${value.toFixed(2)}`
        );
      }

      // For unresolved positions with positive tokens, estimate value
      if (!isResolved && netTokens > 0) {
        unrealizedValue += netTokens * 0.5;  // assume 0.5 mark price
      } else if (isResolved && netTokens > 0) {
        unrealizedValue += value;
      }
    }

    console.log(`\nEstimated unrealized value: $${unrealizedValue.toFixed(2)}`);
    console.log(`Total PnL (realized + unrealized): $${(realizedPnl + unrealizedValue).toFixed(2)}`);
  }

  process.exit(0);
}

main().catch(console.error);
