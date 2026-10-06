"use client";

import { useEffect, useState } from "react";
import { Icon } from "./ui";

/**
 * A one-time tip on phones: put OpenCall on the home screen (6 Oct).
 *
 * Installing already worked — the app has a manifest, icons and a service
 * worker, and opens full screen without the browser's bars once installed —
 * but nothing told anybody. Shown once per device, never when already
 * installed, never during a live show (`hidden`), and gone for good when
 * closed. Android hands the page an install prompt of its own, so there it is
 * a real Install button; iPhone does not, so it says where the two taps are.
 */
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const KEY = "oc:installhint";

export function InstallHint({ hidden = false }: { hidden?: boolean }) {
  const [show, setShow] = useState(false);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const installed =
      window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(KEY) === "done";
    } catch {
      // Private browsing: no memory of it, so it may show again. Harmless.
    }
    if (installed || dismissed || !window.matchMedia("(max-width: 760px)").matches) return;
    setIos(/iPhone|iPad|iPod/.test(navigator.userAgent));
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    // Not the instant the page opens: let them see the sheet first.
    const t = window.setTimeout(() => setShow(true), 4000);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.clearTimeout(t);
    };
  }, []);

  const done = () => {
    setShow(false);
    try {
      localStorage.setItem(KEY, "done");
    } catch {
      // see above
    }
  };

  if (!show || hidden) return null;
  return (
    <div className="install-hint no-print" role="status">
      <div className="install-hint-text">
        <strong>Put OpenCall on your home screen</strong>
        <span>
          {prompt
            ? "It opens full screen, like an app."
            : ios
              ? "Tap the Share button (the square with an arrow), then Add to Home Screen. It opens full screen, like an app."
              : "Open your browser's menu (⋮), then Install app or Add to Home screen. It opens full screen, like an app."}
        </span>
      </div>
      {prompt && (
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => {
            void prompt.prompt().finally(done);
          }}
        >
          Install
        </button>
      )}
      <button type="button" className="install-hint-close" aria-label="Don't show this again" onClick={done}>
        {Icon.close}
      </button>
    </div>
  );
}
