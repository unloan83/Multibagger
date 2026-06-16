"use client";

import { useEffect, useState } from "react";
import { Download, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const zoomLevels = [0.9, 1, 1.1, 1.2] as const;
const dismissKey = "unloan-pwa-install-dismissed";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export function PwaExperienceControls() {
  const [zoomIndex, setZoomIndex] = useState(1);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const zoom = zoomLevels[zoomIndex];

  useEffect(() => {
    document.documentElement.style.setProperty("--app-zoom", String(zoom));
  }, [zoom]);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in window.navigator &&
        Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone));
    const platform = window.navigator.userAgent.toLowerCase();

    setIsStandalone(standalone);
    setIsIos(/iphone|ipad|ipod/.test(platform));
    setIsDismissed(window.sessionStorage.getItem(dismissKey) === "true");

    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setIsDismissed(false);
      window.sessionStorage.removeItem(dismissKey);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  async function installApp() {
    if (!installPrompt) {
      return;
    }

    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  function dismissPrompt() {
    window.sessionStorage.setItem(dismissKey, "true");
    setIsDismissed(true);
  }

  const showInstallPrompt = !isStandalone && !isDismissed;

  return (
    <section className="app-install-bar sticky top-0 z-[80] border-b border-sky-300/20 px-3 py-2 text-slate-100 shadow-lg backdrop-blur-md">
      <div className="mx-auto flex max-w-[1680px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {showInstallPrompt ? (
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white sm:text-sm">
                Add UNLOAN to your home screen for the best mobile view.
              </p>
              <p className="text-[11px] leading-5 text-slate-300 sm:text-xs">
                {installPrompt
                  ? "Install the PWA app and open it like a normal mobile app."
                  : isIos
                    ? "On iPhone/iPad: tap Share, then Add to Home Screen."
                    : "If the install button is unavailable, use your browser menu and choose Add to Home screen."}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-xs leading-5 text-slate-200 sm:text-sm">
            Tables can be swiped sideways. Use zoom controls for a wider mobile view.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {showInstallPrompt && installPrompt ? (
            <Button type="button" size="sm" onClick={installApp}>
              <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Install App
            </Button>
          ) : null}
          <span className="text-xs font-semibold text-slate-300">Zoom</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setZoomIndex((value) => Math.max(0, value - 1))}
            disabled={zoomIndex === 0}
          >
            -
          </Button>
          <span className="min-w-12 text-center text-xs font-semibold text-white">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setZoomIndex((value) => Math.min(zoomLevels.length - 1, value + 1))}
            disabled={zoomIndex === zoomLevels.length - 1}
          >
            +
          </Button>
          {showInstallPrompt ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={dismissPrompt}
              aria-label="Dismiss install prompt"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
