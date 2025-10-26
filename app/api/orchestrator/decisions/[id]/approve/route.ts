/**
 * Orchestrator Decision Approval API
 * POST /api/orchestrator/decisions/[id]/approve
 *
 * Approves a pending orchestrator decision and triggers trade execution.
 * User can optionally adjust the position size before approving.
 *
 * Task Group 12: Database and API Foundation (stub trade execution)
 * Later task groups will implement actual trade execution via Polymarket API
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

interface ApproveRequest {
  adjusted_size?: number; // Optional size adjustment
  override_reason?: string; // Optional reason for adjustment
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: decisionId } = await params;
    const body: ApproveRequest = await request.json().catch(() => ({}));

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
          message: `Decision status is '${existingDecision.status}', cannot approve`,
        },
        { status: 400 }
      );
    }

    // Determine actual size and override status
    const hasAdjustment = body.adjusted_size !== undefined && body.adjusted_size !== existingDecision.recommended_size;
    const actual_size = body.adjusted_size ?? existingDecision.recommended_size;
    const user_override = hasAdjustment;

    // Validate adjusted size if provided
    if (body.adjusted_size !== undefined) {
      if (body.adjusted_size < 0) {
        return NextResponse.json(
          {
            error: 'Invalid size adjustment',
            message: 'adjusted_size must be non-negative',
          },
          { status: 400 }
        );
      }

      // Check against available cash in portfolio snapshot
      const portfolioSnapshot = existingDecision.portfolio_snapshot as any;
      if (body.adjusted_size > portfolioSnapshot.bankroll_free_cash_usd) {
        return NextResponse.json(
          {
            error: 'Insufficient funds',
            message: `Adjusted size ($${body.adjusted_size}) exceeds available cash ($${portfolioSnapshot.bankroll_free_cash_usd})`,
          },
          { status: 400 }
        );
      }
    }

    // Generate override reason if not provided
    let override_reason = body.override_reason;
    if (user_override && !override_reason) {
      override_reason = `User adjusted size from $${existingDecision.recommended_size} to $${actual_size}`;
    }

    // Update decision status to approved
    const { data: updatedDecision, error: updateError } = await supabase
      .from('orchestrator_decisions')
      .update({
        status: 'approved',
        actual_size,
        user_override,
        override_reason,
        decided_at: new Date().toISOString(),
      })
      .eq('id', decisionId)
      .select()
      .single();

    if (updateError) {
      console.error('Failed to update decision:', updateError);
      throw updateError;
    }

    // Stub: Log trade execution intent
    // In later task groups, this will call Polymarket API to execute the trade
    const tradeIntent = {
      market_id: existingDecision.market_id,
      direction: existingDecision.direction,
      size: actual_size,
      execution_type: 'MARKET', // Could be MARKET or LIMIT
      status: 'PENDING_EXECUTION',
    };

    console.log('[ORCHESTRATOR] Trade execution intent logged:', tradeIntent);
    console.log(`[ORCHESTRATOR] Would execute: ${existingDecision.decision} ${existingDecision.direction} for $${actual_size} on market ${existingDecision.market_id}`);

    // TODO (Task Group 13+): Integrate with Polymarket API
    // - Call Polymarket order placement API
    // - Handle order confirmation
    // - Update position tracking
    // - Create trade record in database

    return NextResponse.json({
      success: true,
      decision: updatedDecision,
      trade_intent: {
        ...tradeIntent,
        message: 'Trade execution logged (stub - full execution in later task)',
      },
      message: 'Decision approved successfully',
    });

  } catch (error) {
    console.error('Orchestrator approve API error:', error);
    return NextResponse.json(
      {
        error: 'Failed to approve decision',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
