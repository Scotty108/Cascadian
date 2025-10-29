/**
 * Strategy Management API
 * GET /api/strategies - List all strategies
 * POST /api/strategies - Create new strategy
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

/**
 * Helper to add timeout to promises
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Request timeout')), ms)
  );
  return Promise.race([promise, timeout]);
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Only select needed columns to reduce egress
    const query = supabase
      .from('strategy_definitions')
      .select('strategy_id, strategy_name, strategy_description, strategy_type, is_predefined, is_archived, execution_mode, is_active, trading_mode, paper_bankroll_usd, created_at, updated_at, node_graph')
      .order('updated_at', { ascending: false });

    // Execute with 30 second timeout
    const result: any = await withTimeout(
      Promise.resolve(query),
      30000
    );

    const { data: strategies, error } = result;

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      strategies: strategies || [],
    });
  } catch (error) {
    console.error('Failed to fetch strategies:', error);

    // Graceful timeout handling
    if (error instanceof Error && error.message === 'Request timeout') {
      return NextResponse.json({
        success: true,
        strategies: [],
        message: 'Database connection timeout - please try again',
      });
    }

    return NextResponse.json(
      {
        error: 'Failed to fetch strategies',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      strategy_name,
      strategy_description,
      strategy_type,
      node_graph,
      is_predefined,
      is_archived,
      execution_mode,
      schedule_cron,
      is_active,
      trading_mode,
      paper_bankroll_usd,
    } = body;

    if (!strategy_name || !node_graph) {
      return NextResponse.json(
        { error: 'strategy_name and node_graph are required' },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const strategy_id = crypto.randomUUID();

    const { data: strategy, error } = await supabase
      .from('strategy_definitions')
      .insert({
        strategy_id,
        strategy_name,
        strategy_description: strategy_description || null,
        strategy_type: strategy_type || 'CUSTOM',
        is_predefined: is_predefined || false,
        is_archived: is_archived || false,
        node_graph,
        execution_mode: execution_mode || 'MANUAL',
        schedule_cron: schedule_cron || null,
        is_active: is_active !== undefined ? is_active : true,
        trading_mode: trading_mode || 'paper',
        paper_bankroll_usd: paper_bankroll_usd || 10000,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      strategy_id,
      strategy,
    });
  } catch (error) {
    console.error('Failed to create strategy:', error);
    return NextResponse.json(
      {
        error: 'Failed to create strategy',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
