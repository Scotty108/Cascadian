/**
 * NODE EXECUTORS
 *
 * Execution logic for each node type.
 * Handles both existing nodes and new Polymarket nodes.
 *
 * For MVP:
 * - Existing nodes: Keep current implementation
 * - Polymarket nodes: Add new executors (with stubs where needed)
 * - Services: Delegate to lib/llm, lib/transform, etc.
 */

import type { NodeType, ExecutionContext } from '@/types/workflow'
import { generateText } from 'ai'
import { google } from '@ai-sdk/google'

/**
 * Execute a node based on its type
 */
export async function executeNodeByType(
  type: NodeType,
  config: any,
  inputs: any,
  context: ExecutionContext
): Promise<any> {
  switch (type) {
    // ========================================================================
    // EXISTING NODES (Keep compatibility with current system)
    // ========================================================================

    case 'start':
      return executeStartNode(config, inputs, context)

    case 'end':
      return executeEndNode(config, inputs, context)

    case 'javascript':
      return executeJavaScriptNode(config, inputs, context)

    case 'httpRequest':
      return executeHttpRequestNode(config, inputs, context)

    case 'conditional':
      return executeConditionalNode(config, inputs, context)

    // ========================================================================
    // NEW POLYMARKET NODES (MVP)
    // ========================================================================

    case 'polymarket-stream':
      return executePolymarketStreamNode(config, inputs, context)

    case 'filter':
      return executeFilterNode(config, inputs, context)

    case 'llm-analysis':
      return executeLLMAnalysisNode(config, inputs, context)

    case 'transform':
      return executeTransformNode(config, inputs, context)

    case 'condition':
      return executeConditionNode(config, inputs, context)

    case 'polymarket-buy':
      return executePolymarketBuyNode(config, inputs, context)

    // ========================================================================
    // POST-MVP NODES (Stubs for now)
    // ========================================================================

    case 'llm-research':
      return executeLLMResearchNode(config, inputs, context)

    case 'polymarket-sell':
      return executePolymarketSellNode(config, inputs, context)

    case 'add-to-watchlist':
      return executeWatchlistNode(config, inputs, context)

    case 'orchestrator':
      return executeOrchestratorNode(config, inputs, context)

    case 'DATA_SOURCE':
      return executeDataSourceNode(config, inputs, context)

    case 'WALLET_FILTER':
      return executeWalletFilterNode(config, inputs, context)

    case 'MARKET_FILTER':
      return executeMarketFilterNode(config, inputs, context)

    case 'SMART_MONEY_SIGNAL':
      return executeSmartMoneySignalNode(config, inputs, context)

    default:
      throw new Error(`Unknown node type: ${type}`)
  }
}

// ============================================================================
// EXISTING NODE EXECUTORS (Preserve current functionality)
// ============================================================================

async function executeStartNode(config: any, inputs: any, context: ExecutionContext): Promise<any> {
  return { status: 'started', timestamp: Date.now() }
}

async function executeEndNode(config: any, inputs: any, context: ExecutionContext): Promise<any> {
  // Return the first input or all inputs
  return Array.isArray(inputs) && inputs.length > 0 ? inputs[0] : inputs
}

async function executeJavaScriptNode(config: any, inputs: any, context: ExecutionContext): Promise<any> {
  const { code } = config

  if (!code) {
    throw new Error('JavaScript node requires code')
  }

  try {
    // Create input variables (input1, input2, etc.)
    const inputVars: Record<string, any> = {}
    if (Array.isArray(inputs)) {
      inputs.forEach((input, index) => {
        inputVars[`input${index + 1}`] = input
      })
    } else if (inputs) {
      inputVars.input1 = inputs
    }

    // Execute code in sandboxed context
    const fn = new Function(...Object.keys(inputVars), code)
    const result = fn(...Object.values(inputVars))

    return result
  } catch (error: any) {
    throw new Error(`JavaScript execution error: ${error.message}`)
  }
}

async function executeHttpRequestNode(config: any, inputs: any, context: ExecutionContext): Promise<any> {
  const { url, method = 'GET', headers = {}, body } = config

  if (!url) {
    throw new Error('HTTP Request node requires URL')
  }

  try {
    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    }

    if (body && method !== 'GET') {
      options.body = typeof body === 'string' ? body : JSON.stringify(body)
    }

    const response = await fetch(url, options)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const contentType = response.headers.get('content-type')
    if (contentType?.includes('application/json')) {
      return await response.json()
    } else {
      return await response.text()
    }
  } catch (error: any) {
    throw new Error(`HTTP request failed: ${error.message}`)
  }
}

async function executeConditionalNode(config: any, inputs: any, context: ExecutionContext): Promise<any> {
  const { condition } = config

  if (!condition) {
    throw new Error('Conditional node requires condition')
  }

  try {
    // Prepare input variables
    const inputVars: Record<string, any> = {}
    if (Array.isArray(inputs)) {
      inputs.forEach((input, index) => {
        inputVars[`input${index + 1}`] = input
      })
    } else if (inputs) {
      inputVars.input1 = inputs
    }

    // Evaluate condition
    const fn = new Function(...Object.keys(inputVars), `return ${condition}`)
    const result = fn(...Object.values(inputVars))

    return Boolean(result)
  } catch (error: any) {
    throw new Error(`Condition evaluation error: ${error.message}`)
  }
}

// ============================================================================
// NEW POLYMARKET NODE EXECUTORS
// ============================================================================

