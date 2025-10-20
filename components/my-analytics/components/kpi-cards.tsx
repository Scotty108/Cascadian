import { BarChart3, CreditCard, DollarSign, LineChart } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { KpiCardProps } from "../types"

const KpiCard = ({ title, value, change, icon, isPositive = true }: KpiCardProps) => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium">{title}</CardTitle>
      {icon}
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">{value}</div>
      <p className={`text-xs ${isPositive ? "text-green-500" : "text-muted-foreground"}`}>{change}</p>
    </CardContent>
  </Card>
)

export function KpiCards() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        title="Total Profit"
        value="$18,231.89"
        change="+20.1% from last month"
        icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
        isPositive={true}
      />
      <KpiCard
        title="Win Rate"
        value="72.4%"
        change="+3.1% from last month"
        icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
      />
      <KpiCard
        title="Total Trades"
        value="1,234"
        change="+19% from last month"
        icon={<CreditCard className="h-4 w-4 text-muted-foreground" />}
        isPositive={true}
      />
      <KpiCard
        title="Trading Volume"
        value="$1.2M"
        change="+12.5% since last month"
        icon={<LineChart className="h-4 w-4 text-muted-foreground" />}
      />
    </div>
  )
}
