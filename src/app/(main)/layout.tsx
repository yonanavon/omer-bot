"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, Users } from "lucide-react";

const navItems = [
  { href: "/admin/whatsapp", label: "חיבור וואטסאפ", icon: MessageSquare },
  { href: "/admin/members", label: "חברי קהילה", icon: Users },
];

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-64 border-l border-[var(--border)] bg-[var(--card)] flex flex-col">
        <div className="p-6 border-b border-[var(--border)]">
          <h1 className="text-xl font-bold text-[var(--primary)]">
            עומר בוט
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            ניהול קהילה וספירת העומר
          </p>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  isActive
                    ? "bg-[var(--primary)] text-white"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                <item.icon size={20} />
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
