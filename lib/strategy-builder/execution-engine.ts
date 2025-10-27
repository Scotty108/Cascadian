/**
 * Strategy Execution Engine
 * Orchestrates strategy execution across all node types and data sources
 */

import { walletMetricsConnector } from './clickhouse-connector';
import { supabaseConnector } from './supabase-connector';
import { createClient } from '@supabase/supabase-js';
import type {
  StrategyDefinition,
  ExecutionContext,
  NodeResult,
  StrategyResult,
  Node,
  NodeGraph,
  FilterConfig,
  LogicConfig,
  AggregationConfig,
  SignalConfig,
  ActionConfig,
  QueryFilter,
} from './types';

export class StrategyExecutionEngine {
  private supabase: ReturnType<typeof createClient>;
  private nodeCache: Map<string, NodeResult> = new Map();
  private currentGraph: NodeGraph | null = null;

  constructor() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Main execution entry point
   */
  async execute(
    strategy: StrategyDefinition,
    context: ExecutionContext
  ): Promise<StrategyResult> {
    const startTime = Date.now();
    const results: Record<string, NodeResult> = {};

    console.log(`🚀 Starting strategy execution: ${strategy.strategyName} (${context.executionId})`);

    try {
      this.currentGraph = strategy.nodeGraph;

      // Build execution order (topological sort)
      const executionOrder = this.buildExecutionOrder(strategy.nodeGraph);

      console.log(`   📊 Executing ${executionOrder.length} nodes in order`);

      // Execute nodes in order
      for (const nodeId of executionOrder) {
        const node = strategy.nodeGraph.nodes.find(n => n.id === nodeId);
        if (!node) {
          throw new Error(`Node ${nodeId} not found in graph`);
        }

        console.log(`   🔄 Executing node: ${nodeId} (${node.type})`);

        const nodeResult = await this.executeNode(node, results, context);
        results[nodeId] = nodeResult;

        console.log(`   ✅ Node ${nodeId} complete in ${nodeResult.executionTimeMs}ms`);
      }

      // Collect aggregations, signals, actions
      const aggregations = this.collectAggregations(results);
      const signalsGenerated = this.collectSignals(results);
      const actionsExecuted = await this.executeActions(results, context);

      // Calculate total data points processed
      const dataPointsProcessed = Object.values(results).reduce((sum, r) =>
        Array.isArray(r.data) ? sum + r.data.length : sum, 0
      );

      // Save execution record
      await this.saveExecutionRecord(context, results, {
        aggregations,
        signalsGenerated,
        actionsExecuted,
        dataPointsProcessed,
      });

      const totalTime = Date.now() - startTime;
      console.log(`✅ Strategy execution complete in ${totalTime}ms`);

      return {
        executionId: context.executionId,
        strategyId: context.strategyId,
        results,
        aggregations,
        signalsGenerated,
        actionsExecuted,
        totalExecutionTimeMs: totalTime,
        nodesEvaluated: Object.keys(results).length,
        dataPointsProcessed,
        status: 'SUCCESS'
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ Strategy execution failed: ${errorMessage}`);

      // Save failed execution
      await this.saveExecutionRecord(context, results, {
        status: 'FAILED',
        errorMessage
      });

      return {
        executionId: context.executionId,
        strategyId: context.strategyId,
        results,
        totalExecutionTimeMs: Date.now() - startTime,
        nodesEvaluated: Object.keys(results).length,
        dataPointsProcessed: 0,
        status: 'FAILED',
        errorMessage
      };
    }
  }

  /**
   * Execute a single node based on type
   */
  private async executeNode(
    node: Node,
    previousResults: Record<string, NodeResult>,
    context: ExecutionContext
  ): Promise<NodeResult> {
    const startTime = Date.now();

    try {
      let data: any;

      switch (node.type) {
        case 'DATA_SOURCE':
          data = await this.executeDataSource(node);
          break;

        case 'FILTER':
          data = await this.executeFilter(node, previousResults);
          break;

        case 'LOGIC':
          data = await this.executeLogic(node, previousResults);
          break;

        case 'AGGREGATION':
          data = await this.executeAggregation(node, previousResults);
          break;

        case 'SIGNAL':
          data = await this.executeSignal(node, previousResults);
          break;

        case 'ACTION':
          data = await this.executeAction(node, previousResults, context);
          break;

        default:
          throw new Error(`Unknown node type: ${(node as any).type}`);
      }

      return {
        nodeId: node.id,
        data,
        timestamp: new Date(),
        executionTimeMs: Date.now() - startTime,
        cached: false
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`   ❌ Node ${node.id} failed: ${errorMessage}`);

      return {
        nodeId: node.id,
        data: null,
        timestamp: new Date(),
        executionTimeMs: Date.now() - startTime,
        cached: false,
        error: errorMessage
      };
    }
  }

  /**
   * Execute DATA_SOURCE node - fetch from database
   */
  private async executeDataSource(node: Node): Promise<any[]> {
    const config = node.config as any;
    const { source, prefilters, mode } = config;

    console.log(`      📥 DATA_SOURCE: ${source} (${mode})`);

    // Convert prefilters to QueryOptions
    const filters: QueryFilter[] = [];

    // TODO: Parse prefilters.where string into QueryFilter objects
    // For now, use the connector's native filtering

    switch (source) {
      case 'WALLETS':
        if (prefilters?.table === 'wallet_metrics_complete') {
          // Use ClickHouse for advanced metrics
          const result = await walletMetricsConnector.queryWalletMetrics({
            filters: [],
            timeWindow: 'lifetime',
            limit: prefilters.limit || 10000,
          });
          console.log(`      ✓ Fetched ${result.data.length} wallets from ClickHouse (${result.executionTimeMs}ms)`);
          return result.data;
        } else if (prefilters?.table === 'wallet_metrics_by_category') {
          // Use ClickHouse for category metrics
          const result = await walletMetricsConnector.queryWalletMetricsByCategory({
            filters: [],
            category: 'AI',
            timeWindow: 'lifetime',
            limit: prefilters.limit || 10000,
          });
          console.log(`      ✓ Fetched ${result.data.length} category wallets from ClickHouse (${result.executionTimeMs}ms)`);
          return result.data;
        } else {
          // Use Supabase for basic metrics
          const result = await supabaseConnector.queryWalletScores({
            limit: prefilters?.limit || 10000,
          });
          console.log(`      ✓ Fetched ${result.data.length} wallets from Supabase (${result.executionTimeMs}ms)`);
          return result.data;
        }

      case 'MARKETS':
        const marketsResult = await supabaseConnector.queryMarkets({
          limit: prefilters?.limit || 1000,
        });
        console.log(`      ✓ Fetched ${marketsResult.data.length} markets`);
        return marketsResult.data;

      default:
        throw new Error(`Unsupported data source: ${source}`);
    }
  }

  /**
   * Execute FILTER node - apply condition to data
   */
  private async executeFilter(
    node: Node,
    previousResults: Record<string, NodeResult>
  ): Promise<any[]> {
    const config = node.config as FilterConfig;
    const { field, operator, value, categorySpecific } = config;

    console.log(`      🔍 FILTER: ${field} ${operator} ${JSON.stringify(value)}`);

    // Get input data from connected node
    const inputData = this.getInputData(node.id, previousResults);

    if (!Array.isArray(inputData)) {
      throw new Error(`Filter node ${node.id} expects array input, got ${typeof inputData}`);
    }

    // Apply filter
    const filtered = inputData.filter(item => {
      // Category-specific filter
      if (categorySpecific?.enabled && item.category !== categorySpecific.category) {
        return false;
      }

      // Get field value
      const fieldValue = this.getFieldValue(item, field);

      // Apply operator
      return this.applyOperator(fieldValue, operator, value);
    });

    console.log(`      ✓ Filtered ${inputData.length} → ${filtered.length} items`);
    return filtered;
  }

  /**
   * Execute LOGIC node - combine conditions
   */
  private async executeLogic(
    node: Node,
    previousResults: Record<string, NodeResult>
  ): Promise<any[]> {
    const config = node.config as LogicConfig;
    const { operator, inputs } = config;

    console.log(`      🔀 LOGIC: ${operator} (${inputs.length} inputs)`);

    // Get input results
    const inputResults = inputs.map((inputId: string) => {
      const result = previousResults[inputId];
      if (!result) {
        throw new Error(`Input node ${inputId} not found`);
      }
      return result.data;
    });

    // Ensure all inputs are arrays
    if (!inputResults.every(r => Array.isArray(r))) {
      throw new Error(`Logic node ${node.id} expects array inputs`);
    }

    let result: any[];

    switch (operator) {
      case 'AND':
        result = this.intersectArrays(inputResults);
        break;

      case 'OR':
        result = this.unionArrays(inputResults);
        break;

      case 'NOT':
        if (inputResults.length !== 1) {
          throw new Error('NOT operator requires exactly 1 input');
        }
        // Return empty array for NOT (typically used with another set to subtract)
        result = [];
        break;

      case 'XOR':
        result = this.xorArrays(inputResults);
        break;

      default:
        throw new Error(`Unknown logic operator: ${operator}`);
    }

    console.log(`      ✓ Combined ${inputResults.map(r => r.length).join(', ')} → ${result.length} items`);
    return result;
  }

  /**
   * Execute AGGREGATION node - calculate metrics
   */
  private async executeAggregation(
    node: Node,
    previousResults: Record<string, NodeResult>
  ): Promise<number | Record<string, number>> {
    const config = node.config as AggregationConfig;
    const { function: aggFunc, field, percentile, groupBy } = config;

    console.log(`      📊 AGGREGATION: ${aggFunc}${field ? `(${field})` : ''}`);

    // Get input data
    const inputData = this.getInputData(node.id, previousResults);

    if (!Array.isArray(inputData)) {
      throw new Error(`Aggregation node ${node.id} expects array input`);
    }

    // Group by (if specified)
    if (groupBy && groupBy.length > 0) {
      const grouped = this.groupBy(inputData, groupBy);
      const result: Record<string, number> = {};

      for (const [key, items] of Object.entries(grouped)) {
        result[key] = this.calculateAggregation(items, aggFunc, field, percentile);
      }

      console.log(`      ✓ Aggregated ${inputData.length} items into ${Object.keys(result).length} groups`);
      return result;
    }

    // Single aggregation
    const result = this.calculateAggregation(inputData, aggFunc, field, percentile);
    console.log(`      ✓ Aggregated ${inputData.length} items → ${result}`);
    return result;
  }

  /**
   * Execute SIGNAL node - generate trading signal
   */
  private async executeSignal(
    node: Node,
    previousResults: Record<string, NodeResult>
  ): Promise<any> {
    const config = node.config as SignalConfig;
    const { signalType, condition, direction, strength, positionSize } = config;

    console.log(`      📡 SIGNAL: ${signalType}${direction ? ` ${direction}` : ''}`);

    // Get condition result
    const conditionResult = previousResults[condition];
    if (!conditionResult) {
      throw new Error(`Condition node ${condition} not found`);
    }

    // Condition must evaluate to boolean or non-empty array
    const conditionMet = Array.isArray(conditionResult.data)
      ? conditionResult.data.length > 0
      : Boolean(conditionResult.data);

    if (!conditionMet) {
      console.log(`      ✓ No signal (condition not met)`);
      return null;
    }

    // Generate signal
    const signal = {
      signalId: crypto.randomUUID(),
      signalType,
      direction,
      strength: strength || 'MODERATE',
      positionSize,
      timestamp: new Date(),
      conditionData: conditionResult.data
    };

    console.log(`      ✓ Generated ${signalType} signal`);
    return signal;
  }

  /**
   * Execute ACTION node - perform action
   */
  private async executeAction(
    node: Node,
    previousResults: Record<string, NodeResult>,
    context: ExecutionContext
  ): Promise<any> {
    const config = node.config as ActionConfig;
    const { action, params } = config;

    console.log(`      🎬 ACTION: ${action}`);

    // Get input data
    const inputData = this.getInputData(node.id, previousResults);

    switch (action) {
      case 'ADD_TO_WATCHLIST':
        return await this.addToWatchlist(inputData, params, context);

      case 'SEND_ALERT':
        console.log(`      ✓ Would send alert for ${Array.isArray(inputData) ? inputData.length : 1} items`);
        return { action: 'SEND_ALERT', count: Array.isArray(inputData) ? inputData.length : 1 };

      case 'LOG_RESULT':
        console.log(`      ✓ Logged result:`, inputData);
        return { action: 'LOG_RESULT', data: inputData };

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * Add items to watchlist
   */
  private async addToWatchlist(
    data: any,
    params: any,
    context: ExecutionContext
  ): Promise<any> {
    const inputData = Array.isArray(data) ? data : [data];

    if (inputData.length === 0) {
      console.log(`      ✓ No items to add to watchlist`);
      return { action: 'ADD_TO_WATCHLIST', count: 0, items: [] };
    }

    const items: any[] = [];

    for (const item of inputData) {
      // Determine item type
      const itemType = item.wallet_address ? 'WALLET'
                     : item.market_id ? 'MARKET'
                     : 'CATEGORY';

      const itemId = item.wallet_address || item.market_id || item.category;

      if (!itemId) {
        console.warn(`      ⚠ Skipping item without valid ID:`, item);
        continue;
      }

      // Determine confidence
      let confidence = 'LOW';
      if (itemType === 'WALLET' && item.omega_ratio) {
        if (item.omega_ratio > 2) confidence = 'HIGH';
        else if (item.omega_ratio > 1.5) confidence = 'MEDIUM';
      } else if (itemType === 'MARKET' && item.sii) {
        if (item.sii > 0.7) confidence = 'HIGH';
        else if (item.sii > 0.5) confidence = 'MEDIUM';
      }

      // Build signal reason
      const filters = [];
      if (item.omega_ratio) filters.push(`omega_ratio: ${item.omega_ratio.toFixed(2)}`);
      if (item.win_rate) filters.push(`win_rate: ${(item.win_rate * 100).toFixed(1)}%`);
      if (item.net_pnl) filters.push(`net_pnl: $${item.net_pnl.toFixed(2)}`);
      if (item.sii) filters.push(`sii: ${item.sii.toFixed(2)}`);
      if (item.volume_24h) filters.push(`volume_24h: $${item.volume_24h.toFixed(0)}`);
      const signalReason = filters.length > 0 ? filters.join(', ') : 'Matched strategy criteria';

      // Insert
      try {
        const { data: inserted, error } = await this.supabase
          .from('strategy_watchlist_items')
          .insert({
            strategy_id: context.strategyId,
            execution_id: context.executionId,
            item_type: itemType,
            item_id: itemId,
            item_data: item,
            signal_reason: signalReason,
            confidence: confidence,
            status: 'WATCHING',
          } as any)
          .select()
          .single();

        if (!error && inserted) {
          items.push(inserted);
        } else if (error) {
          console.error(`      ❌ Failed to insert watchlist item:`, error.message);
        }
      } catch (error) {
        console.error(`      ❌ Error inserting watchlist item:`, error);
      }
    }

    console.log(`      ✓ Added ${items.length} items to watchlist`);
    return { action: 'ADD_TO_WATCHLIST', count: items.length, items };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Build execution order using topological sort
   */
  private buildExecutionOrder(graph: NodeGraph): string[] {
    const visited = new Set<string>();
    const order: string[] = [];

    const visit = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      // Visit dependencies first
      const dependencies = graph.edges
        .filter(e => e.to === nodeId)
        .map(e => e.from);

      dependencies.forEach(visit);

      order.push(nodeId);
    };

    graph.nodes.forEach(node => visit(node.id));

    return order;
  }

  /**
   * Get input data for a node
   */
  private getInputData(nodeId: string, previousResults: Record<string, NodeResult>): any {
    if (!this.currentGraph) {
      return [];
    }

    // Find nodes connected to this node
    const inputIds = this.currentGraph.edges
      .filter(e => e.to === nodeId)
      .map(e => e.from);

    if (inputIds.length === 0) {
      return [];
    }

    // For single input, return data directly
    if (inputIds.length === 1) {
      const inputResult = previousResults[inputIds[0]];
      return inputResult?.data || [];
    }

    // For multiple inputs, return array of data
    return inputIds.map(id => previousResults[id]?.data || []);
  }

  /**
   * Get field value from object (supports dot notation)
   */
  private getFieldValue(item: any, field: string): any {
    const parts = field.split('.');
    let value = item;

    for (const part of parts) {
      value = value?.[part];
    }

    return value;
  }

  /**
   * Apply filter operator
   */
  private applyOperator(fieldValue: any, operator: string, value: any): boolean {
    switch (operator) {
      case 'EQUALS':
        return fieldValue === value;
      case 'NOT_EQUALS':
        return fieldValue !== value;
      case 'GREATER_THAN':
        return fieldValue > value;
      case 'GREATER_THAN_OR_EQUAL':
        return fieldValue >= value;
      case 'LESS_THAN':
        return fieldValue < value;
      case 'LESS_THAN_OR_EQUAL':
        return fieldValue <= value;
      case 'IN':
        return Array.isArray(value) && value.includes(fieldValue);
      case 'NOT_IN':
        return Array.isArray(value) && !value.includes(fieldValue);
      case 'CONTAINS':
        return String(fieldValue).includes(String(value));
      case 'BETWEEN':
        return Array.isArray(value) && fieldValue >= value[0] && fieldValue <= value[1];
      case 'IS_NULL':
        return fieldValue === null || fieldValue === undefined;
      case 'IS_NOT_NULL':
        return fieldValue !== null && fieldValue !== undefined;
      default:
        throw new Error(`Unknown operator: ${operator}`);
    }
  }

  /**
   * Array intersection (AND)
   */
  private intersectArrays(arrays: any[][]): any[] {
    if (arrays.length === 0) return [];
    if (arrays.length === 1) return arrays[0];

    // Find items present in ALL arrays (by wallet_address)
    const first = arrays[0];
    return first.filter(item =>
      arrays.slice(1).every(arr =>
        arr.some(a => a.wallet_address === item.wallet_address)
      )
    );
  }

  /**
   * Array union (OR)
   */
  private unionArrays(arrays: any[][]): any[] {
    const seen = new Set<string>();
    const result: any[] = [];

    for (const arr of arrays) {
      for (const item of arr) {
        const key = item.wallet_address || JSON.stringify(item);
        if (!seen.has(key)) {
          seen.add(key);
          result.push(item);
        }
      }
    }

    return result;
  }

  /**
   * Array XOR (exclusive or)
   */
  private xorArrays(arrays: any[][]): any[] {
    const counts = new Map<string, { item: any; count: number }>();

    for (const arr of arrays) {
      for (const item of arr) {
        const key = item.wallet_address || JSON.stringify(item);
        const existing = counts.get(key);
        if (existing) {
          existing.count++;
        } else {
          counts.set(key, { item, count: 1 });
        }
      }
    }

    // Return items that appear exactly once
    return Array.from(counts.values())
      .filter(({ count }) => count === 1)
      .map(({ item }) => item);
  }

  /**
   * Group by fields
   */
  private groupBy(data: any[], fields: string[]): Record<string, any[]> {
    const groups: Record<string, any[]> = {};

    data.forEach(item => {
      const key = fields.map(f => this.getFieldValue(item, f)).join('|');

      if (!groups[key]) {
        groups[key] = [];
      }

      groups[key].push(item);
    });

    return groups;
  }

  /**
   * Calculate aggregation
   */
  private calculateAggregation(
    data: any[],
    func: string,
    field?: string,
    percentile?: number
  ): number {
    if (data.length === 0) return 0;

    switch (func) {
      case 'COUNT':
        return data.length;

      case 'SUM': {
        if (!field) throw new Error('SUM requires field');
        return data.reduce((sum, item) => sum + (this.getFieldValue(item, field) || 0), 0);
      }

      case 'AVG': {
        if (!field) throw new Error('AVG requires field');
        const sum = data.reduce((s, item) => s + (this.getFieldValue(item, field) || 0), 0);
        return sum / data.length;
      }

      case 'MIN': {
        if (!field) throw new Error('MIN requires field');
        return Math.min(...data.map(item => this.getFieldValue(item, field) || Infinity));
      }

      case 'MAX': {
        if (!field) throw new Error('MAX requires field');
        return Math.max(...data.map(item => this.getFieldValue(item, field) || -Infinity));
      }

      case 'PERCENTILE': {
        if (!field || !percentile) throw new Error('PERCENTILE requires field and percentile');
        const sorted = data
          .map(item => this.getFieldValue(item, field) || 0)
          .sort((a, b) => a - b);
        const index = Math.ceil((percentile / 100) * sorted.length) - 1;
        return sorted[index];
      }

      default:
        throw new Error(`Unknown aggregation function: ${func}`);
    }
  }

  /**
   * Collect aggregation results
   */
  private collectAggregations(results: Record<string, NodeResult>): Record<string, any> {
    const aggregations: Record<string, any> = {};

    Object.entries(results).forEach(([nodeId, result]) => {
      if (nodeId.includes('agg_') || nodeId.includes('sort_') || typeof result.data === 'number') {
        aggregations[nodeId] = result.data;
      }
    });

    return aggregations;
  }

  /**
   * Collect signals
   */
  private collectSignals(results: Record<string, NodeResult>): any[] {
    const signals: any[] = [];

    Object.values(results).forEach(result => {
      if (result.data && typeof result.data === 'object' && 'signalType' in result.data) {
        signals.push(result.data);
      }
    });

    return signals;
  }

  /**
   * Execute actions
   */
  private async executeActions(
    results: Record<string, NodeResult>,
    context: ExecutionContext
  ): Promise<any[]> {
    const actions: any[] = [];

    for (const [nodeId, result] of Object.entries(results)) {
      if (nodeId.startsWith('action_') || (result.data && result.data.action)) {
        actions.push(result.data);
      }
    }

    return actions;
  }

  /**
   * Save execution record to database
   */
  private async saveExecutionRecord(
    context: ExecutionContext,
    results: Record<string, NodeResult>,
    metadata: any
  ): Promise<void> {
    try {
      await this.supabase.from('strategy_executions').insert({
        execution_id: context.executionId,
        strategy_id: context.strategyId,
        executed_at: new Date().toISOString(),
        execution_mode: context.mode,
        triggered_by: context.userId,
        results: {
          nodes: results,
          ...metadata
        },
        execution_time_ms: metadata.dataPointsProcessed
          ? Object.values(results).reduce((sum, r) => sum + r.executionTimeMs, 0)
          : 0,
        nodes_evaluated: Object.keys(results).length,
        data_points_processed: metadata.dataPointsProcessed || 0,
        status: metadata.status || 'SUCCESS',
        error_message: metadata.errorMessage
      } as any);
    } catch (error) {
      console.error('Failed to save execution record:', error);
    }
  }
}

// Export singleton
export const strategyEngine = new StrategyExecutionEngine();
