/**
 * Strategy Deployment API
 * POST /api/strategies/[id]/deploy - Create deployment record
 * GET /api/strategies/[id]/deploy - Get deployment history
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: strategyId } = await params;
    const body = await request.json();

    const {
      deployment_type,
      node_graph,
      trading_mode,
      paper_bankroll_usd,
      execution_mode,
      schedule_cron,
      changes_summary,
      changed_nodes,
    } = body;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Use the helper function to create deployment record
    const { data, error } = await supabase.rpc('deploy_strategy', {
      p_strategy_id: strategyId,
      p_deployment_type: deployment_type || 'initial',
      p_node_graph: node_graph,
      p_trading_mode: trading_mode,
      p_paper_bankroll_usd: paper_bankroll_usd,
      p_execution_mode: execution_mode,
      p_schedule_cron: schedule_cron,
      p_changes_summary: changes_summary,
      p_changed_nodes: changed_nodes,
    });

    if (error) {
      console.error('Deployment error:', error);
      throw error;
    }

    return NextResponse.json({
      success: true,
      deployment_id: data,
      message: 'Strategy deployed successfully',
    });
  } catch (error) {
    console.error('Failed to create deployment:', error);
    return NextResponse.json(
      {
        error: 'Failed to create deployment',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: strategyId } = await params;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Fetch deployment history
    const { data: deployments, error } = await supabase
      .from('strategy_deployments')
      .select('*')
      .eq('strategy_id', strategyId)
      .order('deployed_at', { ascending: false });

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      deployments: deployments || [],
    });
  } catch (error) {
    console.error('Failed to fetch deployment history:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch deployment history',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
