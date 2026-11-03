---
name: Entra identity mapping
description: How Microsoft Entra authentication relates to the ETO Tracker role-bearing users.
---

Microsoft Entra owns user authentication, while the existing application users table remains the source of roles and ETO foreign-key relationships.

**Why:** Replacing the application user table would break existing integer IDs, role assignments, and ETO history. Authentication-provider changes must preserve those records.

**How to apply:** Resolve the authenticated Entra object ID into the existing application user record, using email only to claim a previously unlinked row. Use the persistent sessions table for session state and keep application roles independent of the identity provider.

The Admin Console is an additional authorization gate after Entra authenticates
the user. Check access using the Entra object ID and the registered app name
before creating or updating a local user record or issuing a session. Denials
and authorization-service failures must fail closed; never expose the
server-side API key to browser code.

**Why:** The user requested Admin Console control over ETO sign-in, while the
existing ETO roles (Sales, ART, Engineering, Production, Admin, SuperUser) are
stored in the CRM users table and must not be silently replaced by generic
console role labels.

**How to apply:** Treat the console `allowed` result as the sign-in gate and
preserve the existing CRM role mapping. Only synchronize Admin Console roles
to ETO permissions after the user explicitly defines a mapping.

New users provisioned after Admin Console grants sign-in access start with ETO
role `none`. They may authenticate and read their own profile, but must not read
request data or use app actions until an ETO administrator assigns a role.
Pre-created users retain the role already assigned in ETO.

**Why:** The user wants Admin Console approval to create an app user without
implicitly granting Sales or another department role; app permissions remain
under ETO administrators' control.

**How to apply:** Keep the Admin Console as an unchanged external sign-in gate.
Default only newly created local users to `none`, keep existing roles intact,
and fail closed for all app-data APIs until the local role is assigned.