/**
 * Polymarket Stream Node
 * Fetches market data from Polymarket
 * MVP: Returns stub data, will integrate with real API
 */
async function executePolymarketStreamNode(
  config: any,
  inputs: any,
  context: ExecutionContext
): Promise<any> {
  const { categories = [], minVolume = 0, maxResults = 10 } = config

  // Check if we should use real data (environment variable toggle)
  const useRealData = process.env.NEXT_PUBLIC_USE_REAL_POLYMARKET === 'true'

  let markets: any[] = []

  if (useRealData) {
    try {
      // Fetch from internal API (uses cached database)
      const params = new URLSearchParams({
        limit: maxResults.toString(),
        include_analytics: 'true',
        active: 'true',
      })

      // Add category filter if specified
      if (categories.length > 0 && categories[0]) {
        params.append('category', categories[0])
      }

      const apiUrl = `${process.env.NEXT_PUBLIC_API_URL || ''}/api/polymarket/markets?${params}`
      const response = await fetch(apiUrl)

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`)
      }

      const data = await response.json()

      if (data.success && data.data) {
        // Import transformer
        const { transformMarketsForWorkflow } = await import('./market-transformer')
        markets = transformMarketsForWorkflow(data.data)
      } else {
        console.warn('[Polymarket Stream] API returned no data, using stub')
        const { getStubMarkets } = await import('./market-transformer')
        markets = getStubMarkets()
      }
    } catch (error: any) {
      console.error('[Polymarket Stream] Error fetching real data:', error.message)
      console.log('[Polymarket Stream] Falling back to stub data')

      // Fallback to stub data
      const { getStubMarkets } = await import('./market-transformer')
      markets = getStubMarkets()
    }
  } else {
    // Use stub data (default for development)
    const { getStubMarkets } = await import('./market-transformer')
    markets = getStubMarkets()
  }

  // Filter by categories (if not already filtered by API)
  const filtered = markets.filter((m) =>
    categories.length === 0 || categories.includes(m.category)
  )

  // Filter by min volume
  const volumeFiltered = filtered.filter((m) => m.volume >= minVolume)

  // Limit results
  const limited = volumeFiltered.slice(0, maxResults)

  return {
    markets: limited,
    count: limited.length,
    timestamp: Date.now(),
  }
}

/**
 * Filter Node
 * Filters data based on conditions
 * Supports both legacy and enhanced filter configs (v2)
 */
async function executeFilterNode(
  config: any,
  inputs: any,
  context: ExecutionContext
): Promise<any> {
  // Get data to filter (from inputs)
  let data = inputs?.markets || inputs?.data || inputs || []
  if (!Array.isArray(data)) {
    data = [data]
  }

  // Check if this is enhanced filter config (v2) or legacy
  if (config.version === 2 && config.conditions && config.logic) {
    // Use enhanced filter executor v2
    const { executeFilterV2 } = await import('./filter-executor-v2')
    const result = executeFilterV2(data, config.conditions, config.logic)

    return {
      filtered: result.filtered,
      count: result.count,
      original_count: result.originalCount,
      filter_failures: result.filterFailures, // For Task Group 8 data flow viz
    }
  }

  // Legacy filter logic (backward compatibility)
  const { conditions = [] } = config

  // Apply all filter conditions (legacy AND-only logic)
  const filtered = data.filter((item: any) => {
    return conditions.every((cond: any) => {
      const { field, operator, value } = cond
      const itemValue = item[field]

      switch (operator) {
        case 'eq':
          return itemValue === value
        case 'ne':
          return itemValue !== value
        case 'gt':
          return itemValue > value
        case 'gte':
          return itemValue >= value
        case 'lt':
          return itemValue < value
        case 'lte':
          return itemValue <= value
        case 'in':
          return Array.isArray(value) && value.includes(itemValue)
        case 'contains':
          return String(itemValue).toLowerCase().includes(String(value).toLowerCase())
        default:
          return true
      }
    })
  })

  return {
    filtered,
    count: filtered.length,
    original_count: data.length,
  }
}

/**
 * LLM Analysis Node
 * Runs AI analysis with custom prompts
 */
async function executeLLMAnalysisNode(
  config: any,
  inputs: any,
  context: ExecutionContext
): Promise<any> {
  const {
    model = 'gemini-1.5-flash',
    systemPrompt,
    userPrompt,
    temperature = 0.7,
    maxTokens = 1000,
    outputFormat = 'text',
  } = config

  if (!userPrompt) {
    throw new Error('LLM Analysis node requires userPrompt')
  }

  try {
    // Replace {{variable}} placeholders with input data
    const prompt = replaceTemplateVars(userPrompt, inputs)

    const messages: any[] = []
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }
    messages.push({ role: 'user', content: prompt })

    // Use Vercel AI SDK
    const { text } = await generateText({
      model: google(model),
      messages,
      temperature,
    })

    // Parse output based on format
    const parsed = parseOutputFormat(text, outputFormat)

    return {
      result: parsed,
      raw: text,
      model,
      timestamp: Date.now(),
    }
  } catch (error: any) {
    throw new Error(`LLM analysis failed: ${error.message}`)
  }
}

/**
 * Transform Node
 * Data transformation with custom formulas
 */
async function executeTransformNode(
  config: any,
  inputs: any,
  context: ExecutionContext
): Promise<any> {
  const { operations = [] } = config

  // Get data to transform
  let data = inputs?.filtered || inputs?.data || inputs || []
  if (!Array.isArray(data)) {
    data = [data]
  }

  // Apply transformations
  let result = [...data]

  for (const op of operations) {
    switch (op.type) {
      case 'add-column':
        result = addColumn(result, op.config)
        break
      case 'filter-rows':
        result = filterRows(result, op.config)
        break
      case 'sort':
        result = sortData(result, op.config)
        break
      case 'aggregate':
        result = aggregateData(result, op.config)
        break
      default:
        console.warn(`Unknown transform operation: ${op.type}`)
    }
  }

  return {
    transformed: result,
    count: result.length,
  }
}

/**
 * Condition Node
 * If/then/else logic (enhanced conditional)
 */
async function executeConditionNode(
  config: any,
  inputs: any,
  context: ExecutionContext
): Promise<any> {
  const { conditions = [] } = config

  // Evaluate conditions in order
  for (const cond of conditions) {
    if (cond.if) {
      const result = evaluateExpression(cond.if, inputs)
      if (result) {
        return {
          branch: cond.then,
          matched: true,
          condition: cond.if,
        }
      }
    }
    if (cond.else) {
      return {
        branch: cond.else,
        matched: false,
      }
    }
  }

  return {
    branch: null,
    matched: false,
  }
}

/**
 * Polymarket Buy Node
 * Execute buy orders (STUB for MVP)
 */
async function executePolymarketBuyNode(
  config: any,
  inputs: any,
  context: ExecutionContext
): Promise<any> {
  const {
    marketId,
    outcome = 'Yes',
    amount = 10,
    orderType = 'market',
    limitPrice,
    slippage = 2,
  } = config

  // TODO: Integrate with actual Polymarket trading API
  // For MVP, return stub success
  console.log('Executing buy order (STUB):', { marketId, outcome, amount, orderType })

  return {
    orderId: `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    marketId,
    outcome,
    amount,
    executedPrice: limitPrice || 0.45,
    status: 'filled',
    timestamp: Date.now(),
    note: 'STUB: Not executing real trade in MVP',
  }
}

// ============================================================================
// POST-MVP NODE EXECUTORS (Stubs)
// ============================================================================

async function executeLLMResearchNode(
  config: any,
  inputs: any,
  context: ExecutionContext
): Promise<any> {
  // TODO: Implement LLM with research tools (web search, news, perplexity)
  throw new Error('LLM Research node not yet implemented (post-MVP)')
}

async function executePolymarketSellNode(
  config: any,
  inputs: any,
  context: ExecutionContext
): Promise<any> {
  // TODO: Implement sell orders
  throw new Error('Polymarket Sell node not yet implemented (post-MVP)')
}

/**
 * Orchestrator Node
 * AI-powered portfolio orchestration with position sizing
 *
 * Task Group 15: Approval Workflow and Decision History
 */
async function executeOrchestratorNode(
  config: any,
  inputs: any,
  context: ExecutionContext
): Promise<any> {
  // Delegate to specialized orchestrator executor
  const { executeOrchestratorNode: execute } = await import('./node-executors/orchestrator-executor')

  // Create node object for executor
  const node = {
    id: context.workflowId, // Use workflow ID as node ID if not available
    type: 'orchestrator' as const,
    data: { config },
    position: { x: 0, y: 0 },
  }

  return execute(node, inputs, context)
}

/**
 * Add to Watchlist Node
 * Adds markets OR wallets to the strategy's persistent watchlist
 *
 * Feature: Autonomous Strategy Execution System
 * Task Group: 4.5 - Add to Watchlist workflow node
 *
 * Supports:
 * - Markets: For market-based strategies
 * - Wallets: For copy trading strategies
 */
async function executeWatchlistNode(
  config: any,
  inputs: any,
  context: ExecutionContext
): Promise<any> {
  const { reason } = config;

  // Import subscription functions
  const { subscribeToMarket } = await import('@/lib/strategy/market-subscription');
  const { evaluateEscalation } = await import('@/lib/strategy/escalation');

  // Detect if input is wallets or markets
  const wallets = inputs?.wallets || [];
  const markets = inputs?.markets || inputs?.filtered || inputs?.data || inputs || [];

  const isWalletInput = wallets.length > 0;
  const items = isWalletInput ? wallets : (Array.isArray(markets) ? markets : [markets]);

  // Check if we have a workflow ID in context
  if (!context.workflowId) {
    throw new Error('Add to Watchlist node requires workflow context');
  }

  const added: string[] = [];
  const duplicates: string[] = [];
  const errors: string[] = [];

  // Import Supabase client
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Process wallets
  if (isWalletInput) {
    console.log(`[Add to Watchlist] Adding ${wallets.length} wallets to watchlist`)

    for (const wallet of wallets) {
      try {
        const walletAddress = wallet.wallet_address || wallet.address;

        if (!walletAddress) {
          errors.push('Wallet missing address field');
          continue;
        }

        // Check if wallet already exists in watchlist
        const { data: existing } = await supabase
          .from('strategy_watchlist_items')
          .select('id')
          .eq('strategy_id', context.workflowId)
          .eq('item_type', 'WALLET')
          .eq('item_id', walletAddress)
          .single();

        if (existing) {
          duplicates.push(walletAddress);
          continue;
        }

        // Prepare metadata snapshot
        const metadata: any = {
          omega: wallet.omega,
          pnl_30d: wallet.pnl_30d,
          roi_30d: wallet.roi_30d,
          win_rate_30d: wallet.win_rate_30d,
          sharpe_30d: wallet.sharpe_30d,
          trades_30d: wallet.trades_30d,
          primary_category: wallet.primary_category,
          total_volume_usd: wallet.total_volume_usd,
          avg_position_size_usd: wallet.avg_position_size_usd,
          added_by: 'workflow',
          added_at: new Date().toISOString(),
        };

        // Insert into watchlist
        const { error: insertError } = await supabase
          .from('strategy_watchlist_items')
          .insert({
            strategy_id: context.workflowId,
            item_type: 'WALLET',
            item_id: walletAddress,
            status: 'WATCHING',
            metadata,
          });

        if (insertError) {
          console.error('[Add to Watchlist] Insert error:', insertError);
          errors.push(`Failed to add ${walletAddress}: ${insertError.message}`);
          continue;
        }

        added.push(walletAddress);
      } catch (error) {
        console.error('[Add to Watchlist] Error processing wallet:', error);
        errors.push(`Error: ${error instanceof Error ? error.message : 'Unknown'}`);
      }
    }

    // Send notification for wallets
    try {
      const { data: strategy } = await supabase
        .from('strategy_definitions')
        .select('created_by, strategy_name')
        .eq('strategy_id', context.workflowId)
        .single();

      if (strategy) {
        await supabase.from('notifications').insert({
          user_id: strategy.created_by,
          workflow_id: context.workflowId,
          type: 'watchlist_updated',
          title: `${strategy.strategy_name || 'Strategy'} added wallets to watchlist`,
          message: `Added ${added.length} elite wallets to copy trading watchlist`,
          link: `/strategies/${context.workflowId}`,
          priority: 'normal',
        });
      }
    } catch (notificationError) {
      console.warn('[Add to Watchlist] Failed to create notification:', notificationError);
    }

    return {
      added,
      duplicates,
      errors: errors.length > 0 ? errors : undefined,
      count: added.length,
      total_processed: wallets.length,
      item_type: 'WALLET',
      timestamp: Date.now(),
    };
  }

  // Process each market (original logic)
  for (const market of markets) {
    try {
      const marketId = market.id || market.market_id || market.marketId;

      if (!marketId) {
        errors.push('Market missing ID field');
        continue;
      }

      // Check if market already exists in watchlist
      const { data: existing } = await supabase
        .from('strategy_watchlists')
        .select('id')
        .eq('workflow_id', context.workflowId)
        .eq('market_id', marketId)
        .single();

      if (existing) {
        duplicates.push(marketId);
        continue;
      }

      // Prepare metadata snapshot
      const metadata: any = {
        volume_24h: market.volume_24h || market.volume || 0,
        current_price: market.current_price || market.price || 0,
        category: market.category || 'Unknown',
      };

      // Add any additional market data to metadata
      if (market.question) metadata.question = market.question;
      if (market.liquidity) metadata.liquidity = market.liquidity;
      if (market.endDate) metadata.endDate = market.endDate;

      // Insert into watchlist
      const { error: insertError } = await supabase
        .from('strategy_watchlists')
        .insert({
          workflow_id: context.workflowId,
          market_id: marketId,
          reason: reason || 'Added by workflow',
          metadata,
          added_by_execution_id: context.executionId,
        });

      if (insertError) {
        console.error('[Add to Watchlist] Insert error:', insertError);
        errors.push(`Failed to add ${marketId}: ${insertError.message}`);
        continue;
      }

      added.push(marketId);

      // Subscribe to live market signals (stub implementation)
      // Extract condition_id from market data if available
      const conditionId = market.condition_id || market.conditionId || marketId;

      try {
        const unsubscribe = subscribeToMarket(conditionId, marketId, {
          onMomentumSpike: (event) => {
            console.log(`[Watchlist ${context.workflowId}] Momentum spike on ${conditionId}: ${event.side} ${event.magnitude}%`);

            // Evaluate escalation when momentum detected
            const escalation = evaluateEscalation(
              context.workflowId,
              conditionId,
              marketId,
              {
                preferredSide: event.side,
              }
            );

            if (escalation.level === 'READY_TO_TRADE') {
              console.log(`🚨 [Watchlist ${context.workflowId}] ${escalation.reason}`);
              // TODO: Trigger order sizing and placement
            } else if (escalation.level === 'ALERT_ONLY') {
              console.log(`⚠️ [Watchlist ${context.workflowId}] ${escalation.reason}`);
            }
          },
          onHighScoreWalletFlow: (event) => {
            console.log(`[Watchlist ${context.workflowId}] High conviction wallet ${event.wallet} (rank #${event.walletRank}) traded ${event.side} on ${conditionId}`);

            // Evaluate escalation when high conviction wallet trades
            const escalation = evaluateEscalation(
              context.workflowId,
              conditionId,
              marketId,
              {
                recentWallets: [event.wallet],
                preferredSide: event.side,
              }
            );

            if (escalation.level === 'READY_TO_TRADE') {
              console.log(`🚨 [Watchlist ${context.workflowId}] ${escalation.reason}`);
              // TODO: Trigger order sizing and placement
            } else if (escalation.level === 'ALERT_ONLY') {
              console.log(`⚠️ [Watchlist ${context.workflowId}] ${escalation.reason}`);
            }
          },
          onPriceMove: (event) => {
            // Log price updates (verbose - could be throttled in production)
            console.log(`[Watchlist ${context.workflowId}] Price update ${conditionId}: YES=${event.newPriceYes} NO=${event.newPriceNo}`);
          },
        });

        // Store watchlist state in context for cleanup
        if (!context.watchlists) {
          context.watchlists = new Map();
        }
        context.watchlists.set(conditionId, {
          id: conditionId,
          marketId: conditionId,
          conditions: [],
          checkInterval: 0,
          createdAt: Date.now(),
          status: 'active',
          unsubscribe
        });
      } catch (subscriptionError) {
        // Don't fail watchlist addition if subscription fails
        console.warn(`[Watchlist ${context.workflowId}] Failed to subscribe to market ${conditionId}:`, subscriptionError);
      }

      // Send notification for each market added
      // Get workflow details for notification
      const { data: workflow } = await supabase
        .from('workflow_sessions')
        .select('name, user_id')
        .eq('id', context.workflowId)
        .single();

      if (workflow) {
        try {
          await supabase.from('notifications').insert({
            user_id: workflow.user_id,
            workflow_id: context.workflowId,
            type: 'watchlist_updated',
            title: `${workflow.name || 'Strategy'} added market to watchlist`,
            message: `Added '${metadata.question || marketId}' ${metadata.volume_24h ? `($${Math.round(metadata.volume_24h / 1000)}K volume)` : ''}`,
            link: `/strategies/${context.workflowId}`,
            priority: 'normal',
          });
        } catch (notificationError) {
          // Don't fail the node if notification fails
          console.warn('[Add to Watchlist] Failed to create notification:', notificationError);
        }
      }
    } catch (error: any) {
      console.error('[Add to Watchlist] Error processing market:', error);
      errors.push(`Error: ${error.message}`);
    }
  }

  return {
    added,
    duplicates,
    errors: errors.length > 0 ? errors : undefined,
    count: added.length,
    total_processed: markets.length,
    timestamp: Date.now(),
  };
}

/**
 * DATA_SOURCE Node
 * Fetches wallet or market data from ClickHouse
 * Supports STREAM (continuous) and BATCH (one-time) modes
 */
async function executeDataSourceNode(
  config: any,
  inputs: any,
  context: ExecutionContext
): Promise<any> {
  const { source = 'WALLETS', mode = 'BATCH', table = 'wallet_metrics_complete' } = config

  if (source === 'WALLETS') {
    try {
      // Import ClickHouse client
      const { clickhouse } = await import('@/lib/clickhouse/client')

      // Query wallet metrics from ClickHouse
      const result = await clickhouse.query({
        query: `
          SELECT
            wallet_address,
            omega,
            pnl_30d,
            roi_30d,
            win_rate_30d,
            sharpe_30d,
            trades_30d,
            primary_category,
            total_volume_usd,
            avg_position_size_usd,
            max_position_size_usd,
            last_trade_timestamp
          FROM ${table}
          WHERE trades_30d > 0
          ORDER BY omega DESC
          LIMIT 10000
        `,
        format: 'JSONEachRow',
      })

      const wallets = (await result.json()) as any[]

      return {
        wallets,
        count: wallets.length,
        source: 'clickhouse',
        table,
        mode,
        timestamp: Date.now(),
      }
    } catch (error: any) {
      console.error('[DATA_SOURCE] Error fetching wallet data:', error)
      throw new Error(`Failed to fetch wallet data: ${error.message}`)
    }
  } else if (source === 'MARKETS') {
    // TODO: Implement market data source (query from Supabase or Polymarket API)
    throw new Error('MARKETS data source not yet implemented')
  } else if (source === 'TRADES') {
    // TODO: Implement trades data source
    throw new Error('TRADES data source not yet implemented')
  }

  throw new Error(`Unknown data source: ${source}`)
}

/**
 * WALLET_FILTER Node
 * Filters wallets by performance metrics with percentile support
 * Supports multi-level sorting and category filtering
 */
async function executeWalletFilterNode(
  config: any,
  inputs: any,
  context: ExecutionContext
): Promise<any> {
  // Get wallets from input (from DATA_SOURCE node)
  let wallets = inputs?.wallets || inputs?.data || inputs || []
  if (!Array.isArray(wallets)) {
    wallets = [wallets]
  }

  const originalCount = wallets.length

  // Step 1: Category Filtering
  if (config.categories && config.categories.length > 0) {
    wallets = wallets.filter((wallet: any) =>
      config.categories.includes(wallet.primary_category)
    )
    console.log(`[WALLET_FILTER] After category filter: ${wallets.length} wallets`)
  }

  // Step 2: Apply Performance Conditions
  if (config.conditions && config.conditions.length > 0) {
    for (const condition of config.conditions) {
      const { metric, operator, value } = condition
      const numValue = parseFloat(value)

      switch (operator) {
        case 'top_percent': {
          // Find top X% of wallets by metric
          const percentile = calculatePercentile(wallets, metric, 100 - numValue)
          wallets = wallets.filter((wallet: any) => wallet[metric] >= percentile)
          console.log(`[WALLET_FILTER] After top ${numValue}% ${metric}: ${wallets.length} wallets`)
          break
        }

        case 'bottom_percent': {
          // Find bottom X% of wallets by metric
          const percentile = calculatePercentile(wallets, metric, numValue)
          wallets = wallets.filter((wallet: any) => wallet[metric] <= percentile)
          console.log(`[WALLET_FILTER] After bottom ${numValue}% ${metric}: ${wallets.length} wallets`)
          break
        }

        case '>=':
          wallets = wallets.filter((wallet: any) => wallet[metric] >= numValue)
          break

        case '>':
          wallets = wallets.filter((wallet: any) => wallet[metric] > numValue)
          break

        case '<=':
          wallets = wallets.filter((wallet: any) => wallet[metric] <= numValue)
          break

        case '<':
          wallets = wallets.filter((wallet: any) => wallet[metric] < numValue)
          break

        case '=':
          wallets = wallets.filter((wallet: any) => wallet[metric] === numValue)
          break

        default:
          console.warn(`[WALLET_FILTER] Unknown operator: ${operator}`)
      }
    }
  }

  // Step 3: Multi-Level Sorting
  if (config.sorting) {
    wallets.sort((a: any, b: any) => {
      // Primary sort
      if (config.sorting.primary) {
        const primaryResult = compareWallets(a, b, config.sorting.primary)
        if (primaryResult !== 0) return primaryResult
      }

      // Secondary sort (tiebreaker)
      if (config.sorting.secondary) {
        const secondaryResult = compareWallets(a, b, config.sorting.secondary)
        if (secondaryResult !== 0) return secondaryResult
      }

      // Tertiary sort (tiebreaker)
      if (config.sorting.tertiary) {
        return compareWallets(a, b, config.sorting.tertiary)
      }

      return 0
    })
  }

  // Step 4: Apply Limit
  const limit = config.limit || 100
  const limitedWallets = wallets.slice(0, limit)

  return {
    wallets: limitedWallets,
    count: limitedWallets.length,
    original_count: originalCount,
    filter_applied: true,
    timestamp: Date.now(),
  }
}

/**
 * MARKET_FILTER Node
 * Filters markets by liquidity, end date, category, and keywords
 */
async function executeMarketFilterNode(
  config: any,
  inputs: any,
  context: ExecutionContext
): Promise<any> {
  let markets = inputs?.markets || inputs?.data || inputs || []

  const originalCount = markets.length
  console.log(`[MARKET_FILTER] Filtering ${originalCount} markets`)

  // Filter by liquidity
  if (config.min_liquidity_usd) {
    markets = markets.filter((m: any) => {
      const liquidity = m.liquidity_usd || m.liquidity || 0
      return liquidity >= config.min_liquidity_usd
    })
    console.log(`[MARKET_FILTER] After liquidity filter: ${markets.length} markets`)
  }

  // Filter by days to close
  if (config.max_days_to_close !== undefined || config.min_days_to_close !== undefined) {
    markets = markets.filter((m: any) => {
      const closesAt = m.closes_at || m.end_date || m.endDate
      if (!closesAt) return true // Keep if no close date

      const daysToClose = calculateDaysToClose(closesAt)

      if (config.max_days_to_close !== undefined && daysToClose > config.max_days_to_close) {
        return false
      }
      if (config.min_days_to_close !== undefined && daysToClose < config.min_days_to_close) {
        return false
      }
      return true
    })
    console.log(`[MARKET_FILTER] After date filter: ${markets.length} markets`)
  }

  // Filter by category
  if (config.categories && config.categories.length > 0) {
    markets = markets.filter((m: any) =>
      config.categories.includes(m.category)
    )
    console.log(`[MARKET_FILTER] After category filter: ${markets.length} markets`)
  }

  // Filter by keywords (exclude)
  if (config.exclude_keywords && config.exclude_keywords.length > 0) {
    markets = markets.filter((m: any) => {
      const text = `${m.title || ''} ${m.description || ''}`.toLowerCase()
      return !config.exclude_keywords.some((kw: string) =>
        text.includes(kw.toLowerCase())
      )
    })
    console.log(`[MARKET_FILTER] After keyword exclusion: ${markets.length} markets`)
  }

  // Filter by keywords (include - must contain at least one)
  if (config.include_keywords && config.include_keywords.length > 0) {
    markets = markets.filter((m: any) => {
      const text = `${m.title || ''} ${m.description || ''}`.toLowerCase()
      return config.include_keywords.some((kw: string) =>
        text.includes(kw.toLowerCase())
      )
    })
    console.log(`[MARKET_FILTER] After keyword inclusion: ${markets.length} markets`)
  }

  console.log(`[MARKET_FILTER] Final: ${markets.length} markets passed filter`)

  return {
    markets,
    count: markets.length,
    original_count: originalCount,
    filter_applied: true,
    timestamp: Date.now(),
  }
}

/**
 * Calculate days until market closes
 */
function calculateDaysToClose(closesAt: string | Date): number {
  const now = new Date()
  const close = new Date(closesAt)
  const diff = close.getTime() - now.getTime()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

/**
 * SMART_MONEY_SIGNAL Node
 * Analyzes markets for smart money positioning using OWRR
 * Only returns markets with strong smart money consensus
 */
async function executeSmartMoneySignalNode(
  config: any,
  inputs: any,
  context: ExecutionContext
): Promise<any> {
  const { calculateOWRR } = await import('@/lib/metrics/owrr')

  let markets = inputs?.markets || inputs?.data || inputs || []

  const {
    min_owrr_yes = 0.65,        // OWRR ≥ 0.65 = strong YES signal
    max_owrr_no = 0.35,         // OWRR ≤ 0.35 = strong NO signal
    min_confidence = 'medium',  // Require at least medium confidence
    min_edge_percent = 0,       // Optional: minimum edge requirement
  } = config

  const analyzed = []
  const originalCount = markets.length

  console.log(`[SMART_MONEY_SIGNAL] Analyzing ${originalCount} markets for smart money signals`)
  console.log(`[SMART_MONEY_SIGNAL] Thresholds: YES ≥ ${min_owrr_yes}, NO ≤ ${max_owrr_no}, Confidence: ${min_confidence}`)

  for (const market of markets) {
    try {
      // Skip if no category (required for OWRR)
      if (!market.category) {
        console.log(`[SMART_MONEY_SIGNAL] Skipping ${market.market_id}: no category`)
        continue
      }

      // Calculate OWRR using existing function
      const owrrResult = await calculateOWRR(market.market_id, market.category)

      // Check confidence level
      const confidenceMet = checkConfidence(owrrResult.confidence, min_confidence)

      // Determine signal
      let signal: 'BUY_YES' | 'BUY_NO' | 'SKIP' = 'SKIP'
      let reason = ''
      let recommended_side: 'YES' | 'NO' | null = null

      if (owrrResult.owrr >= min_owrr_yes && confidenceMet) {
        signal = 'BUY_YES'
        recommended_side = 'YES'
        reason = `Strong smart money on YES (OWRR ${owrrResult.slider}/100, ${owrrResult.yes_qualified} qualified wallets)`
      } else if (owrrResult.owrr <= max_owrr_no && confidenceMet) {
        signal = 'BUY_NO'
        recommended_side = 'NO'
        reason = `Strong smart money on NO (OWRR ${owrrResult.slider}/100, ${owrrResult.no_qualified} qualified wallets)`
      } else if (!confidenceMet) {
        reason = `Insufficient data (confidence: ${owrrResult.confidence}, need ${min_confidence})`
      } else {
        reason = `Neutral OWRR (${owrrResult.slider}/100, not strong enough)`
      }

      // Calculate edge if we have a signal
      let edge_percent = 0
      if (signal !== 'SKIP' && market.current_yes_price && market.current_no_price) {
        const marketPrice = recommended_side === 'YES' ? market.current_yes_price : market.current_no_price
        const impliedProb = owrrResult.owrr // OWRR is the smart money implied probability
        edge_percent = ((impliedProb / marketPrice) - 1) * 100
      }

      // Skip if edge requirement not met
      if (signal !== 'SKIP' && edge_percent < min_edge_percent) {
        signal = 'SKIP'
        reason = `Edge too low (${edge_percent.toFixed(1)}%, need ${min_edge_percent}%)`
      }

      // Only include markets with strong signals
      if (signal !== 'SKIP') {
        analyzed.push({
          ...market,
          signal,
          reason,
          recommended_side,
          edge_percent,

          // OWRR data
          owrr: owrrResult.owrr,
          slider: owrrResult.slider,
          confidence: owrrResult.confidence,

          // Smart money stats
          yes_qualified: owrrResult.yes_qualified,
          no_qualified: owrrResult.no_qualified,
          yes_avg_omega: owrrResult.yes_avg_omega,
          no_avg_omega: owrrResult.no_avg_omega,
          yes_avg_risk: owrrResult.yes_avg_risk,
          no_avg_risk: owrrResult.no_avg_risk,

          // Metadata
          analyzed_at: new Date().toISOString(),
        })

        console.log(`[SMART_MONEY_SIGNAL] ✅ ${market.market_id}: ${signal} (OWRR ${owrrResult.slider}/100)`)
      } else {
        console.log(`[SMART_MONEY_SIGNAL] ⏭️  ${market.market_id}: ${reason}`)
      }
    } catch (error: any) {
      console.error(`[SMART_MONEY_SIGNAL] ❌ Error analyzing market ${market.market_id}:`, error.message)
    }
  }

  console.log(`[SMART_MONEY_SIGNAL] Found ${analyzed.length} markets with strong signals (out of ${originalCount})`)

  return {
    markets: analyzed,
    count: analyzed.length,
    total_analyzed: originalCount,
    signals: {
      buy_yes: analyzed.filter(m => m.signal === 'BUY_YES').length,
      buy_no: analyzed.filter(m => m.signal === 'BUY_NO').length,
    },
    timestamp: Date.now(),
  }
}

/**
 * Check if confidence level meets minimum requirement
 */
function checkConfidence(
  actual: 'high' | 'medium' | 'low' | 'insufficient_data',
  required: string
): boolean {
  const levels = ['insufficient_data', 'low', 'medium', 'high']
  const actualLevel = levels.indexOf(actual)
  const requiredLevel = levels.indexOf(required)
  return actualLevel >= requiredLevel
}

/**
 * Calculate percentile value for a metric
 * @param wallets - Array of wallet objects
 * @param metric - Metric field name (e.g., 'omega', 'pnl_30d')
 * @param percentile - Percentile value (0-100)
 * @returns The value at the given percentile
 */
function calculatePercentile(wallets: any[], metric: string, percentile: number): number {
  if (wallets.length === 0) return 0

  // Extract metric values and sort
  const values = wallets
    .map(wallet => wallet[metric])
    .filter(val => val !== null && val !== undefined && !isNaN(val))
    .sort((a, b) => a - b)

  if (values.length === 0) return 0

  // Calculate index for percentile
  const index = Math.ceil((percentile / 100) * values.length) - 1
  const clampedIndex = Math.max(0, Math.min(index, values.length - 1))

  return values[clampedIndex]
}

/**
 * Compare two wallets based on a sort string (e.g., 'omega DESC')
 * @param a - First wallet
 * @param b - Second wallet
 * @param sortString - Sort specification (e.g., 'omega DESC', 'pnl_30d ASC')
 * @returns Comparison result (-1, 0, 1)
 */
function compareWallets(a: any, b: any, sortString: string): number {
  const parts = sortString.split(' ')
  const field = parts[0]
  const direction = parts[1]?.toUpperCase() === 'ASC' ? 'asc' : 'desc'

  const aVal = a[field]
  const bVal = b[field]

  // Handle null/undefined
  if (aVal === null || aVal === undefined) return 1
  if (bVal === null || bVal === undefined) return -1

  if (aVal < bVal) return direction === 'asc' ? -1 : 1
  if (aVal > bVal) return direction === 'asc' ? 1 : -1
  return 0
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Replace {{variable}} with values from inputs
 */
function replaceTemplateVars(template: string, inputs: any): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const parts = path.trim().split('.')
    let value = inputs

    for (const part of parts) {
      value = value?.[part]
    }

    return value !== undefined ? String(value) : match
  })
}

