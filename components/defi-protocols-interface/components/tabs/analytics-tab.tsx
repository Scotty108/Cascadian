import { ChevronDown, Plus } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts"
import { CHART_COLORS } from "../../constants"

export function AnalyticsTab() {
  const protocolGrowthData = [
    { name: "Jan", Aave: 4.2, Uniswap: 3.1, Curve: 2.4 },
    { name: "Feb", Aave: 4.5, Uniswap: 3.3, Curve: 2.5 },
    { name: "Mar", Aave: 4.8, Uniswap: 3.5, Curve: 2.7 },
    { name: "Apr", Aave: 5.0, Uniswap: 3.6, Curve: 2.8 },
    { name: "May", Aave: 5.1, Uniswap: 3.7, Curve: 2.9 },
    { name: "Jun", Aave: 5.2, Uniswap: 3.8, Curve: 3.0 },
  ]

  const chainDistributionData = [
    { name: "Ethereum", value: 45 },
    { name: "Polygon", value: 20 },
    { name: "Avalanche", value: 15 },
    { name: "Solana", value: 12 },
    { name: "Base", value: 8 },
  ]

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Protocol Comparison</CardTitle>
          <CardDescription>Compare key metrics across multiple protocols</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge className="gap-1">
                Aave
                <Button variant="ghost" size="icon" className="h-4 w-4 p-0">
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </Badge>
              <Badge className="gap-1">
                Uniswap
                <Button variant="ghost" size="icon" className="h-4 w-4 p-0">
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </Badge>
              <Badge className="gap-1">
                Curve
                <Button variant="ghost" size="icon" className="h-4 w-4 p-0">
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </Badge>
              <Button variant="outline" size="sm" className="h-6 gap-1">
                <Plus className="h-3 w-3" />
                <span>Add Protocol</span>
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-sm font-medium">TVL Comparison</CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="h-3 w-3 rounded-full bg-blue-500" />
                          <span className="text-sm">Aave</span>
                        </div>
                        <span className="text-sm font-medium">$5.24B</span>
                      </div>
                      <Progress value={100} className="h-2" />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="h-3 w-3 rounded-full bg-green-500" />
                          <span className="text-sm">Uniswap</span>
                        </div>
                        <span className="text-sm font-medium">$3.78B</span>
                      </div>
                      <Progress value={72} className="h-2" />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="h-3 w-3 rounded-full bg-yellow-500" />
                          <span className="text-sm">Curve</span>
                        </div>
                        <span className="text-sm font-medium">$2.98B</span>
                      </div>
                      <Progress value={57} className="h-2" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-sm font-medium">APY Comparison</CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="h-3 w-3 rounded-full bg-yellow-500" />
                          <span className="text-sm">Curve</span>
                        </div>
                        <span className="text-sm font-medium">5.6%</span>
                      </div>
                      <Progress value={100} className="h-2" />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="h-3 w-3 rounded-full bg-green-500" />
                          <span className="text-sm">Uniswap</span>
                        </div>
                        <span className="text-sm font-medium">4.2%</span>
                      </div>
                      <Progress value={75} className="h-2" />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="h-3 w-3 rounded-full bg-blue-500" />
                          <span className="text-sm">Aave</span>
                        </div>
                        <span className="text-sm font-medium">3.8%</span>
                      </div>
                      <Progress value={68} className="h-2" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-sm font-medium">Risk Assessment</CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="h-3 w-3 rounded-full bg-blue-500" />
                          <span className="text-sm">Aave</span>
                        </div>
                        <Badge className="bg-green-500">Low Risk</Badge>
                      </div>
                      <Progress value={20} className="h-2" />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="h-3 w-3 rounded-full bg-green-500" />
                          <span className="text-sm">Uniswap</span>
                        </div>
                        <Badge className="bg-green-500">Low Risk</Badge>
                      </div>
                      <Progress value={25} className="h-2" />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="h-3 w-3 rounded-full bg-yellow-500" />
                          <span className="text-sm">Curve</span>
                        </div>
                        <Badge className="bg-yellow-500">Medium Risk</Badge>
                      </div>
                      <Progress value={50} className="h-2" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Protocol Growth</CardTitle>
            <CardDescription>Monthly growth in Total Value Locked (TVL)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={protocolGrowthData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis tickFormatter={(value) => `$${value}B`} />
                  <Tooltip formatter={(value) => [`$${value}B`, ""]} />
                  <Legend />
                  <Bar dataKey="Aave" fill="#3b82f6" />
                  <Bar dataKey="Uniswap" fill="#22c55e" />
                  <Bar dataKey="Curve" fill="#eab308" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Chain Distribution</CardTitle>
            <CardDescription>Protocol distribution across chains</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chainDistributionData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                    label={({ name, percent }) => percent !== undefined ? `${name} ${(percent * 100).toFixed(0)}%` : `${name}`}
                  >
                    {chainDistributionData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => [`${value}%`, ""]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
