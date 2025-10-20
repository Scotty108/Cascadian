import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts"
import type { AllocationData } from "../../types"

interface AllocationChartsProps {
  assetData: AllocationData[]
  chainData: AllocationData[]
  protocolData: AllocationData[]
}

export function AllocationCharts({ assetData, chainData, protocolData }: AllocationChartsProps) {
  const renderChart = (data: AllocationData[], title: string, description: string) => (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={2} dataKey="value">
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => [`${value}%`, "Allocation"]} labelFormatter={(name) => name} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {renderChart(assetData, "Asset Allocation", "Distribution by asset type")}
      {renderChart(chainData, "Chain Allocation", "Distribution by blockchain")}
      {renderChart(protocolData, "Protocol Allocation", "Distribution by DeFi protocol")}
    </div>
  )
}


