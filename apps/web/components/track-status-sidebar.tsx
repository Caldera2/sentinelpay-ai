import { Badge, Card } from "./ui";

const statuses = [
  { label: "PayFi Track", value: "Active - HSP Integrated" },
  { label: "AI Track", value: "Active - Intent Engine Running" },
  { label: "ZKID Track", value: "Verified - NexaID Linked" }
];

export function TrackStatusSidebar() {
  return (
    <Card className="space-y-5">
      <div>
        <div className="text-xs uppercase tracking-[0.24em] text-cyan-200">Track Status</div>
        <h3 className="mt-2 font-display text-2xl text-white">Hackathon proof board</h3>
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
