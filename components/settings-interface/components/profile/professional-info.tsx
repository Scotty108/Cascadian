"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type React from "react";
import type { UserProfile } from "../../types";

interface ProfessionalInfoProps {
  profile: UserProfile;
  onProfileChange: (updates: Partial<UserProfile>) => void;
}

const EXPERIENCE_OPTIONS = [
  { value: "beginner", label: "Beginner (< 1 year)" },
  { value: "1-2", label: "1-2 years" },
  { value: "3-5", label: "3-5 years" },
  { value: "5+", label: "5+ years" },
  { value: "10+", label: "10+ years" },
];

export const ProfessionalInfo: React.FC<ProfessionalInfoProps> = ({ profile, onProfileChange }) => {
  const handleInputChange = (field: keyof UserProfile) => (event: React.ChangeEvent<HTMLInputElement>) => {
    onProfileChange({ [field]: event.target.value });
  };

  const handleExperienceChange = (value: string) => {
    onProfileChange({ experience: value });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label htmlFor="company">Company</Label>
        <Input id="company" value={profile.company || ""} onChange={handleInputChange("company")} placeholder="Enter your company name" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="position">Position</Label>
        <Input id="position" value={profile.position || ""} onChange={handleInputChange("position")} placeholder="Enter your job title" />
      </div>

      
    </div>
  );
};
