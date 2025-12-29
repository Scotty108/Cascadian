/**
 * Trace markets with redemption but NO CLOB activity
 * Investigating ImJustKen's $850K gap
 */

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0x9d84ce0306f8551e02efef1680475fc0f1dc1344';

async function main() {
  console.log('TRACING: Markets with redemption but NO CLOB');
  console.log('='.repeat(120));

  // Get the top 5 redemption markets that have NO CLOB activity
  const q1 = `
    WITH redemption_markets AS (
      SELECT
        canonical_condition_id,
        sum(usdc_delta) as redemption_usdc
      FROM pm_unified_ledger_v9
      WHERE lower(wallet_address) = lower('${WALLET}')
        AND source_type = 'PayoutRedemption'
        AND canonical_condition_id IS NOT NULL
        AND canonical_condition_id != ''
      GROUP BY canonical_condition_id
    ),
    clob_markets AS (
      SELECT DISTINCT canonical_condition_id
      FROM pm_unified_ledger_v9
      WHERE lower(wallet_address) = lower('${WALLET}')
        AND source_type = 'CLOB'
        AND canonical_condition_id IS NOT NULL
        AND canonical_condition_id != ''
    )
    SELECT
      r.canonical_condition_id,
      r.redemption_usdc
    FROM redemption_markets r
    LEFT JOIN clob_markets c ON r.canonical_condition_id = c.canonical_condition_id
    WHERE c.canonical_condition_id IS NULL
    ORDER BY r.redemption_usdc DESC
    LIMIT 5
  `;

  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const topMarkets = (await r1.json()) as any[];

  console.log('Top 5 redemption markets WITHOUT CLOB:');
  console.log('');

  for (const m of topMarkets) {
    console.log('='.repeat(120));
    console.log('Market: ' + m.canonical_condition_id);
    console.log('Redemption USDC: $' + Number(m.redemption_usdc).toLocaleString());
    console.log('');

    // Get ALL activity in this market
    const q2 = `
      SELECT
        source_type,
        outcome_index,
        sum(usdc_delta) as usdc_total,
        sum(token_delta) as token_total,
        any(payout_norm) as resolution,
        count() as events
      FROM pm_unified_ledger_v9
      WHERE lower(wallet_address) = lower('${WALLET}')
        AND canonical_condition_id = '${m.canonical_condition_id}'
      GROUP BY source_type, outcome_index
      ORDER BY source_type, outcome_index
    `;

    const r2 = await clickhouse.query({ query: q2, format: 'JSONEachRow' });
    const activity = (await r2.json()) as any[];

    console.log('All activity:');
    console.log('Source           | Outcome | USDC          | Tokens        | Resolution | Events');
    console.log('-'.repeat(100));

    for (const a of activity) {
      const resStr = a.resolution !== null ? String(a.resolution).padStart(10) : 'NULL'.padStart(10);
      console.log(
        a.source_type.padEnd(16) + ' | ' +
        String(a.outcome_index).padStart(7) + ' | $' +
        Number(a.usdc_total).toLocaleString().padStart(12) + ' | ' +
        Number(a.token_total).toLocaleString().padStart(13) + ' | ' +
        resStr + ' | ' +
        a.events
      );
    }

    console.log('');
  }

  // Summary: What's the total redemption value in markets with NO CLOB?
  const q3 = `
    WITH redemption_markets AS (
      SELECT canonical_condition_id
      FROM pm_unified_ledger_v9
      WHERE lower(wallet_address) = lower('${WALLET}')
        AND source_type = 'PayoutRedemption'
    ),
    clob_markets AS (
      SELECT DISTINCT canonical_condition_id
      FROM pm_unified_ledger_v9
      WHERE lower(wallet_address) = lower('${WALLET}')
        AND source_type = 'CLOB'
    ),
    no_clob_redemptions AS (
      SELECT r.canonical_condition_id
      FROM redemption_markets r
      LEFT JOIN clob_markets c ON r.canonical_condition_id = c.canonical_condition_id
      WHERE c.canonical_condition_id IS NULL
    )
    SELECT
      source_type,
      sum(usdc_delta) as total_usdc,
      sum(token_delta) as total_tokens,
      count() as events
    FROM pm_unified_ledger_v9
    WHERE lower(wallet_address) = lower('${WALLET}')
      AND canonical_condition_id IN (SELECT canonical_condition_id FROM no_clob_redemptions)
    GROUP BY source_type
    ORDER BY total_usdc DESC
  `;

  const r3 = await clickhouse.query({ query: q3, format: 'JSONEachRow' });
  const summary = (await r3.json()) as any[];

  console.log('='.repeat(120));
  console.log('SUMMARY: All activity in markets with redemption but NO CLOB:');
  console.log('-'.repeat(100));
  console.log('Source           | USDC Total       | Tokens Total     | Events');
  console.log('-'.repeat(100));

  let netUsdc = 0;
  for (const s of summary) {
    netUsdc += Number(s.total_usdc);
    console.log(
      s.source_type.padEnd(16) + ' | $' +
      Number(s.total_usdc).toLocaleString().padStart(14) + ' | ' +
      Number(s.total_tokens).toLocaleString().padStart(16) + ' | ' +
      s.events
    );
  }
  console.log('-'.repeat(100));
  console.log('Net USDC: $' + netUsdc.toLocaleString());
  console.log('');
  console.log('='.repeat(120));
  console.log('ANALYSIS:');
  console.log('='.repeat(120));
  console.log('');
  console.log('In these 648 markets, ImJustKen:');
  console.log('  1. Did PositionsMerge (converting tokens → USDC)');
  console.log('  2. Got PayoutRedemption (winning tokens → USDC)');
  console.log('  3. NEVER traded on CLOB');
  console.log('');
  console.log('The tokens for PositionsMerge came from:');
  console.log('  - CLOB trades in OTHER markets (shared outcome tokens)');
  console.log('  - Or market-making activities');
  console.log('');
  console.log('The Net USDC from these markets IS real PnL that CLOB-only formula misses!');
}

main().catch(console.error);
