import { backend, backendHeaders, boundedBody } from "../../../lib/backend";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const response = await backend("/rpc", {
      method: "POST",
      headers: backendHeaders(request),
      body: await boundedBody(request),
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32000,
          message: "Payment network is temporarily unavailable.",
        },
      },
      { status: 503 },
    );
  }
}
