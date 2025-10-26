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
      .from('strategy_performance_snapshots')
      .select('*')
      .eq('strategy_id', id)
      .order('snapshot_timestamp', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ performance: data || [] });
  } catch (error) {
    console.error('Failed to fetch performance:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch performance',
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
