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

    // Get open and recently closed positions
    const { data, error } = await supabase
      .from('strategy_positions')
      .select('*')
      .eq('strategy_id', id)
      .or('status.eq.OPEN,status.eq.CLOSED')
      .order('entry_timestamp', { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Separate open and closed
    const open = (data || []).filter(p => p.status === 'OPEN');
    const closed = (data || []).filter(p => p.status === 'CLOSED');

    return NextResponse.json({ positions: { open, closed } });
  } catch (error) {
    console.error('Failed to fetch positions:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch positions',
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

// POST to manually create position
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      market_id,
      market_title,
      market_slug,
      outcome,
      entry_shares,
      entry_price,
      category,
    } = body;

    if (!market_id || !outcome || !entry_shares || !entry_price) {
      return NextResponse.json(
        { error: 'Missing required fields: market_id, outcome, entry_shares, entry_price' },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: position, error } = await supabase
      .from('strategy_positions')
      .insert({
        strategy_id: id,
        market_id,
        market_title,
        market_slug,
        outcome,
        entry_shares,
        entry_price,
        current_price: entry_price,
        entry_timestamp: new Date().toISOString(),
        category,
        status: 'OPEN',
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, position });
  } catch (error) {
    console.error('Failed to create position:', error);
    return NextResponse.json(
      {
        error: 'Failed to create position',
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
