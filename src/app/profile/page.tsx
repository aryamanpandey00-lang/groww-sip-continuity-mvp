import { PlaceholderPage } from "@/components/layout/placeholder-page";
import { Badge } from "@/components/ui/badge";
import { demoDashboard } from "@/lib/domain/fixtures/demo-dashboard";

export default function ProfilePage() {
  const { investor } = demoDashboard;

  return (
    <PlaceholderPage
      eyebrow="Profile"
      title="Demo profile"
      description="Authentication, onboarding and real investor details are outside Phase 1. This profile is a fictional fixture."
    >
      <div className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-4">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-groww-soft text-sm font-bold text-groww-dark ring-1 ring-groww/20">
          {investor.initials}
        </span>
        <div>
          <p className="text-sm font-semibold text-ink">
            {investor.displayName}
          </p>
          <p className="mt-1 text-xs text-muted">
            Demo investor ID: {investor.id}
          </p>
        </div>
        <Badge tone="green" className="ml-auto">
          Fictional
        </Badge>
      </div>

      <p className="mt-5 text-[11px] leading-5 text-muted">
        No login, KYC, PAN, bank account or personal data is collected in this
        demo.
      </p>
    </PlaceholderPage>
  );
}
