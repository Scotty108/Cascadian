# WalletMonitor System - Complete Implementation Plan

**Version:** 1.0  
**Created:** 2025-10-29  
**Status:** Planning Phase  
**Target:** Production-Ready Copy Trading System

---

## Executive Summary

The WalletMonitor system will enable automated copy trading by:
1. Polling ClickHouse every 30 seconds for new trades from tracked wallets
2. Computing OWRR (smart money consensus) for affected markets
3. Making intelligent copy/skip decisions based on signal strength
4. Executing trades via Polymarket API with proper position sizing
5. Tracking performance and managing positions

**Key Design Principles:**
- Event-driven architecture using Vercel Cron (30s intervals)
- Stateless execution (all state in database)
- Graceful degradation (failures don't break the system)
- Observable (comprehensive logging and metrics)
- Testable (unit tests for all components)

---

## 1. Architecture Overview

### 1.1 System Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                         VERCEL CRON                              │
│                    (Every 30 seconds)                            │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│              /api/cron/wallet-monitor [NEW]                      │
│  - Verify auth                                                   │
│  - Call WalletMonitor.poll()                                     │
│  - Return execution summary                                      │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│              lib/wallet-monitor/index.ts [NEW]                   │
│                    WalletMonitor Class                           │
│                                                                  │
│  poll() {                                                        │
│    1. getActiveStrategies()     ─────► Supabase                │
│    2. detectNewTrades()          ─────► ClickHouse              │
│    3. FOR EACH new trade:                                       │
│       - computeOWRR()            ─────► ClickHouse              │
│       - makeDecision()                                          │
│       - IF copy: executePosition() ──► Polymarket API           │
│       - saveSignal()             ─────► Supabase                │
│    4. updatePositions()          ─────► ClickHouse + Supabase   │
│  }                                                               │
└──────────────────────────────────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
    ┌─────────┐      ┌─────────────┐     ┌──────────────┐
    │ OWRR    │      │  Decision   │     │  Polymarket  │
    │ Calc    │      │  Engine     │     │  Executor    │
    └─────────┘      └─────────────┘     └──────────────┘

```

### 1.2 Data Flow

**Input Sources:**
- ClickHouse `trades_raw` table (new trades)
- ClickHouse `wallet_metrics_by_category` table (Omega ratios)
- Supabase `strategy_settings` table (strategy config)
- Supabase `strategy_positions` table (open positions)

**Output Destinations:**
- Supabase `wallet_monitor_signals` table (all detected signals)
- Supabase `strategy_positions` table (new positions)
- Supabase `strategy_trades` table (executed trades)
- Polymarket API (order placement)

### 1.3 Execution Model

**Trigger:** Vercel Cron every 30 seconds
**Timeout:** 25 seconds max (5s buffer for Vercel)
**Concurrency:** Single instance (no parallel executions)
**Failure Mode:** Log error, continue next cycle

---

## 2. Component Specifications

### 2.1 WalletMonitor Class

**File:** `lib/wallet-monitor/index.ts`

```typescript
/**
 * WalletMonitor - Core polling and decision engine
 * 
 * Responsibilities:
 * - Poll ClickHouse for new trades
 * - Compute OWRR for affected markets
 * - Decide whether to copy trades
 * - Execute positions via Polymarket
 * - Track signals and performance
 */
export class WalletMonitor {
  private clickhouse: ClickHouseClient
  private supabase: SupabaseClient
  private owrrCalculator: OWRRCalculator
  private decisionEngine: DecisionEngine
  private polymarketExecutor: PolymarketExecutor
  private lastPollTimestamp: Date | null = null

  /**
   * Main polling method - called every 30 seconds by cron
   */
  async poll(): Promise<PollResult> {
    const startTime = Date.now()
    
    try {
      // 1. Get active strategies with auto_execute_enabled = true
      const activeStrategies = await this.getActiveStrategies()
      
      if (activeStrategies.length === 0) {
        return { strategiesChecked: 0, newTrades: 0, signalsGenerated: 0 }
      }

      // 2. Get tracked wallet addresses from all active strategies
      const trackedWallets = await this.getTrackedWallets(activeStrategies)
      
      // 3. Poll ClickHouse for new trades since last poll
      const newTrades = await this.detectNewTrades(
        trackedWallets,
        this.lastPollTimestamp
      )
      
      // 4. Update last poll timestamp
      this.lastPollTimestamp = new Date()
      
      if (newTrades.length === 0) {
        return { 
          strategiesChecked: activeStrategies.length,
          newTrades: 0,
          signalsGenerated: 0 
        }
      }

      // 5. Process each new trade
      const signals: Signal[] = []
      
      for (const trade of newTrades) {
        // Compute OWRR for this market
        const owrr = await this.owrrCalculator.calculate(
          trade.market_id,
          trade.category
        )
        
        // Make copy/skip decision for each relevant strategy
        for (const strategy of this.getRelevantStrategies(
          activeStrategies,
          trade.wallet_address
        )) {
          const decision = await this.decisionEngine.decide(
            strategy,
            trade,
            owrr
          )
          
          // Save signal regardless of decision
          await this.saveSignal(strategy, trade, owrr, decision)
          signals.push({ strategy, trade, decision, owrr })
          
          // Execute if decision is to copy
          if (decision.action === 'COPY') {
            await this.executePosition(strategy, trade, decision)
          }
        }
      }
      
      // 6. Update all open positions (mark-to-market)
      await this.updateOpenPositions()
      
      return {
        strategiesChecked: activeStrategies.length,
        newTrades: newTrades.length,
        signalsGenerated: signals.length,
        executionTimeMs: Date.now() - startTime
      }
      
    } catch (error) {
      console.error('[WalletMonitor] Poll failed:', error)
      throw error
    }
  }

  /**
   * Get strategies with auto-execution enabled
   */
  private async getActiveStrategies(): Promise<Strategy[]> {
    // Query strategy_settings WHERE auto_execute_enabled = true
    // JOIN with strategy_definitions to get strategy details
    // Filter to strategies with at least one tracked wallet
  }

  /**
   * Get all tracked wallets from strategy watchlists
   */
  private async getTrackedWallets(strategies: Strategy[]): Promise<string[]> {
    // Query strategy_watchlist_items WHERE item_type = 'WALLET'
    // AND strategy_id IN (strategies)
    // AND status = 'WATCHING'
    // Return unique wallet_addresses
  }

  /**
   * Detect new trades from tracked wallets
   */
  private async detectNewTrades(
    walletAddresses: string[],
    since: Date | null
  ): Promise<Trade[]> {
    // Query ClickHouse trades_raw
    // WHERE wallet_address IN (walletAddresses)
    // AND timestamp > since (or last 60 seconds if null)
    // ORDER BY timestamp ASC
    // 
    // Note: Only return OPENING trades (not closes)
    // Filter: is_closed = 0 AND shares > 0
  }

  /**
   * Find strategies that track this wallet
   */
  private getRelevantStrategies(
    strategies: Strategy[],
    walletAddress: string
  ): Strategy[] {
    // Filter strategies that have this wallet in their watchlist
  }

  /**
   * Save signal to database for analysis
   */
  private async saveSignal(
    strategy: Strategy,
    trade: Trade,
    owrr: OWRRResult,
    decision: Decision
  ): Promise<void> {
    // INSERT INTO wallet_monitor_signals
    // Captures: trade details, OWRR, decision, reasoning
  }

  /**
   * Execute a copy trade position
   */
  private async executePosition(
    strategy: Strategy,
    trade: Trade,
    decision: Decision
  ): Promise<void> {
    // 1. Calculate position size
    // 2. Place order via Polymarket API
    // 3. Record position in strategy_positions
    // 4. Record trade in strategy_trades
  }

  /**
   * Update current prices and P&L for open positions
   */
  private async updateOpenPositions(): Promise<void> {
    // Get all open positions
    // Fetch current market prices
    // Update current_price, current_value_usd, unrealized_pnl
  }
}
```

**Key Methods:**
- `poll()` - Main entry point, called by cron
- `getActiveStrategies()` - Find strategies with auto-execution enabled
- `detectNewTrades()` - Query ClickHouse for new trades
- `saveSignal()` - Log all detected signals
- `executePosition()` - Place order via Polymarket

---

### 2.2 OWRRCalculator

**File:** `lib/wallet-monitor/owrr-calculator.ts`

**Purpose:** Wrapper around existing OWRR calculation with caching

```typescript
/**
 * OWRRCalculator - Smart money consensus calculator
 * 
 * Wraps lib/metrics/owrr.ts with:
 * - In-memory caching (5 minute TTL)
 * - Retry logic for ClickHouse failures
 * - Fallback to last known OWRR if calculation fails
 */
export class OWRRCalculator {
  private cache: Map<string, CachedOWRR> = new Map()
  private readonly CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

  async calculate(
    marketId: string,
    category: string
  ): Promise<OWRRResult> {
    // Check cache first
    const cached = this.cache.get(marketId)
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.result
    }

    try {
      // Calculate fresh OWRR
      const result = await calculateOWRR(marketId, category)
      
      // Cache result
      this.cache.set(marketId, {
        result,
        timestamp: Date.now()
      })
      
      return result
      
    } catch (error) {
      console.error(`[OWRR] Calculation failed for ${marketId}:`, error)
      
      // Return cached result if available
      if (cached) {
        console.warn(`[OWRR] Using stale cache for ${marketId}`)
        return cached.result
      }
      
      // Return neutral OWRR if no cache
      return this.getNeutralOWRR(category)
    }
  }

  private getNeutralOWRR(category: string): OWRRResult {
    return {
      owrr: 0.5,
      slider: 50,
      yes_score: 0,
      no_score: 0,
      yes_qualified: 0,
      no_qualified: 0,
      yes_avg_omega: 0,
      no_avg_omega: 0,
      yes_avg_risk: 0,
      no_avg_risk: 0,
      category,
      confidence: 'insufficient_data',
      breakdown: { yes_votes: [], no_votes: [] }
    }
  }
}
```

**Reuses:** Existing `lib/metrics/owrr.ts` (no changes needed)

---

### 2.3 DecisionEngine

**File:** `lib/wallet-monitor/decision-engine.ts`

**Purpose:** Decide whether to copy a trade based on OWRR and strategy settings

```typescript
export interface Decision {
  action: 'COPY' | 'SKIP'
  reason: string
  positionSizeUsd: number
  confidence: number
}

