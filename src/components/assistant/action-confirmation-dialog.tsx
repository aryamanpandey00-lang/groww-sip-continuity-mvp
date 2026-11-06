"use client";

import { useEffect, useRef } from "react";
import type { PublicActionPreview } from "@/lib/assistant/action-contracts";

export function ActionConfirmationDialog({
  open,
  preview,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  preview: PublicActionPreview | null;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const restoreFocus = () => {
      const previousFocus = returnFocusRef.current;
      returnFocusRef.current = null;
      const fallbackFocus = document.getElementById("demo-practice-title");
      if (previousFocus?.isConnected) {
        previousFocus.focus();
      } else if (fallbackFocus instanceof HTMLElement) {
        fallbackFocus.focus();
      }
    };

    if (open && !dialog.open) {
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      dialog.showModal();
      cancelButtonRef.current?.focus();
    }
    if (!open && dialog.open) {
      dialog.close();
      restoreFocus();
    }

    return () => {
      if (dialog.open) dialog.close();
      restoreFocus();
    };
  }, [open]);

  if (!preview || !preview.previewId || !preview.requiresConfirmation) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby="simulated-action-confirm-title"
      aria-describedby="simulated-action-confirm-description"
      aria-busy={pending}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-line bg-white p-0 text-ink shadow-2xl backdrop:bg-black/40"
    >
      <div className="p-5 sm:p-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-groww-dark">
          Explicit confirmation required
        </p>
        <h2 id="simulated-action-confirm-title" className="mt-2 text-lg font-semibold">
          Confirm simulated action?
        </h2>
        <p id="simulated-action-confirm-description" className="mt-2 text-sm leading-6 text-muted">
          You are confirming a fictional demo action: <span className="break-words font-semibold text-ink">{preview.actionTitle}</span> for <span className="break-words">{preview.sipContext.fundName}</span>. This will update only the signed demo session. No real payment, investment, or account change will occur.
        </p>
        {preview.proposedChange ? (
          <p className="mt-4 break-words rounded-xl border border-line bg-surface p-3 text-sm leading-6">
            {preview.proposedChange}
          </p>
        ) : null}
        {pending ? (
          <p role="status" aria-live="polite" className="mt-4 text-sm text-muted">
            Confirming the simulated action. No real payment is being made.
          </p>
        ) : null}
        {error ? (
          <p role="alert" aria-live="assertive" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-5 text-amber-900">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelButtonRef}
            type="button"
            autoFocus
            disabled={pending}
            onClick={onCancel}
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-groww-dark focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-groww px-4 py-2 text-sm font-semibold text-[#042f25] transition hover:bg-[#00bd8d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-groww-dark focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Processing…" : "Confirm simulated action"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
