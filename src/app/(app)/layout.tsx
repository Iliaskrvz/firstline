import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/ui";
import { NavLinks, NavLinksFallback } from "@/components/nav-links";
import { isAdmin } from "@/lib/admin";
import { requireWorkspace } from "@/lib/auth";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/campaigns">
            <Logo />
          </Link>
          <Suspense fallback={<NavLinksFallback />}>
            <NavLinks />
          </Suspense>
          <div className="ml-auto">
            <Suspense fallback={null}>
              <UserMenu />
            </Suspense>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}

async function UserMenu() {
  const { user, workspace, memberships } = await requireWorkspace();
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="hidden text-right sm:block">
        {memberships.length > 1 ? (
          <WorkspaceSwitcher current={workspace.id} options={memberships} />
        ) : (
          <div className="font-medium leading-tight text-slate-800">{workspace.name}</div>
        )}
        <div className="text-xs leading-tight text-slate-500">{user.email}</div>
      </div>
      {isAdmin(user.email) && (
        <Link href="/admin" className="rounded-lg px-2.5 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900">
          Admin
        </Link>
      )}
      <form action="/auth/signout" method="post">
        <button className="rounded-lg px-2.5 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900">Sign out</button>
      </form>
    </div>
  );
}
