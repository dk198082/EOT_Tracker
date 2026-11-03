import { forwardRef, useRef, useState, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { CURRENCY_SYMBOLS } from "@/lib/money";
import { cn } from "@/lib/utils";

type Props = ComponentProps<typeof Input> & { currency?: string; range?: boolean };

export const MoneyInput = forwardRef<HTMLInputElement, Props>(function MoneyInput(
  { currency = "USD", range = false, className, onChange, onKeyDown, onFocus, onBlur, onPaste, value, defaultValue, ...props }, ref,
) {
  const previous = useRef(String(value ?? defaultValue ?? ""));
  const focusStart = useRef(previous.current);
  const rejectedTyping = useRef(false);
  const [entryError, setEntryError] = useState(false);
  return (
    <div className="min-w-0 flex-1">
      <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-600" aria-hidden="true">
        {CURRENCY_SYMBOLS[currency] ?? currency}
      </span>
      <Input {...props} ref={ref} value={value} defaultValue={defaultValue}
        type={range ? "text" : "number"} inputMode="numeric" min="0" step="1"
        className={cn("pl-7", className)}
        aria-invalid={entryError || props["aria-invalid"]}
        onFocus={(event) => {
          previous.current = focusStart.current = event.currentTarget.value;
          rejectedTyping.current = false;
          setEntryError(false);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          rejectedTyping.current = false;
          onBlur?.(event);
        }}
        onKeyDown={(event) => {
          if (((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") ||
              event.key === "Backspace" || event.key === "Delete") {
            rejectedTyping.current = false;
            focusStart.current = event.currentTarget.value;
            setEntryError(false);
          }
          const forbidden = (range ? [".", "e", "E", "+"] : [".", ",", "e", "E", "+", "-"]).includes(event.key);
          if (forbidden && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            rejectedTyping.current = true;
            event.currentTarget.value = previous.current = focusStart.current;
            onChange?.({ ...event, target: event.currentTarget });
            setEntryError(true);
          } else if (rejectedTyping.current && event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
          }
          onKeyDown?.(event);
        }}
        onPaste={(event) => {
          const pasted = event.clipboardData.getData("text");
          if (!(range ? /^[\d,\s–-]*$/ : /^\d*$/).test(pasted)) {
            event.preventDefault();
            setEntryError(true);
          } else {
            rejectedTyping.current = false;
            setEntryError(false);
          }
          onPaste?.(event);
        }}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (!(range ? /^[\d,\s–-]*$/ : /^\d*$/).test(next)) {
            event.currentTarget.value = previous.current = focusStart.current;
            onChange?.(event);
            setEntryError(true);
            return;
          }
          rejectedTyping.current = false;
          setEntryError(false);
          previous.current = next;
          onChange?.(event);
        }}
      />
      </div>
      {entryError && <p role="alert" className="px-3 py-1 text-xs text-red-600">Whole numbers only. Decimal amounts are not accepted.</p>}
    </div>
  );
});