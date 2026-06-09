"use client";

/** Tiny window-event bus wiring the topbar/palette/quick-log together. */

export function openPalette() {
  window.dispatchEvent(new CustomEvent("kinetico:palette"));
}

export function openQuickLog(type?: string, dealId?: string) {
  window.dispatchEvent(
    new CustomEvent("kinetico:quicklog", { detail: { type, dealId } }),
  );
}
