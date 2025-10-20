import type React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"
import type { ChartData } from "../../types"

interface TvlTrendsChartProps {
  data: ChartData[]
}

export function TvlTrendsChart({ data }: TvlTrendsChartProps) {
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>TVL Trends</CardTitle>
        <CardDescription>Total Value Locked (TVL) trends for top protocols</CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className="h-[300px]"
          style={
            {
              "--color-Aave": "hsl(var(--chart-1))",
              "--color-Uniswap": "hsl(var(--chart-2))",
              "--color-Curve": "hsl(var(--chart-3))",
              "--color-Yearn": "hsl(var(--chart-4))",
            } as React.CSSProperties
          }
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis tickFormatter={(value) => `$${value}B`} />
              <Tooltip formatter={(value) => [`$${value}B`, ""]} />
              <Legend />
              <Line
                type="monotone"
                dataKey="Aave"
                stroke="var(--color-Aave)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 6 }}
              />
              <Line
                type="monotone"
                dataKey="Uniswap"
                stroke="var(--color-Uniswap)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 6 }}
              />
              <Line
                type="monotone"
                dataKey="Curve"
                stroke="var(--color-Curve)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 6 }}
              />
              <Line
                type="monotone"
                dataKey="Yearn"
                stroke="var(--color-Yearn)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
