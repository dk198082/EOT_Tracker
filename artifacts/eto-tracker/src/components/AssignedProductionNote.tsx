import {
  getGetReviewAssignmentDefaultsQueryKey,
  useGetReviewAssignmentDefaults,
  useListUsers,
} from "@workspace/api-client-react";

export function AssignedProductionNote({
  productionAssigneeId,
  entity,
}: {
  productionAssigneeId?: number | null;
  entity?: string | null;
}) {
  const useDefault = productionAssigneeId == null;
  const users = useListUsers();
  const defaults = useGetReviewAssignmentDefaults({ entity: entity === "TOUK" ? "TOUK" : "TOUS" }, {
    query: {
      queryKey: getGetReviewAssignmentDefaultsQueryKey({ entity: entity === "TOUK" ? "TOUK" : "TOUS" }),
      enabled: useDefault,
      refetchInterval: 30_000,
    },
  });

  const assignedId = productionAssigneeId ?? defaults.data?.productionUserId;
  const assignedUser = users.data?.find((user) => user.id === assignedId);
  let message: string;
  if (users.isPending || (useDefault && defaults.isPending)) {
    message = "Loading assigned Production user…";
  } else if (users.isError || (useDefault && defaults.isError)) {
    message = "Unable to load the assigned Production user.";
  } else if (assignedId == null) {
    message = "Not assigned — no default Production user is configured.";
  } else {
    message = assignedUser
      ? `${assignedUser.name}${useDefault ? " (default)" : ""}`
      : "Assigned Production user is unavailable.";
  }

  return (
    <p className="text-xs text-slate-500" aria-live="polite">
      Assigned Production user: <span className="font-medium">{message}</span>
    </p>
  );
}