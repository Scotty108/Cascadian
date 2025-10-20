import { ArrowUpRight, ArrowDownLeft, RefreshCw } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset</TableHead>
              <TableHead>Network</TableHead>
              <TableHead>Balance</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assets.map((asset, index) => (
              <TableRow key={`${asset.symbol}-${index}`}>
                <TableCell>
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
                </TableCell>
                <TableCell>
                  <NetworkBadge networkId={asset.networkId} showName />
                </TableCell>
                <TableCell>
                  <div>
                    <p>{formatCrypto(asset.balance)}</p>
                    <p className="text-sm text-muted-foreground">{asset.symbol}</p>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div>
                    <p>{formatCurrency(asset.usdValue)}</p>
                    <p className="text-sm text-muted-foreground">USD</p>
                  </div>
                </TableCell>
                <TableCell className="text-right">
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
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
