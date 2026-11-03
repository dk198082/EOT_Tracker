import { GitBranch } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type SplitFamilyBadgeProps = {
  familyNumber: string | null;
  position: number | null;
};

export function SplitFamilyBadge({
  familyNumber,
  position,
}: SplitFamilyBadgeProps) {
  if (position === null) return null;

  const label = position === 0
    ? "Original split"
    : `Child ${position}${familyNumber ? ` of ${familyNumber}` : ""}`;

  return (
    <Badge
      variant="outline"
      className="gap-1 border-blue-200 bg-blue-50 text-blue-700 whitespace-nowrap"
    >
      <GitBranch className="h-3 w-3" aria-hidden="true" />
      {label}
    </Badge>
  );
}