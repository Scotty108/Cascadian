/**
 * Orchestrator Decision History API
 * GET /api/orchestrator/decisions
 *
 * Retrieves decision history with filtering and pagination.
 * Users can filter by workflow, status, and paginate results.
 *
 * Task Group 12: Database and API Foundation
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const workflow_id = searchParams.get('workflow_id');
    const status = searchParams.get('status'); // 'pending', 'approved', 'rejected', 'executed'
    const created_after = searchParams.get('created_after');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    if (limit < 1 || limit > 100) {
      return NextResponse.json(
        {
          error: 'Invalid limit',
          message: 'limit must be between 1 and 100',
        },
        { status: 400 }
      );
    }

    if (offset < 0) {
      return NextResponse.json(
        {
          error: 'Invalid offset',
          message: 'offset must be non-negative',
        },
        { status: 400 }
      );
    }

    if (status && !['pending', 'approved', 'rejected', 'executed'].includes(status)) {
      return NextResponse.json(
        {
          error: 'Invalid status',
          message: 'status must be one of: pending, approved, rejected, executed',
        },
        { status: 400 }
      );
    }

    // Create Supabase client
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Build query
    let query = supabase
      .from('orchestrator_decisions')
      .select('*', { count: 'exact' });

    // Apply workflow filter if provided
    if (workflow_id) {
      query = query.eq('workflow_id', workflow_id);
    }

    // Apply status filter if provided
    if (status) {
      query = query.eq('status', status);
    }

    // Apply date filter if provided
    if (created_after) {
      query = query.gte('created_at', created_after);
    }

    // Apply ordering and pagination
    const { data: decisions, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Failed to fetch decisions:', error);
      throw error;
    }

    // Calculate pagination metadata
    const total = count ?? 0;
    const has_more = offset + limit < total;

    // Calculate summary stats if workflow_id is provided
    let summary = null;
    if (workflow_id) {
      const { data: allDecisions } = await supabase
        .from('orchestrator_decisions')
        .select('status, recommended_size, final_size')
        .eq('workflow_id', workflow_id);

      if (allDecisions) {
        const totalDecisions = allDecisions.length;
        const approvedCount = allDecisions.filter(d => d.status === 'approved' || d.status === 'executed').length;
        const pendingCount = allDecisions.filter(d => d.status === 'pending').length;
        const avgSize = allDecisions.length > 0
          ? allDecisions.reduce((sum, d) => sum + (d.final_size || d.recommended_size), 0) / allDecisions.length
          : 0;

        summary = {
          total: totalDecisions,
          approved: approvedCount,
          pending: pendingCount,
          avg_position_size: avgSize,
        };
      }
    }

    return NextResponse.json({
      success: true,
      decisions: decisions || [],
      summary,
      pagination: {
        total,
        limit,
        offset,
        has_more,
        next_offset: has_more ? offset + limit : null,
      },
    });

  } catch (error) {
    console.error('Orchestrator decisions API error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch decisions',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
