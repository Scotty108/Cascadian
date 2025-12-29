/**
 * Evaluate User-Provided Wallets for Copy-Trading Suitability
 *
 * This script evaluates ~40 wallets provided by the user against:
 * - Core metrics: omega, win rate, PnL, volume
 * - Copyability: avg entry price, hold time, concentration
 * - Crowding risk: view count analysis
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
});

// All wallets to evaluate (Group A + resolved Group B)
const WALLETS_TO_EVALUATE = {
  // GEOPOLITICS (8)
  '0x43372356634781eea88d61bbdd7824cdce958882': { name: '@Anjun', category: 'Geopolitics', source: 'TOP_GEO' },
  '0x41583f2efc720b8e2682750fffb67f2806fece9f': { name: '@Toncar16', category: 'Geopolitics', source: 'TOP_GEO' },
  '0x75e765216a57942d738d880ffcda854d9f869080': { name: '@25usdc', category: 'Geopolitics', source: 'TOP_GEO' },
  '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8': { name: '@HolyMoses7', category: 'Geopolitics', source: 'TOP_GEO' },
  '0x4638d71d7b2d36eb590b5e1824955712dc8ad587': { name: '@jeb2016', category: 'Geopolitics', source: 'TOP_GEO' },
  '0x7744bfd749a70020d16a1fcbac1d064761c9999e': { name: '@chungguskhan', category: 'Geopolitics', source: 'TOP_GEO' },
  '0xa9b44dca52ed35e59ac2a6f49d1203b8155464ed': { name: '@VvVv', category: 'Geopolitics', source: 'TOP_GEO' },
  '0x000d257d2dc7616feaef4ae0f14600fdf50a758e': { name: '@scottilicious', category: 'Geopolitics', source: 'TOP_GEO' },

  // SPORTS (9)
  '0xe90bec87d9ef430f27f9dcfe72c34b76967d5da2': { name: '@gmanas', category: 'Sports', source: 'TOP_SPORTS' },
  '0xd38b71f3e8ed1af71983e5c309eac3dfa9b35029': { name: '@primm', category: 'Sports', source: 'TOP_SPORTS' },
  '0x2c57db9e442ef5ffb2651f03afd551171738c94d': { name: '@ZerOptimist', category: 'Sports', source: 'TOP_SPORTS' },
  '0x82a1b239e7e0ff25a2ac12a20b59fd6b5f90e03a': { name: '@darkrider11', category: 'Sports', source: 'TOP_SPORTS' },
  '0x9b979a065641e8cfde3022a30ed2d9415cf55e12': { name: '@LlamaEnjoyer', category: 'Sports', source: 'TOP_SPORTS' },
  '0x42592084120b0d5287059919d2a96b3b7acb936f': { name: '@antman-batman', category: 'Sports', source: 'TOP_SPORTS' },
  '0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee': { name: '@kch123', category: 'Sports', source: 'TOP_SPORTS' },
  '0x2f09642639aedd6ced432519c1a86e7d52034632': { name: '@piastri', category: 'Sports', source: 'TOP_SPORTS' },
  '0x2005d16a84ceefa912d4e380cd32e7ff827875ea': { name: '@RN1', category: 'Sports', source: 'TOP_SPORTS' },

  // WEATHER (1)
  '0x0f37cb80dee49d55b5f6d9e595d52591d6371410': { name: '@Hans323', category: 'Weather', source: 'TOP_WEATHER' },

  // ESPORTS (2)
  '0xec981ed70ae69c5cbcac08c1ba063e734f6bafcd': { name: '@0xheavy888', category: 'Esports', source: 'TOP_ESPORTS' },
  '0x40471b34671887546013ceb58740625c2efe7293': { name: '@esports095', category: 'Esports', source: 'TOP_ESPORTS' },

  // ENTERTAINMENT (1)
  '0x3c593aeb73ebdadbc9ce76d4264a6a2af4011766': { name: '@eightpenguins', category: 'Entertainment', source: 'TOP_ENTERTAINMENT' },

  // CRYPTO (1 - note: SynthDataDotCo and JBODnumber1 are same wallet)
  '0x557bed924a1bb6f62842c5742d1dc789b8d480d4': { name: '@SynthDataDotCo/@JBODnumber1', category: 'Crypto', source: 'TOP_CRYPTO' },

  // ADDITIONAL (5)
  '0x00090e8b4fa8f88dc9c1740e460dd0f670021d43': { name: 'Super forecaster', category: 'Unknown', source: 'USER_FOUND' },
  '0x1521b47bf0c41f6b7fd3ad41cdec566812c8f23e': { name: 'Profile link 1', category: 'Unknown', source: 'USER_FOUND' },
  '0x153bd1a568460b5b4e56f67691dca1b54b83275e': { name: 'Profile link 2', category: 'Unknown', source: 'USER_FOUND' },
  '0x01caaea830076f1dfd77c38375bff51c8305038c': { name: 'Profile link 3', category: 'Unknown', source: 'USER_FOUND' },
  '0x0185f2e4dd9c3183eff6208e8fc2385c85760bd3': { name: 'Profile link 4', category: 'Unknown', source: 'USER_FOUND' },

  // RESOLVED FROM USERNAMES (Bitcoin/Crypto traders)
  '0xe9c6312464b52aa3eff13d822b003282075995c9': { name: '@kingofcoinflips', category: 'Crypto', source: 'RESOLVED' },
  '0x0f863d92dd2b960e3eb6a23a35fd92a91981404e': { name: '@Qualitative', category: 'Crypto', source: 'RESOLVED' },
  '0x71a70f24538d885d1b45f9cea158a2cdf2e56fcf': { name: '@easyclap', category: 'Crypto', source: 'RESOLVED' },
  '0xeffcc79a8572940cee2238b44eac89f2c48fda88': { name: '@FirstOrder', category: 'Crypto', source: 'RESOLVED' },
  '0x7485d661b858b117a66e1b4fcbecfaea87ac1393': { name: '@1TickWonder2', category: 'Crypto', source: 'RESOLVED' },
  '0x4a38e6e0330c2463fb5ac2188a620634039abfe8': { name: '@stonksgoup', category: 'Crypto', source: 'RESOLVED' },
  '0x55be7aa03ecfbe37aa5460db791205f7ac9ddca3': { name: '@coinman2', category: 'Crypto', source: 'RESOLVED' },
  '0x751a2b86cab503496efd325c8344e10159349ea1': { name: '@Sharky6999', category: 'Crypto', source: 'RESOLVED' },
  '0xcc500cbcc8b7cf5bd21975ebbea34f21b5644c82': { name: '@justdance', category: 'Crypto', source: 'RESOLVED' },
  '0xfeb581080aee6dc26c264a647b30a9cd44d5a393': { name: '@completion', category: 'Crypto', source: 'RESOLVED' },
  '0x28065f1b88027422274fb33e1e22bf3dad5736e7': { name: '@Circus', category: 'Crypto', source: 'RESOLVED' },
  '0x8749194e5105c97c3d134e974e103b44eea44ea4': { name: '@0x066423...', category: 'Crypto', source: 'RESOLVED' },
};

interface WalletMetrics {
  wallet: string;
  name: string;
  category: string;
  source: string;
  // Core metrics
  n_positions: number;
  n_events: number;
  n_trades: number;
  n_resolved: number;
  n_wins: number;
  n_losses: number;
  win_pct: number;
  omega: number;
  pnl_60d: number;
  gross_wins: number;
  gross_losses: number;
  total_notional: number;
  // Copyability metrics
  avg_entry_price: number;
  avg_hold_hours: number;
  // Flags
  is_grinder: boolean;
  is_scalper: boolean;
  verdict: string;
}

async function evaluateWallets(): Promise<WalletMetrics[]> {
  const walletAddresses = Object.keys(WALLETS_TO_EVALUATE);
  const walletList = walletAddresses.map(w => `'${w.toLowerCase()}'`).join(',');

  console.log(`\n=== Evaluating ${walletAddresses.length} Wallets ===\n`);

  // Query 1: Core metrics (omega, win rate, PnL)
  const coreMetricsQuery = `
    WITH
      resolutions AS (
        SELECT
          condition_id, outcome_index,
          any(resolved_price) AS resolution_price
        FROM vw_pm_resolution_prices
        GROUP BY condition_id, outcome_index
      ),
      positions AS (
        SELECT
          lower(wallet_address) AS wallet,
          condition_id,
          outcome_index,
          sum(usdc_delta) AS cash_flow,
          sum(token_delta) AS final_tokens,
          count() AS trade_count,
          min(event_time) AS first_trade,
          max(event_time) AS last_trade
        FROM pm_unified_ledger_v6
        WHERE lower(wallet_address) IN (${walletList})
          AND event_time >= now() - INTERVAL 60 DAY
          AND source_type = 'CLOB'
          AND condition_id IS NOT NULL
          AND condition_id != ''
        GROUP BY wallet, condition_id, outcome_index
      ),
      position_pnl AS (
        SELECT
          p.*,
          r.resolution_price,
          CASE WHEN r.resolution_price IS NOT NULL
            THEN p.cash_flow + (p.final_tokens * r.resolution_price)
            ELSE NULL
          END AS realized_pnl,
          r.resolution_price IS NOT NULL AS is_resolved
        FROM positions p
        LEFT JOIN resolutions r USING (condition_id, outcome_index)
      )
    SELECT
      wallet,
      count() AS n_positions,
      uniqExact(condition_id) AS n_events,
      sum(trade_count) AS n_trades,
      round(sum(abs(cash_flow)), 2) AS total_notional,
      countIf(is_resolved) AS n_resolved,
      countIf(realized_pnl > 0 AND is_resolved) AS n_wins,
      countIf(realized_pnl <= 0 AND is_resolved) AS n_losses,
      round(countIf(realized_pnl > 0 AND is_resolved) * 100.0 / nullIf(countIf(is_resolved), 0), 1) AS win_pct,
      round(sumIf(realized_pnl, realized_pnl > 0 AND is_resolved) /
            nullIf(abs(sumIf(realized_pnl, realized_pnl < 0 AND is_resolved)), 0), 2) AS omega,
      round(sumIf(realized_pnl, is_resolved), 2) AS pnl_60d,
      round(sumIf(realized_pnl, realized_pnl > 0 AND is_resolved), 2) AS gross_wins,
      round(abs(sumIf(realized_pnl, realized_pnl < 0 AND is_resolved)), 2) AS gross_losses
    FROM position_pnl
    GROUP BY wallet
    ORDER BY pnl_60d DESC
  `;

  console.log('Running core metrics query...');
  const coreResult = await ch.query({ query: coreMetricsQuery, format: 'JSONEachRow' });
  const coreMetrics = await coreResult.json() as any[];
  console.log(`Got core metrics for ${coreMetrics.length} wallets\n`);

  // Query 2: Entry price analysis (detect grinders)
  const entryPriceQuery = `
    SELECT
      lower(wallet_address) AS wallet,
      round(sumIf(abs(usdc_delta), token_delta > 0) /
            nullIf(sumIf(token_delta, token_delta > 0), 0), 4) AS avg_entry_price
    FROM pm_unified_ledger_v6
    WHERE lower(wallet_address) IN (${walletList})
      AND event_time >= now() - INTERVAL 60 DAY
      AND source_type = 'CLOB'
    GROUP BY wallet
  `;

  console.log('Running entry price query...');
  const entryResult = await ch.query({ query: entryPriceQuery, format: 'JSONEachRow' });
  const entryMetrics = await entryResult.json() as any[];
  const entryMap = new Map(entryMetrics.map(e => [e.wallet, e.avg_entry_price]));
  console.log(`Got entry prices for ${entryMetrics.length} wallets\n`);

  // Query 3: Hold time analysis (detect scalpers)
  const holdTimeQuery = `
    WITH positions AS (
      SELECT
        lower(wallet_address) AS wallet,
        condition_id,
        outcome_index,
        min(event_time) AS first_trade,
        max(event_time) AS last_trade
      FROM pm_unified_ledger_v6
      WHERE lower(wallet_address) IN (${walletList})
        AND event_time >= now() - INTERVAL 60 DAY
        AND source_type = 'CLOB'
      GROUP BY wallet, condition_id, outcome_index
    )
    SELECT
      wallet,
      round(avg(dateDiff('hour', first_trade, last_trade)), 1) AS avg_hold_hours
    FROM positions
    GROUP BY wallet
  `;

  console.log('Running hold time query...');
  const holdResult = await ch.query({ query: holdTimeQuery, format: 'JSONEachRow' });
  const holdMetrics = await holdResult.json() as any[];
  const holdMap = new Map(holdMetrics.map(h => [h.wallet, h.avg_hold_hours]));
  console.log(`Got hold times for ${holdMetrics.length} wallets\n`);

  // Combine results
  const results: WalletMetrics[] = [];

  for (const core of coreMetrics) {
    const walletInfo = WALLETS_TO_EVALUATE[core.wallet] || WALLETS_TO_EVALUATE[core.wallet.toLowerCase()];
    if (!walletInfo) continue;

    const avgEntry = entryMap.get(core.wallet) || 0;
    const avgHold = holdMap.get(core.wallet) || 0;

    const isGrinder = avgEntry > 0.85;
    const isScalper = avgHold < 1;

    let verdict = '✅ RECOMMENDED';
    const flags: string[] = [];

    if (core.omega < 1.0) {
      verdict = '❌ AVOID';
      flags.push('NEGATIVE_EDGE');
    } else if (isGrinder) {
      verdict = '⚠️ CAUTION';
      flags.push('HIGH_ENTRY');
    } else if (isScalper) {
      verdict = '⚠️ CAUTION';
      flags.push('SCALPER');
    } else if (core.n_resolved < 5) {
      verdict = '❓ INSUFFICIENT_DATA';
      flags.push('LOW_RESOLVED');
    } else if (core.win_pct > 90) {
      verdict = '⚠️ CAUTION';
      flags.push('SUSPICIOUS_WIN_RATE');
    }

    results.push({
      wallet: core.wallet,
      name: walletInfo.name,
      category: walletInfo.category,
      source: walletInfo.source,
      n_positions: core.n_positions,
      n_events: core.n_events,
      n_trades: core.n_trades,
      n_resolved: core.n_resolved,
      n_wins: core.n_wins,
      n_losses: core.n_losses,
      win_pct: core.win_pct || 0,
      omega: core.omega || 0,
      pnl_60d: core.pnl_60d || 0,
      gross_wins: core.gross_wins || 0,
      gross_losses: core.gross_losses || 0,
      total_notional: core.total_notional || 0,
      avg_entry_price: avgEntry,
      avg_hold_hours: avgHold,
      is_grinder: isGrinder,
      is_scalper: isScalper,
      verdict: flags.length > 0 ? `${verdict} (${flags.join(', ')})` : verdict,
    });
  }

  // Sort by PnL descending
  results.sort((a, b) => b.pnl_60d - a.pnl_60d);

  return results;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     WALLET COPY-TRADING EVALUATION - User Wallets          ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const results = await evaluateWallets();

  // Print summary table
  console.log('\n=== EVALUATION RESULTS ===\n');
  console.log('| Rank | Name                    | Category    | PnL 60d    | Omega | Win%  | Entry | Hours | Verdict              |');
  console.log('|------|-------------------------|-------------|------------|-------|-------|-------|-------|----------------------|');

  results.forEach((r, i) => {
    const name = r.name.slice(0, 22).padEnd(23);
    const cat = r.category.slice(0, 11).padEnd(11);
    const pnl = `$${r.pnl_60d.toLocaleString()}`.padStart(10);
    const omega = (r.omega || 0).toFixed(2).padStart(5);
    const win = `${(r.win_pct || 0).toFixed(0)}%`.padStart(5);
    const entry = (r.avg_entry_price || 0).toFixed(2).padStart(5);
    const hours = `${(r.avg_hold_hours || 0).toFixed(0)}h`.padStart(5);
    const verdict = r.verdict.slice(0, 20).padEnd(20);

    console.log(`| ${(i+1).toString().padStart(4)} | ${name} | ${cat} | ${pnl} | ${omega} | ${win} | ${entry} | ${hours} | ${verdict} |`);
  });

  // Summary stats
  const recommended = results.filter(r => r.verdict.startsWith('✅')).length;
  const caution = results.filter(r => r.verdict.startsWith('⚠️')).length;
  const avoid = results.filter(r => r.verdict.startsWith('❌')).length;
  const insufficient = results.filter(r => r.verdict.startsWith('❓')).length;

  console.log('\n=== SUMMARY ===');
  console.log(`Total wallets evaluated: ${results.length}`);
  console.log(`✅ RECOMMENDED: ${recommended}`);
  console.log(`⚠️ CAUTION: ${caution}`);
  console.log(`❌ AVOID: ${avoid}`);
  console.log(`❓ INSUFFICIENT DATA: ${insufficient}`);

  // Print top 10 recommended
  const topRecommended = results.filter(r => r.verdict.startsWith('✅')).slice(0, 10);
  if (topRecommended.length > 0) {
    console.log('\n=== TOP RECOMMENDED FOR COPY-TRADING ===\n');
    topRecommended.forEach((r, i) => {
      console.log(`${i+1}. ${r.name} (${r.category})`);
      console.log(`   Wallet: ${r.wallet}`);
      console.log(`   PnL 60d: $${r.pnl_60d.toLocaleString()} | Omega: ${r.omega} | Win: ${r.win_pct}%`);
      console.log(`   Entry: ${r.avg_entry_price.toFixed(2)} | Hold: ${r.avg_hold_hours.toFixed(0)}h | Trades: ${r.n_trades}`);
      console.log('');
    });
  }

  // Save results to JSON
  const fs = await import('fs');
  const outputDir = '/Users/scotty/Projects/Cascadian-app/exports/copytrade';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputFile = `${outputDir}/user-wallet-evaluation-${new Date().toISOString().split('T')[0]}.json`;
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to: ${outputFile}`);

  await ch.close();
}

main().catch(console.error);
