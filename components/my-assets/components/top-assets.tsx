import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChevronUp } from "lucide-react"
import type { AssetData } from "../types"

interface TopAssetsProps {
  assets: AssetData[]
}

export function TopAssets({ assets }: TopAssetsProps) {
  return (
    <Card className="lg:col-span-3">
      <CardHeader>
        <CardTitle>Top Assets</CardTitle>
        <CardDescription>Your best performing assets.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-8">
          {assets.map((asset, index) => {
            const isPositive = asset.change && asset.change > 0

            return (
              <div key={index} className="flex items-center">
                <div className="flex items-center gap-2">
                  <div className={`rounded-full ${isPositive ? "bg-green-500/20" : "bg-red-500/20"} p-1`}>
                    <ChevronUp
                      className={`h-3 w-3 ${isPositive ? "text-green-500" : "text-red-500"}`}
                      style={!isPositive ? { transform: "rotate(180deg)" } : undefined}
                    />
                  </div>
                  <div className="font-medium">{asset.name}</div>
                </div>
                <div className={`ml-auto font-medium ${isPositive ? "text-green-500" : "text-red-500"}`}>
                  {isPositive ? "+" : ""}
                  {asset.change}%
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
