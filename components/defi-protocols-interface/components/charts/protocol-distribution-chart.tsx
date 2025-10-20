import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts"
import type { DistributionData } from "../../types"
import { CHART_COLORS } from "../../constants"

interface ProtocolDistributionChartProps {
  data: DistributionData[]
}

export function ProtocolDistributionChart({ data }: ProtocolDistributionChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Protocol Distribution</CardTitle>
        <CardDescription>Distribution by protocol category</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                labelLine={false}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
                label={({ name, percent }) => percent !== undefined ? `${name} ${(percent * 100).toFixed(0)}%` : `${name}`}
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => [`${value}%`, ""]} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
