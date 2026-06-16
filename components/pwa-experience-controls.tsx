"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const zoomLevels = [0.9, 1, 1.1, 1.2] as const;

export function PwaExperienceControls() {
  const [zoomIndex, setZoomIndex] = useState(1);
  const zoom = zoomLevels[zoomIndex];

  useEffect(() => {
    document.documentElement.style.setProperty("--app-zoom", String(zoom));
  }, [zoom]);

  return (
    <section className="app-install-bar sticky top-0 z-40 border-b border-sky-300/20 px-3 py-2 text-slate-100 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1680px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-slate-200 sm:text-sm">
          For the best mobile/PWA view, add UNLOAN to your home screen. Tables can be
          swiped sideways.
        </p>
        <div className="flex items-center gap-2">
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
        </div>
      </div>
    </section>
  );
}
