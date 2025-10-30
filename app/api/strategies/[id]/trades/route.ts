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

    // Query from paper_trades table (paper trading system)
    const { data, error } = await supabase
      .from('paper_trades')
      .select('*')
      .eq('strategy_id', id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Transform to expected format
    const trades = (data || []).map((trade: any) => ({
      id: trade.trade_id,
      strategy_id: trade.strategy_id,
      market_id: trade.market_id,
      market_question: trade.market_question,
      side: trade.side,
      action: trade.action,
      entry_price: trade.entry_price,
      entry_shares: trade.entry_shares,
      entry_notional_usd: trade.entry_notional_usd,
      exit_price: trade.exit_price,
      exit_shares: trade.exit_shares,
      exit_notional_usd: trade.exit_notional_usd,
      realized_pnl_usd: trade.realized_pnl_usd,
      unrealized_pnl_usd: trade.unrealized_pnl_usd,
      status: trade.status,
      executed_at: trade.entry_date,
      created_at: trade.created_at,
    }));

    return NextResponse.json({ trades });
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
