import { useId, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { calculateReviewStepDates, formatStepDueDate, type ReviewStepSchedule } from "../lib/review-step-dates";

export function validReviewDurations(
  values: string[], includeEngineering = true, includeProduction = true,
): boolean {
  return values.length === 3 && values.every((value, index) =>
    (index === 0 && !includeEngineering) || (index === 1 && !includeProduction) ||
    (!!value.trim() && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 520));
}

export function formatCalendarDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
}

export function ReviewScheduleFields({
  durations, onChange, savedDueDate, acceptedDate,
  includeEngineering, includeProduction, onIncludeEngineeringChange, onIncludeProductionChange,
  engineeringAssignment, productionAssignment,
  savedStepDates,
}: {
  durations: string[];
  onChange: (index: number, value: string) => void;
  savedDueDate?: string | null;
  acceptedDate?: string | null;
  includeEngineering: boolean;
  includeProduction: boolean;
  onIncludeEngineeringChange: (included: boolean) => void;
  onIncludeProductionChange: (included: boolean) => void;
  engineeringAssignment?: ReactNode;
  productionAssignment?: ReactNode;
  savedStepDates?: ReviewStepSchedule;
}) {
  const id = useId();
  const today = new Date();
  const startDate = acceptedDate ??
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const valid = validReviewDurations(durations, includeEngineering, includeProduction);
  const totalWeeks = durations.reduce((sum, value, index) =>
    (index === 0 && !includeEngineering) || (index === 1 && !includeProduction)
      ? sum : sum + Number(value), 0);
  const calculated = new Date(`${startDate}T00:00:00Z`);
  if (valid) calculated.setUTCDate(calculated.getUTCDate() + Math.ceil(totalWeeks * 7 - 1e-9));
  const dueDate = savedDueDate ?? (valid ? calculated.toISOString().slice(0, 10) : null);
  const stepDates = savedDueDate ? savedStepDates : valid ? calculateReviewStepDates({
    artReviewAcceptedDate: startDate,
    includeEngineeringReview: includeEngineering,
    includeProductionReview: includeProduction,
    engineeringReviewDurationWeeks: Number(durations[0]),
    productionReviewDurationWeeks: Number(durations[1]),
    artFinalReviewDurationWeeks: Number(durations[2]),
  }) : undefined;
  const stepDueDate = (date: string | null | undefined, originallyIncluded = true) => (
    <p className="text-xs text-slate-600" aria-live="polite">
      {savedDueDate ? "Planned due date" : "Due date preview"}: {date ? formatStepDueDate(date)
        : savedDueDate && !originallyIncluded ? "Not included at initial acceptance" : "Not set"}
    </p>
  );
  const reviews = [
    { title: "Engineering Review", included: includeEngineering, onChange: onIncludeEngineeringChange,
      assignment: engineeringAssignment,
      description: "Engineering prepares cost, lead time, and part-number guidance." },
    { title: "Production Review", included: includeProduction, onChange: onIncludeProductionChange,
      assignment: productionAssignment,
      description: "Production confirms procurement and assembly estimates." },
  ];
  const durationField = (label: string, index: number) => (
    <div className="space-y-1.5">
      <Label htmlFor={`${id}-${index}`} required={!savedDueDate}>{label}</Label>
      <Input id={`${id}-${index}`} type="number" min="0" max="520" step="any"
        value={durations[index]} disabled={!!savedDueDate}
        onChange={(event) => onChange(index, event.target.value)} />
    </div>
  );

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">Review steps, durations &amp; assignments</p>
        <p className="mt-1 text-xs text-slate-500">
          Checked means included. Both are checked by default; uncheck a review to skip it.
        </p>
      </div>
      {reviews.map((review, index) => (
        <div key={review.title} className="space-y-3 rounded-md border border-slate-200 p-3">
          <label className="flex cursor-pointer items-start gap-3">
            <Checkbox checked={review.included}
              onCheckedChange={(checked) => review.onChange(checked === true)} />
            <span>
              <span className="block text-sm font-medium text-slate-700">{review.title}</span>
              <span className="block text-xs text-slate-500">{review.description}</span>
            </span>
          </label>
          {review.included && (
            <>
              {durationField(`${review.title} Duration (weeks)`, index)}
              {stepDueDate(index === 0 ? stepDates?.engineering : stepDates?.production,
                index === 0 ? stepDates?.includeEngineering : stepDates?.includeProduction)}
              {review.assignment}
            </>
          )}
        </div>
      ))}
      <div className="rounded-md border border-slate-200 p-3">
        {durationField("ART Final Review Duration (weeks)", 2)}
        {stepDueDate(stepDates?.artFinal ?? savedDueDate)}
      </div>
      <div className="border-t pt-3" aria-live="polite">
        <p className="text-xs font-medium text-slate-500">Due Date</p>
        <p className="mt-1 text-sm font-semibold text-[#1E3A5F]">
          {dueDate ? formatCalendarDate(dueDate) : "Enter valid review durations"}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {savedDueDate
            ? "Set at initial ART acceptance. Returning for review does not reset the deadline."
            : valid
              ? `${totalWeeks} weeks from ART acceptance on ${formatCalendarDate(startDate)}. Includes only checked reviews plus ART Final Review; partial days round up.`
              : "Each included duration must be between 0 and 520 weeks."}
        </p>
      </div>
    </div>
  );
}