import { Clock, CheckCircle2 } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import type { Referral } from "../types"

interface ReferralItemProps {
  referral: Referral
}

export function ReferralItem({ referral }: ReferralItemProps) {
  return (
    <div className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0">
      <div className="flex items-center gap-3">
        <Avatar>
          <AvatarFallback>{referral.name.charAt(0)}</AvatarFallback>
        </Avatar>
        <div>
          <p className="font-medium">{referral.name}</p>
          <p className="text-sm text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {referral.date}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Badge variant={referral.status === "active" ? "default" : "outline"}>
          {referral.status === "active" ? (
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Active
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Pending
            </span>
          )}
        </Badge>
        {referral.status === "active" && <span className="font-medium text-sm">${referral.reward}</span>}
      </div>
    </div>
  )
}
