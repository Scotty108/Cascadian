"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer } from "@/components/ui/chart";
import { Separator } from "@/components/ui/separator";
import { BarChart3 } from "lucide-react";
import { useState } from "react";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer } from "recharts";
import type { PortfolioAllocation, UserFarm } from "../../types";
import { formatCurrency } from "../../utils";
import { DetailedAnalyticsModal } from "../modals/detailed-analytics-modal";

interface PortfolioAllocationProps {
  portfolioData: PortfolioAllocation[];
  totalPortfolioValue: number;
  totalRewards: number;
  userFarms: UserFarm[];
}

export function PortfolioAllocationChart({ portfolioData, totalPortfolioValue, totalRewards, userFarms }: PortfolioAllocationProps) {
  const [showAnalyticsModal, setShowAnalyticsModal] = useState(false);

  const averageApy = userFarms.length > 0 ? userFarms.reduce((total, farm) => total + farm.apy, 0) / userFarms.length : 0;

  const estimatedMonthlyYield = (totalPortfolioValue * averageApy) / 100 / 12;

  return (
    <>
      <Card className="">
        <CardHeader>
          <CardTitle>Portfolio Allocation</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex items-center justify-center">
              <div className="h-[300px] w-[250px] sm:w-[300px]">
                <ChartContainer
                  config={{
                    value: {
                      label: "Portfolio Value",
                      color: "hsl(var(--chart-1))",
                    },
                  }}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={portfolioData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        outerRadius={100}
                        fill="#8884d8"
                        dataKey="value"              label={({ name, percent }) => `${name} ${percent !== undefined ? (percent * 100).toFixed(0) : 0}%`}
                      >
                        {portfolioData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <h4 className="font-medium">Farming Statistics</h4>
                <p className="text-sm text-muted-foreground">Overview of your yield farming performance</p>
              </div>
              <Separator />
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm">Total Value Locked</span>
                  <span className="font-medium">{formatCurrency(totalPortfolioValue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Total Rewards Earned</span>
                  <span className="font-medium">{formatCurrency(totalRewards)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Average APY</span>
                  <span className="font-medium">{averageApy.toFixed(2)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Active Farms</span>
                  <span className="font-medium">{userFarms.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Estimated Monthly Yield</span>
                  <span className="font-medium">{formatCurrency(estimatedMonthlyYield)}</span>
                </div>
              </div>
              <Separator />
              <div className="pt-2">
                <Button className="w-full" onClick={() => setShowAnalyticsModal(true)}>
                  <BarChart3 className="mr-2 h-4 w-4" />
                  View Detailed Analytics
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Detailed Analytics Modal */}
      {showAnalyticsModal && (
        <DetailedAnalyticsModal
          isOpen={showAnalyticsModal}
          onClose={() => setShowAnalyticsModal(false)}
          portfolioData={portfolioData}
          totalPortfolioValue={totalPortfolioValue}
          totalRewards={totalRewards}
          userFarms={userFarms}
          averageApy={averageApy}
          estimatedMonthlyYield={estimatedMonthlyYield}
        />
      )}
    </>
  );
}
