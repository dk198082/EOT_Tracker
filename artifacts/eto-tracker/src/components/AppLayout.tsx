import { useAuth } from "@workspace/replit-auth-web";
import { useState } from "react";
import { useLocation, Link } from "wouter";
import { LayoutDashboard, ClipboardList, PlusCircle, LogOut, Shield, GitBranch, Eye, RotateCcw, Menu } from "lucide-react";
import { UserSync } from "./UserSync";
import { ROLE_SIMULATION_STORAGE_KEY, useGetMe } from "@workspace/api-client-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const alwaysVisibleNavItems = [
  { href: "/eto-requests", label: "ETO Requests", icon: ClipboardList },
  { href: "/dashboard", label: "ART Dashboard", icon: LayoutDashboard },
  { href: "/workflow", label: "Workflow", icon: GitBranch },
];

const ROLE_LABELS: Record<string, string> = {
  none: "None",
  admin: "Admin",
  superuser: "SuperUser",
  sales: "Sales",
  art: "ART",
  engineering: "Engineering",
  production: "Production",
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { data: me, isLoading: isMeLoading, isError: isMeError } = useGetMe();
  const effectiveRole = me?.role ?? "";

  const navItems = [
    alwaysVisibleNavItems[0],
    ...(effectiveRole === "sales" || effectiveRole === "superuser"
      ? [{ href: "/eto-requests/new", label: "New Request", icon: PlusCircle }]
      : []),
    ...alwaysVisibleNavItems.slice(1),
    ...(effectiveRole === "admin" || effectiveRole === "superuser"
      ? [{ href: "/admin", label: "Admin", icon: Shield }]
      : []),
  ];

  function changeSimulatedRole(role: string) {
    if (role === "superuser") {
      window.sessionStorage.removeItem(ROLE_SIMULATION_STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(ROLE_SIMULATION_STORAGE_KEY, role);
    }
    window.location.reload();
  }

  function handleLogout() {
    window.sessionStorage.removeItem(ROLE_SIMULATION_STORAGE_KEY);
    logout();
  }

  if (isMeLoading) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-6">
        <p className="text-sm text-slate-500">Checking your ETO access…</p>
      </main>
    );
  }

  if (isMeError || !me) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-6">
        <section className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Unable to verify ETO access</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Your account is signed in, but the app could not confirm your ETO role. Please sign out and try again.
          </p>
          <Button type="button" variant="outline" className="mt-6" onClick={handleLogout}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </section>
      </main>
    );
  }

  if (me.role === "none") {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-6">
        <section className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <img
            src={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/logo.svg`}
            alt="ETO Tracker"
            className="mx-auto mb-5 h-10"
          />
          <h1 className="text-xl font-semibold text-slate-900">ETO app role not assigned</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Your sign-in is approved, but an ETO app administrator must assign your role before you can access requests or other app data. Refresh this page after your role is assigned.
          </p>
          <Button type="button" className="mt-6" onClick={() => window.location.reload()}>
            Check access again
          </Button>
          <Button type="button" variant="outline" className="ml-2 mt-6" onClick={handleLogout}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </section>
      </main>
    );
  }

  const sidebarContent = (
    <>
        <div className="p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <img src={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/logo-light.svg`} alt="" className="h-8 w-8" />
            <span className="text-white font-bold text-lg">ETO Tracker</span>
          </div>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = href === "/eto-requests"
              ? location === href
                || (location.startsWith(`${href}/`) && !location.startsWith(`${href}/new`))
              : location === href || (href !== "/" && location.startsWith(`${href}/`));
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? "bg-[#E8A020]/20 text-amber-200"
                    : "text-slate-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-white/10">
          {me?.canSimulateRoles && (
            <div className="mb-4 rounded-lg border border-white/15 bg-white/5 p-3">
              <label className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-200">
                <Eye className="h-3.5 w-3.5" />
                View as role
              </label>
              <Select value={me.simulatedRole ?? "superuser"} onValueChange={changeSimulatedRole}>
                <SelectTrigger className="h-9 border-white/20 bg-white/10 text-sm text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="superuser">SuperUser (normal)</SelectItem>
                  <SelectItem value="sales">Sales</SelectItem>
                  <SelectItem value="art">ART</SelectItem>
                  <SelectItem value="engineering">Engineering</SelectItem>
                  <SelectItem value="production">Production</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-2 text-[11px] leading-4 text-slate-400">
                Uses the selected role&apos;s real permissions.
              </p>
            </div>
          )}
          {!window.location.search.includes("embedded=1") && (
            <div className="text-slate-300 text-sm mb-3">
              <div className="font-medium text-white truncate">
                {[user?.firstName, user?.lastName]
                  .filter(Boolean)
                  .join(" ") || user?.email}
              </div>

              <div className="text-slate-400 capitalize text-xs mt-0.5">
                {ROLE_LABELS[me?.role ?? ""] ?? me?.role ?? ""}
              </div>
            </div>
          )}

          {!window.location.search.includes("embedded=1") && (
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors w-full"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          )}
        </div>
    </>
  );

  return (
    <div className="flex min-h-[100dvh]">
      <UserSync />
      <aside className="hidden md:flex w-64 bg-[#1E3A5F] flex-col shrink-0">
        {sidebarContent}
      </aside>
      {/* Main content */}
      <main className="flex-1 min-w-0 bg-slate-50 overflow-auto">
        <div className="md:hidden flex items-center gap-3 border-b bg-[#1E3A5F] px-4 py-3 text-white">
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open navigation"
                className="text-white hover:bg-white/10 hover:text-white">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left"
              className="w-64 max-w-[85vw] p-0 gap-0 border-none bg-[#1E3A5F] flex flex-col overflow-y-auto [&>button]:text-white">
              <SheetTitle className="sr-only">ETO Tracker navigation</SheetTitle>
              <SheetDescription className="sr-only">Navigate the app and manage your session.</SheetDescription>
              {sidebarContent}
            </SheetContent>
          </Sheet>
          <span className="font-bold">ETO Tracker</span>
        </div>
        {me?.simulatedRole && (
          <div className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-3 border-b border-amber-300 bg-amber-100 px-6 py-2.5 text-sm text-amber-950 shadow-sm">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4" aria-hidden="true" />
              <span>
                Role simulation active: viewing and acting as{" "}
                <strong>{ROLE_LABELS[me.simulatedRole] ?? me.simulatedRole}</strong>.
                Actions are still recorded under your SuperUser identity.
              </span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => changeSimulatedRole("superuser")}
              className="h-8 border-amber-400 bg-white/70 text-amber-950 hover:bg-white"
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Exit simulation
            </Button>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
