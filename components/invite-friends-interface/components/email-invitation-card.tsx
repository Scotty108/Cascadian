"use client"

import { Mail } from "lucide-react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { useInvitations } from "../hooks/use-invitations"

export function EmailInvitationCard() {
  const { formData, isSending, updateFormData, sendInvitations } = useInvitations()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite via Email</CardTitle>
        <CardDescription>Send personalized invitations directly to your friends&apos; email addresses</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="emails">Email Addresses</Label>
          <Input
            id="emails"
            placeholder="friend@example.com, another@example.com"
            value={formData.emails}
            onChange={(e) => updateFormData({ emails: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">Separate multiple emails with commas</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="message">Personal Message</Label>
          <Textarea
            id="message"
            placeholder="Add a personal message..."
            value={formData.message}
            onChange={(e) => updateFormData({ message: e.target.value })}
            className="min-h-[100px]"
          />
        </div>
      </CardContent>
      <CardFooter>
        <Button onClick={sendInvitations} className="w-full" disabled={isSending}>
          <Mail className="mr-2 h-4 w-4" />
          {isSending ? "Sending..." : "Send Invitations"}
        </Button>
      </CardFooter>
    </Card>
  )
}
