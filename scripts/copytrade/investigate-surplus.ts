/**
 * Investigate where the 2,015.81 surplus tokens are
 * and why the UI shows $0 positions
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = '0x925ad88d18dBc7bfeFF3B71dB7b96Ed4BB572c2e';

async function main() {
  console.log('=== Investigating the Surplus Tokens ===\n');

  // Get per-token surplus (bought > sold)
  const surplusQuery = `
    WITH dedup AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(token_amount) / 1e6 as tokens
      FROM pm_trader_events_dedup_v2_tbl
      WHERE lower(trader_wallet) = lower('${WALLET}')
      GROUP BY event_id
    ),
    token_balances AS (
      SELECT
        token_id,
        sumIf(tokens, side = 'buy') as bought,
        sumIf(tokens, side = 'sell') as sold,
        sumIf(tokens, side = 'buy') - sumIf(tokens, side = 'sell') as balance
      FROM dedup
      GROUP BY token_id
      HAVING balance > 0.1
    )
    SELECT
      tb.token_id,
      tb.bought,
      tb.sold,
      tb.balance,
      m.condition_id,
      m.outcome_index
    FROM token_balances tb
    LEFT JOIN pm_token_to_condition_map_v5 m ON tb.token_id = m.token_id_dec
    ORDER BY tb.balance DESC
    LIMIT 30
  `;
  const surplusResult = await clickhouse.query({ query: surplusQuery, format: 'JSONEachRow' });
  const surplus = (await surplusResult.json()) as any[];

  console.log('Surplus tokens (bought > sold):');
  console.log('Token | Balance | Bought | Sold | Condition | Outcome');
  console.log('------|---------|--------|------|-----------|--------');

  let totalSurplus = 0;
  let mappedCount = 0;
  let unmappedCount = 0;

  surplus.forEach((s: any) => {
    const balance = Number(s.balance);
    totalSurplus += balance;
    const tokenShort = s.token_id.slice(0, 12) + '...';
    const conditionShort = s.condition_id ? s.condition_id.slice(0, 12) + '...' : 'UNMAPPED';
    const outcome = s.outcome_index !== null && s.outcome_index !== undefined ? s.outcome_index : '-';

    if (s.condition_id) mappedCount++;
    else unmappedCount++;

    if (balance > 10) {
      console.log(
        tokenShort +
          ' | ' +
          balance.toFixed(2).padStart(7) +
          ' | ' +
          Number(s.bought).toFixed(2).padStart(6) +
          ' | ' +
          Number(s.sold).toFixed(2).padStart(4) +
          ' | ' +
          conditionShort +
          ' | ' +
          outcome
      );
    }
  });

  console.log('\nSummary:');
  console.log('  Total surplus tokens:', totalSurplus.toFixed(2));
  console.log('  Mapped to conditions:', mappedCount);
  console.log('  Unmapped:', unmappedCount);

  // Check resolution status of mapped tokens
  console.log('\n=== Resolution Status of Surplus Tokens ===');

  const conditionIds = surplus
    .filter((s: any) => s.condition_id)
    .map((s: any) => "'" + s.condition_id + "'")
    .join(',');

  if (conditionIds) {
    const resolutionQuery = `
      SELECT
        condition_id,
        payout_numerators,
        resolved_at
      FROM pm_condition_resolutions
      WHERE condition_id IN (${conditionIds})
    `;
    const resolutionResult = await clickhouse.query({ query: resolutionQuery, format: 'JSONEachRow' });
    const resolutions = new Map((await resolutionResult.json() as any[]).map((r: any) => [r.condition_id, r]));

    console.log('\nResolution status of surplus token conditions:');
    let resolvedCount = 0;
    let unresolvedCount = 0;
    let winnerValue = 0;
    let loserTokens = 0;

    surplus
      .filter((s: any) => s.condition_id)
      .forEach((s: any) => {
        const resolution = resolutions.get(s.condition_id);
        const balance = Number(s.balance);

        if (resolution && resolution.payout_numerators) {
          resolvedCount++;
          try {
            const payouts = JSON.parse(resolution.payout_numerators);
            const outcomeIndex = Number(s.outcome_index);
            const payoutPrice = Number(payouts[outcomeIndex]) / 1e18;
            const value = balance * payoutPrice;

            if (payoutPrice > 0) {
              winnerValue += value;
              console.log(
                '  WIN: ' +
                  s.condition_id.slice(0, 12) +
                  '... outcome ' +
                  outcomeIndex +
                  ': ' +
                  balance.toFixed(2) +
                  ' tokens × $' +
                  payoutPrice.toFixed(2) +
                  ' = $' +
                  value.toFixed(2)
              );
            } else {
              loserTokens += balance;
            }
          } catch (e) {
            // Skip parsing errors
          }
        } else {
          unresolvedCount++;
          console.log('  UNRESOLVED: ' + s.condition_id.slice(0, 12) + '... : ' + balance.toFixed(2) + ' tokens');
        }
      });

    console.log('\nSurplus token breakdown:');
    console.log('  Resolved winners value: $' + winnerValue.toFixed(2));
    console.log('  Resolved losers (worth $0): ' + loserTokens.toFixed(2) + ' tokens');
    console.log('  Unresolved positions:', unresolvedCount);
    console.log('  Unmapped tokens:', unmappedCount);

    // If there are unredeemed winners, that explains the $62
    if (winnerValue > 0) {
      console.log('\n=== KEY FINDING ===');
      console.log('The $62 gap is from UNREDEEMED WINNING tokens!');
      console.log('These tokens resolved to $' + winnerValue.toFixed(2) + ' but havent been redeemed yet.');
    }
  }

  // Check redemptions for these conditions
  console.log('\n=== Redemption Status ===');
  const redemptionQuery = `
    SELECT
      condition_id,
      sum(toFloat64OrZero(amount_or_payout) / 1e6) as total_payout
    FROM pm_ctf_events
    WHERE lower(user_address) = lower('${WALLET}')
      AND event_type = 'PayoutRedemption'
      AND is_deleted = 0
    GROUP BY condition_id
  `;
  const redemptionResult = await clickhouse.query({ query: redemptionQuery, format: 'JSONEachRow' });
  const redemptions = new Map((await redemptionResult.json() as any[]).map((r: any) => [r.condition_id, Number(r.total_payout)]));

  console.log('Redemptions for surplus token conditions:');
  let totalRedeemed = 0;
  surplus
    .filter((s: any) => s.condition_id)
    .forEach((s: any) => {
      const redeemed = redemptions.get(s.condition_id) || 0;
      if (redeemed > 0) {
        totalRedeemed += redeemed;
        console.log('  ' + s.condition_id.slice(0, 12) + '...: $' + redeemed.toFixed(2));
      }
    });
  console.log('Total redeemed from surplus conditions: $' + totalRedeemed.toFixed(2));

  process.exit(0);
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
