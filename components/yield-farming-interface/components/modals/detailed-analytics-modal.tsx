"use client"

import Image from "next/image";
import { useState } from "react"
import { TrendingUp, DollarSign, Percent, BarChart3, Activity } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Progress } from "@/components/ui/progress"
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { formatCurrency } from "../../utils"
import type { PortfolioAllocation, UserFarm } from "../../types"

interface DetailedAnalyticsModalProps {
  isOpen: boolean
  onClose: () => void
  portfolioData: PortfolioAllocation[]
  totalPortfolioValue: number
  totalRewards: number
  userFarms: UserFarm[]
  averageApy: number
  estimatedMonthlyYield: number
}

export function DetailedAnalyticsModal({
  isOpen,
  onClose,
  portfolioData,
  totalPortfolioValue,
  totalRewards,
  userFarms,
  averageApy,
  estimatedMonthlyYield,
}: DetailedAnalyticsModalProps) {
  const [activeTab, setActiveTab] = useState("overview")

  // Mock historical data for charts
  const performanceData = [
    { date: "Jan", value: totalPortfolioValue * 0.7, rewards: totalRewards * 0.1 },
    { date: "Feb", value: totalPortfolioValue * 0.75, rewards: totalRewards * 0.2 },
    { date: "Mar", value: totalPortfolioValue * 0.8, rewards: totalRewards * 0.35 },
    { date: "Apr", value: totalPortfolioValue * 0.85, rewards: totalRewards * 0.5 },
    { date: "May", value: totalPortfolioValue * 0.9, rewards: totalRewards * 0.7 },
    { date: "Jun", value: totalPortfolioValue * 0.95, rewards: totalRewards * 0.85 },
    { date: "Jul", value: totalPortfolioValue, rewards: totalRewards },
  ]

  const apyTrendsData = [
    { date: "Jan", apy: averageApy * 0.8 },
    { date: "Feb", apy: averageApy * 0.9 },
    { date: "Mar", apy: averageApy * 1.1 },
    { date: "Apr", apy: averageApy * 0.95 },
    { date: "May", apy: averageApy * 1.05 },
    { date: "Jun", apy: averageApy * 0.98 },
    { date: "Jul", apy: averageApy },
  ]

  const riskMetrics = [
    { name: "Low Risk", value: 35, color: "#10b981" },
    { name: "Medium Risk", value: 45, color: "#f59e0b" },
    { name: "High Risk", value: 20, color: "#ef4444" },
  ]

  const totalReturn = ((totalPortfolioValue + totalRewards) / (totalPortfolioValue * 0.7) - 1) * 100
  const bestPerformingFarm = userFarms.reduce((best, farm) => (farm.apy > best.apy ? farm : best), userFarms[0])
  const worstPerformingFarm = userFarms.reduce((worst, farm) => (farm.apy < worst.apy ? farm : worst), userFarms[0])

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Detailed Portfolio Analytics
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="risk">Risk Analysis</TabsTrigger>
            <TabsTrigger value="farms">Farm Details</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Portfolio Value</CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatCurrency(totalPortfolioValue)}</div>
                  <p className="text-xs text-muted-foreground">
                    <span className="text-green-600">+{totalReturn.toFixed(2)}%</span> from initial
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Rewards</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatCurrency(totalRewards)}</div>
                  <p className="text-xs text-muted-foreground">Monthly: {formatCurrency(estimatedMonthlyYield)}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Average APY</CardTitle>
                  <Percent className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{averageApy.toFixed(2)}%</div>
                  <p className="text-xs text-muted-foreground">Weighted by allocation</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Active Farms</CardTitle>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{userFarms.length}</div>
                  <p className="text-xs text-muted-foreground">
                    Across {new Set(userFarms.map((f) => f.protocol)).size} protocols
                  </p>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Portfolio Allocation</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={portfolioData}
                          cx="50%"
                          cy="50%"
                          outerRadius={100}
                          fill="#8884d8"
                          dataKey="value"
                          label={({ name, percent }) => percent !== undefined ? `${name} ${(percent * 100).toFixed(0)}%` : `${name}`}
                        >
                          {portfolioData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Performance Overview</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm">Best Performing Farm</span>
                      <div className="text-right">
                        <div className="font-medium">{bestPerformingFarm?.protocol}</div>
                        <div className="text-sm text-green-600">{bestPerformingFarm?.apy.toFixed(2)}% APY</div>
                      </div>
                    </div>
                    <Separator />
                    <div className="flex justify-between items-center">
                      <span className="text-sm">Lowest Performing Farm</span>
                      <div className="text-right">
                        <div className="font-medium">{worstPerformingFarm?.protocol}</div>
                        <div className="text-sm text-orange-600">{worstPerformingFarm?.apy.toFixed(2)}% APY</div>
                      </div>
                    </div>
                    <Separator />
                    <div className="flex justify-between items-center">
                      <span className="text-sm">Total Return</span>
                      <div className="text-right">
                        <div className="font-medium text-green-600">+{totalReturn.toFixed(2)}%</div>
                        <div className="text-sm text-muted-foreground">Since inception</div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="performance" className="space-y-4">
            <div className="grid gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Portfolio Value Over Time</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={performanceData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" />
                        <YAxis tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`} />
                        <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                        <Area type="monotone" dataKey="value" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>APY Trends</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={apyTrendsData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" />
                        <YAxis tickFormatter={(value) => `${value.toFixed(1)}%`} />
                        <Tooltip formatter={(value) => `${Number(value).toFixed(2)}%`} />
                        <Line type="monotone" dataKey="apy" stroke="#10b981" strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Rewards Accumulation</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={performanceData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" />
                        <YAxis tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`} />
                        <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                        <Bar dataKey="rewards" fill="#f59e0b" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="risk" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Risk Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={riskMetrics}
                          cx="50%"
                          cy="50%"
                          outerRadius={100}
                          fill="#8884d8"
                          dataKey="value"
                          label={({ name, percent }) => percent !== undefined ? `${name} ${(percent * 100).toFixed(0)}%` : `${name}`}
                        >
                          {riskMetrics.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Risk Metrics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm">Portfolio Risk Score</span>
                      <Badge variant="outline">Medium</Badge>
                    </div>
                    <Progress value={65} className="h-2" />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm">Diversification Score</span>
                      <Badge variant="outline" className="bg-green-50 text-green-700">
                        Good
                      </Badge>
                    </div>
                    <Progress value={78} className="h-2" />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm">Impermanent Loss Risk</span>
                      <Badge variant="outline" className="bg-yellow-50 text-yellow-700">
                        Moderate
                      </Badge>
                    </div>
                    <Progress value={45} className="h-2" />
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <h4 className="font-medium">Risk Recommendations</h4>
                    <ul className="text-sm space-y-1 text-muted-foreground">
                      <li>• Consider diversifying into more stable protocols</li>
                      <li>• Monitor high-risk positions closely</li>
                      <li>• Set stop-loss limits for volatile assets</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="farms" className="space-y-4">
            <div className="grid gap-4">
              {userFarms.map((farm) => (
                <Card key={farm.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Image
                          src={farm.logo || "/placeholder.svg"}
                          alt={farm.protocol}
                          width={32}
                          height={32}
                          className="w-8 h-8 rounded-full"
                        />
                        <div>
                          <CardTitle className="text-lg">{farm.protocol}</CardTitle>
                          <p className="text-sm text-muted-foreground">{farm.asset}</p>
                        </div>
                      </div>
                      <Badge variant={farm.apy > averageApy ? "default" : "secondary"}>
                        {farm.apy.toFixed(2)}% APY
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div>
                        <p className="text-sm text-muted-foreground">Deposited Amount</p>
                        <p className="text-lg font-medium">
                          {farm.deposited.toFixed(4)} {farm.asset.split("-")[0]}
                        </p>
                        <p className="text-sm text-muted-foreground">{formatCurrency(farm.depositValue)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Rewards Earned</p>
                        <p className="text-lg font-medium text-green-600">{formatCurrency(farm.rewards)}</p>
                        <p className="text-sm text-muted-foreground">Since {farm.timeStaked}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Performance</p>
                        <p className="text-lg font-medium">
                          {farm.apy > averageApy ? (
                            <span className="text-green-600">Above Average</span>
                          ) : (
                            <span className="text-orange-600">Below Average</span>
                          )}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {farm.apy > averageApy ? "+" : ""}
                          {(farm.apy - averageApy).toFixed(2)}% vs avg
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button>Export Report</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
