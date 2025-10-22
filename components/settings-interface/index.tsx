"use client";

import type React from "react";
import { toast } from "sonner";
import { AppearanceTab } from "./components/appearance/appearance-tab";
import { ConnectionsTab } from "./components/connections/connections-tab";
import { DataTab } from "./components/data/data-tab";
import { NotificationsTab } from "./components/notifications/notifications-tab";
import { ProfileTab } from "./components/profile/profile-tab";
import { SecurityTab } from "./components/security/security-tab";
import { SettingsSidebar } from "./components/settings-sidebar";
import { SaveButton } from "./components/shared/save-button";
import { useSettings } from "./hooks/use-settings";

export const SettingsInterface: React.FC = () => {
  const {
    settings,
    isLoading,
    isSaving,
    updateProfile,
    updateSecurity,
    updateNotifications,
    updateAppearance,
    updateData,
    setActiveTab,
    saveSettings,
    resetSettings,
  } = useSettings();

  const handleSave = async () => {
    const result = await saveSettings();
    if (result.success) {
      toast.success("Settings saved successfully");
    } else {
      toast.error(result.error || "Failed to save settings");
    }
  };

  const handleConnectionsChange = (connections: any[]) => {
    // Update connections in settings state
    // This would typically be handled by a separate hook or state management
    console.log("Connections updated:", connections);
  };

  const renderActiveTab = () => {
    switch (settings.activeTab) {
      case "profile":
        return <ProfileTab profile={settings.profile} onProfileChange={updateProfile} />;

      case "security":
        return (
          <SecurityTab
            security={settings.security}
            apiKeys={settings.apiKeys}
            sessions={settings.sessions}
            loginHistory={settings.loginHistory}
            onSecurityChange={updateSecurity}
            onApiKeysChange={(apiKeys) => updateSecurity({ apiKeysEnabled: apiKeys.length > 0 })}
            onSessionsChange={() => {}} // Sessions are managed separately
          />
        );

      case "notifications":
        return <NotificationsTab notifications={settings.notifications} onNotificationsChange={updateNotifications} />;

      case "appearance":
        return <AppearanceTab appearance={settings.appearance} onAppearanceChange={updateAppearance} />;

      case "data":
        return <DataTab data={settings.data} onDataChange={updateData} />;

      case "connections":
        return <ConnectionsTab connections={settings.connections} onConnectionsChange={handleConnectionsChange} />;

      default:
        return (
          <div className="flex items-center justify-center h-64">
            <div className="text-center space-y-2">
              <h3 className="text-lg font-medium">Settings Tab</h3>
              <p className="text-muted-foreground">Select a settings category from the sidebar</p>
            </div>
          </div>
        );
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-2">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#00E0AA] mx-auto"></div>
          <p className="text-muted-foreground">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-md:flex-col h-screen bg-background w-full">
      <SettingsSidebar activeTab={settings.activeTab} onTabChange={setActiveTab} hasUnsavedChanges={settings.hasUnsavedChanges} />

      <div className="flex-1 flex flex-col">
        <div className="flex-1 overflow-auto">
          <div className="p-6">{renderActiveTab()}</div>
        </div>

        {settings.hasUnsavedChanges && (
          <div className="border-t bg-background p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-muted-foreground">You have unsaved changes</p>
              <div className="flex space-x-2">
                <SaveButton onSave={handleSave} isSaving={isSaving} hasUnsavedChanges={settings.hasUnsavedChanges} />
                <button onClick={resetSettings} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
                  Discard Changes
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
