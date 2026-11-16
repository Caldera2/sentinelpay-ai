import { backend, backendHeaders, boundedBody } from "../../../../lib/backend";

export const dynamic = "force-dynamic";
const allowed =
  /^\/(?:config|merchant|auth\/(?:challenge|verify|me|logout)|invoices(?:\/[0-9a-f-]{36}\/cancel)?|payments\/(?:history|summary|export)|refunds\/(?:pending|history|transaction|[0-9a-f-]{36}\/(?:confirm|expire))|treasury\/(?:balance|plan|transaction|pending|[0-9a-f-]{36}\/(?:confirm|expire))|public\/invoices\/[0-9a-f-]{36}(?:\/(?:transaction|confirm))?)$/;

async function proxy(request: Request) {
  const url = new URL(request.url);
  const path = url.pathname.slice("/api/backend".length);
  if (!allowed.test(path))
    return Response.json({ error: "Endpoint not found." }, { status: 404 });
  try {
    const headers = backendHeaders(request);
    const cookie = request.headers.get("cookie");
    const origin = request.headers.get("origin");
    if (cookie) headers.set("Cookie", cookie);
    if (origin) headers.set("Origin", origin);
    const response = await backend(`${path}${url.search}`, {
      method: request.method,
      headers,
      ...(request.method !== "GET" ? { body: await boundedBody(request) } : {}),
    });
    const outgoing = new Headers({
      "Content-Type":
        response.headers.get("Content-Type") || "application/json",
      "Cache-Control": "no-store",
    });
    for (const cookieHeader of response.headers.getSetCookie())
      outgoing.append("Set-Cookie", cookieHeader);
    const disposition = response.headers.get("Content-Disposition");
    if (disposition) outgoing.set("Content-Disposition", disposition);
    for (const name of [
      "Retry-After",
      "RateLimit",
      "RateLimit-Policy",
      "X-Request-ID",
    ]) {
      const value = response.headers.get(name);
      if (value) outgoing.set(name, value);
    }
    return new Response(response.body, {
      status: response.status,
      headers: outgoing,
    });
  } catch {
    return Response.json(
      {
        error:
          "Payment service is unavailable. Check payment status before retrying a transfer.",
      },
      { status: 503 },
    );
  }
}
export { proxy as GET, proxy as POST, proxy as PATCH };
