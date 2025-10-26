/**
 * Individual Strategy API
 * GET /api/strategies/[id] - Get strategy by ID
 * PUT /api/strategies/[id] - Update strategy
 * DELETE /api/strategies/[id] - Delete strategy
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: strategy, error } = await supabase
      .from('strategy_definitions')
      .select('*')
      .eq('strategy_id', id)
      .single();

    if (error || !strategy) {
      return NextResponse.json(
        { error: 'Strategy not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      strategy: {
        strategyId: strategy.strategy_id,
        strategyName: strategy.strategy_name,
        strategyDescription: strategy.strategy_description,
        strategyType: strategy.strategy_type,
        isPredefined: strategy.is_predefined,
        nodeGraph: strategy.node_graph,
        executionMode: strategy.execution_mode,
        scheduleCron: strategy.schedule_cron,
        isActive: strategy.is_active,
        createdBy: strategy.created_by,
        createdAt: new Date(strategy.created_at),
        updatedAt: new Date(strategy.updated_at),
      },
    });
  } catch (error) {
    console.error('Failed to fetch strategy:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch strategy',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      strategy_name,
      strategy_description,
      node_graph,
      execution_mode,
      schedule_cron,
      is_active,
    } = body;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (strategy_name !== undefined) updateData.strategy_name = strategy_name;
    if (strategy_description !== undefined) updateData.strategy_description = strategy_description;
    if (node_graph !== undefined) updateData.node_graph = node_graph;
    if (execution_mode !== undefined) updateData.execution_mode = execution_mode;
    if (schedule_cron !== undefined) updateData.schedule_cron = schedule_cron;
    if (is_active !== undefined) updateData.is_active = is_active;

    const { data: strategy, error } = await supabase
      .from('strategy_definitions')
      .update(updateData)
      .eq('strategy_id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      strategy,
    });
  } catch (error) {
    console.error('Failed to update strategy:', error);
    return NextResponse.json(
      {
        error: 'Failed to update strategy',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { error } = await supabase
      .from('strategy_definitions')
      .delete()
      .eq('strategy_id', id);

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      message: 'Strategy deleted successfully',
    });
  } catch (error) {
    console.error('Failed to delete strategy:', error);
    return NextResponse.json(
      {
        error: 'Failed to delete strategy',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
