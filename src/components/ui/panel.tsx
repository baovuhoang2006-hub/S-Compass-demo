import * as React from "react";
import { cn } from "@/lib/utils";

export function Panel({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <section className={cn("sc-rise rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(20,33,61,0.04),0_10px_30px_-14px_rgba(20,33,61,0.14)]", className)} {...props} />;
}

export function PanelHeader({ title, note, actions, className }: { title: React.ReactNode; note?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-line bg-gradient-to-b from-[#f5f8fd] to-surface px-4 py-3", className)}>
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-base font-semibold leading-6 tracking-tight">
          <span className="h-4 w-1 shrink-0 rounded-full bg-gradient-to-b from-brand to-[#7a3ea8]" aria-hidden />
          <span className="min-w-0">{title}</span>
        </h2>
        {note ? <p className="pl-3 text-xs leading-5 text-ink-faint">{note}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
