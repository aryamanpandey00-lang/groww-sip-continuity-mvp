import Link from "next/link";
import type { ComponentProps } from "react";

type ButtonLinkProps = ComponentProps<typeof Link> & {
  variant?: "primary" | "secondary" | "ghost";
};

const variantClasses = {
  primary:
    "bg-groww text-[#042f25] shadow-sm hover:bg-[#00bd8d] focus-visible:ring-groww/40",
  secondary:
    "border border-line bg-white text-ink hover:bg-surface focus-visible:ring-line",
  ghost:
    "border border-transparent bg-transparent text-groww-dark hover:bg-groww-soft focus-visible:ring-groww/30",
};

export function ButtonLink({
  variant = "primary",
  className = "",
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${variantClasses[variant]} ${className}`}
      {...props}
    />
  );
}
