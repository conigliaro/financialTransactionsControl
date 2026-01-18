// host/bridge-client.js
// Bridge v1 client (postMessage) with allowed-origin + request/response correlation.
//
// Logging policy:
// - No console output during normal operation.
// - Only a single throttled warning may be emitted for repeated disallowed-origin messages.
import { uuidv4 } from "../utils/uuid.js";
import { normalizeAllowedOrigin } from "./bridge-config.js";
import { normalizeCategoryId } from "../utils/payload.js";

const DEFAULT_TIMEOUT_MS = 8000;
const DIAG_REQUEST_HOST_CONTEXT_TIMEOUT_MS = 6000;
const DIAG_READY_TIMEOUT_MS = 1200;

const warnedOnce = new Set();
function warnOnce(key, message, meta) {
  if (warnedOnce.has(key)) return;
  warnedOnce.add(key);
  // eslint-disable-next-line no-console
  console.warn("[bridge]", message, meta ?? "");
}

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

function safeJson(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return obj;
  }
}

function mapToCreateExpensePayload(payload) {
  const amount = Number(payload?.paidValue ?? payload?.amount);
  const categoryId = normalizeCategoryId(payload?.categoryId);
  return {
    amount: Number.isFinite(amount) ? amount : 0,
    currencyCode: payload?.currencyCode ? String(payload.currencyCode) : undefined,
    note: payload?.notes
      ? String(payload.notes)
      : payload?.vendor
      ? String(payload.vendor)
      : undefined,
    occurredAt: payload?.date ? String(payload.date) : undefined,
    ...(categoryId == null ? {} : { categoryId }),
  };
}