/**
 * DecisionEngine - Copy/skip logic
 * 
 * Decision Algorithm:
 * 1. Check if market category matches strategy preferences
 * 2. Check OWRR threshold (e.g., only copy if OWRR > 0.6 for YES trades)
 * 3. Check OWRR confidence (require 'high' or 'medium')
 * 4. Check position limits (max open positions, max position size)
 * 5. Check capital availability
 * 6. Calculate position size based on signal strength
 */
export class DecisionEngine {
  
  async decide(
    strategy: Strategy,
    trade: Trade,
    owrr: OWRRResult
  ): Promise<Decision> {
    
    // Rule 1: Category filter
    if (!this.matchesCategory(strategy, trade.category)) {
      return {
        action: 'SKIP',
        reason: 'Category not tracked by strategy',
        positionSizeUsd: 0,
        confidence: 0
      }
    }
    
    // Rule 2: OWRR threshold
    const threshold = this.getOWRRThreshold(strategy, trade.side)
    if (!this.meetsOWRRThreshold(owrr, trade.side, threshold)) {
      return {
        action: 'SKIP',
        reason: `OWRR ${owrr.slider} does not meet threshold ${threshold}`,
        positionSizeUsd: 0,
        confidence: 0
      }
    }
    
    // Rule 3: OWRR confidence
    if (owrr.confidence === 'insufficient_data' || owrr.confidence === 'low') {
      return {
        action: 'SKIP',
        reason: `OWRR confidence too low: ${owrr.confidence}`,
        positionSizeUsd: 0,
        confidence: 0
      }
    }
    
    // Rule 4: Position limits
    const openPositions = await this.getOpenPositionsCount(strategy.id)
    if (openPositions >= strategy.settings.max_positions) {
      return {
        action: 'SKIP',
        reason: `Max positions reached (${openPositions}/${strategy.settings.max_positions})`,
        positionSizeUsd: 0,
        confidence: 0
      }
    }
    
    // Rule 5: Capital availability
    const availableCapital = strategy.settings.current_balance_usd
    if (availableCapital < strategy.settings.max_position_size_usd * 0.1) {
      return {
        action: 'SKIP',
        reason: `Insufficient capital ($${availableCapital} available)`,
        positionSizeUsd: 0,
        confidence: 0
      }
    }
    
    // Rule 6: Calculate position size
    const positionSize = this.calculatePositionSize(
      strategy,
      trade,
      owrr
    )
    
    // Rule 7: Validate position size
    if (positionSize < 10) { // Min $10 position
      return {
        action: 'SKIP',
        reason: `Position size too small ($${positionSize})`,
        positionSizeUsd: 0,
        confidence: 0
      }
    }
    
    // All checks passed - COPY the trade
    return {
      action: 'COPY',
      reason: `OWRR ${owrr.slider}, confidence ${owrr.confidence}`,
      positionSizeUsd: positionSize,
      confidence: this.calculateConfidence(owrr)
    }
  }
  
