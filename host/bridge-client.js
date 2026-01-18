// host/bridge-client.js (DEBUG SIMPLE, AUTO-INFER allowedParentOrigin)
// Compatible con financie-app.js imports:
//   import {
//     getUserProfile,
//     initializeBridge as initBridge,
//     isBridgeReady,
//     sendTransactionToHost,
//     waitForBridgeReady
//   } from "./host/bridge-client.js";
//
// Importante:
// - NO usamos MBS_SEND_TRANSACTION por defecto.
// - sendTransactionToHost() traduce a Bridge v1:
//     expense -> CREATE_EXPENSE
//     income  -> CREATE_INCOME
// - Devuelve { status:'success', remoteTxnId, result } para que finance-app.js no explote.
//
import { uuidv4 } from "../utils/uuid.js";
import { normalizeAllowedOrigin } from "./bridge-config.js";

const DEFAULT_TIMEOUT_MS = 8000;
const DIAG_REQUEST_HOST_CONTEXT_TIMEOUT_MS = 6000;
const DIAG_READY_TIMEOUT_MS = 1200;

function safeMessageType(data) {
  if (!data || typeof data !== "object") return null;
  const t = data.type;
  return typeof t === "string" ? t : null;
}

function inferHostWindow() {
  try {
    if (window.parent && window.parent !== window) return window.parent;
  } catch {
    // ignore
  }
  if (window.opener) return window.opener;
  return null;
}

function inferAllowedOrigin(provided) {
  const fromProvided = normalizeAllowedOrigin(provided);
  if (fromProvided) return fromProvided;

  try {
    const ao = window.location?.ancestorOrigins;
    if (ao && ao.length) {
      const fromAncestor = normalizeAllowedOrigin(ao[0]);
      if (fromAncestor) return fromAncestor;
    }
  } catch {
    // ignore
  }

  const fromReferrer = normalizeAllowedOrigin(document.referrer || "");
  if (fromReferrer) return fromReferrer;

  return "";
}

// Mapea tu payload (miniapp) al payload Bridge v1
function mapToCreateExpensePayload(payload) {
  const amount = Number(payload?.paidValue ?? payload?.amount);
  return {
    amount: Number.isFinite(amount) ? amount : 0,
    currencyCode: payload?.currencyCode ? String(payload.currencyCode) : undefined,
    note: payload?.notes ? String(payload.notes) : payload?.vendor ? String(payload.vendor) : undefined,
    occurredAt: payload?.date ? String(payload.date) : undefined,
    categoryId: payload?.expenseType ? String(payload.expenseType) : undefined,
  };
}

function mapToCreateIncomePayload(payload) {
  const amount = Number(payload?.paidValue ?? payload?.amount);
  return {
    amount: Number.isFinite(amount) ? amount : 0,
    currencyCode: payload?.currencyCode ? String(payload.currencyCode) : undefined,
    note: payload?.notes ? String(payload.notes) : payload?.vendor ? String(payload.vendor) : undefined,
    occurredAt: payload?.date ? String(payload.date) : undefined,
    categoryId: payload?.expenseType ? String(payload.expenseType) : undefined,
  };
}

function pickRemoteTxnId(result, fallback) {
  const cand =
    result?.remoteTxnId ??
    result?.txnId ??
    result?.transactionId ??
    result?.id ??
    result?.uuid ??
    null;

  if (typeof cand === "string" && cand.trim()) return cand.trim();
  if (typeof cand === "number" && Number.isFinite(cand)) return String(cand);

  return String(fallback || "");
}

