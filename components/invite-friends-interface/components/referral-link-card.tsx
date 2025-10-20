"use client"

import { Copy, CheckCircle2, QrCode } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useSharing } from "../hooks/use-sharing"
import { SocialSharingButtons } from "./social-sharing-buttons"
import { QRCodeDisplay } from "./qr-code-display"
import { DEFAULT_REFERRAL_MESSAGE } from "../constants"

interface ReferralLinkCardProps {
  referralLink: string
}

export function ReferralLinkCard({ referralLink }: ReferralLinkCardProps) {
  const { copied, showQRCode, copyToClipboard, toggleQRCode } = useSharing()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Referral Link</CardTitle>
        <CardDescription>Share this unique link with your friends to start earning rewards</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center space-x-2">
          <Input value={referralLink} readOnly className="font-mono text-sm" />
          <Button variant="outline" size="icon" onClick={() => copyToClipboard(referralLink)} className="shrink-0">
            {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="flex items-center gap-1" onClick={toggleQRCode}>
              <QrCode className="h-4 w-4" />
              {showQRCode ? "Hide QR Code" : "Show QR Code"}
            </Button>
          </div>

          <SocialSharingButtons url={referralLink} message={DEFAULT_REFERRAL_MESSAGE} />
        </div>

        {showQRCode && <QRCodeDisplay data={referralLink} />}
      </CardContent>
    </Card>
  )
}
