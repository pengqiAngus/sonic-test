import { cn } from "@/lib/utils";

interface PanelProps {
  title: string;
  eyebrow?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}

export function Panel({
  title,
  eyebrow,
  description,
  children,
  className,
  action
}: PanelProps): React.ReactElement {
  return (
    <section className={cn("glass-panel rounded-[28px] p-5 md:p-6", className)}>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          {eyebrow ? (
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h2>
          {description ? <p className="mt-2 text-sm text-slate-600">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
