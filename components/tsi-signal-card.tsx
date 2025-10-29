/**
 * TSI Signal Card Component
 *
 * Displays TSI (True Strength Index) momentum signal with conviction score
 * Shows BULLISH/BEARISH/NEUTRAL signals and "Entry Signal" badge for high conviction
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
// import { GlowBorder } from "@/components/ui/glow-border" // COMMENTED OUT
import { useMarketTSI } from "@/hooks/use-market-tsi"
import { TrendingUp, TrendingDown, Minus, Activity } from "lucide-react"

interface TSISignalCardProps {
  marketId: string
  marketTitle?: string
  showLiveIndicator?: boolean
  compact?: boolean
}

export function TSISignalCard({
  marketId,
  marketTitle,
  showLiveIndicator = true,
  compact = false
}: TSISignalCardProps) {
  const { data: tsi, isLoading } = useMarketTSI({ marketId })

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">TSI Signal</CardTitle>
          {marketTitle && <CardDescription>{marketTitle}</CardDescription>}
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-24">
            <div className="animate-pulse text-sm text-muted-foreground">Loading signal...</div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!tsi) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">TSI Signal</CardTitle>
          {marketTitle && <CardDescription>{marketTitle}</CardDescription>}
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-24">
            <div className="text-sm text-muted-foreground">No signal data available</div>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Signal colors and icons
  const signalConfig = {
    BULLISH: {
      color: 'bg-green-500 hover:bg-green-600 text-white border-green-500',
      textColor: 'text-green-500',
      icon: <TrendingUp className="h-8 w-8" />,
      label: 'BULLISH',
      direction: 'UP'
    },
    BEARISH: {
      color: 'bg-red-500 hover:bg-red-600 text-white border-red-500',
      textColor: 'text-red-500',
      icon: <TrendingDown className="h-8 w-8" />,
      label: 'BEARISH',
      direction: 'DOWN'
    },
    NEUTRAL: {
      color: 'bg-gray-500 hover:bg-gray-600 text-white border-gray-500',
      textColor: 'text-muted-foreground',
      icon: <Minus className="h-8 w-8" />,
      label: 'NEUTRAL',
      direction: 'SIDEWAYS'
    }
  }

  const currentSignal = signalConfig[tsi.crossover_signal]

  // Conviction color coding
  const getConvictionColor = (conviction: number) => {
    if (conviction >= 0.9) return 'text-green-600 font-bold'
    if (conviction >= 0.7) return 'text-yellow-600 font-semibold'
    if (conviction >= 0.5) return 'text-orange-500'
    return 'text-red-500'
  }

  // Signal strength badge
  const strengthColors = {
    STRONG: 'bg-green-500 hover:bg-green-600 text-white',
    MODERATE: 'bg-yellow-500 hover:bg-yellow-600 text-black',
    WEAK: 'bg-gray-500 hover:bg-gray-600 text-white'
  }

  // Apply glow border for high conviction signals
  // const shouldGlow = tsi.meets_entry_threshold || tsi.directional_conviction >= 0.8; // COMMENTED OUT

  const cardContent = (
    <Card className="relative shadow-none border-border/60">
      {/* Live indicator */}
      {showLiveIndicator && (
        <div className="absolute top-4 right-4 flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs text-muted-foreground">LIVE</span>
        </div>
      )}

      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Activity className="h-5 w-5 text-blue-500" />
          TSI Momentum Signal
        </CardTitle>
        {marketTitle && <CardDescription className="mt-1">{marketTitle}</CardDescription>}
      </CardHeader>

      <CardContent className={compact ? "space-y-3" : "space-y-4"}>
        {/* Main Signal Display */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={currentSignal.textColor}>
              {currentSignal.icon}
            </div>
            <div>
              <Badge className={`${currentSignal.color} font-bold text-sm px-3 py-1`}>
                {currentSignal.label}
              </Badge>
              <p className="text-xs text-muted-foreground mt-1">
                {currentSignal.direction}
              </p>
            </div>
          </div>

          {/* Entry Signal Badge */}
          {tsi.meets_entry_threshold && (
            <Badge className="bg-purple-500 hover:bg-purple-600 text-white font-bold animate-pulse">
              🎯 ENTRY SIGNAL
            </Badge>
          )}
        </div>

        {/* Conviction Score */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Conviction Score</span>
            <span className={`text-lg font-bold ${getConvictionColor(tsi.directional_conviction)}`}>
              {(tsi.directional_conviction * 100).toFixed(1)}%
            </span>
          </div>

          {/* Conviction Progress Bar */}
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all duration-300 ${
                tsi.directional_conviction >= 0.9
                  ? 'bg-green-500'
                  : tsi.directional_conviction >= 0.7
                  ? 'bg-yellow-500'
                  : 'bg-orange-500'
              }`}
              style={{ width: `${tsi.directional_conviction * 100}%` }}
            />
          </div>
        </div>

        {/* Breakdown (if not compact) */}
        {!compact && (
          <div className="grid grid-cols-3 gap-2 pt-2 border-t">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Elite</p>
              <p className="text-sm font-semibold">
                {(tsi.elite_consensus_pct * 100).toFixed(0)}%
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Specialists</p>
              <p className="text-sm font-semibold">
                {(tsi.category_specialist_pct * 100).toFixed(0)}%
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Ω-Weighted</p>
              <p className="text-sm font-semibold">
                {(tsi.omega_weighted_consensus * 100).toFixed(0)}%
              </p>
            </div>
          </div>
        )}

        {/* TSI Values */}
        <div className="flex items-center justify-between pt-2 border-t text-xs">
          <div>
            <span className="text-muted-foreground">Fast: </span>
            <span className="font-mono font-semibold">{tsi.tsi_fast.toFixed(2)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Slow: </span>
            <span className="font-mono font-semibold">{tsi.tsi_slow.toFixed(2)}</span>
          </div>
          <Badge className={strengthColors[tsi.signal_strength]} variant="outline">
            {tsi.signal_strength}
          </Badge>
        </div>

        {/* Crossover timestamp */}
        {tsi.crossover_timestamp && (
          <p className="text-xs text-muted-foreground text-center pt-1">
            Signal fired {new Date(tsi.crossover_timestamp).toLocaleString()}
          </p>
        )}
      </CardContent>
    </Card>
  );

  // Wrap in glow border if high conviction
  // if (shouldGlow) {
  //   return (
  //     <GlowBorder
  //       color="purple"
  //       intensity="strong"
  //       speed="medium"
  //     >
  //       {cardContent}
  //     </GlowBorder>
  //   );
  // }

  return cardContent;
}
