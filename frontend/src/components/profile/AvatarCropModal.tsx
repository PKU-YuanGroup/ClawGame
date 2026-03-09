"use client";

import { useRef } from "react";
import { useI18n } from "@/lib/i18n";

export function AvatarCropModal({
  open,
  src,
  scale,
  offsetX,
  offsetY,
  setScale,
  setOffsetX,
  setOffsetY,
  onCancel,
  onApply,
}: {
  open: boolean;
  src: string;
  scale: number;
  offsetX: number;
  offsetY: number;
  setScale: (n: number) => void;
  setOffsetX: (n: number) => void;
  setOffsetY: (n: number) => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  const { t } = useI18n();
  const dragRef = useRef({ dragging: false, sx: 0, sy: 0, ox: 0, oy: 0 });
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-4">
        <div className="text-sm font-semibold">{t("profile.avatarCrop")}</div>
        <div className="mt-3 flex justify-center">
          <div
            className="relative h-64 w-64 overflow-hidden rounded-full border-2 border-orange-400 bg-slate-800 cursor-move"
            onMouseDown={(e) => {
              dragRef.current = { dragging: true, sx: e.clientX, sy: e.clientY, ox: offsetX, oy: offsetY };
            }}
            onMouseMove={(e) => {
              if (!dragRef.current.dragging) return;
              setOffsetX(dragRef.current.ox + (e.clientX - dragRef.current.sx));
              setOffsetY(dragRef.current.oy + (e.clientY - dragRef.current.sy));
            }}
            onMouseUp={() => (dragRef.current.dragging = false)}
            onMouseLeave={() => (dragRef.current.dragging = false)}
            onWheel={(e) => {
              e.preventDefault();
              setScale(Math.max(0.6, Math.min(2.4, scale + (e.deltaY < 0 ? 0.05 : -0.05))));
            }}
            title={t("profile.moveZoomHint")}
          >
            <img
              src={src}
              alt="crop"
              style={{
                transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
                transformOrigin: "center center",
                width: "100%",
                height: "100%",
                objectFit: "cover",
                userSelect: "none",
                pointerEvents: "none",
              }}
            />
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-400">{t("profile.moveZoomHint")}</div>
        <div className="mt-3 flex justify-end gap-2">
          <button className="rounded border border-slate-700 px-3 py-1.5 text-sm" onClick={onCancel}>{t("profile.cancel")}</button>
          <button className="rounded bg-orange-500 px-3 py-1.5 text-sm font-semibold text-white" onClick={onApply}>{t("profile.apply")}</button>
        </div>
      </div>
    </div>
  );
}
