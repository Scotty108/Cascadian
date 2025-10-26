/**
 * Orchestrator Single Decision API
 * GET /api/orchestrator/decisions/[id]
 *
 * Retrieves a single decision by ID.
 *
 * Task Group 15: Approval Workflow and Decision History
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    if (!id) {
      return NextResponse.json(
        {
          error: 'Missing decision ID',
          message: 'Decision ID is required',
        },
        { status: 400 }
      );
    }

    // Create Supabase client
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Fetch decision
    const { data: decision, error } = await supabase
      .from('orchestrator_decisions')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          {
            error: 'Decision not found',
            message: `No decision found with ID: ${id}`,
          },
          { status: 404 }
        );
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      decision,
    });

  } catch (error) {
    console.error('Orchestrator decision API error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch decision',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
