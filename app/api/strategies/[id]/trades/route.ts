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
      .from('strategy_trades')
      .select('*')
      .eq('strategy_id', id)
      .order('executed_at', { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ trades: data || [] });
  } catch (error) {
    console.error('Failed to fetch trades:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch trades',
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
