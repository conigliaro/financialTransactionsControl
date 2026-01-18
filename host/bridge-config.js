// host/bridge-config.js

export const ALLOWED_HOST_ORIGINS = [
  "https://mybudgetsocial.com",
  "https://staging.mybudgetsocial.com",
  "http://localhost:5173",
  "https://finanzas.verenzuela.com",
];

// Helper opcional: normaliza y valida "origin" (no URL completa)
export function normalizeAllowedOrigin(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  return url.origin;
}