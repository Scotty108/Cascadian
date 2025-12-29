/**
 * Create vw_pm_retail_wallets_v1
 *
 * Classifies wallets as retail vs operator based on short exposure ratio.
 * Retail wallets (<10% short) use ledger-based PnL which has high accuracy.
 * Operator wallets (>=10% short) need different handling.
 */

import { clickhouse } from '../../lib/clickhouse/client';

const VIEW_NAME = 'vw_pm_retail_wallets_v1';

async function main() {
  console.log('Creating vw_pm_retail_wallets_v1...');
  console.log('');

  // Drop existing view
  try {
    await clickhouse.command({ query: `DROP VIEW IF EXISTS ${VIEW_NAME}` });
    console.log('Dropped existing view');
  } catch {
    console.log('No existing view to drop');
  }

  // Create the retail classification view
  // Retail = short_ratio < 0.10 (less than 10% of resolved positions are shorts on winners)
  const createViewQuery = `
    CREATE VIEW ${VIEW_NAME} AS
    SELECT
      wallet_address,
      total_long_tokens,
      total_short_tokens,
      short_winner_tokens,
      long_winner_tokens,
      short_ratio,
      if(short_ratio < 0.10, 'retail', if(short_ratio < 0.30, 'mixed', 'operator')) AS wallet_tier,
      short_ratio < 0.10 AS is_retail
    FROM (
      SELECT
        wallet_address,
        -- All longs from CLOB
        sumIf(token_delta, token_delta > 0 AND source_type = 'CLOB') AS total_long_tokens,
        -- All shorts from CLOB (absolute value)
        sumIf(abs(token_delta), token_delta < 0 AND source_type = 'CLOB') AS total_short_tokens,
        -- Shorts on resolved winners (this is what breaks the formula)
        sumIf(abs(token_delta), token_delta < 0 AND source_type = 'CLOB' AND payout_norm = 1) AS short_winner_tokens,
        -- Longs on resolved winners
        sumIf(token_delta, token_delta > 0 AND source_type = 'CLOB' AND payout_norm = 1) AS long_winner_tokens,
        -- Short ratio = shorts on winners / (shorts on winners + longs on winners)
        if(
          (short_winner_tokens + long_winner_tokens) > 0,
          short_winner_tokens / (short_winner_tokens + long_winner_tokens),
          0
        ) AS short_ratio
      FROM pm_unified_ledger_v5
      GROUP BY wallet_address
      HAVING total_long_tokens + total_short_tokens > 100  -- At least $100 in trading volume
    )
  `;

  try {
    await clickhouse.command({ query: createViewQuery });
    console.log('Successfully created vw_pm_retail_wallets_v1');
  } catch (e: unknown) {
    console.error('Error creating view:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  // Verify
  console.log('');
  console.log('View structure:');
  const descRes = await clickhouse.query({
    query: `DESCRIBE ${VIEW_NAME}`,
    format: 'JSONEachRow',
  });
  const cols = (await descRes.json()) as any[];
  for (const col of cols) {
    console.log(`  ${col.name}: ${col.type}`);
  }

  // Get stats
  console.log('');
  console.log('Wallet tier distribution:');
  const statsRes = await clickhouse.query({
    query: `
      SELECT
        wallet_tier,
        count() as cnt,
        avg(short_ratio) as avg_short_ratio
      FROM ${VIEW_NAME}
      GROUP BY wallet_tier
      ORDER BY wallet_tier
    `,
    format: 'JSONEachRow',
  });
  const stats = (await statsRes.json()) as any[];
  for (const s of stats) {
    console.log(`  ${s.wallet_tier}: ${s.cnt} wallets (avg short ratio: ${(s.avg_short_ratio * 100).toFixed(1)}%)`);
  }

  // Test benchmark wallets
  console.log('');
  console.log('Benchmark wallet classifications:');
  const benchmarks = [
    { addr: '0x9d36c904930a7d06c5403f9e16996e919f586486', label: 'W1' },
    { addr: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838', label: 'W2' },
    { addr: '0x418db17eaa8f25eaf2085657d0becd82462c6786', label: 'W3' },
    { addr: '0x4974d5c6c551e79c8f2f48f943e18d75c6a9ea15', label: 'W4' },
    { addr: '0xeab03de44f98ad31ecc19cd597bcdef1c9fe42c2', label: 'W5' },
    { addr: '0x7dca4d9f31ceba9d2d5b7a723eccd5e2e7ccc48d', label: 'W6' },
  ];

  for (const w of benchmarks) {
    const res = await clickhouse.query({
      query: `SELECT wallet_tier, short_ratio, is_retail FROM ${VIEW_NAME} WHERE wallet_address = {addr:String}`,
      query_params: { addr: w.addr },
      format: 'JSONEachRow',
    });
    const data = (await res.json()) as any[];
    if (data.length > 0) {
      const d = data[0];
      console.log(`  ${w.label}: ${d.wallet_tier} (${(d.short_ratio * 100).toFixed(1)}% short)`);
    } else {
      console.log(`  ${w.label}: NOT FOUND (insufficient volume)`);
    }
  }

  console.log('');
  console.log('Done.');
}

main().catch(console.error);
