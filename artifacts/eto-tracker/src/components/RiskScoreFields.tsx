import { useId } from "react";
import type { RiskScore } from "@workspace/api-client-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type SelectedRiskScore = NonNullable<RiskScore> | "";

export function RiskScoreFields({
  score,
  notes,
  onScoreChange,
  onNotesChange,
}: {
  score: SelectedRiskScore;
  notes: string;
  onScoreChange: (value: SelectedRiskScore) => void;
  onNotesChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-score`} required>Risk Score</Label>
        <Select value={score} onValueChange={(value) => {
          if (value === "Low" || value === "Med" || value === "High") onScoreChange(value);
        }} required>
          <SelectTrigger id={`${id}-score`} aria-required="true">
            <SelectValue placeholder="Select a risk score" />
          </SelectTrigger>
          <SelectContent>
            {(["Low", "Med", "High"] as const).map((value) => (
              <SelectItem key={value} value={value}>{value}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {score === "High" && (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-notes`} required>Risk Notes</Label>
          <Textarea
            id={`${id}-notes`}
            value={notes}
            onChange={(event) => onNotesChange(event.target.value)}
            rows={3}
            required
            aria-required="true"
            aria-describedby={`${id}-help`}
          />
          <p id={`${id}-help`} className="text-xs text-amber-700">
            An explanation is required for a High Risk Score.
          </p>
        </div>
      )}
    </div>
  );
}