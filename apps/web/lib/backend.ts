import { isIP } from "node:net";

/** Server routes only. API keys and backend addresses never enter the browser bundle. */
export async function backend(path: string, init: RequestInit = {}) {
  const base =
    process.env.API_URL ||
    (process.env.NODE_ENV !== "production" ? "http://localhost:4000" : "");
  if (!base || !path.startsWith("/") || path.startsWith("//"))
    throw new Error("Backend configuration is required.");
  const endpoint = new URL(base);
  if (
    process.env.NODE_ENV === "production" &&
    (endpoint.protocol !== "https:" || !process.env.API_PROXY_SECRET)
  )
    throw new Error("Secure backend configuration is required.");
  const headers = new Headers(init.headers);
  if (process.env.API_PROXY_SECRET)
    headers.set("X-SentinelPay-Proxy", process.env.API_PROXY_SECRET);
  const response = await fetch(new URL(path, endpoint), {
    ...init,
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  return response;
}

export function backendHeaders(request: Request) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (process.env.VERCEL === "1") {
    const address = request.headers
      .get("x-vercel-forwarded-for")
      ?.split(",")[0]
      ?.trim();
    if (address && isIP(address))
      headers.set("X-SentinelPay-Client-IP", address);
  }
  return headers;
}

export async function boundedBody(request: Request, maxBytes = 32_768) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new Error("Request body is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}
