import { adminGetCounts } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage() {
  const counts = await adminGetCounts();

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Stat label="Users" value={counts.users} />
      <Stat label="Cases" value={counts.cases} />
      <Stat label="Exhibits" value={counts.exhibits} />
      <Stat label="AI reviews" value={counts.reviews} />
      <Stat label="Exhibit plans" value={counts.plans} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card p-6">
      <p className="eyebrow mb-2">{label}</p>
      <p className="text-3xl font-semibold tracking-tight text-ink-950 tabular-nums">
        {value.toLocaleString()}
      </p>
    </div>
  );
}
