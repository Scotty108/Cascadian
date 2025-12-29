/**
 * Build Platform-Wide Wallet Classification Table
 *
 * Creates pm_wallet_classification_v1 with:
 * - wallet_address
 * - pnl_v20_trading (CLOB position-based PnL)
 * - pnl_cashflow_all (sum of all usdc_delta)
 * - volume_clob, volume_merge_split, volume_redemption
 * - merge_share (volume_merge_split / total_volume)
 * - wallet_class (T=trader, M=market-maker, X=mixed)
 *
 * Uses batched processing to avoid timeouts
 */

import { clickhouse } from '../../lib/clickhouse/client';

const BATCH_SIZE = 5000;  // Process wallets in batches
const MAX_CONCURRENT = 4; // Concurrent batch queries

interface WalletRow {
  wallet_address: string;
}

interface ClassificationResult {
  wallet_address: string;
  pnl_v20_trading: number;
  pnl_cashflow_all: number;
  volume_clob: number;
  volume_merge_split: number;
  volume_redemption: number;
  merge_share: number;
  wallet_class: string;
  clob_events: number;
  merge_events: number;
  redemption_events: number;
}

async function createTable() {
  console.log('Creating pm_wallet_classification_v1 table...');

  await clickhouse.command({ query: 'DROP TABLE IF EXISTS pm_wallet_classification_v1' });

  const createQuery = `
    CREATE TABLE pm_wallet_classification_v1 (
      wallet_address String,
      pnl_v20_trading Float64,
      pnl_cashflow_all Float64,
      volume_clob Float64,
      volume_merge_split Float64,
      volume_redemption Float64,
      merge_share Float64,
      wallet_class LowCardinality(String),
      clob_events UInt64,
      merge_events UInt64,
      redemption_events UInt64,
      computed_at DateTime DEFAULT now()
    ) ENGINE = ReplacingMergeTree(computed_at)
    ORDER BY wallet_address
  `;

  await clickhouse.command({ query: createQuery });
  console.log('  Table created.');
}

async function getWalletList(): Promise<string[]> {
  console.log('Getting list of all wallets from unified ledger...');

  // Get unique wallets - this is fast since it's just DISTINCT on a column
  const query = `
    SELECT DISTINCT lower(wallet_address) as wallet_address
    FROM pm_unified_ledger_v9
    WHERE wallet_address IS NOT NULL AND wallet_address != ''
    ORDER BY wallet_address
  `;

  const r = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await r.json() as WalletRow[];

  console.log(`  Found ${rows.length.toLocaleString()} unique wallets`);
  return rows.map(r => r.wallet_address);
}

async function classifyWalletBatch(wallets: string[]): Promise<ClassificationResult[]> {
  const walletList = wallets.map(w => `'${w}'`).join(',');

  // Combined query for all metrics per wallet in the batch
  const query = `
    WITH wallet_volumes AS (
      SELECT
        lower(wallet_address) as wallet,
        sumIf(abs(usdc_delta), source_type = 'CLOB') as volume_clob,
        sumIf(abs(usdc_delta), source_type IN ('PositionsMerge', 'PositionSplit')) as volume_merge_split,
        sumIf(abs(usdc_delta), source_type = 'PayoutRedemption') as volume_redemption,
        sumIf(usdc_delta, source_type IN ('CLOB', 'PayoutRedemption', 'PositionsMerge', 'PositionSplit')) as pnl_cashflow_all,
        countIf(source_type = 'CLOB') as clob_events,
        countIf(source_type IN ('PositionsMerge', 'PositionSplit')) as merge_events,
        countIf(source_type = 'PayoutRedemption') as redemption_events
      FROM pm_unified_ledger_v9
      WHERE lower(wallet_address) IN (${walletList})
      GROUP BY lower(wallet_address)
    ),
    trading_pnl AS (
      SELECT
        wallet,
        sum(position_pnl) as pnl_v20_trading
      FROM (
        SELECT
          lower(wallet_address) as wallet,
          canonical_condition_id,
          outcome_index,
          sum(usdc_delta) + sum(token_delta) * coalesce(any(payout_norm), 0) as position_pnl
        FROM pm_unified_ledger_v9
        WHERE lower(wallet_address) IN (${walletList})
          AND source_type = 'CLOB'
          AND canonical_condition_id IS NOT NULL
          AND canonical_condition_id != ''
        GROUP BY lower(wallet_address), canonical_condition_id, outcome_index
      )
      GROUP BY wallet
    )
    SELECT
      v.wallet as wallet_address,
      coalesce(t.pnl_v20_trading, 0) as pnl_v20_trading,
      v.pnl_cashflow_all,
      v.volume_clob,
      v.volume_merge_split,
      v.volume_redemption,
      v.clob_events,
      v.merge_events,
      v.redemption_events
    FROM wallet_volumes v
    LEFT JOIN trading_pnl t ON v.wallet = t.wallet
  `;

  const r = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await r.json() as any[];

  return rows.map(row => {
    const totalVolume = Number(row.volume_clob) + Number(row.volume_merge_split) + Number(row.volume_redemption);
    const mergeShare = totalVolume > 0 ? Number(row.volume_merge_split) / totalVolume : 0;

    // Classification:
    // T (trader): merge_share < 0.2
    // M (market-maker): merge_share > 0.5
    // X (mixed): everything else
    let walletClass = 'X';
    if (mergeShare < 0.2) walletClass = 'T';
    else if (mergeShare > 0.5) walletClass = 'M';

    return {
      wallet_address: row.wallet_address,
      pnl_v20_trading: Number(row.pnl_v20_trading),
      pnl_cashflow_all: Number(row.pnl_cashflow_all),
      volume_clob: Number(row.volume_clob),
      volume_merge_split: Number(row.volume_merge_split),
      volume_redemption: Number(row.volume_redemption),
      merge_share: mergeShare,
      wallet_class: walletClass,
      clob_events: Number(row.clob_events),
      merge_events: Number(row.merge_events),
      redemption_events: Number(row.redemption_events),
    };
  });
}

