import { Children, isValidElement, type ComponentProps, type ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getFieldHelp, type HelpForm } from "@/lib/field-help";
import { cn } from "@/lib/utils";

export function FieldHelp({ field, form }: { field: string; form?: HelpForm }) {
  const text = getFieldHelp(field, form);
  if (!text) return null;
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Help for ${field}`}
          className="ml-1.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-slate-400 bg-white text-[11px] font-semibold leading-none tracking-normal text-slate-600 align-middle normal-case hover:border-slate-700 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          onClick={(event) => event.preventDefault()}
        >
          <span aria-hidden="true">?</span>
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        collisionPadding={12}
        className="z-[100] max-w-[min(24rem,calc(100vw-2rem)) whitespace-pre-line border border-slate-200 bg-white p-3 text-left text-sm font-normal normal-case leading-relaxed tracking-normal text-slate-800 shadow-lg"
      >
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

function labelText(children: ReactNode): string {
  return Children.toArray(children).map((child) => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    if (isValidElement<{ children?: ReactNode }>(child)) return labelText(child.props.children);
    return "";
  }).join("").trim();
}

/** Opt-in label for the spreadsheet-backed request/review forms only. */
export function HelpLabel({ children, className, ...props }: ComponentProps<typeof Label>) {
  const field = labelText(children);
  return (
    <span className={cn("inline-flex items-center", className)}>
      <Label {...props}>{children}</Label>
      <FieldHelp field={field} />
    </span>
  );
}
