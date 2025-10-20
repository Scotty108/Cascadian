import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Legend, ResponsiveContainer } from "recharts"
import type { HistoricalData } from "../../types"

interface PerformanceChartProps {
  data: HistoricalData[]
}

export function PerformanceChart({ data }: PerformanceChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Portfolio Performance</CardTitle>
        <CardDescription>Track your portfolio performance over time compared to market benchmarks</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={{
            portfolio: {
              label: "Portfolio",
              color: "hsl(var(--chart-1))",
            },
            btc: {
              label: "Bitcoin",
              color: "hsl(var(--chart-2))",
            },
            eth: {
              label: "Ethereum",
              color: "hsl(var(--chart-3))",
            },
          }}
          className="h-[300px]"
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Legend />
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--color-portfolio)"
                strokeWidth={2}
                dot={false}
                name="Portfolio"
              />
              <Line
                type="monotone"
                dataKey="btc"
                stroke="var(--color-btc)"
                strokeWidth={2}
                dot={false}
                name="Bitcoin"
                strokeDasharray="5 5"
              />
              <Line
                type="monotone"
                dataKey="eth"
                stroke="var(--color-eth)"
                strokeWidth={2}
                dot={false}
                name="Ethereum"
                strokeDasharray="3 3"
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
