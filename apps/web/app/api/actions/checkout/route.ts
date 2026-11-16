import { backend, backendHeaders, boundedBody } from "../../../../lib/backend";
import type { Invoice, PreparedPayment } from "@sentinelpay/shared";
import { formatUsdc, SOLANA_NETWORKS } from "@sentinelpay/shared";
import { randomUUID } from "node:crypto";
import { actionHeaders } from "../../../../lib/actions";

export const dynamic = "force-dynamic";
function headers(cluster: Invoice["cluster"] = "devnet") {
  return {
    ...actionHeaders,
    "X-Blockchain-Ids": SOLANA_NETWORKS[cluster].caip2,
  };
}
async function getInvoice(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("invoice") || url.pathname.split("/").at(-1);
  if (!id || !/^[0-9a-f-]{36}$/.test(id))
    throw new Error("An invoice ID is required.");
  const response = await backend(`/public/invoices/${id}`, {
    headers: backendHeaders(request),
  });
  if (!response.ok) throw new Error("Invoice is unavailable.");
  return (await response.json()) as Invoice;
}
export function OPTIONS() {
  return new Response(null, { status: 204, headers: actionHeaders });
}
export async function GET(request: Request) {
  try {
    const invoice = await getInvoice(request);
    const url = new URL(request.url);
    const disabled =
      invoice.status !== "open" || new Date(invoice.expiresAt) <= new Date();
    return Response.json(
      {
        type: "action",
        icon: new URL("/sentinelpay-icon.svg", url.origin).toString(),
        title: invoice.title,
        description: `Pay ${invoice.merchantName} ${formatUsdc(invoice.amountAtomic)} USDC on ${invoice.cluster}. Network fees are additional.`,
        label: `Pay ${formatUsdc(invoice.amountAtomic)} USDC`,
        disabled,
        ...(disabled
          ? { error: { message: "This invoice is no longer payable." } }
          : {
              links: {
                actions: [
                  {
                    type: "transaction",
                    href: new URL(
                      `/api/actions/checkout?invoice=${invoice.id}`,
                      url.origin,
                    ).toString(),
                    label: "Pay invoice",
                  },
                ],
              },
            }),
      },
      { headers: headers(invoice.cluster) },
    );
  } catch {
    return Response.json(
      { message: "A valid, available invoice is required." },
      { status: 400, headers: actionHeaders },
    );
  }
}
export async function POST(request: Request) {
  try {
    const invoice = await getInvoice(request);
    const body = JSON.parse(await boundedBody(request)) as { account?: string };
    // Prices, recipients, discounts, and allocation percentages are never accepted from an Action caller.
    const response = await backend(
      `/public/invoices/${invoice.id}/transaction`,
      {
        method: "POST",
        headers: backendHeaders(request),
        body: JSON.stringify({
          account: body.account,
          requestId: randomUUID(),
        }),
      },
    );
    if (!response.ok)
      return Response.json(
        { message: "Unable to prepare this invoice payment." },
        { status: response.status, headers: headers(invoice.cluster) },
      );
    const prepared = (await response.json()) as PreparedPayment;
    const next = new URL(
      `/api/actions/checkout/confirm?invoice=${invoice.id}&attempt=${prepared.attemptId}`,
      request.url,
    );
    return Response.json(
      {
        type: "transaction",
        transaction: prepared.transaction,
        message: `Pay ${formatUsdc(invoice.amountAtomic)} USDC to ${invoice.merchantName}`,
        links: { next: { type: "post", href: next.toString() } },
      },
      { headers: headers(invoice.cluster) },
    );
  } catch {
    return Response.json(
      {
        message:
          "Unable to prepare payment. No transaction was submitted by SentinelPay.",
      },
      { status: 400, headers: actionHeaders },
    );
  }
}
