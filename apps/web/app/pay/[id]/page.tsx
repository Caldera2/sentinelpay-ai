import { PaymentCheckout } from "../../../components/payment-checkout";
export default async function PayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main className="grid-shell min-h-screen px-4 py-8">
      <PaymentCheckout invoiceId={id} />
    </main>
  );
}
