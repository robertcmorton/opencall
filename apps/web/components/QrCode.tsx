"use client";

import { useMemo } from "react";
import qrcode from "qrcode-generator";

/**
 * A QR code for a link (21 Oct, Robert: "create a QR code for the view-only
 * links section"). The crew point a phone camera at the screen, or at a
 * printout on the wall, and the sheet opens — no typing a six-letter code.
 *
 * Drawn as an SVG from the code's own grid: one path, dark on white with the
 * standard four-module quiet zone, which cameras need whatever the page
 * theme is. Medium error correction survives a glare spot or a crease.
 */
export function QrCode({ value, size = 220, label }: { value: string; size?: number; label: string }) {
  const { n, d } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    let path = "";
    for (let r = 0; r < count; r++)
      for (let c = 0; c < count; c++) if (qr.isDark(r, c)) path += `M${c + 4} ${r + 4}h1v1h-1z`;
    return { n: count + 8, d: path };
  }, [value]);
  return (
    <svg className="qr-code" width={size} height={size} viewBox={`0 0 ${n} ${n}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
