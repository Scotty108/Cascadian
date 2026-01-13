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

interface WIOScoreCardProps {
  score: WalletScore | null;
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
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="space-y-1 cursor-help">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                {icon}
                <span>{label}</span>
              </div>
              <span className={`font-medium ${colorClass || 'text-foreground'}`}>
                {displayValue}%
              </span>
            </div>
            <Progress value={percentage} className="h-2" />
          </div>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-xs">
          <p className="text-sm">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function WIOScoreCard({ score }: WIOScoreCardProps) {
  if (!score) {
    return (
      <Card className="p-6 border-border/50">
        <div className="text-center py-8 text-muted-foreground">
          <Shield className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No WIO score available for this wallet yet.</p>
          <p className="text-sm mt-1">Scores are calculated for wallets with resolved positions.</p>
        </div>
      </Card>
    );
  }

  const credibilityLabel = formatCredibility(score.credibility_score);
  const credibilityColor = getCredibilityColor(score.credibility_score);

  // Determine credibility ring color based on score
  const getRingColor = (score: number) => {
    if (score >= 0.7) return 'stroke-green-500';
    if (score >= 0.5) return 'stroke-blue-500';
    if (score >= 0.3) return 'stroke-amber-500';
    return 'stroke-red-500';
  };

  return (
    <Card className="p-6 border-border/50">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Shield className="h-5 w-5 text-[#00E0AA]" />
          WIO Intelligence Score
        </h2>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <Info className="h-4 w-4 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent className="max-w-sm">
              <p>
                WIO (Wallet Intelligence Ontology) scores measure trading skill, consistency,
                and reliability based on resolved position outcomes.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Credibility Gauge */}
        <div className="flex flex-col items-center justify-center">
          {/* Circular Gauge */}
          <div className="relative w-40 h-40">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
              {/* Background circle */}
              <circle
                cx="50"
                cy="50"
                r="45"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                className="text-muted/20"
              />
              {/* Progress circle */}
              <circle
                cx="50"
                cy="50"
                r="45"
                fill="none"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${score.credibility_score * 283} 283`}
                className={getRingColor(score.credibility_score)}
              />
            </svg>
            {/* Center text */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-3xl font-bold ${credibilityColor}`}>
                {(score.credibility_score * 100).toFixed(0)}
              </span>
              <span className="text-xs text-muted-foreground uppercase tracking-wide">
                {credibilityLabel}
              </span>
            </div>
          </div>

          {/* Secondary Scores */}
          <div className="flex gap-6 mt-4">
            <div className="text-center">
              <div className="flex items-center gap-1 text-muted-foreground mb-1">
                <Bot className="h-3 w-3" />
                <span className="text-xs">Bot Risk</span>
              </div>
              <span className={`text-lg font-semibold ${score.bot_likelihood > 0.5 ? 'text-red-500' : 'text-green-500'}`}>
                {(score.bot_likelihood * 100).toFixed(0)}%
              </span>
            </div>
            <div className="text-center">
              <div className="flex items-center gap-1 text-muted-foreground mb-1">
                <Copy className="h-3 w-3" />
                <span className="text-xs">Copyability</span>
              </div>
              <span className={`text-lg font-semibold ${score.copyability_score >= 0.7 ? 'text-green-500' : score.copyability_score >= 0.4 ? 'text-amber-500' : 'text-muted-foreground'}`}>
                {(score.copyability_score * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        </div>

        {/* Right: Component Breakdown */}
        <div className="space-y-4">
          <ScoreBar
            label="Skill"
            value={score.skill_component}
            tooltip="Measures trading skill based on ROI and win rate. Higher is better. (0-0.5 weight)"
            icon={<Brain className="h-3.5 w-3.5" />}
            colorClass={score.skill_component > 0.3 ? 'text-green-500' : undefined}
          />

          <ScoreBar
            label="Consistency"
            value={score.consistency_component}
            tooltip="Measures profit factor (total gains / total losses). Consistent profits score higher. (0-0.3 weight)"
            icon={<Zap className="h-3.5 w-3.5" />}
            colorClass={score.consistency_component > 0.2 ? 'text-green-500' : undefined}
          />

          <ScoreBar
            label="Sample Size"
            value={score.sample_size_factor}
            tooltip="Bayesian shrinkage factor based on number of resolved positions. More positions = more reliable score."
            icon={<Shield className="h-3.5 w-3.5" />}
            colorClass={score.sample_size_factor > 0.7 ? 'text-green-500' : undefined}
          />

          <ScoreBar
            label="Time Horizon"
            value={score.horizon_component}
            tooltip="Measures preference for longer-term positions (held > 1 hour). Long-term traders score higher. (0-0.3 weight)"
            icon={<Clock className="h-3.5 w-3.5" />}
            colorClass={score.horizon_component > 0.2 ? 'text-green-500' : undefined}
          />

          <ScoreBar
            label="Risk Management"
            value={score.risk_component}
            tooltip="Measures downside protection. Lower max losses and drawdowns score better. (0-0.2 weight)"
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            colorClass={score.risk_component > 0.1 ? 'text-green-500' : undefined}
          />
        </div>
      </div>

      {/* Bot Warning */}
      {score.bot_likelihood > 0.5 && (
        <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <div className="flex items-center gap-2 text-red-500">
            <Bot className="h-4 w-4" />
            <span className="text-sm font-medium">High Bot Likelihood Detected</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            This wallet shows patterns consistent with automated trading (high fill rate: {(score.fill_rate_signal * 100).toFixed(0)}%,
            scalping behavior: {(score.scalper_signal * 100).toFixed(0)}%).
          </p>
        </div>
      )}
    </Card>
  );
}
