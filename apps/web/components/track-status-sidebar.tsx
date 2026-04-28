import { Badge, Card } from "./ui";

const statuses = [
  { label: "Settlement Rail", value: "Active - Solana USDC" },
  { label: "Swap Engine", value: "Ready - Jupiter Exact-Out" },
  { label: "Treasury Lane", value: "Live - Liquid + USDY Split" }
];

export function TrackStatusSidebar() {
  return (
    <Card className="space-y-5 lg:sticky lg:top-6 lg:self-start">
      <div>
        <div className="text-xs uppercase tracking-[0.24em] text-cyan-200">Track Status</div>
        <h3 className="mt-2 font-display text-2xl text-white">Treasury operations</h3>
      </div>

      <div className="space-y-4">
        {statuses.map((item) => (
          <div key={item.label} className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm text-slate-300">{item.label}</div>
            <Badge className="mt-3 border-cyan-400/30 bg-cyan-400/10 text-cyan-100">{item.value}</Badge>
          </div>
        ))}
      </div>
    </Card>
  );
}
