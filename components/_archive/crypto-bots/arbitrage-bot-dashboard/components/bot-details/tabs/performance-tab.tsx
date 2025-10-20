"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts"
import type { ArbitrageBot } from "../../../types"

interface PerformanceTabProps {
  bot: ArbitrageBot
  historicalData: {
    dailyProfits: Array<{ date: string; profit: number }>
    spreadHistory: Array<{ timestamp: string; spread: number }>
    volumeHistory: Array<{ timestamp: string; volume: number }>
  }
}

export function PerformanceTab({ bot, historicalData }: PerformanceTabProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Profit History</CardTitle>
          <CardDescription>Daily profit over the last 7 days</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={historicalData.dailyProfits}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip formatter={(value) => [`$${value}`, "Profit"]} />
                <Line type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="spread" className="space-y-4">
        <TabsList>
          <TabsTrigger value="spread">Spread History</TabsTrigger>
          <TabsTrigger value="volume">Volume History</TabsTrigger>
        </TabsList>
        <TabsContent value="spread">
          <Card>
            <CardHeader>
              <CardTitle>Spread History</CardTitle>
              <CardDescription>Spread percentage over time</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={historicalData.spreadHistory}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="timestamp" tickFormatter={(value) => value.split("T")[1].substring(0, 5)} />
                    <YAxis />
                    <Tooltip formatter={(value) => [`${value}%`, "Spread"]} />
                    <Line type="monotone" dataKey="spread" stroke="#6366f1" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="volume">
          <Card>
            <CardHeader>
              <CardTitle>Volume History</CardTitle>
              <CardDescription>Trading volume over time</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={historicalData.volumeHistory}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="timestamp" tickFormatter={(value) => value.split("T")[1].substring(0, 5)} />
                    <YAxis />
                    <Tooltip formatter={(value) => [`$${value}`, "Volume"]} />
                    <Bar dataKey="volume" fill="#ec4899" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Performance Metrics</CardTitle>
            <CardDescription>Key performance indicators</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Win Rate</p>
                  <p className="text-xl font-bold">{bot.performance?.winRate || bot.successRate}%</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Avg. Profit/Trade</p>
                  <p className="text-xl font-bold">${bot.performance?.avgProfitPerTrade?.toFixed(2) || "0.00"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Largest Profit</p>
                  <p className="text-xl font-bold">${bot.performance?.largestProfit?.toFixed(2) || "0.00"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Avg. Execution Time</p>
                  <p className="text-xl font-bold">{bot.performance?.avgExecutionTime || "0"}s</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Profit Breakdown</CardTitle>
            <CardDescription>Profit by time period</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Daily</p>
                  <p className="text-xl font-bold text-green-600 dark:text-green-400">
                    ${bot.performance?.daily?.toFixed(2) || "0.00"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Weekly</p>
                  <p className="text-xl font-bold text-green-600 dark:text-green-400">
                    ${bot.performance?.weekly?.toFixed(2) || "0.00"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Monthly</p>
                  <p className="text-xl font-bold text-green-600 dark:text-green-400">
                    ${bot.performance?.monthly?.toFixed(2) || "0.00"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">All-Time</p>
                  <p className="text-xl font-bold text-green-600 dark:text-green-400">
                    ${bot.performance?.allTime?.toFixed(2) || bot.totalProfit?.toFixed(2) || "0.00"}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
