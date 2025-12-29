"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Wallet, TrendingUp, Users } from "lucide-react";

// Hardcoded smart money data
const smartMoneyData = {
  sentiment: "BULLISH",
  sentimentScore: 82,
  topWalletsBuyingYes: 18,
  topWalletsBuyingNo: 4,
  avgPosition: "$125K",
  recentFlow: "+$2.3M",
  flowDirection: "YES",
};

export function SmartMoneyMeter() {
  return (
    <Card className="p-4 border-border/50 bg-gradient-to-br from-amber-500/5 to-background">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-1">
          <Wallet className="h-4 w-4 text-amber-400" />
          Smart Money
        </h3>
        <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/30">
          {smartMoneyData.sentiment}
        </Badge>
      </div>

      {/* Sentiment gauge */}
      <div className="relative h-3 bg-muted rounded-full mb-4 overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all"
          style={{ width: `${smartMoneyData.sentimentScore}%` }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[10px] font-bold text-white drop-shadow">
            {smartMoneyData.sentimentScore}% YES
          </span>
        </div>
      </div>

      {/* Top wallets breakdown */}
      <div className="bg-muted/30 rounded-lg p-3 mb-3">
        <div className="flex items-center gap-2 mb-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Top 50 Wallets</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-center">
            <div className="text-xl font-bold text-emerald-500">{smartMoneyData.topWalletsBuyingYes}</div>
            <div className="text-xs text-muted-foreground">Buying YES</div>
          </div>
          <div className="h-8 w-px bg-border" />
          <div className="text-center">
            <div className="text-xl font-bold text-rose-500">{smartMoneyData.topWalletsBuyingNo}</div>
            <div className="text-xs text-muted-foreground">Buying NO</div>
          </div>
        </div>
      </div>

      {/* Recent flow */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">24h Flow</span>
        <div className="flex items-center gap-1">
          <TrendingUp className="h-4 w-4 text-emerald-500" />
          <span className="font-semibold text-emerald-500">{smartMoneyData.recentFlow}</span>
          <Badge variant="outline" className="text-[10px] h-5 bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
            {smartMoneyData.flowDirection}
          </Badge>
        </div>
      </div>

      {/* Avg position */}
      <div className="flex items-center justify-between text-sm mt-2">
        <span className="text-muted-foreground">Avg Position</span>
        <span className="font-semibold">{smartMoneyData.avgPosition}</span>
      </div>
    </Card>
  );
}
