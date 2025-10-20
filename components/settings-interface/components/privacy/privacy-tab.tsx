"use client"

import type React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SettingsToggle } from "../shared/settings-toggle"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Lock, Eye, Cookie, Shield, AlertTriangle } from "lucide-react"
import type { PrivacySettings } from "../../types"

interface PrivacyTabProps {
  privacy: PrivacySettings
  onPrivacyChange: (updates: Partial<PrivacySettings>) => void
}

export const PrivacyTab: React.FC<PrivacyTabProps> = ({ privacy, onPrivacyChange }) => {
  const handleDataSharingChange = (key: keyof PrivacySettings["dataSharing"], value: boolean) => {
    onPrivacyChange({
      dataSharing: { ...privacy.dataSharing, [key]: value },
    })
  }

  const handleProfilePrivacyChange = (key: keyof PrivacySettings["profilePrivacy"], value: boolean) => {
    onPrivacyChange({
      profilePrivacy: { ...privacy.profilePrivacy, [key]: value },
    })
  }

  const handleCookiesChange = (key: keyof PrivacySettings["cookiesTracking"], value: boolean) => {
    onPrivacyChange({
      cookiesTracking: { ...privacy.cookiesTracking, [key]: value },
    })
  }

  const handleSecurityPrivacyChange = (key: keyof PrivacySettings["securityPrivacy"], value: boolean) => {
    onPrivacyChange({
      securityPrivacy: { ...privacy.securityPrivacy, [key]: value },
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Privacy Settings</h2>
        <p className="text-muted-foreground">Control how your data is used and shared</p>
      </div>

      <Alert>
        <Shield className="h-4 w-4" />
        <AlertDescription>
          Your privacy is important to us. These settings help you control how your data is collected, used, and shared.
          Changes may affect the functionality of certain features.
        </AlertDescription>
      </Alert>

      {/* Data Sharing */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Eye className="h-5 w-5" />
            <span>Data Sharing</span>
          </CardTitle>
          <CardDescription>Control how your data is shared for analytics and improvements</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsToggle
            id="analytics-sharing"
            label="Analytics Data"
            description="Share anonymized usage data to help improve our services"
            checked={privacy.dataSharing.analytics}
            onCheckedChange={(checked) => handleDataSharingChange("analytics", checked)}
          />

          <SettingsToggle
            id="marketing-sharing"
            label="Marketing Data"
            description="Allow use of your data for personalized marketing and recommendations"
            checked={privacy.dataSharing.marketing}
            onCheckedChange={(checked) => handleDataSharingChange("marketing", checked)}
          />

          <SettingsToggle
            id="third-party-sharing"
            label="Third-Party Sharing"
            description="Share data with trusted third-party partners for enhanced services"
            checked={privacy.dataSharing.thirdParty}
            onCheckedChange={(checked) => handleDataSharingChange("thirdParty", checked)}
          />

          <SettingsToggle
            id="research-sharing"
            label="Research Data"
            description="Contribute anonymized data for market research and analysis"
            checked={privacy.dataSharing.research}
            onCheckedChange={(checked) => handleDataSharingChange("research", checked)}
          />
        </CardContent>
      </Card>

      {/* Profile Privacy */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Lock className="h-5 w-5" />
            <span>Profile Privacy</span>
          </CardTitle>
          <CardDescription>Control the visibility of your profile and trading information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsToggle
            id="public-profile"
            label="Public Profile"
            description="Make your profile visible to other users"
            checked={privacy.profilePrivacy.publicProfile}
            onCheckedChange={(checked) => handleProfilePrivacyChange("publicProfile", checked)}
          />

          <SettingsToggle
            id="show-trading-stats"
            label="Show Trading Statistics"
            description="Display your trading performance statistics on your profile"
            checked={privacy.profilePrivacy.showTradingStats}
            onCheckedChange={(checked) => handleProfilePrivacyChange("showTradingStats", checked)}
            disabled={!privacy.profilePrivacy.publicProfile}
          />

          <SettingsToggle
            id="show-portfolio"
            label="Show Portfolio"
            description="Display your portfolio information on your profile"
            checked={privacy.profilePrivacy.showPortfolio}
            onCheckedChange={(checked) => handleProfilePrivacyChange("showPortfolio", checked)}
            disabled={!privacy.profilePrivacy.publicProfile}
          />

          <SettingsToggle
            id="allow-messages"
            label="Allow Messages"
            description="Allow other users to send you direct messages"
            checked={privacy.profilePrivacy.allowMessages}
            onCheckedChange={(checked) => handleProfilePrivacyChange("allowMessages", checked)}
          />

          {!privacy.profilePrivacy.publicProfile && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Your profile is currently private. Enable &quot;Public Profile&quot; to access additional sharing options.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Cookies & Tracking */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Cookie className="h-5 w-5" />
            <span>Cookies & Tracking</span>
          </CardTitle>
          <CardDescription>Manage cookie preferences and tracking settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsToggle
            id="essential-cookies"
            label="Essential Cookies"
            description="Required for basic site functionality and security"
            checked={privacy.cookiesTracking.essential}
            onCheckedChange={(checked) => handleCookiesChange("essential", checked)}
            disabled={true}
          />

          <SettingsToggle
            id="analytics-cookies"
            label="Analytics Cookies"
            description="Help us understand how you use our platform"
            checked={privacy.cookiesTracking.analytics}
            onCheckedChange={(checked) => handleCookiesChange("analytics", checked)}
          />

          <SettingsToggle
            id="marketing-cookies"
            label="Marketing Cookies"
            description="Used to deliver personalized advertisements"
            checked={privacy.cookiesTracking.marketing}
            onCheckedChange={(checked) => handleCookiesChange("marketing", checked)}
          />

          <SettingsToggle
            id="preferences-cookies"
            label="Preferences Cookies"
            description="Remember your settings and preferences"
            checked={privacy.cookiesTracking.preferences}
            onCheckedChange={(checked) => handleCookiesChange("preferences", checked)}
          />

          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Essential cookies cannot be disabled as they are required for the platform to function properly.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Security & Privacy */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Shield className="h-5 w-5" />
            <span>Security & Privacy</span>
          </CardTitle>
          <CardDescription>Advanced privacy and security tracking settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsToggle
            id="login-history"
            label="Login History Tracking"
            description="Keep a record of your login attempts and sessions"
            checked={privacy.securityPrivacy.loginHistory}
            onCheckedChange={(checked) => handleSecurityPrivacyChange("loginHistory", checked)}
          />

          <SettingsToggle
            id="device-tracking"
            label="Device Tracking"
            description="Track devices used to access your account for security"
            checked={privacy.securityPrivacy.deviceTracking}
            onCheckedChange={(checked) => handleSecurityPrivacyChange("deviceTracking", checked)}
          />

          <SettingsToggle
            id="location-tracking"
            label="Location Tracking"
            description="Track approximate location for security and compliance"
            checked={privacy.securityPrivacy.locationTracking}
            onCheckedChange={(checked) => handleSecurityPrivacyChange("locationTracking", checked)}
          />

          <SettingsToggle
            id="biometric-data"
            label="Biometric Data"
            description="Store biometric data for enhanced security (if supported)"
            checked={privacy.securityPrivacy.biometricData}
            onCheckedChange={(checked) => handleSecurityPrivacyChange("biometricData", checked)}
          />
        </CardContent>
      </Card>

      {/* Privacy Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Privacy Summary</CardTitle>
          <CardDescription>Overview of your current privacy settings</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {Object.values(privacy.dataSharing).filter(Boolean).length}/4
              </div>
              <div className="text-sm text-muted-foreground">Data Sharing</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {privacy.profilePrivacy.publicProfile ? "Public" : "Private"}
              </div>
              <div className="text-sm text-muted-foreground">Profile</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">
                {Object.values(privacy.cookiesTracking).filter(Boolean).length}/4
              </div>
              <div className="text-sm text-muted-foreground">Cookies</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                {Object.values(privacy.securityPrivacy).filter(Boolean).length}/4
              </div>
              <div className="text-sm text-muted-foreground">Security</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Privacy Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Privacy Actions</CardTitle>
          <CardDescription>Additional privacy-related actions you can take</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline">Download My Data</Button>
            <Button variant="outline">Delete Account Data</Button>
            <Button variant="outline">Privacy Policy</Button>
            <Button variant="outline">Cookie Policy</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