export function createBridgeClient({
  allowedParentOrigin,
  parentWindow,
  selfWindow = window,
  defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
  debug = true,
} = {}) {
  const pending = new Map();

  let destroyed = false;
  let initialized = false;

  // diagnóstico/UI
  let ready = false;
  let activeOrigin = null;

  let allowedOrigin = inferAllowedOrigin(allowedParentOrigin);
  const hostWindow = parentWindow ?? inferHostWindow();

  function log(...args) {
    if (!debug) return;
    // eslint-disable-next-line no-console
    console.log("[bridge]", ...args);
  }
  function warn(...args) {
    // eslint-disable-next-line no-console
    console.warn("[bridge]", ...args);
  }
  function error(...args) {
    // eslint-disable-next-line no-console
    console.error("[bridge]", ...args);
  }

  function isReady() {
    return ready && Boolean(activeOrigin) && Boolean(hostWindow) && Boolean(allowedOrigin);
  }

  function dumpEnv() {
    let ancestor0 = null;
    try {
      const ao = window.location?.ancestorOrigins;
      ancestor0 = ao && ao.length ? ao[0] : null;
    } catch {
      ancestor0 = null;
    }

    log("boot env", {
      selfUrl: window.location.href,
      selfOrigin: window.location.origin,
      allowedParentOriginProvided: allowedParentOrigin || null,
      inferredAllowedOrigin: allowedOrigin || null,
      referrer: document.referrer || null,
      ancestor0,
      hasParent: !!window.parent,
      isIframe: (() => {
        try {
          return window.parent && window.parent !== window;
        } catch {
          return true;
        }
      })(),
      hasOpener: !!window.opener,
      hostWindow: hostWindow ? (hostWindow === window.parent ? "parent" : "opener") : null,
    });
  }

  function postToHost(message) {
    if (!hostWindow) {
      throw Object.assign(new Error("Host window not available"), { code: "NO_HOST_WINDOW" });
    }
    if (!allowedOrigin) {
      throw Object.assign(new Error("allowedParentOrigin is required (or inferable)"), {
        code: "MISSING_ALLOWED_PARENT_ORIGIN",
      });
    }
    hostWindow.postMessage(message, allowedOrigin);
  }

  function request(msg, timeoutMs) {
    if (destroyed) {
      return Promise.reject(
        Object.assign(new Error("Bridge destroyed"), { code: "BRIDGE_DESTROYED" })
      );
    }

    const requestId = uuidv4();
    const tms = Math.max(500, Number(timeoutMs ?? defaultTimeoutMs) || DEFAULT_TIMEOUT_MS);

    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pending.delete(requestId);
        reject(Object.assign(new Error("timeout"), { code: "TIMEOUT", requestId, type: msg?.type }));
      }, tms);

      pending.set(requestId, { resolve, reject, timer, type: msg?.type });

      try {
        postToHost({ ...msg, requestId });
      } catch (e) {
        window.clearTimeout(timer);
        pending.delete(requestId);
        reject(e);
      }
    });
  }

  function markHandshake(event, type) {
    if (ready) return;
    if (type === "HOST_CONTEXT" || type === "BRIDGE_READY") {
      ready = true;
      activeOrigin = event.origin;
      log("HANDSHAKE OK", { activeOrigin, type });
    }
  }

  function onMessage(event) {
    if (destroyed) return;

    const type = safeMessageType(event.data);
    if (!type) return;

    log("message in", {
      type,
      origin: event.origin,
      expectedOrigin: allowedOrigin || null,
      fromHostWindow: hostWindow ? event.source === hostWindow : null,
      hasRequestId: typeof event.data?.requestId === "string",
      dataKeys: Object.keys(event.data || {}),
    });

    if (!allowedOrigin) {
      allowedOrigin = inferAllowedOrigin(allowedParentOrigin);
      warn("allowedOrigin was empty; inferred now:", allowedOrigin || null);
    }

    if (!allowedOrigin) {
      warn("blocked: missing allowedOrigin (no provided + no inferable)");
      return;
    }
    if (event.origin !== allowedOrigin) {
      warn("blocked: origin mismatch", { got: event.origin, expected: allowedOrigin });
      return;
    }

    if (!hostWindow) {
      warn("blocked: no hostWindow (not iframe and no opener)");
      return;
    }
    if (event.source !== hostWindow) {
      warn("blocked: source mismatch (event.source !== hostWindow)");
      return;
    }

    markHandshake(event, type);

    const requestId = event.data?.requestId;
    if (typeof requestId !== "string") return;

    const p = pending.get(requestId);
    if (!p) return;

    if (type === "RESULT") {
      window.clearTimeout(p.timer);
      pending.delete(requestId);
      p.resolve(event.data?.result);
      return;
    }

    if (type === "HOST_CONTEXT") {
      window.clearTimeout(p.timer);
      pending.delete(requestId);
      p.resolve(event.data?.payload ?? event.data);
      return;
    }

    if (type === "ERROR") {
      window.clearTimeout(p.timer);
      pending.delete(requestId);

      const raw = event.data?.error;
      const code = typeof raw?.code === "string" ? raw.code : "UNKNOWN";
      const message = typeof raw?.message === "string" ? raw.message : "Unknown host error";

      const e = Object.assign(new Error(message), {
        code,
        raw,
        requestId,
        requestType: p.type,
      });

      p.reject(e);
      return;
    }
  }

  function initializeBridge() {
    allowedOrigin = inferAllowedOrigin(allowedParentOrigin);
    dumpEnv();

    if (!allowedOrigin) {
      error("NO CONNECT: allowedParentOrigin vacío/no inferible.");
      return Promise.reject(
        Object.assign(new Error("allowedParentOrigin is required"), {
          code: "MISSING_ALLOWED_PARENT_ORIGIN",
        })
      );
    }

    if (!hostWindow) {
      error("NO CONNECT: no hay hostWindow (iframe/opener).");
      return Promise.reject(
        Object.assign(new Error("Host window not available"), { code: "NO_HOST_WINDOW" })
      );
    }

    if (!initialized) {
      initialized = true;
      selfWindow.addEventListener("message", onMessage);
    }

    try {
      postToHost({ type: "APP_READY" });
      log("sent APP_READY to", allowedOrigin);
    } catch (e) {
      error("failed to post APP_READY", e);
    }

    void request({ type: "REQUEST_HOST_CONTEXT" }, DIAG_REQUEST_HOST_CONTEXT_TIMEOUT_MS)
      .then((ctx) => log("REQUEST_HOST_CONTEXT OK", ctx))
      .catch((e) => error("REQUEST_HOST_CONTEXT ERROR", { code: e.code, message: e.message, raw: e.raw }));

    window.setTimeout(() => {
      if (isReady()) {
        log("bridge READY ✅", { activeOrigin });
        return;
      }
      error("bridge NOT READY ❌ (no handshake)", {
        allowedOrigin,
        hint: [
          "1) allowedOrigin debe ser ORIGIN exacto (sin path).",
          "2) Debes estar en iframe u opener (si opener=null, el host pudo usar noopener).",
          "3) El host debe responder a APP_READY con HOST_CONTEXT/BRIDGE_READY.",
        ],
      });
    }, DIAG_READY_TIMEOUT_MS);

    return Promise.resolve({ ok: true, allowedOrigin });
  }

  // IMPORTANTE: implementado en Bridge v1 (starter kit), NO MBS_*
  async function sendTransactionToHost(payload, idempotencyKey, { timeoutMs } = {}) {
    if (!hostWindow) {
      throw Object.assign(new Error("Host window not available"), { code: "NO_HOST_WINDOW" });
    }
    if (!allowedOrigin) {
      throw Object.assign(new Error("allowedParentOrigin is required (or inferable)"), {
        code: "MISSING_ALLOWED_PARENT_ORIGIN",
      });
    }

    const txnType = String(payload?.txnType || "").toLowerCase();
    const isIncome = txnType === "income";
    const isExpense = txnType === "expense" || !txnType;

    const msgType = isIncome ? "CREATE_INCOME" : "CREATE_EXPENSE";
    const v1Payload = isIncome ? mapToCreateIncomePayload(payload) : mapToCreateExpensePayload(payload);

    // Validación mínima para que el host no te devuelva ERROR por tonterías
    if (!Number.isFinite(Number(v1Payload.amount)) || Number(v1Payload.amount) <= 0) {
      const e = Object.assign(new Error("Invalid amount (must be > 0)"), { code: "VALIDATION" });
      e.responsePayload = { v1Payload, original: payload };
      throw e;
    }

    // Bridge v1 responde RESULT con un objeto de transacción
    const result = await request({ type: msgType, payload: v1Payload }, timeoutMs);

    // Adapter: tu finance-app.js espera {status:'success', remoteTxnId}
    const remoteTxnId = pickRemoteTxnId(result, idempotencyKey || uuidv4());

    return {
      status: "success",
      remoteTxnId,
      result, // útil para debug/telemetría
      _meta: { msgType, usedBridgeV1: true, originalTxnType: isIncome ? "income" : "expense" },
    };
  }

  return {
    initializeBridge,
    isReady,
    sendTransactionToHost,
    request,
  };
}