  /**
   * Get OWRR threshold for trade side
   * 
   * For YES trades: require OWRR > 60 (smart money favors YES)
   * For NO trades: require OWRR < 40 (smart money favors NO)
   */
  private getOWRRThreshold(strategy: Strategy, side: 'YES' | 'NO'): number {
    const config = strategy.settings.copy_trading_config
    
    if (side === 'YES') {
      return config?.owrr_threshold_yes || 60
    } else {
      return config?.owrr_threshold_no || 40
    }
  }
  
  /**
   * Check if OWRR meets threshold
   */
  private meetsOWRRThreshold(
    owrr: OWRRResult,
    side: 'YES' | 'NO',
    threshold: number
  ): boolean {
    if (side === 'YES') {
      return owrr.slider >= threshold
    } else {
      return owrr.slider <= threshold
    }
  }
  
  /**
   * Calculate position size based on:
   * - Strategy settings (max_position_size_usd, risk_per_trade_percent)
   * - OWRR strength (higher OWRR = larger position)
   * - Available capital
   */
  private calculatePositionSize(
    strategy: Strategy,
    trade: Trade,
    owrr: OWRRResult
  ): number {
    const settings = strategy.settings
    
    // Base position size from risk_per_trade_percent
    const baseSize = settings.current_balance_usd * 
                     (settings.risk_per_trade_percent / 100)
    
    // Scale by OWRR strength
    const owrrStrength = this.getOWRRStrength(owrr, trade.side)
    const scaledSize = baseSize * owrrStrength
    
    // Cap at max_position_size_usd
    const cappedSize = Math.min(
      scaledSize,
      settings.max_position_size_usd
    )
    
    // Cap at available capital
    const finalSize = Math.min(
      cappedSize,
      settings.current_balance_usd
    )
    
    return Math.round(finalSize)
  }
  
  /**
   * Calculate OWRR strength (0.5 - 1.0)
   * 
   * For YES trades: strength = (owrr - 0.5) / 0.5
   *   - OWRR 50 → strength 0.0
   *   - OWRR 75 → strength 0.5
   *   - OWRR 100 → strength 1.0
   * 
   * For NO trades: strength = (0.5 - owrr) / 0.5
   *   - OWRR 50 → strength 0.0
   *   - OWRR 25 → strength 0.5
   *   - OWRR 0 → strength 1.0
   */
  private getOWRRStrength(owrr: OWRRResult, side: 'YES' | 'NO'): number {
    const owrrNormalized = owrr.owrr // 0-1 scale
    
    if (side === 'YES') {
      // Strength increases as OWRR increases above 0.5
      return Math.max(0, (owrrNormalized - 0.5) / 0.5)
    } else {
      // Strength increases as OWRR decreases below 0.5
      return Math.max(0, (0.5 - owrrNormalized) / 0.5)
    }
  }
  
  /**
   * Calculate overall confidence (0-1)
   */
  private calculateConfidence(owrr: OWRRResult): number {
    const confidenceMap = {
      'high': 1.0,
      'medium': 0.7,
      'low': 0.4,
      'insufficient_data': 0.0
    }
    
    return confidenceMap[owrr.confidence]
  }
}
```

---

### 2.4 PolymarketExecutor

**File:** `lib/wallet-monitor/polymarket-executor.ts`

**Purpose:** Execute trades via Polymarket API

```typescript
/**
 * PolymarketExecutor - Trade execution via Polymarket
 * 
 * Responsibilities:
 * - Place market orders
 * - Handle API errors gracefully
 * - Record trade execution details
 * - Update position tracking
 * 
 * Note: Initially implements MOCK mode for safety
 * Real execution requires Polymarket SDK integration
 */
export class PolymarketExecutor {
  private readonly mockMode: boolean
  private readonly polymarketApi: PolymarketAPI | null
  
  constructor() {
    this.mockMode = process.env.POLYMARKET_MOCK_MODE !== 'false'
    this.polymarketApi = this.mockMode ? null : new PolymarketAPI()
  }
  