/**
 * Parse LLM output based on desired format
 */
function parseOutputFormat(text: string, format: string): any {
  if (!format || format === 'text') {
    return text
  }

  if (format === 'boolean') {
    const lower = text.toLowerCase().trim()
    return lower.includes('yes') || lower.includes('true') || lower.startsWith('y')
  }

  if (format === 'number') {
    const match = text.match(/\d+\.?\d*/)
    return match ? parseFloat(match[0]) : 0
  }

  if (format === 'json') {
    try {
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/)
      const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : text
      return JSON.parse(jsonStr)
    } catch (error) {
      console.error('Failed to parse JSON:', error)
      return { error: 'Failed to parse JSON', raw: text }
    }
  }

  return text
}

/**
 * Add column transformation
 */
function addColumn(data: any[], config: any): any[] {
  const { name, formula } = config

  return data.map((row) => ({
    ...row,
    [name]: evaluateFormula(formula, row),
  }))
}

/**
 * Filter rows transformation
 */
function filterRows(data: any[], config: any): any[] {
  const { condition } = config
  return data.filter((row) => evaluateExpression(condition, row))
}

/**
 * Sort transformation
 */
function sortData(data: any[], config: any): any[] {
  const { field, direction = 'asc' } = config

  return [...data].sort((a, b) => {
    if (a[field] < b[field]) return direction === 'asc' ? -1 : 1
    if (a[field] > b[field]) return direction === 'asc' ? 1 : -1
    return 0
  })
}

