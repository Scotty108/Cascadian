/**
 * Fresh 20-wallet validation against UI
 * 
 * Using Playwright-scraped UI values vs our realizedUiStyleV1 calculation
 */
import { clickhouse } from '../../lib/clickhouse/client';
import { calculateRealizedUiStyle } from '../../lib/pnl/realizedUiStyleV1';

async function getRandomWalletsWithData(count: number): Promise<string[]> {
  const query = `
    SELECT 
      wallet_address,
      countDistinct(condition_id) as conditions,
      sum(abs(usdc_delta)) as volume
    FROM pm_unified_ledger_v8_tbl
    WHERE wallet_address != ''
      AND condition_id != ''
    GROUP BY wallet_address
    HAVING conditions >= 5 AND volume >= 100
    ORDER BY rand()
    LIMIT ${count}
  `;
  
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];
  return rows.map(r => r.wallet_address);
}

async function main() {
  console.log('=== Fresh 20-Wallet Validation ===\n');
  
  // Get 20 random wallets with good data coverage
  const wallets = await getRandomWalletsWithData(20);
  
  console.log('Selected wallets:');
  for (const w of wallets) {
    console.log(`  ${w}`);
  }
  console.log('\nCalculating PnL for each...\n');
  
  const results: { wallet: string; ours: number; positions: number; resolved: number }[] = [];
  
  for (const wallet of wallets) {
    try {
      const calc = await calculateRealizedUiStyle(wallet);
      results.push({
        wallet,
        ours: calc.realized_pnl,
        positions: calc.total_positions,
        resolved: calc.resolved_positions
      });
      console.log(`${wallet}: $${calc.realized_pnl.toFixed(2)} (${calc.resolved_positions}/${calc.total_positions} resolved)`);
    } catch (e: any) {
      console.log(`${wallet}: ERROR - ${e.message}`);
    }
  }
  
  console.log('\n=== Summary ===');
  console.log(`Total wallets: ${results.length}`);
  console.log(`Avg realized: $${(results.reduce((s, r) => s + r.ours, 0) / results.length).toFixed(2)}`);
  
  // Output wallets for Playwright scraping
  console.log('\n=== Polymarket URLs for Playwright ===');
  for (const r of results) {
    console.log(`https://polymarket.com/${r.wallet}`);
  }
  
  process.exit(0);
}

main().catch(console.error);