// ----------------------
// Singleton exports
// ----------------------

let bridgeSingleton = null;
let bootPromise = null;

function getOrCreateSingleton(opts) {
  if (!bridgeSingleton) bridgeSingleton = createBridgeClient(opts);

  if (!bootPromise) {
    bootPromise = bridgeSingleton.initializeBridge().catch((e) => {
      // eslint-disable-next-line no-console
      console.error("[bridge] boot failed", { code: e.code, message: e.message, raw: e.raw });
      throw e;
    });
  }

  return bridgeSingleton;
}

export async function initializeBridge(opts) {
  getOrCreateSingleton(opts);
  await bootPromise;
  return { ok: true };
}

export function isBridgeReady() {
  return Boolean(bridgeSingleton?.isReady?.());
}

export async function waitForBridgeReady(opts = {}) {
  const b = getOrCreateSingleton(opts);

  try {
    await bootPromise;
  } catch {
    return false;
  }

  const timeoutMs = Math.max(250, Number(opts.timeoutMs ?? 1200) || 1200);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (b.isReady()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }

  return b.isReady();
}

export async function getUserProfile(opts = {}) {
  const b = getOrCreateSingleton(opts);
  await bootPromise;
  return b.request({ type: "GET_USER_PROFILE" }, opts.timeoutMs);
}

export async function sendTransactionToHost(payload, idempotencyKey, opts = {}) {
  const b = getOrCreateSingleton(opts);
  await bootPromise;
  return b.sendTransactionToHost(payload, idempotencyKey, opts);
}

export function __resetBridgeForTests() {
  bridgeSingleton = null;
  bootPromise = null;
}