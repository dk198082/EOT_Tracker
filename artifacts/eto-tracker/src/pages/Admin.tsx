import { useState } from "react";
import { RequiredMark } from "@/components/RequiredMark";
import {
  useGetMe,
  useListUsers,
  useUpdateUserRole,
  useCreateUser,
  useDeleteUser,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Shield, User as UserIcon, UserPlus, Trash2, X } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DesignFormulaSettings } from "@/components/DesignFormulaSettings";
import { AssemblyFormulaSettings } from "@/components/AssemblyFormulaSettings";
import { PriceCalculatorSettings } from "@/components/PriceCalculatorSettings";
import { ReviewAssignmentDefaults } from "@/components/ReviewAssignmentDefaults";
import { EmailNotificationSettings } from "@/components/EmailNotificationSettings";

const ROLES = ["none", "sales", "art", "engineering", "production", "admin", "superuser"] as const;
type Role = (typeof ROLES)[number];

const ROLE_LABELS: Record<Role, string> = {
  none: "None",
  sales: "Sales",
  art: "ART",
  engineering: "Engineering",
  production: "Production",
  admin: "Admin",
  superuser: "SuperUser",
};

const ROLE_COLORS: Record<Role, string> = {
  none: "bg-slate-100 text-slate-600",
  sales: "bg-blue-50 text-blue-700",
  art: "bg-purple-50 text-purple-700",
  engineering: "bg-amber-50 text-amber-700",
  production: "bg-green-50 text-green-700",
  admin: "bg-red-50 text-red-700",
  superuser: "bg-indigo-50 text-indigo-700",
};

interface AddUserDialogProps {
  onClose: () => void;
  onCreated: () => void;
}