async function insertBatch(results: ClassificationResult[]) {
  if (results.length === 0) return;

  const values = results.map(r =>
    `('${r.wallet_address}', ${r.pnl_v20_trading}, ${r.pnl_cashflow_all}, ${r.volume_clob}, ${r.volume_merge_split}, ${r.volume_redemption}, ${r.merge_share}, '${r.wallet_class}', ${r.clob_events}, ${r.merge_events}, ${r.redemption_events}, now())`
  ).join(',\n');

  const insertQuery = `
    INSERT INTO pm_wallet_classification_v1
    (wallet_address, pnl_v20_trading, pnl_cashflow_all, volume_clob, volume_merge_split, volume_redemption, merge_share, wallet_class, clob_events, merge_events, redemption_events, computed_at)
    VALUES ${values}
  `;

  await clickhouse.command({ query: insertQuery });
}

async function generateStatistics() {
  console.log('\n' + '='.repeat(120));
  console.log('PLATFORM-WIDE WALLET CLASSIFICATION STATISTICS');
  console.log('='.repeat(120));

  // Class distribution
  const classDistQuery = `
    SELECT
      wallet_class,
      count() as wallet_count,
      round(sum(volume_clob), 2) as total_volume_clob,
      round(sum(volume_merge_split), 2) as total_volume_merge,
      round(sum(volume_redemption), 2) as total_volume_redemption,
      round(sum(pnl_v20_trading), 2) as total_pnl_trading,
      round(sum(pnl_cashflow_all), 2) as total_pnl_cashflow
    FROM pm_wallet_classification_v1
    GROUP BY wallet_class
    ORDER BY wallet_count DESC
  `;

  const r1 = await clickhouse.query({ query: classDistQuery, format: 'JSONEachRow' });
  const classDist = await r1.json() as any[];

  console.log('\nCLASS DISTRIBUTION:');
  console.log('-'.repeat(120));
  console.log('Class | Wallets    | CLOB Volume      | Merge Volume     | Redemp Volume    | Trading PnL      | Cashflow PnL');
  console.log('-'.repeat(120));

  let totalWallets = 0;
  let totalVolume = 0;

  for (const c of classDist) {
    const className = c.wallet_class === 'T' ? 'T (trader)' : c.wallet_class === 'M' ? 'M (market-maker)' : 'X (mixed)';
    totalWallets += Number(c.wallet_count);
    totalVolume += Number(c.total_volume_clob) + Number(c.total_volume_merge) + Number(c.total_volume_redemption);

    console.log(
      className.padEnd(6) + '| ' +
      Number(c.wallet_count).toLocaleString().padStart(10) + ' | $' +
      Number(c.total_volume_clob).toLocaleString().padStart(14) + ' | $' +
      Number(c.total_volume_merge).toLocaleString().padStart(14) + ' | $' +
      Number(c.total_volume_redemption).toLocaleString().padStart(14) + ' | $' +
      Number(c.total_pnl_trading).toLocaleString().padStart(14) + ' | $' +
      Number(c.total_pnl_cashflow).toLocaleString().padStart(14)
    );
  }

  console.log('-'.repeat(120));
  console.log(`TOTAL: ${totalWallets.toLocaleString()} wallets, $${totalVolume.toLocaleString()} total volume`);

  // Class percentages
  console.log('\nCLASS PERCENTAGES:');
  for (const c of classDist) {
    const pct = (Number(c.wallet_count) / totalWallets * 100).toFixed(1);
    console.log(`  ${c.wallet_class}: ${pct}% of wallets`);
  }

  // PnL difference analysis by class
  const pnlDiffQuery = `
    SELECT
      wallet_class,
      count() as cnt,
      round(avg(abs(pnl_v20_trading - pnl_cashflow_all)), 2) as avg_pnl_diff,
      round(median(abs(pnl_v20_trading - pnl_cashflow_all)), 2) as median_pnl_diff,
      round(quantile(0.90)(abs(pnl_v20_trading - pnl_cashflow_all)), 2) as p90_pnl_diff
    FROM pm_wallet_classification_v1
    WHERE volume_clob > 1000  -- Only wallets with meaningful CLOB activity
    GROUP BY wallet_class
  `;

  const r2 = await clickhouse.query({ query: pnlDiffQuery, format: 'JSONEachRow' });
  const pnlDiff = await r2.json() as any[];

  console.log('\nPNL METHOD DIFFERENCE BY CLASS (wallets with >$1K CLOB volume):');
  console.log('-'.repeat(80));
  console.log('Class | Count      | Avg |Trading-Cashflow| Diff  | Median Diff     | P90 Diff');
  console.log('-'.repeat(80));

  for (const p of pnlDiff) {
    console.log(
      p.wallet_class.padEnd(6) + '| ' +
      Number(p.cnt).toLocaleString().padStart(10) + ' | $' +
      Number(p.avg_pnl_diff).toLocaleString().padStart(14) + ' | $' +
      Number(p.median_pnl_diff).toLocaleString().padStart(14) + ' | $' +
      Number(p.p90_pnl_diff).toLocaleString().padStart(14)
    );
  }

  // Sample wallets from each class for validation
  console.log('\n' + '='.repeat(120));
  console.log('SAMPLE WALLETS FOR UI VALIDATION');
  console.log('='.repeat(120));

  for (const classType of ['T', 'M', 'X']) {
    const sampleQuery = `
      SELECT
        wallet_address,
        round(pnl_v20_trading, 2) as pnl_trading,
        round(pnl_cashflow_all, 2) as pnl_cashflow,
        round(volume_clob, 2) as vol_clob,
        round(merge_share * 100, 1) as merge_pct
      FROM pm_wallet_classification_v1
      WHERE wallet_class = '${classType}'
        AND volume_clob > 10000  -- At least $10K volume
      ORDER BY volume_clob DESC
      LIMIT 10
    `;

    const r = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
    const samples = await r.json() as any[];

    const className = classType === 'T' ? 'TRADERS (T)' : classType === 'M' ? 'MARKET-MAKERS (M)' : 'MIXED (X)';
    console.log(`\n${className} - Top 10 by CLOB volume:`);
    console.log('Wallet Address                             | Trading PnL     | Cashflow PnL    | CLOB Vol        | Merge%');
    console.log('-'.repeat(110));

    for (const s of samples) {
      console.log(
        s.wallet_address.padEnd(42) + ' | $' +
        Number(s.pnl_trading).toLocaleString().padStart(13) + ' | $' +
        Number(s.pnl_cashflow).toLocaleString().padStart(13) + ' | $' +
        Number(s.vol_clob).toLocaleString().padStart(13) + ' | ' +
        s.merge_pct + '%'
      );
    }
  }
}

