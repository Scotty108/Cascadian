/**
 * Compare different PnL formulas on Theo NegRisk wallet
 */

import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  const wallet = '0x9d36c904930a7d06c5403f9e16996e919f586486';

  // 1. CLOB positions
  const clob = await clickhouse.query({
    query: `
      SELECT
        lower(m.condition_id) as condition_id,
        SUM(CASE WHEN t.side = 'buy' THEN -t.usdc_amount ELSE t.usdc_amount END) / 1e6 as cash_flow,
        SUM(CASE WHEN t.side = 'buy' AND m.outcome_index = 0 THEN t.token_amount
                 WHEN t.side = 'sell' AND m.outcome_index = 0 THEN -t.token_amount
                 ELSE 0 END) / 1e6 as shares_0,
        SUM(CASE WHEN t.side = 'buy' AND m.outcome_index = 1 THEN t.token_amount
                 WHEN t.side = 'sell' AND m.outcome_index = 1 THEN -t.token_amount
                 ELSE 0 END) / 1e6 as shares_1
      FROM (
        SELECT event_id, any(side) as side, any(usdc_amount) as usdc_amount, any(token_amount) as token_amount, any(token_id) as token_id
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
        GROUP BY event_id
      ) t
      INNER JOIN pm_token_to_condition_map_v4 m ON toString(t.token_id) = toString(m.token_id_dec)
      GROUP BY lower(m.condition_id)
    `,
    format: 'JSONEachRow'
  });
  const clobRows = await clob.json() as any[];
  const clobMap = new Map(clobRows.map(r => [r.condition_id, r]));

  // 2. Redemptions
  const redemptions = await clickhouse.query({
    query: `
      SELECT
        cond,
        SUM(toFloat64(payout)) / 1e6 as redemption_payout
      FROM (
        SELECT lower(condition_id) as cond, amount_or_payout as payout
        FROM pm_ctf_events
        WHERE event_type = 'PayoutRedemption'
          AND lower(user_address) = lower('${wallet}')
      )
      GROUP BY cond
    `,
    format: 'JSONEachRow'
  });
  const redRows = await redemptions.json() as any[];
  const redMap = new Map(redRows.map(r => [r.cond, Number(r.redemption_payout)]));

  // 3. Resolutions
  const resolutions = await clickhouse.query({
    query: `
      SELECT
        lower(condition_id) as condition_id,
        payout_numerators
      FROM pm_condition_resolutions
      WHERE is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  const resRows = await resolutions.json() as any[];
  const resMap = new Map(resRows.map(r => {
    let res0: number | null = null;
    let res1: number | null = null;
    if (r.payout_numerators?.startsWith('[1,')) { res0 = 1; res1 = 0; }
    else if (r.payout_numerators?.startsWith('[0,')) { res0 = 0; res1 = 1; }
    return [r.condition_id, { res0, res1 }];
  }));

  // Calculate PnL for each condition
  console.log('=== PNL BY CONDITION ===');
  let totalV1 = 0, totalV2a = 0, totalV2b = 0, totalV3 = 0;

  for (const [condId, c] of clobMap) {
    const cashFlow = Number(c.cash_flow);
    const shares0 = Number(c.shares_0);
    const shares1 = Number(c.shares_1);
    const redemption = redMap.get(condId) || 0;
    const res = resMap.get(condId) || { res0: null, res1: null };

    // V1: CLOB only (BUGGY - treats shorts as owing money)
    const v1 = cashFlow + (shares0 * (res.res0 ?? 0)) + (shares1 * (res.res1 ?? 0));

    // V2a: If redeemed, only cash + redemption (ignores unredeemed shares)
    let v2a: number;
    if (redemption > 0) {
      v2a = cashFlow + redemption;
    } else if (res.res0 !== null) {
      v2a = cashFlow + (shares0 * res.res0) + (shares1 * (res.res1 ?? 0));
    } else {
      v2a = cashFlow;
    }

    // V2b: cash + redemption + unredeemed winning shares (with MAX fix)
    let v2b = cashFlow + redemption;
    if (res.res0 === 1 && shares0 > redemption) {
      v2b += (shares0 - redemption) * 1.0;
    } else if (res.res1 === 1 && shares1 > redemption) {
      v2b += (shares1 - redemption) * 1.0;
    }

    // V3: CORRECT FORMULA
    // cash_flow + redemption + MAX(unredeemed_shares, 0) * resolution_price
    // Shorts (negative shares) get $0 payout, not negative
    let v3 = cashFlow + redemption;
    if (res.res0 !== null) {
      // Only pay out on POSITIVE share positions
      const payout0 = Math.max(shares0 - redemption, 0) * res.res0;
      const payout1 = Math.max(shares1, 0) * (res.res1 ?? 0);
      v3 += payout0 + payout1;
    }

    totalV1 += v1;
    totalV2a += v2a;
    totalV2b += v2b;
    totalV3 += v3;

    console.log(`${condId.slice(0,12)}... | cash: $${cashFlow.toFixed(2).padStart(12)} | red: $${redemption.toFixed(2).padStart(10)} | v1: $${v1.toFixed(2).padStart(10)} | v3: $${v3.toFixed(2).padStart(10)}`);
  }

  console.log('');
  console.log('=== TOTALS ===');
  console.log(`V1 (CLOB only, buggy):    $${totalV1.toFixed(2)}`);
  console.log(`V2a (cash+red only):      $${totalV2a.toFixed(2)}`);
  console.log(`V3 (correct formula):     $${totalV3.toFixed(2)}`);
  console.log(`UI benchmark:             $-6,138.90`);
  console.log('');
  console.log(`V1 error:  ${Math.abs((totalV1 - (-6138.9)) / 6138.9 * 100).toFixed(1)}%`);
  console.log(`V2a error: ${Math.abs((totalV2a - (-6138.9)) / 6138.9 * 100).toFixed(1)}%`);
  console.log(`V3 error:  ${Math.abs((totalV3 - (-6138.9)) / 6138.9 * 100).toFixed(1)}%`);
}

main().catch(console.error);
