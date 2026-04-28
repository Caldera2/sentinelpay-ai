import { AllocationSlider } from "../../components/dashboard/payfi/AllocationSlider";
import { PaymentModal } from "../../components/dashboard/payfi/PaymentModal";
import { StatCards } from "../../components/dashboard/payfi/StatCards";
import { TrackStatusSidebar } from "../../components/track-status-sidebar";
import { TransactionHistoryTable } from "../../components/transaction-history-table";
import { UserCheckout } from "../../components/user-checkout";

export default function DashboardPage() {
  return (
    <main className="grid-shell min-h-screen px-4 py-6 sm:px-6 md:px-8 md:py-8 xl:px-10">
      <div className="mx-auto grid w-full max-w-7xl gap-5 lg:grid-cols-[minmax(280px,0.32fr)_minmax(0,0.68fr)] lg:gap-6">
        <TrackStatusSidebar />
        <div className="min-w-0 space-y-5 md:space-y-6">
          <section className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)] xl:items-start xl:gap-6">
            <div className="space-y-6">
              <StatCards />
              <AllocationSlider />
            </div>
            <PaymentModal />
          </section>
          <UserCheckout />
          <TransactionHistoryTable />
        </div>
      </div>
    </main>
  );
}
