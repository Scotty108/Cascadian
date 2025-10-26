/**
 * Strategy Management API
 * GET /api/strategies - List all strategies
 * POST /api/strategies - Create new strategy
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: strategies, error } = await supabase
      .from('strategy_definitions')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      strategies: strategies || [],
    });
  } catch (error) {
    console.error('Failed to fetch strategies:', error);
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
      execution_mode,
      schedule_cron,
      is_active,
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
        node_graph,
        execution_mode: execution_mode || 'MANUAL',
        schedule_cron: schedule_cron || null,
        is_active: is_active !== undefined ? is_active : true,
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
