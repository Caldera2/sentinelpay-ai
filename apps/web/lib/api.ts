const defaultApiBaseUrl = process.env.NODE_ENV === "development" ? "http://localhost:4000" : "";

export const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL?.trim() || defaultApiBaseUrl;
export const isApiConfigured = Boolean(apiBaseUrl);
export const backendSetupMessage =
  "SentinelPay AI backend is not configured. Deploy the Railway API and set NEXT_PUBLIC_API_URL to enable login and ZK checks.";

type ErrorPayload = {
  error?: string;
};

function getApiUrl(path: string) {
  if (!isApiConfigured) {
    throw new Error(backendSetupMessage);
  }

  return `${apiBaseUrl}${path}`;
}

function looksLikeHtmlResponse(text: string) {
  const normalized = text.trim().toLowerCase();
  return normalized.startsWith("<!doctype") || normalized.startsWith("<html") || normalized.startsWith("<");
}

export async function fetchApiJson<T>(path: string, init?: RequestInit) {
  let response: Response;

  try {
    response = await fetch(getApiUrl(path), init);
  } catch {
    throw new Error(
      "SentinelPay API is temporarily unreachable. Please wait a moment and try again."
    );
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const text = await response.text();
  let payload: T | ErrorPayload | null = null;

  if (text) {
    if (contentType.includes("application/json") || text.trim().startsWith("{") || text.trim().startsWith("[")) {
      try {
        payload = JSON.parse(text) as T | ErrorPayload;
      } catch {
        throw new Error("SentinelPay AI backend returned malformed JSON.");
      }
    } else if (looksLikeHtmlResponse(text)) {
      throw new Error(backendSetupMessage);
    }
  }

  if (!response.ok) {
    const errorMessage =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `SentinelPay AI backend request failed (${response.status}).`;

    throw new Error(errorMessage);
  }

  return payload as T;
}

export function getSessionToken() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem("sentinelpay.jwt");
}

export function setSessionToken(token: string) {
  window.localStorage.setItem("sentinelpay.jwt", token);
}
