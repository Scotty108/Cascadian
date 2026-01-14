"use client";

import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info, Shield, Bot, Copy, Brain, Zap, Clock, AlertTriangle } from "lucide-react";
import { WalletScore, formatCredibility, getCredibilityColor } from "@/hooks/use-wallet-wio";

interface WIOScoreCardHorizontalProps {
  score: WalletScore | null;
  isLoading?: boolean;
}

function SkeletonBar() {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="h-4 w-24 bg-muted/50 rounded animate-pulse" />
        <div className="h-4 w-10 bg-muted/50 rounded animate-pulse" />
      </div>
      <div className="h-2 w-full bg-muted/50 rounded animate-pulse" />
    </div>
  );
}

interface ScoreBarProps {
  label: string;
  value: number;
  maxValue?: number;
  tooltip: string;
  icon: React.ReactNode;
  colorClass?: string;
}

function ScoreBar({ label, value, maxValue = 1, tooltip, icon, colorClass }: ScoreBarProps) {
  const percentage = Math.min(100, (value / maxValue) * 100);
  const displayValue = (value * 100).toFixed(0);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5 text-muted-foreground cursor-help">
                {icon}
                <span>{label}</span>
                <Info className="h-3 w-3 text-muted-foreground/50" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-xs">
              <p className="text-sm">{tooltip}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <span className={`font-medium ${colorClass || 'text-foreground'}`}>
          {displayValue}%
        </span>
      </div>
      <Progress value={percentage} className="h-2" />
    </div>
  );
}

function SkeletonGauge() {
  return (
    <div className="relative" style={{ width: 150, height: 150 }}>
      <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          className="text-muted/20"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="h-10 w-16 bg-muted/50 rounded animate-pulse mb-1" />
        <div className="h-3 w-12 bg-muted/50 rounded animate-pulse" />
      </div>
    </div>
  );
}

function SkeletonSecondaryStats() {
  return (
    <div className="flex gap-4 text-center">
      <div>
        <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
          <Bot className="h-3 w-3" />
          <span className="text-xs">Bot Risk</span>
        </div>
        <div className="h-5 w-8 bg-muted/50 rounded animate-pulse mx-auto" />
      </div>
      <div>
        <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
          <Copy className="h-3 w-3" />
          <span className="text-xs">Copyability</span>
        </div>
        <div className="h-5 w-8 bg-muted/50 rounded animate-pulse mx-auto" />
      </div>
    </div>
  );
}

export function WIOScoreCardHorizontal({ score, isLoading }: WIOScoreCardHorizontalProps) {
  const getRingColor = (value: number) => {
    if (value >= 0.7) return 'stroke-green-500';
    if (value >= 0.5) return 'stroke-blue-500';
    if (value >= 0.3) return 'stroke-amber-500';
    return 'stroke-red-500';
  };

  // No score and not loading = empty state
  if (!score && !isLoading) {
    return (
      <Card className="p-6 border-border/50">
        <div className="text-center py-8 text-muted-foreground">
          <Shield className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No WIO score available for this wallet yet.</p>
        </div>
      </Card>
    );
  }

  const credibilityLabel = score ? formatCredibility(score.credibility_score) : '';
  const credibilityColor = score ? getCredibilityColor(score.credibility_score) : '';

  return (
    <Card className="p-6 border-border/50 overflow-hidden relative">
      <div className="absolute inset-0 bg-gradient-to-br from-[#00E0AA]/5 via-transparent to-[#3B82F6]/5 pointer-events-none" />

      <div className="relative z-10">
        {/* Header - Always visible */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Credibility Score</h2>
            <p className="text-xs text-muted-foreground">Should you follow this trader?</p>
          </div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Info className="h-4 w-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className="max-w-sm">
                <p>Combined score factoring skill, consistency, sample size, and risk management.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Horizontal Layout: Gauge Left, Bars Right */}
        <div className="grid grid-cols-2 gap-6">
          {/* Left: Gauge + Secondary Stats */}
          <div className="flex flex-col items-center justify-between" style={{ height: 280 }}>
            {/* Gauge container - smaller gauge centered */}
            <div className="relative flex items-center justify-center flex-1">
              {isLoading || !score ? (
                <SkeletonGauge />
              ) : (
                <div className="relative" style={{ width: 150, height: 150 }}>
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                    <circle
                      cx="50"
                      cy="50"
                      r="45"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="6"
                      className="text-muted/20"
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="45"
                      fill="none"
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeDasharray={`${score.credibility_score * 283} 283`}
                      className={getRingColor(score.credibility_score)}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className={`text-4xl font-bold ${credibilityColor}`}>
                      {(score.credibility_score * 100).toFixed(0)}
                    </span>
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">
                      {credibilityLabel}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Secondary Stats - anchored to bottom */}
            {isLoading || !score ? (
              <SkeletonSecondaryStats />
            ) : (
              <div className="flex gap-4 text-center">
                <div>
                  <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
                    <Bot className="h-3 w-3" />
                    <span className="text-xs">Bot Risk</span>
                  </div>
                  <span className={`text-sm font-semibold ${score.bot_likelihood > 0.5 ? 'text-red-500' : 'text-green-500'}`}>
                    {(score.bot_likelihood * 100).toFixed(0)}%
                  </span>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
                    <Copy className="h-3 w-3" />
                    <span className="text-xs">Copyability</span>
                  </div>
                  <span className={`text-sm font-semibold ${score.copyability_score >= 0.7 ? 'text-green-500' : score.copyability_score >= 0.4 ? 'text-amber-500' : 'text-muted-foreground'}`}>
                    {(score.copyability_score * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Right: Progress Bars */}
          <div className="space-y-2 min-w-0">
            {isLoading || !score ? (
              <>
                <SkeletonBar />
                <SkeletonBar />
                <SkeletonBar />
                <SkeletonBar />
                <SkeletonBar />
              </>
            ) : (
              <>
                <ScoreBar
                  label="Skill"
                  value={score.skill_component}
                  tooltip="Trading skill based on ROI and win rate."
                  icon={<Brain className="h-3 w-3" />}
                  colorClass={score.skill_component > 0.3 ? 'text-green-500' : undefined}
                />
                <ScoreBar
                  label="Consistency"
                  value={score.consistency_component}
                  tooltip="Profit factor (gains / losses)."
                  icon={<Zap className="h-3 w-3" />}
                  colorClass={score.consistency_component > 0.2 ? 'text-green-500' : undefined}
                />
                <ScoreBar
                  label="Sample Size"
                  value={score.sample_size_factor}
                  tooltip="More positions = more reliable."
                  icon={<Shield className="h-3 w-3" />}
                  colorClass={score.sample_size_factor > 0.7 ? 'text-green-500' : undefined}
                />
                <ScoreBar
                  label="Time Horizon"
                  value={score.horizon_component}
                  tooltip="Longer-term positions score higher."
                  icon={<Clock className="h-3 w-3" />}
                  colorClass={score.horizon_component > 0.2 ? 'text-green-500' : undefined}
                />
                <ScoreBar
                  label="Risk Management"
                  value={score.risk_component}
                  tooltip="Downside protection quality."
                  icon={<AlertTriangle className="h-3 w-3" />}
                  colorClass={score.risk_component > 0.1 ? 'text-green-500' : undefined}
                />
              </>
            )}
          </div>
        </div>

        {/* Footer - Always visible */}
        <div className="mt-4 pt-3 border-t border-border/50">
          <p className="text-xs text-muted-foreground text-center">
            Use this score to decide if a wallet is worth following.
          </p>
        </div>
      </div>
    </Card>
  );
}
