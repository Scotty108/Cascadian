/**
 * Orchestrator Decision Rejection API
 * POST /api/orchestrator/decisions/[id]/reject
 *
 * Rejects a pending orchestrator decision. No trade is executed.
 * User can optionally provide a reason for rejection.
 *
 * Task Group 12: Database and API Foundation
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

interface RejectRequest {
  rejection_reason?: string; // Optional reason for rejection
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const decisionId = params.id;
    const body: RejectRequest = await request.json().catch(() => ({}));

    // Create Supabase client
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Fetch existing decision
    const { data: existingDecision, error: fetchError } = await supabase
      .from('orchestrator_decisions')
      .select('*')
      .eq('id', decisionId)
      .single();

    if (fetchError || !existingDecision) {
      return NextResponse.json(
        {
          error: 'Decision not found',
          message: 'No decision found with the provided ID',
        },
        { status: 404 }
      );
    }

    // Validate decision is pending
    if (existingDecision.status !== 'pending') {
      return NextResponse.json(
        {
          error: 'Decision already processed',
          message: `Decision status is '${existingDecision.status}', cannot reject`,
        },
        { status: 400 }
      );
    }

    // Default rejection reason if not provided
    const override_reason = body.rejection_reason || 'User rejected the decision';

    // Update decision status to rejected
    const { data: updatedDecision, error: updateError } = await supabase
      .from('orchestrator_decisions')
      .update({
        status: 'rejected',
        override_reason,
        decided_at: new Date().toISOString(),
        // actual_size remains NULL (no trade executed)
      })
      .eq('id', decisionId)
      .select()
      .single();

    if (updateError) {
      console.error('Failed to update decision:', updateError);
      throw updateError;
    }

    console.log('[ORCHESTRATOR] Decision rejected:', {
      decision_id: decisionId,
      market_id: existingDecision.market_id,
      direction: existingDecision.direction,
      recommended_size: existingDecision.recommended_size,
      reason: override_reason,
    });

    return NextResponse.json({
      success: true,
      decision: updatedDecision,
      message: 'Decision rejected successfully. No trade executed.',
    });

  } catch (error) {
    console.error('Orchestrator reject API error:', error);
    return NextResponse.json(
      {
        error: 'Failed to reject decision',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
