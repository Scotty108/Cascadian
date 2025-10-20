"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ArrowDownUp, ArrowRight, Bot, Check, Clock, Eye, Plus, Sparkles, TrendingUp, X, Zap } from "lucide-react";
// import { mockOpportunities, mockStats } from "../data"
// import type { ArbitrageBot, ArbitrageOpportunity } from "../types"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
// import { Description } from "@/components/ui/description" // Importing Description component
import { mockOpportunities, mockStats } from "@/components/arbitrage-bot-dashboard/data";
import { ArbitrageBot, ArbitrageOpportunity } from "@/components/arbitrage-bot-dashboard/types";
import { useState } from "react";
import { OpportunityDetailsModal } from "./modals/opportunity-details-modal";
// import { OpportunityDetailsModal } from "../modals/opportunity-details-modal"

interface OverviewTabProps {
  activeBots: ArbitrageBot[];
  activeOpportunities: ArbitrageOpportunity[];
  onCreateBot: () => void;
  onExecuteOpportunity: (opportunityId: string) => void;
}

const chartData = [
  { date: "Jan 1", profit: 120 },
  { date: "Jan 2", profit: 180 },
  { date: "Jan 3", profit: 95 },
  { date: "Jan 4", profit: 240 },
  { date: "Jan 5", profit: 160 },
  { date: "Jan 6", profit: 320 },
  { date: "Jan 7", profit: 280 },
  { date: "Jan 8", profit: 190 },
  { date: "Jan 9", profit: 350 },
  { date: "Jan 10", profit: 420 },
  { date: "Jan 11", profit: 380 },
  { date: "Jan 12", profit: 290 },
  { date: "Jan 13", profit: 460 },
  { date: "Jan 14", profit: 520 },
];

