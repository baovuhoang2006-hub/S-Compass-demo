"use client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, title, description, wide }: { className?: string; children: React.ReactNode; title: string; description?: string; wide?: boolean }) {
  const opener = React.useRef<HTMLElement | null>(null);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dialog-overlay fixed inset-0 z-40 bg-ink/40" />
      <DialogPrimitive.Content
        onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={(event) => {
          if (opener.current?.isConnected) {
            event.preventDefault();
            opener.current.focus({ preventScroll: true });
          }
        }}
        className={cn(
          "dialog-surface fixed inset-x-0 bottom-0 z-50 max-h-[92vh] overflow-y-auto rounded-t-2xl bg-surface shadow-xl outline-none sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[min(92vw,640px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl",
          wide && "sm:w-[min(94vw,980px)]",
          className,
        )}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-surface px-5 py-4">
          <div>
            <DialogPrimitive.Title className="text-lg font-semibold leading-7">{title}</DialogPrimitive.Title>
            {description ? <DialogPrimitive.Description className="text-sm text-ink-faint">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
          </div>
          <DialogPrimitive.Close className="rounded-md p-1 text-ink-faint hover:bg-canvas hover:text-ink" aria-label="Close">
            <X className="size-5" />
          </DialogPrimitive.Close>
        </div>
        <div className="px-5 py-4">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
