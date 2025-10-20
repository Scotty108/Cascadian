"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowUpRight, Wallet } from "lucide-react"
import type { WalletAsset } from "../types"

interface WalletOverviewProps {
  assets: WalletAsset[]
}

export function WalletOverview({ assets }: WalletOverviewProps) {
  return (
    <Card className="lg:col-span-3">
      <CardHeader>
        <CardTitle>Wallet Overview</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {assets.map((asset, index) => (
            <div key={index} className="flex items-center gap-4">
              <div className="rounded-full bg-blue-500/20 p-2">
                <Wallet className="h-4 w-4 text-blue-500" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{asset.name}</div>
                  <div className="font-medium">{asset.value}</div>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <div>{asset.amount}</div>
                  <div
                    className={`flex items-center gap-1 ${
                      asset.changeType === "positive"
                        ? "text-green-500"
                        : asset.changeType === "negative"
                          ? "text-red-500"
                          : "text-muted-foreground"
                    }`}
                  >
                    <ArrowUpRight className="h-3 w-3" />
                    {asset.change}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
      <CardFooter>
        <Button variant="outline" className="w-full" href="/my-assets">
          View All Assets
        </Button>
      </CardFooter>
    </Card>
  )
}
