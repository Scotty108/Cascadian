import { clickhouse } from './lib/clickhouse/client';

interface AttributionConflict {
  transaction_hash: string;
  wallets: string[];
  wallet_count: number;
  total_value: number;
}

async function checkGlobalCollisions() {
  console.log('=== CHECKING FOR EXISTING ATTRIBUTION CONFLICTS ===\n');

  const collisionsResult = await clickhouse.query({
    query: `
      SELECT
        transaction_hash,
        groupUniqArray(lower(wallet_address)) AS wallets,
        count() AS wallet_count,
        sum(usd_value) AS total_value
      FROM pm_trades_canonical_v3
      GROUP BY transaction_hash
      HAVING wallet_count > 1
      ORDER BY total_value DESC
      LIMIT 100
    `,
    format: 'JSONEachRow'
  });

  const collisions = await collisionsResult.json<AttributionConflict>();

  console.log(`Total attribution conflicts found: ${collisions.length}`);

  if (collisions.length === 0) {
    console.log('✅ No attribution conflicts detected in current data');
    return { count: 0, total_value: 0, collisions: [] };
  }

  const totalAffectedValue = collisions.reduce((sum, c) => sum + c.total_value, 0);

  console.log(`Total affected trading volume: $${totalAffectedValue.toFixed(2)}\n`);
  console.log('Top 10 conflicts by value:');

  collisions.slice(0, 10).forEach((conflict, idx) => {
    console.log(`\n${idx + 1}. TX: ${conflict.transaction_hash.substring(0, 16)}...`);
    console.log(`   Wallets (${conflict.wallet_count}): ${conflict.wallets.slice(0, 3).join(', ')}${conflict.wallet_count > 3 ? '...' : ''}`);
    console.log(`   Total Value: $${conflict.total_value.toFixed(2)}`);
  });

  // Analyze by conflict severity
  console.log('\n=== CONFLICT SEVERITY ANALYSIS ===');
  const severe = collisions.filter(c => c.wallet_count > 5);
  const moderate = collisions.filter(c => c.wallet_count > 2 && c.wallet_count <= 5);
  const minor = collisions.filter(c => c.wallet_count === 2);

  console.log(`Severe (>5 wallets): ${severe.length}`);
  console.log(`Moderate (3-5 wallets): ${moderate.length}`);
  console.log(`Minor (2 wallets): ${minor.length}`);

  // Analyze by value
  console.log('\n=== VALUE DISTRIBUTION ===');
  const highValue = collisions.filter(c => c.total_value > 100000);
  const mediumValue = collisions.filter(c => c.total_value > 10000 && c.total_value <= 100000);
  const lowValue = collisions.filter(c => c.total_value <= 10000);

  console.log(`High value (>$100k): ${highValue.length} conflicts, $${highValue.reduce((s, c) => s + c.total_value, 0).toFixed(2)}`);
  console.log(`Medium value ($10k-$100k): ${mediumValue.length} conflicts, $${mediumValue.reduce((s, c) => s + c.total_value, 0).toFixed(2)}`);
  console.log(`Low value (<$10k): ${lowValue.length} conflicts, $${lowValue.reduce((s, c) => s + c.total_value, 0).toFixed(2)}`);

  return {
    count: collisions.length,
    total_value: totalAffectedValue,
    collisions,
    severity: { severe: severe.length, moderate: moderate.length, minor: minor.length },
    value_distribution: { high: highValue.length, medium: mediumValue.length, low: lowValue.length }
  };
}

// Run check
checkGlobalCollisions()
  .then(results => {
    console.log('\n✅ Collision check complete');
    console.log(`\nSummary: ${results.count} conflicts affecting $${results.total_value.toFixed(2)}`);
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Collision check failed:', error);
    process.exit(1);
  });
