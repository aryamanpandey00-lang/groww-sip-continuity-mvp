import type { ReactNode, SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement>;

function SvgIcon({
  children,
  ...props
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="m3 10.5 9-7.5 9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </SvgIcon>
  );
}

export function CompassIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
    </SvgIcon>
  );
}

export function InvestmentsIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M22 20H2" />
    </SvgIcon>
  );
}

export function ProfileIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c.7-3.4 3.3-5.5 7-5.5s6.3 2.1 7 5.5" />
    </SvgIcon>
  );
}

export function MutualFundsIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M4 17.5 9 12l3 3 7.5-8" />
      <path d="M15 7h5v5" />
    </SvgIcon>
  );
}

export function StocksIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M5 19V9" />
      <path d="M10 19V5" />
      <path d="M15 19v-6" />
      <path d="M20 19V8" />
    </SvgIcon>
  );
}

export function AddMoneyIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8" />
      <path d="M8 12h8" />
    </SvgIcon>
  );
}

export function SipIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="3.5" y="5" width="17" height="16" rx="3" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M3.5 10h17" />
      <path d="M8 14h3" />
      <path d="M8 17h6" />
    </SvgIcon>
  );
}

export function AssistantIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M12 3.5 13.5 9 19 10.5 13.5 12 12 17.5 10.5 12 5 10.5 10.5 9 12 3.5Z" />
      <path d="M19 16.5v3" />
      <path d="M17.5 18h3" />
    </SvgIcon>
  );
}

export function ArrowUpRightIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </SvgIcon>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M19 12H5" />
      <path d="m11 18-6-6 6-6" />
    </SvgIcon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="m9 18 6-6-6-6" />
    </SvgIcon>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M10.3 4.3 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </SvgIcon>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </SvgIcon>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M12 3 20 6v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6l8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </SvgIcon>
  );
}

export function GiftIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="3.5" y="8.5" width="17" height="12" rx="2" />
      <path d="M12 8.5V20.5" />
      <path d="M3.5 13h17" />
      <path d="M12 8.5H8.5a2.5 2.5 0 1 1 0-5C11 3.5 12 8.5 12 8.5Z" />
      <path d="M12 8.5h3.5a2.5 2.5 0 1 0 0-5C13 3.5 12 8.5 12 8.5Z" />
    </SvgIcon>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="5" y="10" width="14" height="11" rx="2.5" />
      <path d="M8.5 10V7.5a3.5 3.5 0 1 1 7 0V10" />
    </SvgIcon>
  );
}

export function SlidersIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M4 7h10" />
      <path d="M18 7h2" />
      <path d="M4 17h2" />
      <path d="M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </SvgIcon>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M20 7v5h-5" />
      <path d="M4 17v-5h5" />
      <path d="M5.6 9a7 7 0 0 1 11.6-2L20 12" />
      <path d="M18.4 15a7 7 0 0 1-11.6 2L4 12" />
    </SvgIcon>
  );
}

export function ChartIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="m7 15 4-4 3 3 5-6" />
    </SvgIcon>
  );
}
