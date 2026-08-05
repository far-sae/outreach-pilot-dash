import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  Users,
  FolderOpen,
  FileText,
  Send,
  Settings,
  Menu,
  X,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/store/auth-store";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/groups", label: "Groups", icon: FolderOpen },
  { to: "/prospects", label: "Prospects", icon: Users },
  { to: "/templates", label: "Templates", icon: FileText },
  { to: "/campaigns", label: "Campaigns", icon: Send },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav className="flex flex-col gap-0.5">
      {nav.map((item) => {
        const active = pathname === item.to;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent-blue">
        <Send className="h-3.5 w-3.5 text-primary-foreground" strokeWidth={2} />
      </div>
      <span className="truncate text-sm font-semibold tracking-tight">Outreach Console</span>
    </div>
  );
}

function AccountFooter() {
  const { user, signOut } = useAuth();
  if (!user) return null;

  return (
    <div className="border-t border-border px-2 pt-3">
      <p className="truncate px-1 text-xs text-muted-foreground" title={user.email ?? ""}>
        {user.email}
      </p>
      <button
        type="button"
        onClick={() => void signOut()}
        className="mt-1.5 flex w-full items-center gap-2.5 rounded-lg px-1 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <LogOut className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        <span>Sign out</span>
      </button>
    </div>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen w-full bg-background">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-sidebar px-3 py-5 md:flex">
        <div className="px-2 pb-6">
          <Brand />
        </div>
        <NavLinks />
        <div className="mt-auto pt-6">
          <AccountFooter />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 md:hidden">
          <Brand />
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
            className="rounded-lg border border-border p-2 text-muted-foreground"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </header>
        {open && (
          <div className="border-b border-border bg-sidebar px-3 py-3 md:hidden">
            <NavLinks onNavigate={() => setOpen(false)} />
            <div className="mt-3">
              <AccountFooter />
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-10">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <AppLayout>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Nothing here yet — this page is next on the list.
      </p>
    </AppLayout>
  );
}
