"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CompassIcon,
  HomeIcon,
  InvestmentsIcon,
  ProfileIcon,
} from "@/components/ui/icons";

const navigationItems = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/explore", label: "Explore", icon: CompassIcon },
  { href: "/investments", label: "Investments", icon: InvestmentsIcon },
  { href: "/profile", label: "Profile", icon: ProfileIcon },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 pb-2 backdrop-blur-xl lg:hidden"
    >
      <div className="mx-auto grid max-w-md grid-cols-4 px-2 pt-1">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[10px] font-semibold transition ${
                isActive ? "text-groww-dark" : "text-muted hover:text-ink"
              }`}
            >
              <Icon
                className={`h-5 w-5 ${isActive ? "text-groww-dark" : "text-muted"}`}
              />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
