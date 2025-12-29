/**
 * Debug Unified Ledger for a Wallet
 *
 * Shows all ledger entries (CLOB + CTF) for a wallet to help
 * understand why V18 might be inaccurate and how V19 can fix it.
 */

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = process.argv[2] || '0x6a8ab02581be2c9ba3cdb59eeba25a481ee38a70'; // Johnny

async function main() {
  console.log('='.repeat(80));
  console.log(`UNIFIED LEDGER DEBUG: ${WALLET}`);
  console.log('='.repeat(80));

  // 1. Get all ledger entries by source type
  const q1 = `
    SELECT
      source_type,
      count() as events,
      sum(usdc_delta) as total_usdc,
      sum(token_delta) as total_tokens
    FROM pm_unified_ledger_v5
    WHERE lower(wallet_address) = lower('${WALLET}')
    GROUP BY source_type
    ORDER BY events DESC
  `;

  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const rows1 = (await r1.json()) as any[];

  console.log('\n1. LEDGER SUMMARY BY SOURCE:');
  console.log('-'.repeat(60));
  console.log('Source            | Events | Total USDC    | Total Tokens');
  console.log('-'.repeat(60));
  for (const r of rows1) {
    console.log(
      `${r.source_type.padEnd(17)} | ${String(r.events).padStart(6)} | ` +
        `$${Number(r.total_usdc).toFixed(2).padStart(12)} | ` +
        `${Number(r.total_tokens).toFixed(2).padStart(12)}`
    );
  }

  // 2. Get position-level aggregates from unified ledger
  const q2 = `
    SELECT
      condition_id,
      outcome_index,
      sum(usdc_delta) as total_usdc,
      sum(token_delta) as total_tokens,
      groupArray(source_type) as sources,
      any(payout_norm) as resolution
    FROM pm_unified_ledger_v5
    WHERE lower(wallet_address) = lower('${WALLET}')
    GROUP BY condition_id, outcome_index
    HAVING abs(total_usdc) > 0.01 OR abs(total_tokens) > 0.01
    ORDER BY abs(total_usdc) DESC
    LIMIT 20
  `;

  const r2 = await clickhouse.query({ query: q2, format: 'JSONEachRow' });
  const rows2 = (await r2.json()) as any[];

  console.log('\n2. TOP 20 POSITIONS BY USDC:');
  console.log('-'.repeat(100));
  console.log('Condition ID               | Idx | Cash Flow  | Tokens     | Res | Sources                  | PnL');
  console.log('-'.repeat(100));

  let totalPnl = 0;

  for (const r of rows2) {
    const usdc = Number(r.total_usdc);
    const tokens = Number(r.total_tokens);
    const resolution = r.resolution !== null ? Number(r.resolution) : null;
    const sources = [...new Set(r.sources as string[])].join(',');

    // Calculate PnL
    let pnl = 0;
    if (resolution !== null) {
      pnl = usdc + tokens * resolution;
    }
    totalPnl += pnl;

    const condId = r.condition_id.substring(0, 24) + '...';
    const resStr = resolution !== null ? resolution.toFixed(0) : 'N/A';

    console.log(
      `${condId} | ${String(r.outcome_index).padStart(3)} | ` +
        `$${usdc.toFixed(2).padStart(9)} | ` +
        `${tokens.toFixed(2).padStart(10)} | ` +
        `${resStr.padStart(3)} | ` +
        `${sources.padEnd(24)} | ` +
        `$${pnl.toFixed(2)}`
    );
  }

  console.log('\n' + '-'.repeat(100));
  console.log(`TOTAL PnL (from unified ledger): $${totalPnl.toFixed(2)}`);

  // 3. Compare CLOB-only vs unified ledger
  console.log('\n3. CLOB-ONLY vs UNIFIED COMPARISON:');
  console.log('-'.repeat(60));

  // Get CLOB-only PnL using V18 approach
  const q3 = `
    WITH positions AS (
      SELECT
        condition_id,
        outcome_index,
        sum(usdc_delta) as usdc,
        sum(token_delta) as tokens,
        any(payout_norm) as resolution
      FROM pm_unified_ledger_v5
      WHERE lower(wallet_address) = lower('${WALLET}')
        AND source_type = 'clob_maker'
      GROUP BY condition_id, outcome_index
    )
    SELECT
      sum(CASE WHEN resolution IS NOT NULL
        THEN usdc + tokens * resolution
        ELSE 0 END) as realized_pnl
    FROM positions
  `;

  const r3 = await clickhouse.query({ query: q3, format: 'JSONEachRow' });
  const rows3 = (await r3.json()) as any[];
  const clobOnlyPnl = rows3[0]?.realized_pnl ? Number(rows3[0].realized_pnl) : 0;

  // Get unified PnL (all sources)
  const q4 = `
    WITH positions AS (
      SELECT
        condition_id,
        outcome_index,
        sum(usdc_delta) as usdc,
        sum(token_delta) as tokens,
        any(payout_norm) as resolution
      FROM pm_unified_ledger_v5
      WHERE lower(wallet_address) = lower('${WALLET}')
      GROUP BY condition_id, outcome_index
    )
    SELECT
      sum(CASE WHEN resolution IS NOT NULL
        THEN usdc + tokens * resolution
        ELSE 0 END) as realized_pnl
    FROM positions
  `;

  const r4 = await clickhouse.query({ query: q4, format: 'JSONEachRow' });
  const rows4 = (await r4.json()) as any[];
  const unifiedPnl = rows4[0]?.realized_pnl ? Number(rows4[0].realized_pnl) : 0;

  console.log(`CLOB-only (V18 style):    $${clobOnlyPnl.toFixed(2)}`);
  console.log(`Unified (V19 style):      $${unifiedPnl.toFixed(2)}`);
  console.log(`Difference:               $${(unifiedPnl - clobOnlyPnl).toFixed(2)}`);

  // 4. Show CTF-specific events for this wallet
  console.log('\n4. CTF EVENTS DETAIL:');
  console.log('-'.repeat(80));

  const q5 = `
    SELECT
      event_type,
      condition_id,
      amount_or_payout,
      event_timestamp,
      tx_hash
    FROM pm_ctf_events
    WHERE lower(user_address) = lower('${WALLET}')
    ORDER BY event_timestamp DESC
    LIMIT 10
  `;

  const r5 = await clickhouse.query({ query: q5, format: 'JSONEachRow' });
  const rows5 = (await r5.json()) as any[];

  if (rows5.length === 0) {
    console.log('No CTF events found');
  } else {
    console.log('Type             | Condition ID               | Amount/Payout | Time');
    console.log('-'.repeat(80));
    for (const r of rows5) {
      const condId = r.condition_id.substring(0, 24) + '...';
      console.log(
        `${(r.event_type || 'unknown').padEnd(16)} | ${condId} | ` +
          `${String(r.amount_or_payout).padStart(13)} | ${r.event_timestamp}`
      );
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('DIAGNOSIS:');
  console.log('='.repeat(80));

  const diff = Math.abs(unifiedPnl - clobOnlyPnl);
  if (diff < 1) {
    console.log('Unified and CLOB-only PnL are similar. V18 should work well.');
  } else if (unifiedPnl > clobOnlyPnl) {
    console.log(`Unified PnL is $${diff.toFixed(2)} HIGHER than CLOB-only.`);
    console.log('CTF events (splits/merges/redemptions) are adding positive value.');
    console.log('V19 with unified ledger should improve accuracy.');
  } else {
    console.log(`Unified PnL is $${diff.toFixed(2)} LOWER than CLOB-only.`);
    console.log('CTF events may represent cost basis not captured in CLOB trades.');
    console.log('V19 with unified ledger should improve accuracy.');
  }
}

main().catch(console.error);
