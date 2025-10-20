import { AlertCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { REFERRAL_TIPS } from "../constants"

export function ReferralTipsCard() {
  return (
    <Card>
      <CardHeader className="bg-muted/50 rounded-t-lg">
        <CardTitle className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          Tips for Successful Referrals
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-6">
        <div className="grid gap-6 md:grid-cols-2">
          {REFERRAL_TIPS.map((tip, index) => (
            <div key={index} className="space-y-2">
              <h3 className="font-medium">{tip.title}</h3>
              <p className="text-sm text-muted-foreground">{tip.description}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
