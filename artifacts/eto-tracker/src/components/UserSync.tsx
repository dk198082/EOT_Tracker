import { useEffect, useRef } from "react";
import { useAuth } from "@workspace/replit-auth-web";
import { useSyncUser } from "@workspace/api-client-react";

export function UserSync() {
  const { user, isLoading } = useAuth();
  const { mutate: syncUser } = useSyncUser();
  const syncedRef = useRef<string | null>(null);

  useEffect(() => {
    if (isLoading || !user) return;
    if (syncedRef.current === user.id) return;
    syncedRef.current = user.id;
    syncUser({
      data: {
        name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "Unknown",
        email: user.email ?? "",
      },
    });
  }, [isLoading, user, syncUser]);

  return null;
}
