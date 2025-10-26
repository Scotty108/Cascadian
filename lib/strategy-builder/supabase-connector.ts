/**
 * Supabase Connector
 * Fast queries for basic metrics from wallet_scores tables
 * Used when strategies only need simple metrics (omega, pnl, win_rate)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { QueryFilter, QueryOptions, DataSourceResult } from './types';

export class SupabaseConnector {
  private client: SupabaseClient;

  constructor() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase credentials in environment variables');
    }

    this.client = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Query wallet_scores table (basic metrics, fast)
   */
  async queryWalletScores(options: QueryOptions = {}): Promise<DataSourceResult> {
    const startTime = Date.now();

    try {
      let query = this.client
        .from('wallet_scores')
        .select('*', { count: 'exact' });

      // Apply filters
      query = this.applyFilters(query, options.filters || []);

      // Apply sorting
      if (options.orderBy) {
        query = query.order(options.orderBy.field, {
          ascending: options.orderBy.direction === 'ASC'
        });
      }

      // Apply pagination
      if (options.limit) {
        query = query.limit(options.limit);
      }
      if (options.offset) {
        query = query.range(options.offset, options.offset + (options.limit || 100) - 1);
      }

      const { data, error, count } = await query;

      if (error) {
        throw new Error(`Supabase query failed: ${error.message}`);
      }

      return {
        data: data || [],
        totalCount: count || 0,
        executionTimeMs: Date.now() - startTime,
        source: 'supabase'
      };
    } catch (error) {
      throw new Error(
        `Supabase wallet_scores query failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Query wallet_scores_by_category table (category specialists)
   */
  async queryWalletScoresByCategory(
    category: string,
    options: QueryOptions = {}
  ): Promise<DataSourceResult> {
    const startTime = Date.now();

    try {
      let query = this.client
        .from('wallet_scores_by_category')
        .select('*', { count: 'exact' })
        .eq('category', category);

      // Apply filters
      query = this.applyFilters(query, options.filters || []);

      // Apply sorting
      if (options.orderBy) {
        query = query.order(options.orderBy.field, {
          ascending: options.orderBy.direction === 'ASC'
        });
      }

      // Apply pagination
      if (options.limit) {
        query = query.limit(options.limit);
      }
      if (options.offset) {
        query = query.range(options.offset, options.offset + (options.limit || 100) - 1);
      }

      const { data, error, count } = await query;

      if (error) {
        throw new Error(`Supabase query failed: ${error.message}`);
      }

      return {
        data: data || [],
        totalCount: count || 0,
        executionTimeMs: Date.now() - startTime,
        source: 'supabase'
      };
    } catch (error) {
      throw new Error(
        `Supabase wallet_scores_by_category query failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Query markets table
   */
  async queryMarkets(options: QueryOptions = {}): Promise<DataSourceResult> {
    const startTime = Date.now();

    try {
      let query = this.client
        .from('markets')
        .select('*', { count: 'exact' });

      // Apply filters
      query = this.applyFilters(query, options.filters || []);

      // Apply sorting
      if (options.orderBy) {
        query = query.order(options.orderBy.field, {
          ascending: options.orderBy.direction === 'ASC'
        });
      }

      // Apply pagination
      if (options.limit) {
        query = query.limit(options.limit);
      }

      const { data, error, count } = await query;

      if (error) {
        throw new Error(`Supabase query failed: ${error.message}`);
      }

      return {
        data: data || [],
        totalCount: count || 0,
        executionTimeMs: Date.now() - startTime,
        source: 'supabase'
      };
    } catch (error) {
      throw new Error(
        `Supabase markets query failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Apply filters to Supabase query
   */
  private applyFilters(query: any, filters: QueryFilter[]): any {
    for (const filter of filters) {
      switch (filter.operator) {
        case 'EQUALS':
          query = query.eq(filter.field, filter.value);
          break;

        case 'NOT_EQUALS':
          query = query.neq(filter.field, filter.value);
          break;

        case 'GREATER_THAN':
          query = query.gt(filter.field, filter.value);
          break;

        case 'GREATER_THAN_OR_EQUAL':
          query = query.gte(filter.field, filter.value);
          break;

        case 'LESS_THAN':
          query = query.lt(filter.field, filter.value);
          break;

        case 'LESS_THAN_OR_EQUAL':
          query = query.lte(filter.field, filter.value);
          break;

        case 'IN':
          query = query.in(filter.field, filter.value);
          break;

        case 'NOT_IN':
          query = query.not(filter.field, 'in', filter.value);
          break;

        case 'CONTAINS':
          query = query.ilike(filter.field, `%${filter.value}%`);
          break;

        case 'IS_NULL':
          query = query.is(filter.field, null);
          break;

        case 'IS_NOT_NULL':
          query = query.not(filter.field, 'is', null);
          break;

        case 'BETWEEN':
          if (Array.isArray(filter.value) && filter.value.length === 2) {
            query = query.gte(filter.field, filter.value[0]).lte(filter.field, filter.value[1]);
          }
          break;

        default:
          console.warn(`Unsupported filter operator: ${filter.operator}`);
      }
    }

    return query;
  }

  /**
   * Get metrics availability from wallet_scores
   */
  async getAvailableMetrics(): Promise<string[]> {
    // Return fields available in wallet_scores table
    return [
      'wallet_address',
      'omega_ratio',
      'omega_momentum',
      'closed_positions',
      'total_positions',
      'total_pnl',
      'total_gains',
      'total_losses',
      'win_rate',
      'avg_gain',
      'avg_loss',
      'grade',
      'momentum_direction',
      'meets_minimum_trades',
      'calculated_at',
      'updated_at'
    ];
  }

  /**
   * Get category metrics availability
   */
  async getCategoryMetrics(): Promise<string[]> {
    // Return fields available in wallet_scores_by_category
    return [
      'wallet_address',
      'category',
      'omega_ratio',
      'omega_momentum',
      'closed_positions',
      'total_positions',
      'total_pnl',
      'total_gains',
      'total_losses',
      'win_rate',
      'avg_gain',
      'avg_loss',
      'roi_per_bet',
      'overall_roi',
      'grade',
      'momentum_direction',
      'meets_minimum_trades'
    ];
  }
}

// Singleton instance
export const supabaseConnector = new SupabaseConnector();
