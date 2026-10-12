import { useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Btn, PageHeader, Panel } from "@/components/kit";
import { WhatsappSetup } from "@/components/whatsapp-setup";

export default function WhatsappSettingsPage({ platform = false }: { platform?: boolean }) {
  const [, navigate] = useLocation();
  return (
    <div className="space-y-5">
      <Btn variant="ghost" data-testid="button-back-messaging" onClick={() => navigate(platform ? "/platform/settings?tab=messaging" : "/settings/messaging")}>
        <ArrowLeft className="h-4 w-4" />Messaging
      </Btn>
      <PageHeader eyebrow="Settings" title={platform ? "WhatsApp configuration" : "WhatsApp number"} meta={platform ? "Manage the platform key and shared WhatsApp number." : "Connect and manage your school's WhatsApp number."} />
      <Panel><ul><WhatsappSetup platform={platform} /></ul></Panel>
    </div>
  );
}
