"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Plus } from "lucide-react"
import type { LiquidityPosition } from "../../types"

interface PositionsTableProps {
  positions: LiquidityPosition[]
}

export function PositionsTable({ positions }: PositionsTableProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
          <div>
            <CardTitle>My Liquidity Positions</CardTitle>
            <CardDescription>Your active liquidity positions across protocols</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Position
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pool</TableHead>
                <TableHead>Protocol</TableHead>
                <TableHead>Invested</TableHead>
                <TableHead>Current Value</TableHead>
                <TableHead>ROI</TableHead>
                <TableHead>APY</TableHead>
                <TableHead>Rewards</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions.map((position) => (
                <TableRow key={position.id}>
                  <TableCell className="font-medium">{position.name}</TableCell>
                  <TableCell>{position.protocol}</TableCell>
                  <TableCell>{position.invested}</TableCell>
                  <TableCell>{position.currentValue}</TableCell>
                  <TableCell className={position.roi.startsWith("+") ? "text-green-500" : "text-red-500"}>
                    {position.roi}
                  </TableCell>
                  <TableCell className="text-green-500">{position.apy}</TableCell>
                  <TableCell>{position.rewards}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="bg-green-500/10 text-green-500 hover:bg-green-500/20">
                      {position.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm">
                        Manage
                      </Button>
                      <Button variant="ghost" size="sm">
                        Claim
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