/**
 * Aggregate transformation
 * Supports: sum, avg, count, min, max with optional groupBy
 */
function aggregateData(data: any[], config: any): any[] {
  const { operation, field, groupBy } = config

  if (!operation) {
    console.warn('Aggregate operation not specified')
    return data
  }

  // No grouping - simple aggregation
  if (!groupBy) {
    const result = calculateAggregate(data, operation, field)
    return [{
      operation,
      field: field || 'all',
      result,
      count: data.length,
    }]
  }

  // With grouping - aggregate per group
  const groups: Record<string, any[]> = {}

  // Group the data
  for (const row of data) {
    const groupKey = String(row[groupBy])
    if (!groups[groupKey]) {
      groups[groupKey] = []
    }
    groups[groupKey].push(row)
  }

  // Calculate aggregates for each group
  const results = Object.entries(groups).map(([groupKey, groupData]) => ({
    [groupBy]: groupKey,
    operation,
    field: field || 'all',
    result: calculateAggregate(groupData, operation, field),
    count: groupData.length,
  }))

  return results
}

/**
 * Calculate aggregate value for a dataset
 */
function calculateAggregate(data: any[], operation: string, field?: string): number {
  if (data.length === 0) return 0

  switch (operation.toLowerCase()) {
    case 'count':
      return data.length

    case 'sum': {
      if (!field) return 0
      return data.reduce((sum, row) => sum + (Number(row[field]) || 0), 0)
    }

    case 'avg': {
      if (!field) return 0
      const sum = data.reduce((sum, row) => sum + (Number(row[field]) || 0), 0)
      return sum / data.length
    }

    case 'min': {
      if (!field) return 0
      const values = data.map(row => Number(row[field])).filter(v => !isNaN(v))
      return values.length > 0 ? Math.min(...values) : 0
    }

    case 'max': {
      if (!field) return 0
      const values = data.map(row => Number(row[field])).filter(v => !isNaN(v))
      return values.length > 0 ? Math.max(...values) : 0
    }

    default:
      console.warn(`Unknown aggregate operation: ${operation}`)
      return 0
  }
}