export function OverviewTab({ activeBots, activeOpportunities, onCreateBot, onExecuteOpportunity }: OverviewTabProps) {
  const [selectedOpportunity, setSelectedOpportunity] = useState<ArbitrageOpportunity | null>(null);
  const [isOpportunityModalOpen, setIsOpportunityModalOpen] = useState(false);

  const handleViewOpportunity = (opportunity: ArbitrageOpportunity) => {
    setSelectedOpportunity(opportunity);
    setIsOpportunityModalOpen(true);
  };

  const handleCloseOpportunityModal = () => {
    setIsOpportunityModalOpen(false);
    setSelectedOpportunity(null);
  };

  return (
    <div className=" md:grid gap-4 max-md:space-y-4 md:grid-cols-2 lg:grid-cols-3">
      {/* Profit Chart */}
      <Card className=" md:col-span-2">
        <CardHeader>
          <CardTitle>Profit Overview</CardTitle>
          <CardDescription>Daily arbitrage profit over time</CardDescription>
        </CardHeader>
        <CardContent className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
              <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#6b7280" }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#6b7280" }} tickFormatter={(value) => `$${value}`} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "6px",
                  boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                }}
                formatter={(value: any) => [`$${value}`, "Profit"]}
                labelStyle={{ color: "hsl(var(--foreground))" }}
              />
              <Area type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorProfit)" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Best Performing */}
      <Card>
        <CardHeader>
          <CardTitle>Best Performing</CardTitle>
          <CardDescription>Top arbitrage metrics</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center">
                  <Sparkles className="mr-1 h-4 w-4 text-yellow-500" />
                  <span>Best Pair</span>
                </div>
                <span className="font-medium">{mockStats.bestPair}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center">
                  <ArrowDownUp className="mr-1 h-4 w-4 text-blue-500" />
                  <span>Best Exchange Route</span>
                </div>
                <span className="font-medium">{mockStats.bestExchangePair}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center">
                  <TrendingUp className="mr-1 h-4 w-4 text-green-500" />
                  <span>Largest Spread</span>
                </div>
                <span className="font-medium">{mockStats.largestSpread}%</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center">
                  <Clock className="mr-1 h-4 w-4 text-purple-500" />
                  <span>Avg. Execution Time</span>
                </div>
                <span className="font-medium">{mockStats.avgExecutionTime}s</span>
              </div>
            </div>
            <Separator />
            <div>
              <h4 className="mb-2 text-sm font-medium">Recent Activity</h4>
              <div className="space-y-2">
                {mockOpportunities
                  .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
                  .slice(0, 3)
                  .map((opp) => (
                    <div key={opp.id} className="flex items-center justify-between text-sm">
                      <div className="flex items-center">
                        <Badge variant={opp.status === "active" ? "default" : opp.status === "completed" ? "secondary" : "destructive"} className="mr-2 px-1 py-0">
                          {opp.status === "active" ? <Zap className="h-2 w-2" /> : opp.status === "completed" ? <Check className="h-2 w-2" /> : <X className="h-2 w-2" />}
                        </Badge>
                        <span>
                          {opp.pair} ({opp.spread.toFixed(2)}%)
                        </span>
                      </div>
                      <span className="text-green-600 dark:text-green-400">+${opp.profit.toFixed(2)}</span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Active Bots */}
      <Card>
        <CardHeader>
          <CardTitle>Active Bots</CardTitle>
          <CardDescription>Currently running arbitrage bots</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {activeBots.length > 0 ? (
              activeBots.map((bot) => (
                <div key={bot.id} className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{bot.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {bot.pairs.length} pairs • {bot.exchanges.length} exchanges
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-green-600 dark:text-green-400">+${bot.totalProfit.toFixed(2)}</div>
                    <div className="text-xs text-muted-foreground">{bot.successRate}% success</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <Bot className="mb-2 h-8 w-8 text-muted-foreground" />
                <h3 className="text-lg font-medium">No Active Bots</h3>
                <p className="text-sm text-muted-foreground">Start a bot to begin arbitrage trading</p>
                <Button className="mt-4" size="sm" onClick={onCreateBot}>
                  <Plus className="mr-1 h-4 w-4" /> Create Bot
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Active Opportunities */}
      <Card className="col-span-2">
        <CardHeader>
          <CardTitle>Active Opportunities</CardTitle>
          <CardDescription>Current arbitrage opportunities</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {activeOpportunities.length > 0 ? (
              activeOpportunities.map((opp) => (
                <div key={opp.id} className="flex items-center flex-wrap gap-3 justify-between rounded-lg border p-3">
                  <div>
                    <div className="flex items-center space-x-1">
                      <span className="font-medium">{opp.pair}</span>
                      <Badge variant="outline" className="px-1 py-0">
                        {opp.spread.toFixed(2)}%
                      </Badge>
                    </div>
                    <div className="flex items-center space-x-1 text-sm text-muted-foreground">
                      <span>{opp.buyExchange}</span>
                      <ArrowRight className="h-3 w-3" />
                      <span>{opp.sellExchange}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-green-600 dark:text-green-400">+${opp.profit.toFixed(2)}</div>
                    <div className="text-xs text-muted-foreground">${opp.volume.toLocaleString()} volume</div>
                  </div>
                  <div className=" flex space-x-2">
                    <Button size="sm" variant="default" onClick={() => onExecuteOpportunity(opp.id)}>
                      <Zap className="mr-1 h-3 w-3" />
                      Execute
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleViewOpportunity(opp)}>
                      <Eye className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <Zap className="mb-2 h-8 w-8 text-muted-foreground" />
                <h3 className="text-lg font-medium">No Active Opportunities</h3>
                <p className="text-sm text-muted-foreground">Opportunities will appear here when detected by your bots</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      <OpportunityDetailsModal opportunity={selectedOpportunity} isOpen={isOpportunityModalOpen} onClose={handleCloseOpportunityModal} onExecute={onExecuteOpportunity} />
    </div>
  );
}
