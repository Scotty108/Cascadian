"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Legend, ResponsiveContainer } from "recharts"
import { liquidityOverviewData } from "../../data"

export function LiquidityOverviewChart() {
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Liquidity Overview</CardTitle>
        <CardDescription>Total value locked across protocols</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={{
            uniswap: {
              label: "Uniswap",
              color: "hsl(var(--chart-1))",
            },
            curve: {
              label: "Curve",
              color: "hsl(var(--chart-2))",
            },
            balancer: {
              label: "Balancer",
              color: "hsl(var(--chart-3))",
            },
            sushiswap: {
              label: "SushiSwap",
              color: "hsl(var(--chart-4))",
            },
          }}
          className="h-[300px]"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={liquidityOverviewData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Legend />
              <Area
                type="monotone"
                dataKey="uniswap"
                stackId="1"
                stroke="var(--color-uniswap)"
                fill="var(--color-uniswap)"
              />
              <Area type="monotone" dataKey="curve" stackId="1" stroke="var(--color-curve)" fill="var(--color-curve)" />
              <Area
                type="monotone"
                dataKey="balancer"
                stackId="1"
                stroke="var(--color-balancer)"
                fill="var(--color-balancer)"
              />
              <Area
                type="monotone"
                dataKey="sushiswap"
                stackId="1"
                stroke="var(--color-sushiswap)"
                fill="var(--color-sushiswap)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