function AddUserDialog({ onClose, onCreated }: AddUserDialogProps) {
  const createUser = useCreateUser();
  const { toast } = useToast();
  const [form, setForm] = useState({ name: "", email: "", role: "sales" as Role });
  const [errors, setErrors] = useState<Partial<typeof form>>({});

  function validate() {
    const e: Partial<typeof form> = {};
    if (!form.name.trim()) e.name = "Name is required";
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      e.email = "Valid email required";
    return e;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    try {
      await createUser.mutateAsync({ data: { name: form.name.trim(), email: form.email.trim(), role: form.role } });
      toast({ title: "User added", description: `${form.name} will be assigned ${ROLE_LABELS[form.role]} when they first sign in.` });
      onCreated();
      onClose();
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? "Failed to create user";
      toast({ title: "Error", description: msg, variant: "destructive" });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-[#1E3A5F]" />
            <h2 className="text-lg font-semibold text-slate-900">Add User</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-slate-500 mb-5">
          Pre-create a user with the right role. When they sign in for the first time their
          account will be automatically linked and the role applied.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Name <RequiredMark /></label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => { setForm(f => ({ ...f, name: e.target.value })); setErrors(er => ({ ...er, name: undefined })); }}
              placeholder="Jane Smith"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]/30 focus:border-[#1E3A5F]"
            />
            {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email <RequiredMark /></label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => { setForm(f => ({ ...f, email: e.target.value })); setErrors(er => ({ ...er, email: undefined })); }}
              placeholder="jane@company.com"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]/30 focus:border-[#1E3A5F]"
            />
            {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Role <RequiredMark /></label>
            <select
              value={form.role}
              onChange={(e) => setForm(f => ({ ...f, role: e.target.value as Role }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]/30 focus:border-[#1E3A5F]"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-slate-200 text-slate-600 rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createUser.isPending}
              className="flex-1 bg-[#1E3A5F] text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-[#162d4a] transition-colors disabled:opacity-50"
            >
              {createUser.isPending ? "Adding…" : "Add User"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface DeleteConfirmProps {
  userName: string;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}

function DeleteConfirm({ userName, onConfirm, onCancel, isPending }: DeleteConfirmProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900 mb-2">Remove user?</h2>
        <p className="text-sm text-slate-500 mb-5">
          This will remove <strong>{userName}</strong> from the system. Any ETO records they created or
          are assigned to will remain intact.
        </p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 border border-slate-200 text-slate-600 rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-50 transition-colors">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1 bg-red-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            {isPending ? "Removing…" : "Remove"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Admin() {
  const { data: me, isLoading: meLoading } = useGetMe();
  const {
    data: users,
    isLoading: usersLoading,
    isFetching: usersRefreshing,
    refetch,
  } = useListUsers();
  const updateRole = useUpdateUserRole();
  const deleteUser = useDeleteUser();
  const { toast } = useToast();

  const [savingId, setSavingId] = useState<number | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const isAdmin = me?.role === "admin" || me?.role === "superuser";

  if (meLoading || usersLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-500 text-sm">Loading…</div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-2">
          <Shield className="h-10 w-10 text-slate-300 mx-auto" />
          <p className="text-slate-600 font-medium">Admin access required</p>
          <p className="text-slate-400 text-sm">Only admins can access this page.</p>
        </div>
      </div>
    );
  }

  async function handleRoleChange(userId: number, newRole: string) {
    setSavingId(userId);
    try {
      await updateRole.mutateAsync({ id: userId, data: { role: newRole } });
      toast({ title: "Role updated", description: "User role has been saved." });
      refetch();
    } catch (err: any) {
      toast({ title: "Failed to update role", description: err?.response?.data?.error ?? "Please try again.", variant: "destructive" });
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(userId: number) {
    try {
      await deleteUser.mutateAsync({ id: userId });
      toast({ title: "User removed" });
      refetch();
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? "Failed to remove user";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setConfirmDeleteId(null);
    }
  }

  const confirmTarget = users?.find((u) => u.id === confirmDeleteId);

  return (
    <>
      {showAddDialog && (
        <AddUserDialog onClose={() => setShowAddDialog(false)} onCreated={refetch} />
      )}
      {confirmDeleteId !== null && confirmTarget && (
        <DeleteConfirm
          userName={confirmTarget.name}
          onConfirm={() => handleDelete(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
          isPending={deleteUser.isPending}
        />
      )}

      <div className="p-6 max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-slate-900">Admin</h1>
          <p className="text-sm text-slate-500 mt-1">Manage users, assignment defaults and calculation settings.</p>
        </div>
        <Tabs defaultValue="users">
          <TabsList className="mb-5 h-auto max-w-full flex-wrap justify-start">
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="assignment-defaults">Assignment Defaults</TabsTrigger>
            <TabsTrigger value="email-notifications">Email Notifications</TabsTrigger>
            <TabsTrigger value="design-formula">Design Formula</TabsTrigger>
            <TabsTrigger value="assembly-formula">Assembly Formula</TabsTrigger>
            <TabsTrigger value="price-calculator">Price Calculator</TabsTrigger>
          </TabsList>
          <TabsContent value="users" className="mt-0">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Shield className="h-5 w-5 text-[#1E3A5F]" />
              <h2 className="text-xl font-bold text-slate-900">User Management</h2>
            </div>
            <p className="text-slate-500 text-sm">Assign roles and manage who has access to ETO Tracker.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              disabled={usersRefreshing}
              className="flex items-center gap-2 border border-slate-200 bg-white text-slate-600 text-sm font-medium px-3 py-2 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Refresh user management table"
            >
              <RefreshCw className={`h-4 w-4 ${usersRefreshing ? "animate-spin" : ""}`} />
              {usersRefreshing ? "Refreshing…" : "Refresh"}
            </button>
            <button
              onClick={() => setShowAddDialog(true)}
              className="flex items-center gap-2 bg-[#1E3A5F] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#162d4a] transition-colors"
            >
              <UserPlus className="h-4 w-4" />
              Add User
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-5 py-3 font-medium text-slate-600">User</th>
                <th className="text-left px-5 py-3 font-medium text-slate-600">Email</th>
                <th className="text-left px-5 py-3 font-medium text-slate-600">Role <RequiredMark /></th>
                <th className="w-10 px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {(users ?? []).map((u) => {
                const role = u.role as Role;
                const isPending = !u.authId;
                return (
                  <tr key={u.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-full bg-[#1E3A5F]/10 flex items-center justify-center text-[#1E3A5F] shrink-0">
                          <UserIcon className="h-4 w-4" />
                        </div>
                        <div>
                          <span className="font-medium text-slate-800">{u.name}</span>
                          {u.id === me?.id && (
                            <span className="text-xs text-slate-400 ml-1">(you)</span>
                          )}
                          {isPending && (
                            <span className="ml-2 text-xs bg-amber-50 text-amber-600 border border-amber-200 rounded px-1.5 py-0.5">
                              awaiting first login
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-slate-500">{u.email}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <select
                          value={u.role}
                          disabled={savingId === u.id || u.id === me?.id}
                          title={u.id === me?.id ? "You cannot change your own role" : undefined}
                          onChange={(e) => handleRoleChange(u.id, e.target.value)}
                          className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]/30 focus:border-[#1E3A5F] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                          ))}
                        </select>
                        {savingId === u.id && <span className="text-xs text-slate-400">Saving…</span>}
                        {u.id === me?.id && <span className="text-xs text-slate-400 italic">cannot change own role</span>}
                        {savingId !== u.id && u.id !== me?.id && (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[role] ?? "bg-slate-100 text-slate-600"}`}>
                            {ROLE_LABELS[role] ?? u.role}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {u.id !== me?.id && (
                        <button
                          onClick={() => setConfirmDeleteId(u.id)}
                          title="Remove user"
                          className="text-slate-300 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {(users ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-slate-400">
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
          </TabsContent>
          <TabsContent value="assignment-defaults" className="mt-0">
            <ReviewAssignmentDefaults users={users ?? []} entity="TOUS" />
            <ReviewAssignmentDefaults users={users ?? []} entity="TOUK" />
          </TabsContent>
          <TabsContent value="email-notifications" className="mt-0">
            <EmailNotificationSettings />
          </TabsContent>
          <TabsContent value="design-formula" className="mt-0">
            <DesignFormulaSettings />
          </TabsContent>
          <TabsContent value="assembly-formula" className="mt-0">
            <AssemblyFormulaSettings />
          </TabsContent>
          <TabsContent value="price-calculator" className="mt-0">
            <PriceCalculatorSettings />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
