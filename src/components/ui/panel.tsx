import * as React from "react";
import { cn } from "@/lib/utils";

export function Panel({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <section className={cn("sc-rise rounded-xl border border-line border-t-[3px] border-t-navy-2 bg-surface shadow-[0_1px_2px_rgba(20,33,61,0.04),0_4px_14px_-6px_rgba(20,33,61,0.08)]", className)} {...props} />;
}

export function PanelHeader({ title, note, actions, className }: { title: React.ReactNode; note?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-line/60 bg-gradient-to-b from-[#f4f7fc] to-surface px-5 py-3.5", className)}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold leading-6 tracking-tight">{title}</h2>
        {note ? <p className="text-xs leading-5 text-ink-faint">{note}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
