/**
 * PolymarketExecutor - Trade Execution Engine
 *
 * Responsibilities:
 * - Execute trades via Polymarket API (or mock mode)
 * - Handle API errors gracefully
 * - Record trade execution details
 * - Update position tracking
 *
 * Safety:
 * - MOCK_TRADING mode by default (set to 'false' to enable real trading)
 * - All trades logged to database
 * - Comprehensive error handling
 *
 * @module lib/trading/polymarket-executor
 */

import { createClient } from '@supabase/supabase-js';
import { ClobClient, Side } from '@polymarket/clob-client';
import { Wallet } from '@ethersproject/wallet';
import type { CopyDecision, TradeSide } from './types';
import type { OWRRResult } from '../metrics/owrr';

// ============================================================================
// Types
// ============================================================================

interface Strategy {
  strategy_id: string;
  name: string;
  settings: {
    current_balance_usd: number;
    max_position_size_usd: number;
    risk_per_trade_percent: number;
  };
}

interface Trade {
  trade_id: string;
  wallet_address: string;
  market_id: string;
  market_slug?: string;
  market_title?: string;
  side: TradeSide;
  entry_price: number;
  shares: number;
  usd_value: number;
  timestamp: Date;
  category?: string;
}

interface ExecutionResult {
  success: boolean;
  order_id?: string;
  transaction_hash?: string;
  executed_shares?: number;
  executed_price?: number;
  total_cost?: number;
  fees?: number;
  error?: string;
  copy_trade_id?: number;
}

// ============================================================================
// PolymarketExecutor Class
// ============================================================================

export class PolymarketExecutor {
  private supabase: ReturnType<typeof createClient>;
  private readonly mockMode: boolean;
  private readonly vpnRequired: boolean;
  private readonly polymarketPK?: string;
  private clobClient?: ClobClient;

  constructor() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    this.supabase = createClient(supabaseUrl, supabaseKey);

    // Safety: mock mode by default
    this.mockMode = process.env.MOCK_TRADING !== 'false';
    this.vpnRequired = process.env.REQUIRE_VPN !== 'false';
    this.polymarketPK = process.env.POLYMARKET_PK;

    // Initialize CLOB client if we have a private key and not in mock mode
    if (this.polymarketPK && !this.mockMode) {
      try {
        const host = 'https://clob.polymarket.com';
        const chainId = 137; // Polygon mainnet
        const wallet = new Wallet(this.polymarketPK);
        this.clobClient = new ClobClient(
          host,
          chainId,
          wallet
        );
        console.log('[PolymarketExecutor] CLOB client initialized');
      } catch (error) {
        console.error('[PolymarketExecutor] Failed to initialize CLOB client:', error);
      }
    }

