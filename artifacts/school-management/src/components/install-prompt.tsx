import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

const DISMISSED_KEY = "rejista.install.dismissed";
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

/**
 * On a phone, offers to put the app on the home screen, where it opens full-screen like any other app.
 * Android gives a real install button; an iPhone has no such button, so it gets the two taps to do it by hand.
 * Shown once: dismissing it, or installing, puts it away for good.
 */
export function InstallPrompt() {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [steps, setSteps] = useState(false);
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    let dismissed = false;
    try { dismissed = localStorage.getItem(DISMISSED_KEY) === "1"; } catch { /* storage unavailable */ }
    if (standalone || dismissed) return;
    setHidden(false);
    const agent = navigator.userAgent;
    setIos(/iPhone|iPad|iPod/.test(agent) && /Safari/.test(agent) && !/CriOS|FxiOS|EdgiOS/.test(agent));
    const ready = (e: Event) => { e.preventDefault(); setEvent(e as InstallEvent); };
    const installed = () => setHidden(true);
    window.addEventListener("beforeinstallprompt", ready);
    window.addEventListener("appinstalled", installed);
    return () => { window.removeEventListener("beforeinstallprompt", ready); window.removeEventListener("appinstalled", installed); };
  }, []);
  const dismiss = () => { setHidden(true); try { localStorage.setItem(DISMISSED_KEY, "1"); } catch { /* storage unavailable */ } };
  if (hidden || (!event && !ios)) return null;
  return (
    // Floats above the bottom bar on the left, clear of the page and of a page's own add button on the right. Android installs on a tap; an iPhone has no install
    // button, so a tap there opens the two steps to do it by hand.
    <div data-testid="install-prompt" className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-3 z-30 flex max-w-[calc(100vw-1.5rem)] items-center rounded-full bg-foreground text-background shadow-[0_10px_28px_-10px_rgba(0,0,0,.6)] md:hidden">
      <button type="button" data-testid="button-install-app" onClick={async () => { if (!event) return setSteps((v) => !v); await event.prompt(); await event.userChoice.catch(() => null); dismiss(); }} className="flex h-10 items-center gap-2 pl-3.5 pr-2 text-[13px] font-semibold">
        <Download className="h-4 w-4 shrink-0" />
        {steps && !event ? <span className="font-normal">Tap <Share className="mb-0.5 inline h-3.5 w-3.5" /> Share, then <b>Add to Home Screen</b></span> : "Install app"}
      </button>
      <button type="button" aria-label="Not now" data-testid="button-install-dismiss" onClick={dismiss} className="flex h-10 w-9 items-center justify-center rounded-full text-background/70"><X className="h-4 w-4" /></button>
    </div>
  );
}
