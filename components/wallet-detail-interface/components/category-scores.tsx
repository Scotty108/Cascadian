"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Trophy, TrendingUp, Activity } from "lucide-react";
import { WalletScore, CategoryScore } from "@/lib/wallet-scoring";

interface CategoryScoresProps {
  walletScore: WalletScore;
}

export function CategoryScores({ walletScore }: CategoryScoresProps) {
  const getGradeColor = (grade: CategoryScore['grade']) => {
    switch (grade) {
      case 'S': return 'bg-purple-500 text-white';
      case 'A': return 'bg-[#00E0AA] text-black';
      case 'B': return 'bg-blue-500 text-white';
      case 'C': return 'bg-yellow-500 text-black';
      case 'D': return 'bg-orange-500 text-white';
      case 'F': return 'bg-red-500 text-white';
      case 'N/A': return 'bg-muted text-muted-foreground';
    }
  };

  const getSpecializationColor = (spec: CategoryScore['specialization']) => {
    switch (spec) {
      case 'Expert': return 'bg-purple-500/20 text-purple-300 border-purple-500/50';
      case 'Advanced': return 'bg-[#00E0AA]/20 text-[#00E0AA] border-[#00E0AA]/50';
      case 'Intermediate': return 'bg-blue-500/20 text-blue-300 border-blue-500/50';
      case 'Novice': return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/50';
      case 'None': return 'bg-muted text-muted-foreground border-border';
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatPercent = (value: number) => {
    return `${(value * 100).toFixed(1)}%`;
  };

  return (
    <div className="space-y-6">
      {/* Overall Score Card */}
      <Card className="p-6 border-border/50 bg-gradient-to-br from-[#00E0AA]/10 to-transparent">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Trophy className="h-6 w-6 text-[#00E0AA]" />
              <h2 className="text-2xl font-bold">Wallet Intelligence Score</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Category-based performance analysis
            </p>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-bold text-[#00E0AA]">
                {walletScore.overall}
              </span>
              <span className="text-2xl text-muted-foreground">/100</span>
            </div>
            <Badge className={getGradeColor(walletScore.grade)} variant="outline">
              Grade: {walletScore.grade}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {walletScore.rank}
            </Badge>
          </div>
        </div>

        {/* Specializations */}
        {walletScore.specializations.length > 0 && (
          <div className="mt-6 pt-6 border-t border-border/50">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-4 w-4 text-[#00E0AA]" />
              <h3 className="text-sm font-semibold">Specializations</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {walletScore.specializations.map((spec) => (
                <Badge
                  key={spec}
                  className="bg-[#00E0AA]/20 text-[#00E0AA] border-[#00E0AA]/50"
                  variant="outline"
                >
                  {spec} Expert
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Strengths & Weaknesses */}
        <div className="mt-6 pt-6 border-t border-border/50 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Strengths */}
          <div>
            <h3 className="text-sm font-semibold mb-3 text-[#00E0AA]">
              Strengths
            </h3>
            {walletScore.strengths.length > 0 ? (
              <ul className="space-y-2">
                {walletScore.strengths.map((strength) => (
                  <li key={strength} className="text-sm text-muted-foreground">
                    • {strength}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No significant strengths yet
              </p>
            )}
          </div>

          {/* Weaknesses */}
          <div>
            <h3 className="text-sm font-semibold mb-3 text-red-400">
              Areas for Growth
            </h3>
            {walletScore.weaknesses.length > 0 ? (
              <ul className="space-y-2">
                {walletScore.weaknesses.slice(0, 3).map((weakness) => (
                  <li key={weakness} className="text-sm text-muted-foreground">
                    • {weakness}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Strong across all traded categories
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* Category Breakdown */}
      <Card className="p-6 border-border/50">
        <div className="flex items-center gap-3 mb-6">
          <Activity className="h-5 w-5 text-[#00E0AA]" />
          <h2 className="text-xl font-semibold">Category Breakdown</h2>
        </div>

        <div className="space-y-6">
          {walletScore.categories.map((category) => (
            <div key={category.category} className="space-y-3">
              {/* Category Header */}
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold">{category.category}</h3>
                    <Badge
                      className={getSpecializationColor(category.specialization)}
                      variant="outline"
                    >
                      {category.specialization}
                    </Badge>
                    <Badge className={getGradeColor(category.grade)} variant="outline">
                      {category.grade}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {category.trades} trade{category.trades !== 1 ? 's' : ''}
                  </p>
                </div>

                <div className="text-right">
                  <div className="text-2xl font-bold text-[#00E0AA]">
                    {category.score}
                  </div>
                  <div className="text-xs text-muted-foreground">/ 100</div>
                </div>
              </div>

              {/* Progress Bar */}
              <Progress value={category.score} className="h-2" />

              {/* Category Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
                <div>
                  <div className="text-xs text-muted-foreground">Win Rate</div>
                  <div className={`text-sm font-semibold ${category.winRate >= 0.7 ? 'text-[#00E0AA]' : ''}`}>
                    {formatPercent(category.winRate)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">ROI</div>
                  <div className={`text-sm font-semibold ${category.roi >= 0.2 ? 'text-[#00E0AA]' : ''}`}>
                    {formatPercent(category.roi)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Sharpe</div>
                  <div className={`text-sm font-semibold ${category.sharpe >= 1.5 ? 'text-[#00E0AA]' : ''}`}>
                    {category.sharpe.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Total P&L</div>
                  <div className={`text-sm font-semibold ${category.totalPnL >= 0 ? 'text-[#00E0AA]' : 'text-red-500'}`}>
                    {formatCurrency(category.totalPnL)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
