import {
  backend,
  backendHeaders,
  boundedBody,
} from "../../../../../lib/backend";
import { actionHeaders } from "../../../../../lib/actions";
export const dynamic = "force-dynamic";
export function OPTIONS() {
  return new Response(null, { status: 204, headers: actionHeaders });
}
export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const invoice = url.searchParams.get("invoice");
    const attemptId = url.searchParams.get("attempt");
    if (
      !invoice ||
      !attemptId ||
      !/^[0-9a-f-]{36}$/.test(invoice) ||
      !/^[0-9a-f-]{36}$/.test(attemptId)
    )
      throw new Error("Invalid receipt.");
    const body = JSON.parse(await boundedBody(request)) as {
      signature?: string;
    };
    const response = await backend(`/public/invoices/${invoice}/confirm`, {
      method: "POST",
      headers: backendHeaders(request),
      body: JSON.stringify({ attemptId, signature: body.signature }),
    });
    if (!response.ok || response.status === 202)
      return Response.json(
        {
          message:
            "Receipt is not yet verified. Open your invoice to check status before paying again.",
        },
        { status: 400, headers: actionHeaders },
      );
    return Response.json(
      {
        type: "completed",
        icon: new URL("/sentinelpay-icon.svg", url.origin).toString(),
        title: "Payment verified",
        description: "The merchant received the invoice amount in USDC.",
        label: "Paid",
      },
      { headers: actionHeaders },
    );
  } catch {
    return Response.json(
      { message: "Unable to verify this payment receipt." },
      { status: 400, headers: actionHeaders },
    );
  }
}