function mapToCreateIncomePayload(payload) {
  const amount = Number(payload?.paidValue ?? payload?.amount);
  const categoryId = normalizeCategoryId(payload?.categoryId);
  return {
    amount: Number.isFinite(amount) ? amount : 0,
    currencyCode: payload?.currencyCode ? String(payload.currencyCode) : undefined,
    note: payload?.notes
      ? String(payload.notes)
      : payload?.vendor
      ? String(payload.vendor)
      : undefined,
    occurredAt: payload?.date ? String(payload.date) : undefined,
    ...(categoryId == null ? {} : { categoryId }),
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

function summarizeHostContext(ctx) {
  try {
    const v = ctx?.v;
    const isAuthed = ctx?.isAuthed;
    const perms = Array.isArray(ctx?.permissions) ? ctx.permissions : [];
    const appId = ctx?.app?.id;
    const appMode = ctx?.app?.mode;
    const platformMode = ctx?.platform?.mode;
    const platformHost = ctx?.platform?.host;
    return { v, isAuthed, permissions: perms, appId, appMode, platformMode, platformHost };
  } catch {
    return null;
  }
}

export function createBridgeClient({
  allowedParentOrigin,
  parentWindow,
  selfWindow = window,
  defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  // pending: requestId -> { resolve, reject, timer, type, msg }
  const pending = new Map();

  let destroyed = false;
  let initialized = false;

  // diagnóstico/UI
  let ready = false;
  let activeOrigin = null;

  let allowedOrigin = inferAllowedOrigin(allowedParentOrigin);
  const hostWindow = parentWindow ?? inferHostWindow();

  // cache útil para debugging
  let lastHostContext = null;

  function isReady() {
    return ready && Boolean(activeOrigin) && Boolean(hostWindow) && Boolean(allowedOrigin);
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
      return Promise.reject(Object.assign(new Error("Bridge destroyed"), { code: "BRIDGE_DESTROYED" }));
    }

    const requestId = uuidv4();
    const tms = Math.max(500, Number(timeoutMs ?? defaultTimeoutMs) || DEFAULT_TIMEOUT_MS);

    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pending.delete(requestId);
        const e = Object.assign(new Error("timeout"), {
          code: "TIMEOUT",
          requestId,
          type: msg?.type,
          timeoutMs: tms,
        });
        reject(e);
      }, tms);

      pending.set(requestId, { resolve, reject, timer, type: msg?.type, msg });

      try {
        postToHost({ ...msg, requestId });
      } catch (e) {
        window.clearTimeout(timer);
        pending.delete(requestId);
        reject(e);
      }
    });
  }

  function markHandshake(event, type, data) {
    if (ready) return;

    if (type === "HOST_CONTEXT" || type === "BRIDGE_READY") {
      ready = true;
      activeOrigin = event.origin;

      if (type === "HOST_CONTEXT") {
        const payload = data?.payload;
        if (payload && typeof payload === "object") lastHostContext = payload;
      }
    }
  }

  function onMessage(event) {
    if (destroyed) return;

    const type = safeMessageType(event.data);
    if (!type) return;

    if (!allowedOrigin) {
      allowedOrigin = inferAllowedOrigin(allowedParentOrigin);
    }

    if (!allowedOrigin) {
      return;
    }
    if (event.origin !== allowedOrigin) {
      warnOnce("origin-mismatch", "blocked: origin mismatch", {
        got: event.origin,
        expected: allowedOrigin,
      });
      return;
    }

    if (!hostWindow) {
      return;
    }
    if (event.source !== hostWindow) {
      return;
    }

    markHandshake(event, type, event.data);

    const requestId = event.data?.requestId;
    if (typeof requestId !== "string") return;

    const p = pending.get(requestId);
    if (!p) return;

    if (type === "RESULT") {
      window.clearTimeout(p.timer);
      pending.delete(requestId);

      const result = event.data?.result;
      p.resolve(result);
      return;
    }

    if (type === "HOST_CONTEXT") {
      window.clearTimeout(p.timer);
      pending.delete(requestId);

      const payload = event.data?.payload ?? event.data;
      if (payload && typeof payload === "object" && payload.v === 1) {
        lastHostContext = payload;
      }

      p.resolve(payload);
      return;
    }

    if (type === "ERROR") {
      window.clearTimeout(p.timer);
      pending.delete(requestId);

      const raw = event.data?.error;
      const code = typeof raw?.code === "string" ? raw.code : "UNKNOWN";
      const message = typeof raw?.message === "string" ? raw.message : "Unknown host error";

      const e = Object.assign(new Error(message), { code, raw, requestId, requestType: p.type });
      p.reject(e);
      return;
    }
  }

  function initializeBridge() {
    allowedOrigin = inferAllowedOrigin(allowedParentOrigin);

    if (!allowedOrigin) {
      return Promise.reject(
        Object.assign(new Error("allowedParentOrigin is required"), {
          code: "MISSING_ALLOWED_PARENT_ORIGIN",
        })
      );
    }

    if (!hostWindow) {
      return Promise.reject(Object.assign(new Error("Host window not available"), { code: "NO_HOST_WINDOW" }));
    }

    if (!initialized) {
      initialized = true;
      selfWindow.addEventListener("message", onMessage);
    }

    try {
      postToHost({ type: "APP_READY" });
    } catch (e) {
      throw e;
    }

    void request({ type: "REQUEST_HOST_CONTEXT" }, DIAG_REQUEST_HOST_CONTEXT_TIMEOUT_MS)
      .then((ctx) => {
        if (ctx && typeof ctx === "object" && ctx.v === 1) {
          lastHostContext = ctx;
        }
      })
      .catch((e) => {
        // ignore: diagnostic only
      });

    window.setTimeout(() => {
      // Silent: readiness is polled by callers, and standalone mode is expected.
      void allowedOrigin;
    }, DIAG_READY_TIMEOUT_MS);

    return Promise.resolve({ ok: true, allowedOrigin });
  }

  // Envío via Bridge v1 (CREATE_EXPENSE/CREATE_INCOME)
  async function sendTransactionToHost(payload, idempotencyKey, { timeoutMs } = {}) {
    if (!hostWindow) throw Object.assign(new Error("Host window not available"), { code: "NO_HOST_WINDOW" });
    if (!allowedOrigin) {
      throw Object.assign(new Error("allowedParentOrigin is required (or inferable)"), {
        code: "MISSING_ALLOWED_PARENT_ORIGIN",
      });
    }

    const txnType = String(payload?.txnType || payload?.type || "").toLowerCase();
    const isIncome = txnType === "income";
    const msgType = isIncome ? "CREATE_INCOME" : "CREATE_EXPENSE";

    const v1Payload = isIncome ? mapToCreateIncomePayload(payload) : mapToCreateExpensePayload(payload);

    if (!Number.isFinite(Number(v1Payload.amount)) || Number(v1Payload.amount) <= 0) {
      const e = Object.assign(new Error("Invalid amount (must be > 0)"), { code: "VALIDATION" });
      e.responsePayload = { v1Payload, original: payload };
      throw e;
    }

    // manda al host
    const result = await request({ type: msgType, payload: v1Payload }, timeoutMs);

    const rawError = result?.error;
    if (rawError && typeof rawError === "object") {
      const code = typeof rawError.code === "string" ? rawError.code : "UNKNOWN";
      const message = typeof rawError.message === "string" ? rawError.message : "Unknown host error";
      const e = Object.assign(new Error(message), { code, raw: rawError });
      e.responsePayload = result;
      throw e;
    }

    // Adapter para finance-app.js
    const remoteTxnId = pickRemoteTxnId(result, idempotencyKey || uuidv4());

    return {
      status: "success",
      remoteTxnId,
      result,
      _meta: { msgType, usedBridgeV1: true },
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

  try {
    const res = await b.request({ type: "GET_USER_PROFILE" }, opts.timeoutMs);
    return res;
  } catch (e) {
    throw e;
  }
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

export function __setBridgeForTests(bridge) {
  bridgeSingleton = bridge;
  bootPromise = Promise.resolve();
}
