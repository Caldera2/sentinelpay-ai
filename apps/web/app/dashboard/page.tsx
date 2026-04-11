import { TrackStatusSidebar } from "../../components/track-status-sidebar";
import { TransactionHistoryTable } from "../../components/transaction-history-table";
import { UserCheckout } from "../../components/user-checkout";

export default function DashboardPage() {
  return (
    <main className="grid-shell min-h-screen px-6 py-8 md:px-10">
      <div className="mx-auto grid w-full max-w-7xl gap-6 lg:grid-cols-[0.32fr_0.68fr]">
        <TrackStatusSidebar />
        <div className="space-y-6">
          <UserCheckout />
          <TransactionHistoryTable />
        </div>
      </div>
    </main>
  );
}
