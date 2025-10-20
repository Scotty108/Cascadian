"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";
import { AddPaymentMethodDialog } from "./components/add-payment-method-dialog";
import { BillingHistoryTab } from "./components/billing-history-tab";
import { CancelSubscriptionDialog } from "./components/cancel-subscription-dialog";
import { CurrentPlanCard } from "./components/current-plan-card";
import { EditPaymentMethodDialog } from "./components/edit-payment-method-dialog";
import { EnterpriseSolutionsCard } from "./components/enterprise-solutions-card";
import { FAQSection } from "./components/faq-section";
import { PaymentMethodsTab } from "./components/payment-methods-tab";
import { PlanComparisonCard } from "./components/plan-comparison-card";
import { SubscriptionSettingsTab } from "./components/subscription-settings-tab";
import { plans, usageData } from "./data";
import { useBilling } from "./hooks/use-billing";
import { usePaymentMethods } from "./hooks/use-payment-methods";
import { useSubscription } from "./hooks/use-subscription";
import type { PaymentMethod } from "./types";

export function SubscriptionInterface() {
  const [showAddPaymentDialog, setShowAddPaymentDialog] = useState(false);
  const [showEditPaymentDialog, setShowEditPaymentDialog] = useState(false);
  const [editingPaymentMethod, setEditingPaymentMethod] = useState<PaymentMethod | null>(null);

  const { billingCycle, toggleBillingCycle, currentPlan, settings, updateSetting, showCancelDialog, openCancelDialog, closeCancelDialog, upgradePlan, cancelSubscription } = useSubscription();

  const { billingHistory, downloadInvoice, viewInvoice, isDownloading } = useBilling();

  const { paymentMethods, setAsDefault, removePaymentMethod, addPaymentMethod, updatePaymentMethod, isLoading: isPaymentLoading } = usePaymentMethods();

  const handleAddPaymentMethod = () => {
    setShowAddPaymentDialog(true);
  };

  const handleEditPaymentMethod = (method: PaymentMethod) => {
    setEditingPaymentMethod(method);
    setShowEditPaymentDialog(true);
  };

  const handleCloseEditDialog = () => {
    setShowEditPaymentDialog(false);
    setEditingPaymentMethod(null);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Subscription</h1>
        <p className="text-muted-foreground">Manage your subscription plan and billing details.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <CurrentPlanCard currentPlan={currentPlan} billingCycle={billingCycle} usageData={usageData} onCancelSubscription={openCancelDialog} />

        <PlanComparisonCard plans={plans} billingCycle={billingCycle} currentPlan={currentPlan} onToggleBillingCycle={toggleBillingCycle} onUpgrade={upgradePlan} />
      </div>

      <Tabs defaultValue="billing">
        <div className="overflow-x-auto">
          <div className="min-w-[450px]">
            <TabsList className="grid w-full grid-cols-3 md:w-auto">
              <TabsTrigger value="billing">Billing History</TabsTrigger>
              <TabsTrigger value="payment">Payment Methods</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>
          </div>
        </div>

        <TabsContent value="billing" className="space-y-4 ">
          <BillingHistoryTab billingHistory={billingHistory} onDownloadInvoice={downloadInvoice} onViewInvoice={viewInvoice} isDownloading={isDownloading} />
        </TabsContent>

        <TabsContent value="payment" className="space-y-4">
          <PaymentMethodsTab
            paymentMethods={paymentMethods}
            onSetAsDefault={setAsDefault}
            onRemove={removePaymentMethod}
            onEdit={handleEditPaymentMethod}
            onAddNew={handleAddPaymentMethod}
            isLoading={isPaymentLoading}
          />
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <SubscriptionSettingsTab settings={settings} onUpdateSetting={updateSetting} />
        </TabsContent>
      </Tabs>

      <EnterpriseSolutionsCard />
      <FAQSection />

      <CancelSubscriptionDialog isOpen={showCancelDialog} onClose={closeCancelDialog} onConfirm={cancelSubscription} />

      <AddPaymentMethodDialog isOpen={showAddPaymentDialog} onClose={() => setShowAddPaymentDialog(false)} onAdd={addPaymentMethod} isLoading={isPaymentLoading} />

      <EditPaymentMethodDialog isOpen={showEditPaymentDialog} onClose={handleCloseEditDialog} onUpdate={updatePaymentMethod} method={editingPaymentMethod} isLoading={isPaymentLoading} />
    </div>
  );
}
