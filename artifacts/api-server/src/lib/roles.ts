import type { User } from "@workspace/db";

export const SUPERUSER_ROLE = "superuser" as const;
export const UNASSIGNED_ROLE = "none" as const;
export const ROLE_SIMULATION_HEADER = "x-eto-simulated-role";
export const SIMULATABLE_ROLES = ["sales", "art", "engineering", "production", "eng-prod"] as const;
export type SimulatedRole = (typeof SIMULATABLE_ROLES)[number];

export function isSimulatableRole(role: unknown): role is SimulatedRole {
  return typeof role === "string" && (SIMULATABLE_ROLES as readonly string[]).includes(role);
}

export function isSuperUser(role: string | null | undefined): boolean {
  return role === SUPERUSER_ROLE;
}

export function isAdminLike(role: string | null | undefined): boolean {
  return role === "admin" || isSuperUser(role);
}

export function hasRole(user: Pick<User, "role">, ...roles: string[]): boolean {
  return isSuperUser(user.role) || roles.some((role) => matchesRole(user.role, role));
}

/** Department membership, without SuperUser's action-permission override. */
export function matchesRole(actualRole: string, requiredRole: string): boolean {
  return departmentRoles(requiredRole).includes(actualRole);
}

export function departmentRoles(role: string): string[] {
  return role === "engineering" || role === "production" ? [role, "eng-prod"] : [role];
}