#!/usr/bin/env tsx
/**
 * SMART MONEY MARKET STRATEGY - POLITICS
 *
 * Strategy: Find politics markets where elite wallets are heavily positioned on one side
 * Approach: Market-focused (analyze markets for smart money consensus)
 *
 * Flow: DATA_SOURCE (Markets) → MARKET_FILTER → SMART_MONEY_SIGNAL → ORCHESTRATOR → ACTION
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function createSmartMoneyPoliticsStrategy() {
  const supabase = createClient(supabaseUrl, supabaseKey)

  // Delete existing strategy if it exists
  const { data: existing } = await supabase
    .from('strategy_definitions')
    .select('strategy_id')
    .eq('strategy_name', 'Smart Money - Politics Markets')
    .single()

  if (existing) {
    console.log('Found existing Smart Money Politics strategy, updating...')
    await supabase
      .from('strategy_definitions')
      .delete()
      .eq('strategy_id', existing.strategy_id)
    console.log('✅ Deleted old strategy')
  }

  const strategyId = crypto.randomUUID()

  /**
   * NODE GRAPH
   * ===========
   *
   * 1. DATA_SOURCE: Fetch all active markets from Polymarket
   * 2. MARKET_FILTER: Filter by liquidity, end date, category
   * 3. SMART_MONEY_SIGNAL: Analyze top holders → Calculate OWRR → Filter by threshold
   * 4. ORCHESTRATOR: Position sizing based on signal strength
   * 5. ACTION: Execute trades on markets with strong smart money signals
   *
   * KEY DIFFERENCE from Copy Trading:
   * - Copy Trading: Watch wallets → Copy when they trade
   * - Smart Money: Scan markets → Trade when smart money has consensus
   */
  const nodeGraph = {
    nodes: [
      // 1. DATA_SOURCE - Fetch Markets
      {
        id: 'data_source_markets',
        type: 'DATA_SOURCE',
        config: {
          source: 'MARKETS',
          filters: {
            active_only: true,
            min_liquidity_usd: 10000,
          }
        },
      },

      // 2. MARKET_FILTER - Filter Politics Markets
      {
        id: 'filter_politics_markets',
        type: 'MARKET_FILTER',
        config: {
          categories: ['politics'],
          min_liquidity_usd: 50000,      // Minimum $50k liquidity
          max_days_to_close: 14,         // Closes within 14 days
          min_days_to_close: 1,          // At least 1 day away
          exclude_keywords: ['parlay'],  // Exclude parlay markets
        },
      },

      // 3. SMART_MONEY_SIGNAL - Analyze Smart Money Positioning
      {
        id: 'smart_money_signal',
        type: 'SMART_MONEY_SIGNAL',
        config: {
          // OWRR Thresholds
          min_owrr_yes: 0.65,           // OWRR ≥ 0.65 = strong YES (2+ elite wallets agree)
          max_owrr_no: 0.35,            // OWRR ≤ 0.35 = strong NO (2+ elite wallets agree)
          min_confidence: 'medium',      // Require medium+ confidence (12+ qualified wallets)

          // Optional: Edge requirement
          min_edge_percent: 5,          // Minimum 5% edge to trade
        },
      },

      // 4. ORCHESTRATOR - Position Sizing
      {
        id: 'orchestrator_position_sizing',
        type: 'ORCHESTRATOR',
        config: {
          version: 1,
          mode: 'approval',             // Set to 'autonomous' for auto-execution
          portfolio_size_usd: 10000,
          risk_tolerance: 5,

          position_sizing_rules: {
            fractional_kelly_lambda: 0.25,
            max_per_position: 0.05,
            min_bet: 10,
            max_bet: 500,
            portfolio_heat_limit: 0.50,
            risk_reward_threshold: 2.0,
            drawdown_protection: {
              enabled: true,
              drawdown_threshold: 0.10,
              size_reduction: 0.50,
            },
            volatility_adjustment: {
              enabled: false,
            },
          },
        },
      },

      // 5. ACTION - Execute Trades
      {
        id: 'action_execute_trades',
        type: 'ACTION',
        config: {
          action: 'EXECUTE_TRADE',
          description: 'Execute trades on markets with strong smart money signals',
        },
      },
    ],

    edges: [
      { from: 'data_source_markets', to: 'filter_politics_markets' },
      { from: 'filter_politics_markets', to: 'smart_money_signal' },
      { from: 'smart_money_signal', to: 'orchestrator_position_sizing' },
      { from: 'orchestrator_position_sizing', to: 'action_execute_trades' },
    ],
  }

  const { data, error } = await supabase
    .from('strategy_definitions')
    .insert({
      strategy_id: strategyId,
      strategy_name: 'Smart Money - Politics Markets',
      strategy_description: `**MARKET-FOCUSED SMART MONEY STRATEGY**

Find politics markets where elite wallets are heavily positioned on one side, then trade those high-conviction opportunities.

**Strategy**: Scan markets for smart money consensus
**Trade Frequency**: Low-Medium (5-20 positions)
**Approach**: Market analysis (not wallet following)
**Best For**: Finding mispriced markets with strong smart money signals

---

**How It Works:**

1. **Scan Active Markets** (100+ politics markets)
2. **Filter Markets**:
   • Liquidity ≥ $50k
   • Closes in 1-14 days
   • Politics category only

3. **Analyze Smart Money** (OWRR):
   • Get top 20 holders on YES side
   • Get top 20 holders on NO side
   • Filter: Only wallets with 10+ trades in politics
   • Calculate OWRR (Omega-Weighted Risk Ratio)
   • OWRR = smart money consensus score (0-100)

4. **Trade Strong Signals**:
   • OWRR ≥ 65 = BUY YES (smart money bullish)
   • OWRR ≤ 35 = BUY NO (smart money bearish)
   • Only trade if confidence is Medium+ (12+ qualified wallets)

---

**OWRR Formula:**

For each wallet on a market:
\`\`\`
voice = omega_in_politics × sqrt(money_at_risk)

S_YES = sum of all YES wallet voices
S_NO = sum of all NO wallet voices
OWRR = S_YES / (S_YES + S_NO) × 100
\`\`\`

**OWRR Interpretation:**
• 0-35: Strong NO signal (smart money bearish)
• 35-45: Lean NO
• 45-55: Neutral (skip)
• 55-65: Lean YES
• 65-100: Strong YES signal (smart money bullish)

---

**Why OWRR Works:**

✅ **Category-Specific**: Only counts politics performance (not crypto or sports)
✅ **Quality-Weighted**: Better performers get more voice (omega weighting)
✅ **Whale-Dampened**: sqrt prevents one whale from dominating
✅ **Track Record Required**: Minimum 10 trades in politics to qualify

---

**Example Trade:**

**Market**: "Will Trump win 2024?"
**Analysis**:
• Top 20 YES holders: 15 qualified (avg Omega 2.1)
• Top 20 NO holders: 8 qualified (avg Omega 1.3)
• OWRR: 72/100

**Signal**: STRONG YES (72 ≥ 65)
**Reason**: 15 elite politics wallets are bullish vs 8 bearish
**Action**: BUY YES with Kelly position sizing

---

**Position Sizing:**
• Conservative Kelly (0.25 fractional)
• Max 5% per position
• Max 50% portfolio deployed
• $10-$500 bet range
• Drawdown protection enabled

**Edge Requirement:**
• Minimum 5% edge to trade
• Edge = (OWRR_prob / market_price) - 1
• Example: OWRR 70%, price 60¢ → edge = 16.7%

---

**Pros:**
✅ Find mispriced markets before crowd catches on
✅ Follow elite consensus, not individual wallets
✅ Category-specific expertise (politics traders on politics)
✅ Lower trade frequency = lower transaction costs

**Cons:**
⚠️ Requires sufficient liquidity ($50k+)
⚠️ Needs enough qualified wallets (12+)
⚠️ Market must be "figure-outable" (skill-based, not random)

---

**Perfect For:**
• Finding alpha in politics prediction markets
• Riding smart money consensus signals
• Lower-frequency, higher-conviction trading
• Those who prefer market analysis over wallet following

---

**Execution Mode:**
• Default: Paper trading (safe testing)
• Can switch to Live trading after validation
• Requires Polymarket API key for live execution

**Trading Mode:**
• Default: Approval mode (review each trade)
• Can enable Autonomous mode for auto-execution`,
      strategy_type: 'SCREENING',
      is_predefined: true,
      node_graph: nodeGraph,
      execution_mode: 'SCHEDULED',
      schedule_cron: '0 */6 * * *', // Run every 6 hours
      is_active: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) {
    console.error('❌ Error creating strategy:', error)
    throw error
  }

  console.log('✅ Successfully created Smart Money Politics strategy!')
  console.log('═'.repeat(70))
  console.log('')
  console.log('📊 STRATEGY: SMART MONEY - POLITICS MARKETS')
  console.log('═'.repeat(70))
  console.log(`Strategy ID: ${strategyId}`)
  console.log(`Approach: Market-focused (scan markets for consensus)`)
  console.log(`Nodes: ${nodeGraph.nodes.length} (DATA_SOURCE → MARKET_FILTER → SMART_MONEY_SIGNAL → ORCHESTRATOR → ACTION)`)
  console.log(`Edges: ${nodeGraph.edges.length}`)
  console.log('')
  console.log('🎯 MARKET FILTERING')
  console.log('─'.repeat(70))
  console.log('• Category: Politics only')
  console.log('• Liquidity: $50k+ minimum')
  console.log('• Time horizon: 1-14 days to close')
  console.log('• Exclude: Parlay markets')
  console.log('')
  console.log('🧠 SMART MONEY ANALYSIS (OWRR)')
  console.log('─'.repeat(70))
  console.log('• Signal: OWRR ≥ 65 (YES) or ≤ 35 (NO)')
  console.log('• Confidence: Medium+ (12+ qualified wallets)')
  console.log('• Edge: Minimum 5% advantage')
  console.log('• Analysis: Top 20 holders per side')
  console.log('')
  console.log('💰 POSITION SIZING')
  console.log('─'.repeat(70))
  console.log('• Kelly Fraction: 0.25 (conservative)')
  console.log('• Max Per Position: 5%')
  console.log('• Portfolio Heat: Max 50%')
  console.log('• Bet Range: $10 - $500')
  console.log('• Drawdown Protection: Enabled')
  console.log('')
  console.log('🚀 NEXT STEPS')
  console.log('═'.repeat(70))
  console.log('1. Open Strategy Builder')
  console.log('2. Load "Smart Money - Politics Markets" from Library')
  console.log('3. Review the node configuration:')
  console.log('   • DATA_SOURCE: Fetch markets')
  console.log('   • MARKET_FILTER: Filter politics markets')
  console.log('   • SMART_MONEY_SIGNAL: Analyze OWRR')
  console.log('   • ORCHESTRATOR: Position sizing')
  console.log('   • ACTION: Execute trades')
  console.log('4. Click "Deploy" and choose:')
  console.log('   • Paper Trading (recommended first)')
  console.log('   • Live Trading (requires Polymarket key)')
  console.log('5. Set schedule: Every 6 hours (or customize)')
  console.log('')
  console.log('✨ Strategy is ready to deploy!')
  console.log('')

  return strategyId
}

createSmartMoneyPoliticsStrategy()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Failed:', error)
    process.exit(1)
  })
