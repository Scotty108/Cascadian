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

    const { data, error } = await supabase
      .from('strategy_watchlist_items')
      .select('*')
      .eq('strategy_id', id)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ watchlist: data || [] });
  } catch (error) {
    console.error('Failed to fetch watchlist:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch watchlist',
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

// DELETE to dismiss item
export async function DELETE(request: NextRequest) {
  try {
    const { watchlist_item_id } = await request.json();

    if (!watchlist_item_id) {
      return NextResponse.json(
        { error: 'watchlist_item_id is required' },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { error } = await supabase
      .from('strategy_watchlist_items')
      .update({ status: 'DISMISSED' })
      .eq('id', watchlist_item_id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to dismiss watchlist item:', error);
    return NextResponse.json(
      {
        error: 'Failed to dismiss watchlist item',
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
