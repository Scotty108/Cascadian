/**
 * Classify Wallets by Volume (Phase 1)
 *
 * Creates pm_wallet_volume_classification_v1 - volume-based classification only
 * This is FAST because it queries source tables directly without joining.
 *
 * Step 1: Get CLOB volumes from pm_trader_events_v2
 * Step 2: Get CTF volumes from pm_ctf_events
 * Step 3: Combine and classify
 */

import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  console.log('='.repeat(120));
  console.log('WALLET VOLUME CLASSIFICATION (Phase 1 - Volume Only)');
  console.log('='.repeat(120));
  console.log('');

  // ========================================
  // Step 1: Create table
  // ========================================
  console.log('STEP 1: Creating pm_wallet_volume_classification_v1 table...');

  await clickhouse.command({ query: 'DROP TABLE IF EXISTS pm_wallet_volume_classification_v1' });

  const createTable = `
    CREATE TABLE pm_wallet_volume_classification_v1 (
      wallet_address String,
      volume_clob Float64,
      volume_merge_split Float64,
      volume_redemption Float64,
      total_volume Float64,
      merge_share Float64,
      wallet_class LowCardinality(String),
      clob_events UInt64,
      merge_events UInt64,
      redemption_events UInt64,
      computed_at DateTime DEFAULT now()
    ) ENGINE = ReplacingMergeTree(computed_at)
    ORDER BY wallet_address
  `;

  await clickhouse.command({ query: createTable });
  console.log('  Table created.');
  console.log('');

  // ========================================
  // Step 2: Build classification from source tables
  // ========================================
  console.log('STEP 2: Building classification from source tables...');
  console.log('  This uses a single INSERT ... SELECT for speed.');
  console.log('');

  // The strategy: UNION ALL from each source table, then GROUP BY wallet
  const insertQuery = `
    INSERT INTO pm_wallet_volume_classification_v1
    (wallet_address, volume_clob, volume_merge_split, volume_redemption, total_volume, merge_share, wallet_class, clob_events, merge_events, redemption_events, computed_at)
    WITH combined_volumes AS (
      -- CLOB volumes (from pm_trader_events_v2)
      SELECT
        lower(trader_wallet) as wallet,
        sum(usdc_amount) / 1e6 as vol,
        count() as events,
        'CLOB' as source
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY lower(trader_wallet)

      UNION ALL

      -- Merge/Split volumes (from pm_ctf_events)
      SELECT
        lower(user_address) as wallet,
        sum(toFloat64OrZero(amount_or_payout)) / 1e6 as vol,
        count() as events,
        'MERGE' as source
      FROM pm_ctf_events
      WHERE is_deleted = 0 AND event_type IN ('PositionsMerge', 'PositionSplit')
      GROUP BY lower(user_address)

      UNION ALL

      -- Redemption volumes (from pm_ctf_events)
      SELECT
        lower(user_address) as wallet,
        sum(toFloat64OrZero(amount_or_payout)) / 1e6 as vol,
        count() as events,
        'REDEMPTION' as source
      FROM pm_ctf_events
      WHERE is_deleted = 0 AND event_type = 'PayoutRedemption'
      GROUP BY lower(user_address)
    ),
    wallet_totals AS (
      SELECT
        wallet,
        sumIf(vol, source = 'CLOB') as volume_clob,
        sumIf(vol, source = 'MERGE') as volume_merge_split,
        sumIf(vol, source = 'REDEMPTION') as volume_redemption,
        sumIf(events, source = 'CLOB') as clob_events,
        sumIf(events, source = 'MERGE') as merge_events,
        sumIf(events, source = 'REDEMPTION') as redemption_events
      FROM combined_volumes
      GROUP BY wallet
    )
    SELECT
      wallet as wallet_address,
      volume_clob,
      volume_merge_split,
      volume_redemption,
      volume_clob + volume_merge_split + volume_redemption as total_volume,
      if(volume_clob + volume_merge_split + volume_redemption > 0,
         volume_merge_split / (volume_clob + volume_merge_split + volume_redemption),
         0) as merge_share,
      multiIf(
        volume_clob + volume_merge_split + volume_redemption = 0, 'EMPTY',
        volume_merge_split / (volume_clob + volume_merge_split + volume_redemption + 0.0001) > 0.5, 'M',
        volume_merge_split / (volume_clob + volume_merge_split + volume_redemption + 0.0001) < 0.2, 'T',
        'X'
      ) as wallet_class,
      clob_events,
      merge_events,
      redemption_events,
      now() as computed_at
    FROM wallet_totals
  `;

  console.log('  Executing INSERT ... SELECT (this may take a few minutes)...');
  const startTime = Date.now();

  try {
    await clickhouse.command({ query: insertQuery, clickhouse_settings: { max_execution_time: 600 } });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  Insert complete in ${elapsed}s`);
  } catch (e: any) {
    console.log('  ERROR: ' + e.message);
    return;
  }

  console.log('');

  // ========================================
  // Step 3: Generate statistics
  // ========================================
  console.log('STEP 3: Generating statistics...');
  console.log('');

  // Total wallet count
  const countQ = `SELECT count() as cnt FROM pm_wallet_volume_classification_v1`;
  const countR = await clickhouse.query({ query: countQ, format: 'JSONEachRow' });
  const countRows = await countR.json() as any[];
  console.log(`Total wallets classified: ${Number(countRows[0].cnt).toLocaleString()}`);
  console.log('');

  // Class distribution
  const classQ = `
    SELECT
      wallet_class,
      count() as wallet_count,
      round(sum(volume_clob), 2) as total_clob,
      round(sum(volume_merge_split), 2) as total_merge,
      round(sum(volume_redemption), 2) as total_redemption,
      round(sum(total_volume), 2) as total_volume
    FROM pm_wallet_volume_classification_v1
    WHERE wallet_class != 'EMPTY'
    GROUP BY wallet_class
    ORDER BY wallet_count DESC
  `;

  const classR = await clickhouse.query({ query: classQ, format: 'JSONEachRow' });
  const classRows = await classR.json() as any[];

  console.log('='.repeat(120));
  console.log('CLASS DISTRIBUTION');
  console.log('='.repeat(120));
  console.log('');
  console.log('Class | Wallets      | % Wallets | CLOB Volume      | Merge Volume     | Redemp Volume    | Total Volume');
  console.log('-'.repeat(120));

  let totalWallets = 0;
  let grandTotal = 0;
  for (const c of classRows) {
    totalWallets += Number(c.wallet_count);
    grandTotal += Number(c.total_volume);
  }

  for (const c of classRows) {
    const className = c.wallet_class === 'T' ? 'T (trader)     ' :
                      c.wallet_class === 'M' ? 'M (market-maker)' :
                      'X (mixed)      ';
    const walletPct = ((Number(c.wallet_count) / totalWallets) * 100).toFixed(1) + '%';

    console.log(
      className + ' | ' +
      Number(c.wallet_count).toLocaleString().padStart(12) + ' | ' +
      walletPct.padStart(9) + ' | $' +
      Number(c.total_clob).toLocaleString().padStart(14) + ' | $' +
      Number(c.total_merge).toLocaleString().padStart(14) + ' | $' +
      Number(c.total_redemption).toLocaleString().padStart(14) + ' | $' +
      Number(c.total_volume).toLocaleString().padStart(14)
    );
  }

  console.log('-'.repeat(120));
  console.log(`TOTAL: ${totalWallets.toLocaleString()} wallets | $${grandTotal.toLocaleString()} volume`);
  console.log('');

  // Volume percentages by class
  console.log('='.repeat(120));
  console.log('VOLUME SHARE BY CLASS');
  console.log('='.repeat(120));
  console.log('');
  for (const c of classRows) {
    const volumePct = ((Number(c.total_volume) / grandTotal) * 100).toFixed(1);
    console.log(`  ${c.wallet_class}: ${volumePct}% of total platform volume`);
  }

  // Sample wallets from each class
  console.log('');
  console.log('='.repeat(120));
  console.log('SAMPLE WALLETS FOR UI VALIDATION');
  console.log('='.repeat(120));

  for (const walletClass of ['T', 'M', 'X']) {
    const sampleQ = `
      SELECT
        wallet_address,
        round(volume_clob, 2) as vol_clob,
        round(volume_merge_split, 2) as vol_merge,
        round(merge_share * 100, 1) as merge_pct
      FROM pm_wallet_volume_classification_v1
      WHERE wallet_class = '${walletClass}'
        AND volume_clob > 10000  -- At least $10K CLOB volume
      ORDER BY total_volume DESC
      LIMIT 15
    `;

    const sampleR = await clickhouse.query({ query: sampleQ, format: 'JSONEachRow' });
    const samples = await sampleR.json() as any[];

    const className = walletClass === 'T' ? 'TRADERS (T)' :
                      walletClass === 'M' ? 'MARKET-MAKERS (M)' :
                      'MIXED (X)';
    console.log(`\n${className} - Top 15 by total volume (min $10K CLOB):`);
    console.log('Wallet Address                             | CLOB Volume     | Merge Volume    | Merge%');
    console.log('-'.repeat(100));

    for (const s of samples) {
      console.log(
        s.wallet_address.padEnd(42) + ' | $' +
        Number(s.vol_clob).toLocaleString().padStart(13) + ' | $' +
        Number(s.vol_merge).toLocaleString().padStart(13) + ' | ' +
        s.merge_pct + '%'
      );
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log('='.repeat(120));
  console.log(`CLASSIFICATION COMPLETE in ${totalTime}s`);
  console.log('='.repeat(120));
  console.log('');
  console.log('Table created: pm_wallet_volume_classification_v1');
  console.log('');
  console.log('NEXT STEP: Add PnL calculations to this table for full classification.');
  console.log('');
  console.log('Usage:');
  console.log("  SELECT * FROM pm_wallet_volume_classification_v1 WHERE wallet_class = 'T' LIMIT 100");
  console.log('  SELECT wallet_class, count() FROM pm_wallet_volume_classification_v1 GROUP BY wallet_class');
}

main().catch(console.error);
