"use client"

import type React from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { UserProfile } from "../../types"
import { validateEmail, validatePhone } from "../../utils"

interface ProfileFormProps {
  profile: UserProfile
  onProfileChange: (updates: Partial<UserProfile>) => void
}

export const ProfileForm: React.FC<ProfileFormProps> = ({ profile, onProfileChange }) => {
  const handleInputChange =
    (field: keyof UserProfile) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onProfileChange({ [field]: event.target.value })
    }

  const isEmailValid = validateEmail(profile.email)
  const isPhoneValid = validatePhone(profile.phone)

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label htmlFor="firstName">First Name</Label>
        <Input
          id="firstName"
          value={profile.firstName}
          onChange={handleInputChange("firstName")}
          placeholder="Enter your first name"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="lastName">Last Name</Label>
        <Input
          id="lastName"
          value={profile.lastName}
          onChange={handleInputChange("lastName")}
          placeholder="Enter your last name"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email Address</Label>
        <Input
          id="email"
          type="email"
          value={profile.email}
          onChange={handleInputChange("email")}
          placeholder="Enter your email"
          className={!isEmailValid && profile.email ? "border-destructive" : ""}
        />
        {!isEmailValid && profile.email && (
          <p className="text-sm text-destructive">Please enter a valid email address</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="phone">Phone Number</Label>
        <Input
          id="phone"
          type="tel"
          value={profile.phone}
          onChange={handleInputChange("phone")}
          placeholder="Enter your phone number"
          className={!isPhoneValid && profile.phone ? "border-destructive" : ""}
        />
        {!isPhoneValid && profile.phone && (
          <p className="text-sm text-destructive">Please enter a valid phone number</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="location">Location</Label>
        <Input
          id="location"
          value={profile.location}
          onChange={handleInputChange("location")}
          placeholder="Enter your location"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="website">Website</Label>
        <Input
          id="website"
          type="url"
          value={profile.website}
          onChange={handleInputChange("website")}
          placeholder="https://your-website.com"
        />
      </div>

      <div className="md:col-span-2 space-y-2">
        <Label htmlFor="bio">Bio</Label>
        <Textarea
          id="bio"
          value={profile.bio}
          onChange={handleInputChange("bio")}
          placeholder="Tell us about yourself..."
          rows={3}
        />
      </div>
    </div>
  )
}
