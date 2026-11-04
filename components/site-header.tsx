"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AudioWaveform,
  History,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  Volume2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { href: "/", label: "Studio", icon: AudioWaveform },
  { href: "/voices", label: "Voices", icon: Volume2 },
  { href: "/history", label: "History", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/privacy", label: "Privacy", icon: ShieldCheck },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();

  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <Link
            href="/"
            className="flex items-center gap-2 font-semibold tracking-tight"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <AudioWaveform className="h-4 w-4" />
            </span>
            FreeTTS
          </Link>
          {/* Desktop nav — hidden on small screens, replaced by the tab bar */}
          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href}>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-current={pathname === item.href ? "page" : undefined}
                  className={cn(
                    pathname === item.href
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {item.label}
                </Button>
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggle}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </header>

      {/* Mobile bottom tab bar — fixed, so no layout shift. Content padding
          for it lives on <main> in app/layout.tsx. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur md:hidden"
        aria-label="Primary"
      >
        <div
          className="grid grid-cols-5 pb-[env(safe-area-inset-bottom)]"
          role="tablist"
          aria-orientation="horizontal"
        >
          {NAV.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                role="tab"
                aria-selected={active}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon
                  className={cn("h-5 w-5", active && "text-foreground")}
                  strokeWidth={active ? 2.25 : 2}
                />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
