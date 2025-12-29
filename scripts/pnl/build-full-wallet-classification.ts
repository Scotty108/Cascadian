/**
 * Build Full Wallet Classification with PnL Metrics
 *
 * Combines:
 * 1. Volume classification from pm_wallet_volume_classification_v1
 * 2. Trading PnL (CLOB position-based) from pm_unified_ledger_v9
 * 3. Cashflow PnL (all source types)
 *
 * Creates pm_wallet_full_classification_v1
 */

import { clickhouse } from '../../lib/clickhouse/client';

const BATCH_SIZE = 5000;

async function main() {
  console.log('='.repeat(120));
  console.log('BUILDING FULL WALLET CLASSIFICATION WITH PNL METRICS');
  console.log('='.repeat(120));
  console.log('');

  // ========================================
  // Step 1: Create target table
  // ========================================
  console.log('STEP 1: Creating pm_wallet_full_classification_v1 table...');

  await clickhouse.command({ query: 'DROP TABLE IF EXISTS pm_wallet_full_classification_v1' });

  const createTable = `
    CREATE TABLE pm_wallet_full_classification_v1 (
      wallet_address String,
      -- Volume metrics (from classification)
      volume_clob Float64,
      volume_merge_split Float64,
      volume_redemption Float64,
      total_volume Float64,
      merge_share Float64,
      wallet_class LowCardinality(String),
      -- Activity counts
      clob_events UInt64,
      merge_events UInt64,
      redemption_events UInt64,
      -- PnL metrics
      pnl_trading Float64,           -- CLOB position-based (V20 formula)
      pnl_cashflow Float64,          -- sum(usdc_delta) from CLOB + PayoutRedemption
      pnl_all_sources Float64,       -- sum(usdc_delta) from ALL sources
      -- PnL validation
      pnl_diff Float64,              -- pnl_trading - pnl_cashflow
      -- Metadata
      computed_at DateTime DEFAULT now()
    ) ENGINE = ReplacingMergeTree(computed_at)
    ORDER BY wallet_address
  `;

  await clickhouse.command({ query: createTable });
  console.log('  Table created.');
  console.log('');

  // ========================================
  // Step 2: Get wallet list from volume classification
  // ========================================
  console.log('STEP 2: Getting wallet list from volume classification...');

  const countQ = `SELECT count() as cnt FROM pm_wallet_volume_classification_v1 WHERE wallet_class != 'EMPTY'`;
  const countR = await clickhouse.query({ query: countQ, format: 'JSONEachRow' });
  const countRows = await countR.json() as any[];
  const totalWallets = Number(countRows[0].cnt);
  console.log(`  Found ${totalWallets.toLocaleString()} wallets to process`);
  console.log('');

  // ========================================
  // Step 3: Process in batches by class to avoid timeout
  // ========================================
  console.log('STEP 3: Processing wallets by class...');
  console.log('');

  const startTime = Date.now();
  let processedCount = 0;

  for (const walletClass of ['T', 'M', 'X']) {
    console.log(`Processing class ${walletClass}...`);

    // Get count for this class
    const classCountQ = `SELECT count() as cnt FROM pm_wallet_volume_classification_v1 WHERE wallet_class = '${walletClass}'`;
    const classCountR = await clickhouse.query({ query: classCountQ, format: 'JSONEachRow' });
    const classCountRows = await classCountR.json() as any[];
    const classCount = Number(classCountRows[0].cnt);
    console.log(`  ${classCount.toLocaleString()} wallets in class ${walletClass}`);

    // Process in batches
    let offset = 0;
    while (offset < classCount) {
      // Get batch of wallets
      const batchQuery = `
        SELECT wallet_address
        FROM pm_wallet_volume_classification_v1
        WHERE wallet_class = '${walletClass}'
        ORDER BY total_volume DESC
        LIMIT ${BATCH_SIZE}
        OFFSET ${offset}
      `;

      const batchR = await clickhouse.query({ query: batchQuery, format: 'JSONEachRow' });
      const batchRows = await batchR.json() as any[];

      if (batchRows.length === 0) break;

      const walletList = batchRows.map((r: any) => `'${r.wallet_address}'`).join(',');

      // Insert with PnL calculation
      const insertQuery = `
        INSERT INTO pm_wallet_full_classification_v1
        WITH
        -- Get volume data from classification table
        vol_data AS (
          SELECT
            wallet_address,
            volume_clob,
            volume_merge_split,
            volume_redemption,
            total_volume,
            merge_share,
            wallet_class,
            clob_events,
            merge_events,
            redemption_events
          FROM pm_wallet_volume_classification_v1
          WHERE wallet_address IN (${walletList})
        ),
        -- Calculate Trading PnL (CLOB position-based)
        trading_pnl AS (
          SELECT
            lower(wallet_address) as wallet,
            sum(position_pnl) as pnl_trading
          FROM (
            SELECT
              wallet_address,
              canonical_condition_id,
              outcome_index,
              sum(usdc_delta) + sum(token_delta) * coalesce(any(payout_norm), 0) as position_pnl
            FROM pm_unified_ledger_v9
            WHERE lower(wallet_address) IN (${walletList})
              AND source_type = 'CLOB'
              AND canonical_condition_id IS NOT NULL
              AND canonical_condition_id != ''
            GROUP BY wallet_address, canonical_condition_id, outcome_index
          )
          GROUP BY lower(wallet_address)
        ),
        -- Calculate Cashflow PnL (CLOB + PayoutRedemption)
        cashflow_pnl AS (
          SELECT
            lower(wallet_address) as wallet,
            sumIf(usdc_delta, source_type IN ('CLOB', 'PayoutRedemption')) as pnl_cashflow,
            sum(usdc_delta) as pnl_all_sources
          FROM pm_unified_ledger_v9
          WHERE lower(wallet_address) IN (${walletList})
          GROUP BY lower(wallet_address)
        )
        SELECT
          v.wallet_address,
          v.volume_clob,
          v.volume_merge_split,
          v.volume_redemption,
          v.total_volume,
          v.merge_share,
          v.wallet_class,
          v.clob_events,
          v.merge_events,
          v.redemption_events,
          coalesce(t.pnl_trading, 0) as pnl_trading,
          coalesce(c.pnl_cashflow, 0) as pnl_cashflow,
          coalesce(c.pnl_all_sources, 0) as pnl_all_sources,
          coalesce(t.pnl_trading, 0) - coalesce(c.pnl_cashflow, 0) as pnl_diff,
          now() as computed_at
        FROM vol_data v
        LEFT JOIN trading_pnl t ON lower(v.wallet_address) = t.wallet
        LEFT JOIN cashflow_pnl c ON lower(v.wallet_address) = c.wallet
      `;

      try {
        await clickhouse.command({ query: insertQuery, clickhouse_settings: { max_execution_time: 300 } });
        processedCount += batchRows.length;

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = (processedCount / parseFloat(elapsed)).toFixed(0);
        const pct = ((processedCount / totalWallets) * 100).toFixed(1);

        console.log(`    Batch ${Math.floor(offset / BATCH_SIZE) + 1}: ${processedCount.toLocaleString()}/${totalWallets.toLocaleString()} (${pct}%) | ${rate}/sec | ${elapsed}s`);
      } catch (e: any) {
        console.log(`    ERROR in batch: ${e.message}`);
      }

      offset += BATCH_SIZE;
    }
  }

  console.log('');
  console.log(`Processed ${processedCount.toLocaleString()} wallets`);
  console.log('');

  // ========================================
  // Step 4: Generate statistics
  // ========================================
  console.log('STEP 4: Generating statistics...');
  console.log('');

  // Class distribution with PnL
  const statsQuery = `
    SELECT
      wallet_class,
      count() as wallet_count,
      round(sum(volume_clob), 0) as total_clob,
      round(sum(pnl_trading), 0) as sum_pnl_trading,
      round(sum(pnl_cashflow), 0) as sum_pnl_cashflow,
      round(avg(abs(pnl_diff)), 0) as avg_pnl_diff,
      round(median(abs(pnl_diff)), 0) as median_pnl_diff,
      round(quantile(0.90)(abs(pnl_diff)), 0) as p90_pnl_diff
    FROM pm_wallet_full_classification_v1
    WHERE wallet_class IN ('T', 'M', 'X')
    GROUP BY wallet_class
    ORDER BY wallet_count DESC
  `;

  const statsR = await clickhouse.query({ query: statsQuery, format: 'JSONEachRow' });
  const stats = await statsR.json() as any[];

  console.log('='.repeat(140));
  console.log('CLASS STATISTICS WITH PNL');
  console.log('='.repeat(140));
  console.log('');
  console.log('Class | Wallets      | CLOB Volume          | Sum Trading PnL     | Sum Cashflow PnL    | Avg |Diff|       | Median |Diff|    | P90 |Diff|');
  console.log('-'.repeat(140));

  for (const s of stats) {
    const className = s.wallet_class === 'T' ? 'T (trader)      ' :
                      s.wallet_class === 'M' ? 'M (market-maker)' :
                      'X (mixed)       ';
    console.log(
      className + ' | ' +
      Number(s.wallet_count).toLocaleString().padStart(12) + ' | $' +
      Number(s.total_clob).toLocaleString().padStart(18) + ' | $' +
      Number(s.sum_pnl_trading).toLocaleString().padStart(17) + ' | $' +
      Number(s.sum_pnl_cashflow).toLocaleString().padStart(17) + ' | $' +
      Number(s.avg_pnl_diff).toLocaleString().padStart(13) + ' | $' +
      Number(s.median_pnl_diff).toLocaleString().padStart(12) + ' | $' +
      Number(s.p90_pnl_diff).toLocaleString().padStart(12)
    );
  }

  // Sample high-value wallets from each class for UI validation
  console.log('');
  console.log('='.repeat(140));
  console.log('SAMPLE WALLETS FOR UI VALIDATION');
  console.log('='.repeat(140));

  for (const walletClass of ['T', 'M', 'X']) {
    const sampleQ = `
      SELECT
        wallet_address,
        round(pnl_trading, 2) as pnl_trading,
        round(pnl_cashflow, 2) as pnl_cashflow,
        round(pnl_diff, 2) as pnl_diff,
        round(volume_clob, 2) as vol_clob,
        round(merge_share * 100, 1) as merge_pct
      FROM pm_wallet_full_classification_v1
      WHERE wallet_class = '${walletClass}'
        AND volume_clob > 10000  -- At least $10K CLOB volume
      ORDER BY volume_clob DESC
      LIMIT 10
    `;

    const sampleR = await clickhouse.query({ query: sampleQ, format: 'JSONEachRow' });
    const samples = await sampleR.json() as any[];

    const className = walletClass === 'T' ? 'TRADERS (T)' :
                      walletClass === 'M' ? 'MARKET-MAKERS (M)' :
                      'MIXED (X)';
    console.log(`\n${className} - Top 10 by CLOB volume (min $10K):`);
    console.log('Wallet Address                             | Trading PnL     | Cashflow PnL    | Diff            | CLOB Vol        | Merge%');
    console.log('-'.repeat(130));

    for (const s of samples) {
      console.log(
        s.wallet_address.padEnd(42) + ' | $' +
        Number(s.pnl_trading).toLocaleString().padStart(13) + ' | $' +
        Number(s.pnl_cashflow).toLocaleString().padStart(13) + ' | $' +
        Number(s.pnl_diff).toLocaleString().padStart(13) + ' | $' +
        Number(s.vol_clob).toLocaleString().padStart(13) + ' | ' +
        s.merge_pct + '%'
      );
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log('='.repeat(140));
  console.log(`CLASSIFICATION COMPLETE in ${totalTime}s`);
  console.log('='.repeat(140));
  console.log('');
  console.log('Table created: pm_wallet_full_classification_v1');
  console.log('');
  console.log('Usage:');
  console.log("  SELECT * FROM pm_wallet_full_classification_v1 WHERE wallet_class = 'T' ORDER BY volume_clob DESC LIMIT 100");
  console.log('');
  console.log('NEXT: Run UI validation on sample wallets from each class');
}

main().catch(console.error);
