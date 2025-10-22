import { ArrowUpRight, ArrowDownLeft, RefreshCw } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { NetworkBadge } from "../../shared/network-badge"
import { formatCrypto, formatCurrency } from "../../../utils"
import type { Asset } from "../../../types"

interface AssetsTableProps {
  assets: (Asset & { networkId: string })[]
}

export function AssetsTable({ assets }: AssetsTableProps) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto" style={{ maxHeight: '600px', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table className="w-full whitespace-nowrap caption-bottom text-sm border-collapse">
              <thead className="sticky top-0 z-40 bg-background border-b border-border">
                <tr>
                  <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Asset</th>
                  <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Network</th>
                  <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Balance</th>
                  <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Value</th>
                  <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((asset, index) => (
                  <tr key={`${asset.symbol}-${index}`} className="border-b border-border hover:bg-muted/30 transition">
                    <td className="px-2 py-1.5 align-middle">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={asset.icon || "/placeholder.svg"} alt={asset.name} />
                          <AvatarFallback>{asset.symbol}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">{asset.name}</p>
                          <p className="text-sm text-muted-foreground">{asset.symbol}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 align-middle">
                      <NetworkBadge networkId={asset.networkId} showName />
                    </td>
                    <td className="px-2 py-1.5 align-middle">
                      <div>
                        <p>{formatCrypto(asset.balance)}</p>
                        <p className="text-sm text-muted-foreground">{asset.symbol}</p>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 align-middle text-right">
                      <div>
                        <p>{formatCurrency(asset.usdValue)}</p>
                        <p className="text-sm text-muted-foreground">USD</p>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 align-middle text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <ArrowUpRight className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <ArrowDownLeft className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
