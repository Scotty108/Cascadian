import { Shield } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatDate, getSecurityBadgeVariant, getSecurityBadgeText } from "../../../utils"
import type { Wallet } from "../../../types"

interface SecurityStatusProps {
  wallet: Wallet
}

export function SecurityStatus({ wallet }: SecurityStatusProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Security Status</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-green-500" />
              <span className="font-medium">Security Level: {wallet.securityLevel}</span>
            </div>
            <Badge variant={getSecurityBadgeVariant(wallet.securityLevel)}>
              {getSecurityBadgeText(wallet.securityLevel)}
            </Badge>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm">Backup Status</span>
              <Badge variant="outline" className="bg-green-100 text-green-600">
                Complete
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Transaction Signing</span>
              <Badge variant="outline" className="bg-green-100 text-green-600">
                Hardware Key
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Last Activity</span>
              <span className="text-sm">{formatDate(wallet.lastActivity)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
