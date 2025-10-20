"use client"

import { MessageSquare, MessageCircle, Mail, Clock, CheckCircle2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SupportTeamMemberAvatar } from "./support-team-member"
import { SUPPORT_TEAM, CONTACT_INFO } from "../data"

interface ContactSupportSectionProps {
  onLiveChatClick?: () => void
  onEmailClick?: () => void
}

export function ContactSupportSection({ onLiveChatClick, onEmailClick }: ContactSupportSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
          <MessageSquare className="mr-2 h-5 w-5" />
          Contact Support
        </CardTitle>
        <CardDescription>Get personalized help from our team</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex flex-col space-y-2">
            <h4 className="text-sm font-medium">Support Team</h4>
            <div className="flex -space-x-2">
              {SUPPORT_TEAM.map((member) => (
                <SupportTeamMemberAvatar key={member.name} member={member} />
              ))}
            </div>
          </div>

          <Separator />

          <div className="grid gap-4">
            <div className="flex items-center">
              <div className="mr-4 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <MessageCircle className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h4 className="text-sm font-medium">Live Chat</h4>
                <p className="text-xs text-muted-foreground">{CONTACT_INFO.availability}</p>
              </div>
            </div>

            <div className="flex items-center">
              <div className="mr-4 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <Mail className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h4 className="text-sm font-medium">Email Support</h4>
                <p className="text-xs text-muted-foreground">{CONTACT_INFO.email}</p>
              </div>
            </div>

            <div className="flex items-center">
              <div className="mr-4 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <Clock className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h4 className="text-sm font-medium">Response Time</h4>
                <div className="flex items-center">
                  <CheckCircle2 className="mr-1 h-3 w-3 text-green-500" />
                  <p className="text-xs text-muted-foreground">{CONTACT_INFO.responseTime}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex flex-col space-y-2">
        <Button className="w-full" onClick={onLiveChatClick}>
          <MessageSquare className="mr-2 h-4 w-4" />
          Start Live Chat
        </Button>
        <Button variant="outline" className="w-full" onClick={onEmailClick}>
          <Mail className="mr-2 h-4 w-4" />
          Send Email
        </Button>
      </CardFooter>
    </Card>
  )
}
