"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  Repeat,
  MapPin,
  Settings,
} from "lucide-react";

const navItems = [
  { label: "Dashboard", href: "/account", icon: LayoutDashboard },
  { label: "Orders", href: "/account/orders", icon: Package },
  { label: "Subscriptions", href: "/account/subscriptions", icon: Repeat },
  { label: "Addresses", href: "/account/addresses", icon: MapPin },
  { label: "Settings", href: "/account/settings", icon: Settings },
];

export default function AccountSidebar() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/account") return pathname === "/account";
    return pathname.startsWith(href);
  };

  return (
    <>
      {/* Desktop sidebar */}
      <nav className="hidden md:flex flex-col w-56 flex-shrink-0 border-r border-border-default pr-6 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-primary-500 text-text-inverse"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-light"
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Mobile horizontal nav */}
      <nav className="flex md:hidden gap-1 overflow-x-auto pb-4 mb-4 border-b border-border-default -mx-1 px-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                active
                  ? "bg-primary-500 text-text-inverse"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-light"
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