  /**
   * Execute a copy trade position
   */
  async execute(
    strategy: Strategy,
    trade: Trade,
    decision: Decision
  ): Promise<ExecutionResult> {
    
    if (this.mockMode) {
      return this.executeMock(strategy, trade, decision)
    }
    
    try {
      // 1. Calculate shares to buy
      const shares = this.calculateShares(
        decision.positionSizeUsd,
        trade.entry_price
      )
      
      // 2. Place market order
      const order = await this.polymarketApi!.placeOrder({
        marketId: trade.market_id,
        side: trade.side,
        shares: shares,
        price: trade.entry_price,
        orderType: 'MARKET'
      })
      
      // 3. Wait for order confirmation (with timeout)
      const execution = await this.waitForExecution(order.orderId, 30000)
      
      // 4. Record position
      await this.recordPosition(strategy, trade, decision, execution)
      
      // 5. Record trade
      await this.recordTrade(strategy, trade, execution)
      
      // 6. Update strategy balance
      await this.updateBalance(
        strategy.id,
        -execution.amountSpent
      )
      
      return {
        success: true,
        orderId: order.orderId,
        transactionHash: execution.transactionHash,
        shares: execution.shares,
        avgPrice: execution.avgPrice,
        totalCost: execution.amountSpent,
        fees: execution.fees
      }
      
    } catch (error) {
      console.error('[PolymarketExecutor] Execution failed:', error)
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
  
  /**
   * Mock execution for testing (no real trades)
   */
  private async executeMock(
    strategy: Strategy,
    trade: Trade,
    decision: Decision
  ): Promise<ExecutionResult> {
    console.log('[PolymarketExecutor] MOCK EXECUTION:', {
      strategy: strategy.name,
      market: trade.market_id,
      side: trade.side,
      size: decision.positionSizeUsd,
      price: trade.entry_price
    })
    
    const shares = this.calculateShares(
      decision.positionSizeUsd,
      trade.entry_price
    )
    
    // Record position (with MOCK flag)
    await this.recordPosition(strategy, trade, decision, {
      shares,
      avgPrice: trade.entry_price,
      amountSpent: decision.positionSizeUsd,
      fees: decision.positionSizeUsd * 0.02, // 2% fee estimate
      transactionHash: 'MOCK_TX_' + Date.now()
    })
    
    return {
      success: true,
      orderId: 'MOCK_ORDER_' + Date.now(),
      transactionHash: 'MOCK_TX_' + Date.now(),
      shares,
      avgPrice: trade.entry_price,
      totalCost: decision.positionSizeUsd,
      fees: decision.positionSizeUsd * 0.02
    }
  }
  
  /**
   * Calculate shares from USD amount and price
   */
  private calculateShares(amountUsd: number, price: number): number {
    // For YES: shares = amount / price
    // For NO: shares = amount / (1 - price)
    return amountUsd / price
  }
  
  /**
   * Record position in database
   */
  private async recordPosition(
    strategy: Strategy,
    trade: Trade,
    decision: Decision,
    execution: any
  ): Promise<void> {
    // INSERT INTO strategy_positions
    const supabase = getSupabaseClient()
    
    await supabase.from('strategy_positions').insert({
      strategy_id: strategy.id,
      watchlist_item_id: null, // Could link to tracked wallet
      market_id: trade.market_id,
      market_slug: trade.market_slug,
      market_title: trade.market_title,
      outcome: trade.side,
      category: trade.category,
      entry_signal_type: 'WALLET_COPY_TRADE',
      entry_price: execution.avgPrice,
      entry_shares: execution.shares,
      entry_amount_usd: execution.amountSpent,
      current_price: execution.avgPrice,
      current_value_usd: execution.amountSpent,
      unrealized_pnl: 0,
      unrealized_pnl_percent: 0,
      fees_paid: execution.fees,
      status: 'OPEN',
      auto_entered: true,
      metadata: {
        source_wallet: trade.wallet_address,
        source_trade_id: trade.trade_id,
        owrr_at_entry: decision.owrr,
        decision_reason: decision.reason,
        mock_mode: this.mockMode
      }
    })
  }
  
  /**
   * Record trade execution
   */
  private async recordTrade(
    strategy: Strategy,
    trade: Trade,
    execution: any
  ): Promise<void> {
    // INSERT INTO strategy_trades
    const supabase = getSupabaseClient()
    
    await supabase.from('strategy_trades').insert({
      strategy_id: strategy.id,
      position_id: null, // Update later with position ID
      trade_type: 'BUY',
      market_id: trade.market_id,
      market_title: trade.market_title,
      outcome: trade.side,
      shares: execution.shares,
      price: execution.avgPrice,
      amount_usd: execution.amountSpent,
      fees: execution.fees,
      execution_status: 'COMPLETED',
      executed_at: new Date(),
      order_id: execution.orderId,
      transaction_hash: execution.transactionHash,
      metadata: {
        source_wallet: trade.wallet_address,
        mock_mode: this.mockMode
      }
    })
  }
  
  /**
   * Update strategy balance
   */
  private async updateBalance(
    strategyId: string,
    deltaUsd: number
  ): Promise<void> {
    const supabase = getSupabaseClient()
    
    await supabase.rpc('update_strategy_balance', {
      strategy_id: strategyId,
      delta: deltaUsd
    })
  }
}
```

---

### 2.5 Database Additions

**File:** `supabase/migrations/20251029_wallet_monitor_signals.sql`

```sql
-- New table to log all wallet trade signals
CREATE TABLE wallet_monitor_signals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Strategy context
  strategy_id UUID NOT NULL REFERENCES strategy_definitions(strategy_id) ON DELETE CASCADE,
  
  -- Source trade details
  source_wallet TEXT NOT NULL,
  source_trade_id TEXT NOT NULL,
  market_id TEXT NOT NULL,
  market_title TEXT,
  category TEXT,
  side trade_outcome NOT NULL,
  entry_price NUMERIC(10,4) NOT NULL,
  shares NUMERIC(20,8) NOT NULL,
  usd_value NUMERIC(20,2) NOT NULL,
  trade_timestamp TIMESTAMPTZ NOT NULL,
  
  -- OWRR at time of signal
  owrr NUMERIC(5,4),
  owrr_slider INTEGER,
  owrr_confidence TEXT,
  yes_score NUMERIC(20,2),
  no_score NUMERIC(20,2),
  yes_qualified INTEGER,
  no_qualified INTEGER,
  
  -- Decision
  decision TEXT NOT NULL CHECK (decision IN ('COPY', 'SKIP')),
  decision_reason TEXT NOT NULL,
  position_size_usd NUMERIC(20,2),
  confidence NUMERIC(5,4),
  
  -- Execution result (if copied)
  execution_status TEXT CHECK (execution_status IN ('PENDING', 'COMPLETED', 'FAILED')),
  execution_error TEXT,
  position_id UUID REFERENCES strategy_positions(id) ON DELETE SET NULL,
  
  -- Timestamps
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_signals_strategy_time 
  ON wallet_monitor_signals(strategy_id, detected_at DESC);

CREATE INDEX idx_signals_wallet 
  ON wallet_monitor_signals(source_wallet, detected_at DESC);

CREATE INDEX idx_signals_market 
  ON wallet_monitor_signals(market_id, detected_at DESC);

CREATE INDEX idx_signals_decision 
  ON wallet_monitor_signals(decision, detected_at DESC);

-- Comments
COMMENT ON TABLE wallet_monitor_signals IS 
  'Log of all wallet copy trade signals detected by WalletMonitor';
COMMENT ON COLUMN wallet_monitor_signals.decision IS 
  'Whether signal resulted in COPY or SKIP decision';
COMMENT ON COLUMN wallet_monitor_signals.decision_reason IS 
  'Human-readable explanation of why this decision was made';
```

**Additional Schema Changes:**

Add `copy_trading_config` to `strategy_settings`:

```sql
ALTER TABLE strategy_settings 
ADD COLUMN copy_trading_config JSONB DEFAULT '{
  "enabled": true,
  "owrr_threshold_yes": 60,
  "owrr_threshold_no": 40,
  "min_owrr_confidence": "medium",
  "tracked_categories": ["Politics", "Crypto", "AI"]
}'::jsonb;

COMMENT ON COLUMN strategy_settings.copy_trading_config IS
  'Configuration for automated copy trading based on wallet signals';
```

---

## 3. Implementation Tasks

### Phase 1: Core Infrastructure (8-10 hours)

#### Task 1.1: Database Schema (1 hour)
- [ ] Create `wallet_monitor_signals` table migration
- [ ] Add `copy_trading_config` to `strategy_settings`
- [ ] Test migrations locally
- [ ] Deploy to staging

**Files:**
- `supabase/migrations/20251029_wallet_monitor_signals.sql`

#### Task 1.2: WalletMonitor Class (2 hours)
- [ ] Create `lib/wallet-monitor/index.ts`
- [ ] Implement `poll()` method
- [ ] Implement `getActiveStrategies()`
- [ ] Implement `detectNewTrades()`
- [ ] Implement `getTrackedWallets()`
- [ ] Add error handling and logging

**Files:**
- `lib/wallet-monitor/index.ts`
- `lib/wallet-monitor/types.ts`

#### Task 1.3: OWRRCalculator (1 hour)
- [ ] Create `lib/wallet-monitor/owrr-calculator.ts`
- [ ] Implement caching logic
- [ ] Implement retry logic
- [ ] Add fallback for failures

**Files:**
- `lib/wallet-monitor/owrr-calculator.ts`

#### Task 1.4: DecisionEngine (2 hours)
- [ ] Create `lib/wallet-monitor/decision-engine.ts`
- [ ] Implement `decide()` method
- [ ] Implement all decision rules
- [ ] Implement position sizing logic
- [ ] Add comprehensive logging

**Files:**
- `lib/wallet-monitor/decision-engine.ts`

#### Task 1.5: PolymarketExecutor (Mock Mode) (2 hours)
- [ ] Create `lib/wallet-monitor/polymarket-executor.ts`
- [ ] Implement mock execution mode
- [ ] Implement `recordPosition()`
- [ ] Implement `recordTrade()`
- [ ] Add error handling

**Files:**
- `lib/wallet-monitor/polymarket-executor.ts`

#### Task 1.6: Cron Endpoint (2 hours)
- [ ] Create `app/api/cron/wallet-monitor/route.ts`
- [ ] Implement auth verification
- [ ] Wire up WalletMonitor.poll()
- [ ] Add response formatting
- [ ] Test locally with curl

**Files:**
- `app/api/cron/wallet-monitor/route.ts`
- Update `vercel.json` with new cron job

---

### Phase 2: Testing & Validation (4-6 hours)

#### Task 2.1: Unit Tests (2 hours)
- [ ] Test DecisionEngine rules
- [ ] Test position sizing calculations
- [ ] Test OWRR threshold logic
- [ ] Test capital limit checks

**Files:**
- `__tests__/wallet-monitor/decision-engine.test.ts`

#### Task 2.2: Integration Tests (2 hours)
- [ ] Test end-to-end flow with mock data
- [ ] Test ClickHouse query performance
- [ ] Test signal logging
- [ ] Test position creation

**Files:**
- `__tests__/wallet-monitor/integration.test.ts`

#### Task 2.3: Load Testing (2 hours)
- [ ] Test with 100+ tracked wallets
- [ ] Test with 50+ new trades per cycle
- [ ] Measure execution time
- [ ] Optimize slow queries

---

### Phase 3: Real Execution Mode (4-6 hours)

#### Task 3.1: Polymarket SDK Integration (3 hours)
- [ ] Research Polymarket order placement API
- [ ] Implement `PolymarketAPI` class
- [ ] Implement `placeOrder()` method
- [ ] Implement `waitForExecution()` method
- [ ] Add wallet integration (if needed)

**Files:**
- `lib/polymarket/trading-client.ts`
- Update `lib/wallet-monitor/polymarket-executor.ts`

#### Task 3.2: Position Management (2 hours)
- [ ] Implement `updateOpenPositions()`
- [ ] Fetch current market prices
- [ ] Update unrealized P&L
- [ ] Handle resolved markets

**Files:**
- `lib/wallet-monitor/position-updater.ts`

#### Task 3.3: Safety Checks (1 hour)
- [ ] Add kill switch (emergency disable)
- [ ] Add daily loss limits
- [ ] Add max drawdown checks
- [ ] Add balance reconciliation

---

### Phase 4: Monitoring & Observability (3-4 hours)

#### Task 4.1: Logging & Metrics (2 hours)
- [ ] Add structured logging
- [ ] Log execution metrics
- [ ] Log decision statistics
- [ ] Add performance counters

**Files:**
- `lib/wallet-monitor/logger.ts`
- `lib/wallet-monitor/metrics.ts`

#### Task 4.2: Alerts & Notifications (2 hours)
- [ ] Alert on execution failures
- [ ] Alert on ClickHouse errors
- [ ] Alert on position limit breaches
- [ ] Daily summary report

**Files:**
- `lib/wallet-monitor/alerts.ts`

---

### Phase 5: UI & Management (4-6 hours)

#### Task 5.1: Signal Dashboard (3 hours)
- [ ] Create signals table view
- [ ] Show COPY vs SKIP decisions
- [ ] Show OWRR at time of signal
- [ ] Filter by strategy/wallet

**Files:**
- `components/wallet-monitor-signals/index.tsx`
- `app/(dashboard)/wallet-monitor/signals/page.tsx`

#### Task 5.2: Configuration UI (2 hours)
- [ ] Add copy trading settings to strategy editor
- [ ] Configure OWRR thresholds
- [ ] Configure position sizing
- [ ] Enable/disable auto-execution

**Files:**
- `components/strategy-settings-interface/copy-trading-config.tsx`

#### Task 5.3: Performance Dashboard (1 hour)
- [ ] Show copy trade performance
- [ ] Compare to source wallet performance
- [ ] Show signal statistics

---

## 4. Deployment Strategy

### 4.1 Staging Rollout

**Week 1: Mock Mode Only**
- Deploy to staging with `POLYMARKET_MOCK_MODE=true`
- Monitor for 7 days
- Validate signal detection
- Validate decision logic
- No real money at risk

**Week 2: Single Strategy Test**
- Enable one test strategy with $100 budget
- Monitor all executions manually
- Validate order placement
- Validate position tracking

**Week 3: Multiple Strategies**
- Enable 3-5 strategies with limited budgets
- Monitor performance daily
- Tune OWRR thresholds
- Optimize position sizing

### 4.2 Production Rollout

**Week 4: Soft Launch**
- Deploy to production
- Enable for beta users only
- Start with small position sizes
- Daily manual review of all trades

**Week 5+: Full Production**
- Open to all users
- Increase position size limits
- Add advanced features (exit signals, stop losses)

---

## 5. Edge Cases & Error Handling

### 5.1 ClickHouse Failures

**Problem:** ClickHouse is down or slow

**Solution:**
- Retry queries with exponential backoff (3 attempts)
- If all retries fail, log error and skip this cycle
- Alert team after 3 consecutive failures
- Continue next cycle (don't crash)

### 5.2 OWRR Calculation Failures

**Problem:** Not enough data to calculate OWRR

**Solution:**
- Use cached OWRR if available (stale data better than nothing)
- If no cache, return neutral OWRR (slider=50)
- DecisionEngine will SKIP due to insufficient confidence
- Log event for analysis

### 5.3 Polymarket API Failures

**Problem:** Order placement fails or times out

**Solution:**
- Retry order placement (1 retry only)
- If retry fails, mark signal as FAILED
- Don't crash - continue processing other signals
- Alert user via webhook/email
- Manual review of failed orders

### 5.4 Concurrent Strategy Tracking Same Wallet

**Problem:** Two strategies both track wallet X, both want to copy same trade

**Solution:**
- Each strategy executes independently
- Both create separate positions
- Position sizing ensures neither over-leverages
- This is intended behavior (strategies are independent)

### 5.5 Position Sizing Exceeds Limits

**Problem:** Calculated position size > available capital

**Solution:**
- Cap position size at available capital
- If capped size < $10 minimum, SKIP
- Log reason as "Insufficient capital"
- Don't place partial orders

### 5.6 Trade Already Closed

**Problem:** By the time we copy, trade already closed

**Solution:**
- Check if market still open before placing order
- If closed, mark signal as SKIP with reason "Market closed"
- Don't place order
- Learn from timing delay (track latency)

### 5.7 Duplicate Signal Detection

**Problem:** Same trade detected twice in consecutive polls

**Solution:**
- Track processed trade IDs in memory (LRU cache, 1000 items)
- Skip signals for trade IDs we've already processed
- Clear cache every hour to prevent memory leak
- Database unique constraint on (strategy_id, source_trade_id)

---

## 6. Performance Targets

### 6.1 Latency Requirements

**Critical Path:** New trade → Decision → Execution
- Trade detection latency: < 30 seconds (polling interval)
- OWRR calculation: < 500ms (with caching)
- Decision logic: < 100ms
- Order placement: < 5 seconds
- **Total latency: < 40 seconds** from trade to execution

### 6.2 Throughput Requirements

**Per Polling Cycle (30 seconds):**
- Check up to 50 active strategies
- Track up to 500 unique wallets
- Process up to 100 new trades
- Execute up to 25 copy positions
- Complete entire cycle in < 25 seconds (5s buffer)

### 6.3 Database Query Performance

**ClickHouse Queries:**
- `detectNewTrades()`: < 200ms for 500 wallets
- `getTopPositions()`: < 100ms per market
- `getWalletCategoryMetrics()`: < 100ms for 40 wallets

**Optimization Strategies:**
- Use PREWHERE for wallet_address filters
- Partition trades_raw by timestamp
- Index wallet_address and timestamp
- Limit query results (LIMIT 100)

---

## 7. Testing Strategy

### 7.1 Unit Tests

**Coverage Target:** 80%+

**Test Files:**
- `decision-engine.test.ts` - All decision rules
- `owrr-calculator.test.ts` - Caching and fallback logic
- `polymarket-executor.test.ts` - Mock execution
- `position-sizing.test.ts` - Position size calculations

**Test Cases:**
- OWRR threshold checks (YES/NO sides)
- Capital limit checks
- Position count limits
- Position sizing scaling
- Edge cases (null values, zero balances)

### 7.2 Integration Tests

**Test Scenarios:**
1. End-to-end flow with mock ClickHouse data
2. Multiple strategies tracking same wallet
3. Rapid succession of trades
4. ClickHouse failure recovery
5. OWRR cache hits/misses

### 7.3 Manual Testing

**Test Checklist:**
- [ ] Deploy to staging with POLYMARKET_MOCK_MODE=true
- [ ] Create test strategy tracking 5 known wallets
- [ ] Verify signals appear in database
- [ ] Verify COPY decisions create positions
- [ ] Verify SKIP decisions logged with reasons
- [ ] Verify cron runs every 30 seconds
- [ ] Verify no crashes after 24 hours
- [ ] Review all logged signals for accuracy

---

## 8. Monitoring & Alerts

### 8.1 Key Metrics to Track

**Operational Metrics:**
- Polling cycle completion time
- Strategies checked per cycle
- New trades detected per cycle
- Signals generated per cycle
- Copy decisions vs Skip decisions
- Execution success rate
- Average position size

**Performance Metrics:**
- ClickHouse query latency
- OWRR calculation latency
- Decision logic latency
- Order placement latency
- Cache hit rate

**Financial Metrics:**
- Total capital deployed
- Unrealized P&L
- Realized P&L
- Win rate
- Average hold time

### 8.2 Alert Conditions

**Critical Alerts (Page immediately):**
- 3 consecutive cron failures
- ClickHouse down for 5+ minutes
- Polymarket API down for 5+ minutes
- Strategy lost > 50% of capital
- Execution failure rate > 25%

**Warning Alerts (Email/Slack):**
- Polling cycle took > 20 seconds
- OWRR cache miss rate > 50%
- Daily loss > 10%
- Single position loss > 30%

**Info Alerts (Daily summary):**
- Total signals detected
- Copy vs Skip breakdown
- Performance summary
- Top performing strategies

### 8.3 Dashboards

**Operations Dashboard:**
- Real-time cron health
- Current cycle metrics
- Last 100 signals
- Error log

**Performance Dashboard:**
- P&L chart (last 7 days)
- Win rate by strategy
- OWRR distribution of signals
- Latency histograms

---

## 9. Security Considerations

### 9.1 API Security

**Cron Endpoint:**
- Require `Authorization: Bearer <CRON_SECRET>` header
- Reject requests without valid secret
- Rate limit to 1 request per 25 seconds max

**Polymarket API Keys:**
- Store in environment variables (never in code)
- Use separate keys for staging and production
- Rotate keys monthly
- Never log API keys

### 9.2 Capital Protection

**Kill Switch:**
- Environment variable `COPY_TRADING_ENABLED=false` disables all execution
- Can be toggled without deployment
- Takes effect on next polling cycle

**Position Limits:**
- Hard cap: Max 20 open positions per strategy
- Hard cap: Max $10,000 per position
- Hard cap: Max $100,000 total exposure per strategy

**Loss Limits:**
- Daily loss limit: 15% of starting balance
- Drawdown limit: 30% from peak
- Auto-pause strategy if limits breached

### 9.3 Data Privacy

**Sensitive Data:**
- Wallet addresses (public blockchain data - OK)
- Trade amounts (public blockchain data - OK)
- User API keys (encrypted, never logged)
- Strategy settings (RLS enforced)

---

## 10. Future Enhancements (Post-MVP)

### Phase 6: Advanced Features

**Smart Exit Signals:**
- Close positions when OWRR flips
- Trailing stop losses
- Take profit at target OWRR levels

**Portfolio Optimization:**
- Diversify across categories
- Rebalance based on performance
- Dynamic position sizing

**Advanced Analytics:**
- Compare copy performance to source wallet
- Identify best wallets to track
- Optimize OWRR thresholds per category

**Social Features:**
- Share successful copy strategies
- Leaderboard of copy traders
- Follow other users' strategies

---

## 11. Success Metrics

### 11.1 Technical Success

**Must Have:**
- ✅ 99% uptime (< 7 hours downtime per month)
- ✅ < 40 second average latency (trade detection to execution)
- ✅ < 5% execution failure rate
- ✅ Zero data loss (all signals logged)

**Nice to Have:**
- ✅ < 25 second average latency
- ✅ < 2% execution failure rate
- ✅ 95%+ cache hit rate on OWRR

### 11.2 Business Success

**Month 1:**
- 10+ active copy trading strategies
- $10,000+ total capital deployed
- 500+ signals detected
- 100+ positions executed

**Month 3:**
- 50+ active strategies
- $100,000+ total capital deployed
- 5,000+ signals detected
- Positive average ROI (> 0%)

**Month 6:**
- 200+ active strategies
- $500,000+ total capital deployed
- 20,000+ signals detected
- Average ROI > 10%

---

## 12. Documentation Deliverables

1. **README.md** - Overview and quick start
2. **ARCHITECTURE.md** - Detailed system design
3. **API.md** - API endpoint documentation
4. **CONFIGURATION.md** - Environment variables and settings
5. **MONITORING.md** - Metrics and alert setup
6. **RUNBOOK.md** - Operational procedures
7. **FAQ.md** - Common questions and issues

---

## 13. Team & Timeline

### 13.1 Required Skills

- Backend: Node.js, TypeScript, Next.js
- Database: ClickHouse, PostgreSQL, Supabase
- Testing: Jest, integration testing
- DevOps: Vercel, cron jobs, monitoring

### 13.2 Estimated Timeline

**Phase 1 (Core):** 8-10 hours
**Phase 2 (Testing):** 4-6 hours
**Phase 3 (Real Execution):** 4-6 hours
**Phase 4 (Monitoring):** 3-4 hours
**Phase 5 (UI):** 4-6 hours

**Total Development Time:** 23-32 hours (3-4 working days)

**Additional Time:**
- Testing & QA: 1-2 days
- Staging validation: 1 week
- Production rollout: 2-3 weeks

**Total Calendar Time:** 4-5 weeks from start to production

---

## 14. Risk Assessment

### High Risk

**Risk:** Polymarket API changes/breaks
**Mitigation:** Monitor API status, have fallback to mock mode, alert on failures

**Risk:** ClickHouse performance degrades
**Mitigation:** Query optimization, caching, fallback to Supabase, scale ClickHouse

**Risk:** Positions lose money rapidly
**Mitigation:** Loss limits, kill switch, position size caps, careful OWRR threshold tuning

### Medium Risk

**Risk:** Cron job misses cycles due to Vercel timeouts
**Mitigation:** Optimize query performance, batch processing, increase timeout if needed

**Risk:** Strategy tracking wrong wallets (user error)
**Mitigation:** UI validation, preview mode, clear documentation

**Risk:** OWRR becomes stale during high volatility
**Mitigation:** Reduce cache TTL to 2 minutes, force refresh on market updates

### Low Risk

**Risk:** Database migrations fail
**Mitigation:** Test thoroughly in staging, use Supabase migration rollback

**Risk:** Memory leaks from caching
**Mitigation:** LRU cache with size limits, monitor memory usage

---

## 15. Appendix: Example Flow

### Example: User Sets Up Copy Trading

**Step 1:** User creates strategy "Copy Smart Whales"

**Step 2:** User adds high-Omega wallets to watchlist
- Wallet A (Omega 3.2 in Crypto)
- Wallet B (Omega 2.8 in Politics)
- Wallet C (Omega 2.5 in AI)

**Step 3:** User configures copy trading settings
```json
{
  "copy_trading_config": {
    "enabled": true,
    "owrr_threshold_yes": 65,
    "owrr_threshold_no": 35,
    "min_owrr_confidence": "medium",
    "tracked_categories": ["Crypto", "Politics", "AI"]
  },
  "auto_execute_enabled": true,
  "max_position_size_usd": 500,
  "max_positions": 10,
  "risk_per_trade_percent": 5,
  "initial_balance_usd": 10000,
  "current_balance_usd": 10000
}
```

**Step 4:** User enables auto-execution

**Step 5:** WalletMonitor polls every 30 seconds

**Cycle 1 (T=0s):** No new trades detected

**Cycle 2 (T=30s):** New trade detected!
```
Wallet A buys 1000 shares YES @ $0.55
Market: "Will Bitcoin hit $100K by Dec 31?"
Category: Crypto
```

**Step 6:** System calculates OWRR
```
OWRR: 0.72 (slider 72)
Confidence: high
YES qualified: 18 wallets
NO qualified: 15 wallets
```

**Step 7:** DecisionEngine evaluates
```
✅ Category matches (Crypto)
✅ OWRR 72 > threshold 65 (YES trade)
✅ OWRR confidence is high
✅ Open positions: 3 < max 10
✅ Available capital: $9,500 > $500
✅ Position size: $500 (5% of $10,000)
```

**Decision:** COPY

**Step 8:** PolymarketExecutor executes
```
Market order: 909 shares YES @ $0.55
Total cost: $500.00
Fees: $10.00
Transaction: 0x7b2f3a...
```

**Step 9:** System records position
```sql
INSERT INTO strategy_positions (
  strategy_id, market_id, outcome, entry_price,
  entry_shares, entry_amount_usd, fees_paid,
  status, auto_entered, metadata
) VALUES (
  'strategy-uuid', '0xmarket123', 'YES', 0.55,
  909, 500.00, 10.00,
  'OPEN', true, '{"source_wallet": "0xWalletA", "owrr_at_entry": 0.72}'
)
```

**Step 10:** System logs signal
```sql
INSERT INTO wallet_monitor_signals (
  strategy_id, source_wallet, market_id, side,
  owrr, owrr_slider, decision, decision_reason,
  position_size_usd
) VALUES (
  'strategy-uuid', '0xWalletA', '0xmarket123', 'YES',
  0.72, 72, 'COPY', 'OWRR 72, confidence high',
  500.00
)
```

**Step 11:** User sees position in dashboard
- Entry: $0.55
- Current: $0.57
- Unrealized P&L: +$18.18 (+3.6%)

**Success! 🎉**

---

## End of Implementation Plan

This plan provides a complete roadmap for building a production-ready WalletMonitor system. The design is:

- **Modular:** Each component has clear responsibilities
- **Testable:** Unit and integration tests for all logic
- **Observable:** Comprehensive logging and metrics
- **Safe:** Mock mode, kill switches, position limits
- **Scalable:** Handles 500+ wallets, 100+ trades per cycle
- **Maintainable:** Clean code, good documentation

**Next Steps:**
1. Review this plan with team
2. Prioritize Phase 1 tasks
3. Set up development environment
4. Begin implementation
5. Test thoroughly in staging
6. Roll out carefully to production

Good luck! 🚀