    console.log('[PolymarketExecutor] Initialized', {
      mockMode: this.mockMode,
      vpnRequired: this.vpnRequired,
      hasClobClient: !!this.clobClient,
    });
  }

  /**
   * Execute a copy trade position
   */
  async execute(
    strategy: Strategy,
    trade: Trade,
    decision: CopyDecision,
    owrr: OWRRResult
  ): Promise<ExecutionResult> {
    console.log('[PolymarketExecutor] Executing trade:', {
      strategy: strategy.name,
      market: trade.market_id,
      side: trade.side,
      decision: decision.decision,
      mockMode: this.mockMode,
    });

    if (this.mockMode) {
      return this.executeMock(strategy, trade, decision, owrr);
    }

    // Real trading
    return this.executeReal(strategy, trade, decision, owrr);
  }

  /**
   * Mock execution for testing (no real trades)
   */
  private async executeMock(
    strategy: Strategy,
    trade: Trade,
    decision: CopyDecision,
    owrr: OWRRResult
  ): Promise<ExecutionResult> {
    try {
      // Calculate position size
      const positionSizeUsd = decision.factors?.position_size_usd || trade.usd_value;
      const multiplier = decision.position_size_multiplier || 1.0;

      // Calculate shares based on side
      const shares = trade.side === 'YES'
        ? positionSizeUsd / trade.entry_price
        : positionSizeUsd / (1 - trade.entry_price);

      // Simulate execution price (add small slippage)
      const slippageBps = 10; // 0.1% slippage
      const executedPrice = trade.entry_price * (1 + slippageBps / 10000);

      // Calculate fees (2% of position)
      const fees = positionSizeUsd * 0.02;

      // Generate mock IDs
      const orderId = `MOCK_ORDER_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const transactionHash = `MOCK_TX_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      console.log('[PolymarketExecutor] MOCK EXECUTION:', {
        orderId,
        shares: shares.toFixed(4),
        price: executedPrice.toFixed(4),
        totalCost: positionSizeUsd.toFixed(2),
        fees: fees.toFixed(2),
      });

      // Record to database
      const copyTradeId = await this.recordCopyTrade(
        strategy,
        trade,
        decision,
        owrr,
        {
          orderId,
          transactionHash,
          executedShares: shares,
          executedPrice,
          totalCost: positionSizeUsd,
          fees,
        }
      );

      return {
        success: true,
        order_id: orderId,
        transaction_hash: transactionHash,
        executed_shares: shares,
        executed_price: executedPrice,
        total_cost: positionSizeUsd,
        fees,
        copy_trade_id: copyTradeId,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[PolymarketExecutor] Mock execution failed:', errorMsg);

      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Record copy trade to database
   */
  private async recordCopyTrade(
    strategy: Strategy,
    trade: Trade,
    decision: CopyDecision,
    owrr: OWRRResult,
    execution: {
      orderId: string;
      transactionHash: string;
      executedShares: number;
      executedPrice: number;
      totalCost: number;
      fees: number;
    }
  ): Promise<number> {
    try {
      // Calculate latency
      const latencySeconds = (Date.now() - trade.timestamp.getTime()) / 1000;

      // Calculate slippage
      const slippageBps = ((execution.executedPrice - trade.entry_price) / trade.entry_price) * 10000;
      const slippageUsd = (execution.executedPrice - trade.entry_price) * execution.executedShares;

      const { data, error } = await this.supabase
        .from('copy_trades')
        .insert({
          strategy_id: strategy.strategy_id,
          source_wallet: trade.wallet_address,
          source_trade_id: trade.trade_id,
          market_id: trade.market_id,
          side: trade.side,
          source_entry_price: trade.entry_price,
          source_shares: trade.shares,
          source_usd_amount: trade.usd_value,
          source_timestamp: trade.timestamp.toISOString(),
          our_order_id: execution.orderId,
          our_entry_price: execution.executedPrice,
          our_shares: execution.executedShares,
          our_usd_amount: execution.totalCost,
          our_timestamp: new Date().toISOString(),
          latency_seconds: latencySeconds,
          slippage_bps: slippageBps,
          slippage_usd: slippageUsd,
          execution_fee_usd: execution.fees,
          status: 'open',
          entry_owrr_score: owrr.owrr,
          entry_owrr_slider: owrr.slider,
        } as any)
        .select('id')
        .single();

      if (error) {
        throw new Error(`Failed to record copy trade: ${error.message}`);
      }

      const recordId = (data as any)?.id || 0;

      console.log('[PolymarketExecutor] Copy trade recorded:', {
        id: recordId,
        strategy: strategy.name,
        market: trade.market_id,
      });

      return recordId;
    } catch (error) {
      console.error('[PolymarketExecutor] Error recording copy trade:', error);
      throw error;
    }
  }

  /**
   * Update strategy balance after trade
   */
  private async updateStrategyBalance(
    strategyId: string,
    deltaUsd: number
  ): Promise<void> {
    try {
      // TODO: Implement RPC function to update balance
      console.log(`[PolymarketExecutor] Would update balance for ${strategyId} by $${deltaUsd.toFixed(2)}`);
    } catch (error) {
      console.error('[PolymarketExecutor] Error updating balance:', error);
      // Don't throw - balance updates can be reconciled later
    }
  }

  /**
   * Real Polymarket API execution
   */
  private async executeReal(
    strategy: Strategy,
    trade: Trade,
    decision: CopyDecision,
    owrr: OWRRResult
  ): Promise<ExecutionResult> {
    try {
      // Safety checks
      if (!this.clobClient) {
        throw new Error('CLOB client not initialized - check POLYMARKET_PK environment variable');
      }

      if (!this.polymarketPK) {
        throw new Error('POLYMARKET_PK not configured - cannot execute real trades');
      }

      // VPN check if required
      if (this.vpnRequired) {
        const isUsingVPN = await this.checkVPNConnection();
        if (!isUsingVPN) {
          throw new Error('VPN required for real trading (not legal in US). Please connect to VPN and try again.');
        }
      }

      console.log('[PolymarketExecutor] Placing real order via CLOB client');

      // Calculate position size
      const positionSizeUsd = decision.factors?.position_size_usd || trade.usd_value;
      const multiplier = decision.position_size_multiplier || 1.0;

      // Get token IDs for the market
      const tokenID = await this.getTokenID(trade.market_id, trade.side);

      // Calculate amount based on side
      // For YES: amount = USD / price
      // For NO: amount = USD / (1 - price)
      const amount = trade.side === 'YES'
        ? positionSizeUsd / trade.entry_price
        : positionSizeUsd / (1 - trade.entry_price);

      // Place market order
      // Note: Market orders execute immediately at best available price
      const order = await this.clobClient.createAndPostMarketOrder({
        tokenID,
        amount,
        side: Side.BUY,
      });

      console.log('[PolymarketExecutor] Order placed:', {
        orderID: order.orderID,
        tokenID,
        amount: amount.toFixed(4),
      });

      // Wait briefly for execution confirmation
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Get order status
      const orderStatus = await this.clobClient.getOrder(order.orderID);

      // Calculate actual execution details
      const executedShares = parseFloat(orderStatus.size_matched || amount.toString());
      const executedPrice = parseFloat(orderStatus.price || trade.entry_price.toString());
      const totalCost = executedShares * executedPrice;
      const fees = totalCost * 0.02; // Polymarket charges ~2% fees

      console.log('[PolymarketExecutor] REAL EXECUTION:', {
        orderId: order.orderID,
        shares: executedShares.toFixed(4),
        price: executedPrice.toFixed(4),
        totalCost: totalCost.toFixed(2),
        fees: fees.toFixed(2),
      });

      // Record to database
      const copyTradeId = await this.recordCopyTrade(
        strategy,
        trade,
        decision,
        owrr,
        {
          orderId: order.orderID,
          transactionHash: orderStatus.id || `TX_${order.orderID}`,
          executedShares,
          executedPrice,
          totalCost,
          fees,
        }
      );

      return {
        success: true,
        order_id: order.orderID,
        transaction_hash: orderStatus.id,
        executed_shares: executedShares,
        executed_price: executedPrice,
        total_cost: totalCost,
        fees,
        copy_trade_id: copyTradeId,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[PolymarketExecutor] Real execution failed:', errorMsg);

      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Get token ID for a market and side
   */
  private async getTokenID(marketId: string, side: TradeSide): Promise<string> {
    try {
      // Fetch market data from Polymarket API
      const response = await fetch(`https://clob.polymarket.com/markets/${marketId}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch market data: ${response.statusText}`);
      }

      const marketData = await response.json();

      // Market data contains tokens array with YES and NO tokens
      // Each token has: { token_id, outcome, price }
      const token = marketData.tokens?.find((t: any) =>
        t.outcome?.toUpperCase() === side.toUpperCase()
      );

      if (!token) {
        throw new Error(`Token not found for market ${marketId} side ${side}`);
      }

      return token.token_id;
    } catch (error) {
      console.error('[PolymarketExecutor] Error getting token ID:', error);
      throw error;
    }
  }

  /**
   * Check VPN connection by verifying IP geolocation
   */
  private async checkVPNConnection(): Promise<boolean> {
    try {
      // Get public IP
      const response = await fetch('https://api.ipify.org?format=json');
      const { ip } = await response.json();

      // Get geolocation for IP
      const geoResponse = await fetch(`https://ipapi.co/${ip}/json/`);
      const geo = await geoResponse.json();

      const isVPN = geo.country_code !== 'US';

      console.log('[PolymarketExecutor] VPN Check:', {
        ip,
        country: geo.country_code,
        usingVPN: isVPN ? 'Yes' : 'No'
      });

      return isVPN;
    } catch (error) {
      console.error('[PolymarketExecutor] VPN check failed:', error);
      // Fail safe: if we can't check, assume no VPN
      return false;
    }
  }
}
