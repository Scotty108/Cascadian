"use client"

import Image from "next/image";
import type React from "react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { QrCode, Smartphone, Shield, Copy, Check } from "lucide-react"
import { toast } from "sonner"

interface TwoFactorSectionProps {
  isEnabled: boolean
  onToggle: (enabled: boolean) => void
}

export const TwoFactorSection: React.FC<TwoFactorSectionProps> = ({ isEnabled, onToggle }) => {
  const [isSetupMode, setIsSetupMode] = useState(false)
  const [verificationCode, setVerificationCode] = useState("")
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const secretKey = "JBSWY3DPEHPK3PXP"
  const qrCodeUrl = `otpauth://totp/DeFiBotX:user@example.com?secret=${secretKey}&issuer=DeFiBotX`

  const handleEnable2FA = async () => {
    if (!verificationCode) {
      toast.error("Please enter the verification code")
      return
    }

    setIsLoading(true)
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Generate backup codes
      const codes = Array.from({ length: 8 }, () => Math.random().toString(36).substring(2, 8).toUpperCase())
      setBackupCodes(codes)

      onToggle(true)
      setIsSetupMode(false)
      toast.success("Two-factor authentication enabled successfully")
    } catch (error) {
      toast.error("Failed to enable 2FA. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleDisable2FA = async () => {
    setIsLoading(true)
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000))

      onToggle(false)
      setBackupCodes([])
      toast.success("Two-factor authentication disabled")
    } catch (error) {
      toast.error("Failed to disable 2FA. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedCode(text)
      setTimeout(() => setCopiedCode(null), 2000)
      toast.success("Copied to clipboard")
    } catch (error) {
      toast.error("Failed to copy to clipboard")
    }
  }

  if (isSetupMode) {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-4">
          <div className="mx-auto w-48 h-48 bg-white p-4 rounded-lg border">
            <Image
              src={`/placeholder.svg?height=192&width=192&query=QR+code+for+2FA+setup`}
              alt="2FA QR Code"
              width={192}
              height={192}
              className="w-full h-full"
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Scan this QR code with your authenticator app</p>
            <div className="flex items-center justify-center space-x-2">
              <code className="px-2 py-1 bg-muted rounded text-sm">{secretKey}</code>
              <Button variant="ghost" size="sm" onClick={() => copyToClipboard(secretKey)}>
                {copiedCode === secretKey ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="verificationCode">Verification Code</Label>
          <Input
            id="verificationCode"
            value={verificationCode}
            onChange={(e) => setVerificationCode(e.target.value)}
            placeholder="Enter 6-digit code from your app"
            maxLength={6}
          />
        </div>

        <div className="flex space-x-2">
          <Button onClick={handleEnable2FA} disabled={isLoading}>
            {isLoading ? "Verifying..." : "Enable 2FA"}
          </Button>
          <Button variant="outline" onClick={() => setIsSetupMode(false)}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <Shield className="h-4 w-4" />
            <span className="font-medium">Two-Factor Authentication</span>
            <Badge variant={isEnabled ? "default" : "secondary"}>{isEnabled ? "Enabled" : "Disabled"}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">Add an extra layer of security to your account</p>
        </div>

        {!isEnabled ? (
          <Button onClick={() => setIsSetupMode(true)}>
            <Smartphone className="mr-2 h-4 w-4" />
            Enable 2FA
          </Button>
        ) : (
          <Button variant="destructive" onClick={handleDisable2FA} disabled={isLoading}>
            {isLoading ? "Disabling..." : "Disable 2FA"}
          </Button>
        )}
      </div>

      {isEnabled && backupCodes.length > 0 && (
        <div className="p-4 border rounded-lg space-y-3">
          <div className="flex items-center space-x-2">
            <QrCode className="h-4 w-4" />
            <span className="font-medium">Backup Codes</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Save these backup codes in a safe place. You can use them to access your account if you lose your
            authenticator device.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {backupCodes.map((code, index) => (
              <div key={index} className="flex items-center justify-between p-2 bg-muted rounded">
                <code className="text-sm">{code}</code>
                <Button variant="ghost" size="sm" onClick={() => copyToClipboard(code)}>
                  {copiedCode === code ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
