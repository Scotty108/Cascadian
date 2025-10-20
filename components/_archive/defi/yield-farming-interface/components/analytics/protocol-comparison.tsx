"use client"

import Image from "next/image";
import { ExternalLink } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

const protocolData = [
  {
    name: "Aave",
    logo: "/placeholder.svg?height=32&width=32",
    averageApy: 9.8,
    totalTvl: 5200000000,
    risk: "Low",
    chains: ["/ethereum-logo-abstract.png", "/placeholder-qj1jv.png", "/placeholder-esl16.png"],
    features: ["Lending", "Borrowing", "Flash Loans"],
  },
  {
    name: "Curve",
    logo: "/placeholder.svg?height=32&width=32",
    averageApy: 8.5,
    totalTvl: 3800000000,
    risk: "Low",
    chains: ["/ethereum-logo-abstract.png", "/placeholder-qj1jv.png", "/placeholder-esl16.png"],
    features: ["Stablecoin LP", "Low Slippage", "Gauges"],
  },
  {
    name: "Uniswap",
    logo: "/placeholder.svg?height=32&width=32",
    averageApy: 15.2,
    totalTvl: 4500000000,
    risk: "Medium",
    chains: [
      "/ethereum-logo-abstract.png",
      "/placeholder-qj1jv.png",
      "/placeholder-esl16.png",
      "/bnb-logo-abstract.png",
    ],
    features: ["LP", "Concentrated Liquidity", "V3"],
  },
]

export function ProtocolComparison() {
  const formatTvl = (value: number) => {
    return `$${(value / 1000000000).toFixed(1)}B`
  }

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case "Low":
        return "bg-emerald-500"
      case "Medium":
        return "bg-yellow-500"
      case "High":
        return "bg-orange-500"
      default:
        return "bg-gray-500"
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Protocol Comparison</CardTitle>
        <CardDescription>Compare key metrics across different yield farming protocols</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Protocol</TableHead>
              <TableHead className="text-right">Average APY</TableHead>
              <TableHead className="text-right">Total TVL</TableHead>
              <TableHead>Risk Profile</TableHead>
              <TableHead>Supported Chains</TableHead>
              <TableHead>Features</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {protocolData.map((protocol) => (
              <TableRow key={protocol.name}>
                <TableCell>
                  <div className="flex items-center">
                    <Image
                      src={protocol.logo || "/placeholder.svg"}
                      alt={protocol.name}
                      width={32}
                      height={32}
                      className="mr-2 h-8 w-8 rounded-full"
                    />
                    <div className="font-medium">{protocol.name}</div>
                  </div>
                </TableCell>
                <TableCell className="text-right">{protocol.averageApy}%</TableCell>
                <TableCell className="text-right">{formatTvl(protocol.totalTvl)}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={`${getRiskColor(protocol.risk)} text-white`}>
                    {protocol.risk}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex space-x-1">
                    {protocol.chains.map((chain, index) => (
                      <Image key={index} src={chain || "/placeholder.svg"} alt="Chain" width={20} height={20} className="h-5 w-5 rounded-full" />
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex space-x-1">
                    {protocol.features.map((feature, index) => (
                      <Badge key={index} variant="secondary" className="text-xs">
                        {feature}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="sm">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Visit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