async function main() {
  const startTime = Date.now();

  console.log('='.repeat(120));
  console.log('BUILDING PLATFORM-WIDE WALLET CLASSIFICATION');
  console.log('='.repeat(120));
  console.log('');

  // Step 1: Create table
  await createTable();

  // Step 2: Get wallet list
  const wallets = await getWalletList();

  // Step 3: Process in batches
  console.log(`\nProcessing ${wallets.length.toLocaleString()} wallets in batches of ${BATCH_SIZE}...`);

  const totalBatches = Math.ceil(wallets.length / BATCH_SIZE);
  let processedWallets = 0;
  let successfulInserts = 0;

  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batch = wallets.slice(i, i + BATCH_SIZE);

    try {
      const results = await classifyWalletBatch(batch);
      await insertBatch(results);

      processedWallets += batch.length;
      successfulInserts += results.length;

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = (processedWallets / parseFloat(elapsed)).toFixed(0);
      const pct = ((processedWallets / wallets.length) * 100).toFixed(1);

      console.log(`  Batch ${batchNum}/${totalBatches}: ${processedWallets.toLocaleString()}/${wallets.length.toLocaleString()} (${pct}%) | ${rate} wallets/sec | ${elapsed}s elapsed`);

    } catch (e: any) {
      console.log(`  Batch ${batchNum} ERROR: ${e.message}`);
    }
  }

  console.log(`\nInserted ${successfulInserts.toLocaleString()} wallet classifications`);

  // Step 4: Generate statistics
  await generateStatistics();

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(120));
  console.log(`CLASSIFICATION COMPLETE in ${totalTime}s`);
  console.log('='.repeat(120));
  console.log('\nTable created: pm_wallet_classification_v1');
  console.log('\nUsage:');
  console.log('  SELECT * FROM pm_wallet_classification_v1 WHERE wallet_class = \'T\' LIMIT 100');
  console.log('  SELECT wallet_class, count() FROM pm_wallet_classification_v1 GROUP BY wallet_class');
}

main().catch(console.error);
