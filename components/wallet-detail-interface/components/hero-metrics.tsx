import { MetricCard } from '@/components/ui/metric-card';
import { TrendingUp, Trophy, Target, Activity, DollarSign, BarChart3, Wallet as WalletIcon, Calendar } from 'lucide-react';

interface HeroMetricsProps {
  totalPnL: number;
  totalPnLPct: number;
  winRate: number;
  winningTrades: number;
  losingTrades: number;
  rankAll: number;
  totalTraders: number;
  activePositions: number;
  activeValue: number;
  unrealizedPnL: number;
  totalInvested: number;
  daysActive: number;
  sharpeRatio: number;
  sharpeLevel: string;
  avgTradeSize: number;
  totalTrades: number;
  marketsTraded: number;
  activeMarkets: number;
  pnlSparkline?: number[];
  winRateSparkline?: number[];
  volumeSparkline?: number[];
}

export function HeroMetrics({
  totalPnL,
  totalPnLPct,
  winRate,
  winningTrades,
  losingTrades,
  rankAll,
  totalTraders = 10000,
  activePositions,
  activeValue,
  unrealizedPnL,
  totalInvested,
  daysActive,
  sharpeRatio,
  sharpeLevel,
  avgTradeSize,
  totalTrades,
  marketsTraded,
  activeMarkets,
  pnlSparkline,
  winRateSparkline,
  volumeSparkline,
}: HeroMetricsProps) {
  const percentile = Math.round((1 - rankAll / totalTraders) * 100);
  const formatPnL = (value: number) => {
    const abs = Math.abs(value);
    if (abs >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
    if (abs >= 1000) return `$${(value / 1000).toFixed(1)}k`;
    return `$${value.toFixed(0)}`;
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {/* Total PnL */}
      <MetricCard
        label="Total PnL"
        value={formatPnL(totalPnL)}
        change={`${totalPnLPct >= 0 ? '+' : ''}${totalPnLPct.toFixed(1)}%`}
        changeType={totalPnL >= 0 ? 'positive' : 'negative'}
        icon={<TrendingUp className="h-4 w-4" />}
        sparklineData={pnlSparkline}
      />

      {/* Win Rate */}
      <MetricCard
        label="Win Rate"
        value={`${(winRate * 100).toFixed(1)}%`}
        change={`${winningTrades}W / ${losingTrades}L`}
        changeType={winRate >= 0.6 ? 'positive' : winRate >= 0.5 ? 'neutral' : 'negative'}
        icon={<Target className="h-4 w-4" />}
        sparklineData={winRateSparkline}
      />

      {/* Rank */}
      <MetricCard
        label="Rank (All Time)"
        value={`#${rankAll} / ${totalTraders.toLocaleString()}`}
        change={`Top ${percentile}%`}
        changeType={percentile <= 10 ? 'positive' : percentile <= 25 ? 'neutral' : 'negative'}
        icon={<Trophy className="h-4 w-4" />}
      />

      {/* Active Positions */}
      <MetricCard
        label="Active Positions"
        value={activePositions}
        change={`${formatPnL(activeValue)} total`}
        changeType={unrealizedPnL >= 0 ? 'positive' : 'negative'}
        icon={<Activity className="h-4 w-4" />}
      />

      {/* Total Invested */}
      <MetricCard
        label="Total Invested"
        value={formatPnL(totalInvested)}
        change={`${daysActive} days active`}
        changeType="neutral"
        icon={<DollarSign className="h-4 w-4" />}
      />

      {/* Sharpe Ratio */}
      <MetricCard
        label="Sharpe Ratio"
        value={sharpeRatio.toFixed(2)}
        change={sharpeLevel}
        changeType={
          sharpeRatio >= 2.0 ? 'positive' :
          sharpeRatio >= 1.5 ? 'neutral' : 'negative'
        }
        icon={<BarChart3 className="h-4 w-4" />}
      />

      {/* Avg Trade Size */}
      <MetricCard
        label="Avg Trade Size"
        value={formatPnL(avgTradeSize)}
        change={`${totalTrades} trades`}
        changeType="neutral"
        icon={<WalletIcon className="h-4 w-4" />}
        sparklineData={volumeSparkline}
      />

      {/* Markets Traded */}
      <MetricCard
        label="Markets Traded"
        value={marketsTraded}
        change={`${activeMarkets} active`}
        changeType="neutral"
        icon={<Calendar className="h-4 w-4" />}
      />
    </div>
  );
}