/**
 * Evaluate a formula (simple math expressions)
 * Example: "currentPrice - 0.5" or "volume / 1000"
 */
function evaluateFormula(formula: string, row: any): any {
  try {
    // Replace variable names with values
    let expr = formula
    for (const [key, value] of Object.entries(row)) {
      const regex = new RegExp(`\\b${key}\\b`, 'g')
      const replacement = typeof value === 'string' ? `"${value}"` : String(value)
      expr = expr.replace(regex, replacement)
    }

    // Evaluate safely
    const fn = new Function(`return ${expr}`)
    return fn()
  } catch (error) {
    console.error('Formula evaluation error:', error)
    return null
  }
}

/**
 * Evaluate boolean expression
 * Example: "price > 0.5" or "volume > 50000"
 */
function evaluateExpression(expr: string, inputs: any): boolean {
  try {
    // Replace variable names with values
    let evaluated = expr
    for (const [key, value] of Object.entries(inputs)) {
      const regex = new RegExp(`\\b${key}\\b`, 'g')
      const replacement = typeof value === 'string' ? `"${value}"` : String(value)
      evaluated = evaluated.replace(regex, replacement)
    }

    // Evaluate safely
    const fn = new Function(`return ${evaluated}`)
    return Boolean(fn())
  } catch (error) {
    console.error('Expression evaluation error:', error)
    return false
  }
}
