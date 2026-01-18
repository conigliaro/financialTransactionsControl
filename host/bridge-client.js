// host/bridge-client.js (DEBUG SIMPLE, AUTO-INFER allowedParentOrigin)
//
// Exporta lo que finance-app.js espera:
//   import {
//     getUserProfile,
//     initializeBridge as initBridge,
//     isBridgeReady,
//     sendTransactionToHost,
//     waitForBridgeReady
//   } from "./host/bridge-client.js";
//
// Objetivo:
// - Log claro al cargar (env + mensajes entrantes)
// - Auto-infer allowedParentOrigin si NO lo pasan (desde ancestorOrigins/referrer)
// - NO bloquear requests por "ready" (estilo starter kit)
// - Bridge v1 (RESULT/ERROR/HOST_CONTEXT) + compat legacy (MBS_*)
// - Diagnóstico: REQUEST_HOST_CONTEXT automático al boot
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
  // embedded iframe
  try {
    if (window.parent && window.parent !== window) return window.parent;
  } catch {
    // ignore
  }
  // standalone popup
  if (window.opener) return window.opener;
  return null;
}

function inferAllowedOrigin(provided) {
  // 1) si viene explícito, úsalo
  const fromProvided = normalizeAllowedOrigin(provided);
  if (fromProvided) return fromProvided;

  // 2) mejor fuente en iframes: ancestorOrigins[0]
  try {
    const ao = window.location?.ancestorOrigins;
    if (ao && ao.length) {
      const fromAncestor = normalizeAllowedOrigin(ao[0]);
      if (fromAncestor) return fromAncestor;
    }
  } catch {
    // ignore
  }

  // 3) fallback: referrer
  const fromReferrer = normalizeAllowedOrigin(document.referrer || "");
  if (fromReferrer) return fromReferrer;

  return "";
}

export function createBridgeClient({
  allowedParentOrigin, // opcional ahora (se infiere)
  parentWindow,
  selfWindow = window,
  defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
  debug = true,
} = {}) {
  const pending = new Map();

  let destroyed = false;
  let initialized = false;

  // Ready es diagnóstico / UI; NO bloquea requests
  let ready = false;
  let activeOrigin = null;

  // OJO: ahora se infiere si no lo pasan
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
      hint: "Si no pasas allowedParentOrigin, se infiere de ancestor0/referrer. Debe ser ORIGIN exacto (sin path).",
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

    if (
      type === "HOST_CONTEXT" ||
      type === "BRIDGE_READY" ||
      type === "MBS_BRIDGE_READY" ||
      type === "MBS_HOST_CONTEXT"
    ) {
      ready = true;
      activeOrigin = event.origin;
      log("HANDSHAKE OK", { activeOrigin, type });
    }
  }

  function onMessage(event) {
    if (destroyed) return;

    const type = safeMessageType(event.data);
    if (!type) return;

    // Log crudo
    log("message in", {
      type,
      origin: event.origin,
      expectedOrigin: allowedOrigin || null,
      fromHostWindow: hostWindow ? event.source === hostWindow : null,
      hasRequestId: typeof event.data?.requestId === "string",
      dataKeys: Object.keys(event.data || {}),
    });

    // Si por alguna razón allowedOrigin aún no existe, intenta inferirlo aquí (último chance)
    if (!allowedOrigin) {
      allowedOrigin = inferAllowedOrigin(allowedParentOrigin);
      warn("allowedOrigin was empty; inferred now:", allowedOrigin || null);
    }

    // 1) origin must match allowedOrigin
    if (!allowedOrigin) {
      warn("blocked: missing allowedOrigin (no provided + no inferable)");
      return;
    }
    if (event.origin !== allowedOrigin) {
      warn("blocked: origin mismatch", { got: event.origin, expected: allowedOrigin });
      return;
    }

    // 2) source must match hostWindow
    if (!hostWindow) {
      warn("blocked: no hostWindow (not iframe and no opener)");
      return;
    }
    if (event.source !== hostWindow) {
      warn("blocked: source mismatch (event.source !== hostWindow)");
      return;
    }

    // 3) handshake best-effort
    markHandshake(event, type);

    // 4) correlación requestId
    const requestId = event.data?.requestId;
    if (typeof requestId !== "string") return;

    const p = pending.get(requestId);
    if (!p) return;

    // Bridge v1
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

    // Compat legacy
    if (type === "MBS_SEND_TRANSACTION_RESULT" || type === "MBS_SEND_TRANSACTION_RESPONSE") {
      window.clearTimeout(p.timer);
      pending.delete(requestId);
      p.resolve(event.data);
      return;
    }
  }

  function initializeBridge() {
    // Refresca allowedOrigin justo al boot (por si llamaron init sin opts)
    allowedOrigin = inferAllowedOrigin(allowedParentOrigin);

    dumpEnv();

    if (!allowedOrigin) {
      error(
        "NO CONNECT: allowedParentOrigin vacío/no inferible. Pasa allowedParentOrigin o revisa ancestorOrigins/referrer."
      );
      return Promise.reject(
        Object.assign(new Error("allowedParentOrigin is required"), {
          code: "MISSING_ALLOWED_PARENT_ORIGIN",
        })
      );
    }

    if (!hostWindow) {
      error(
        "NO CONNECT: no hay hostWindow. Debes abrir la miniapp dentro del host (iframe) o desde el host (window.opener)."
      );
      return Promise.reject(
        Object.assign(new Error("Host window not available"), { code: "NO_HOST_WINDOW" })
      );
    }

    if (!initialized) {
      initialized = true;
      selfWindow.addEventListener("message", onMessage);
    }

    // 1) enviar APP_READY
    try {
      postToHost({ type: "APP_READY" });
      log("sent APP_READY to", allowedOrigin);
    } catch (e) {
      error("failed to post APP_READY", e);
    }

    // 2) ping diagnóstico
    void request({ type: "REQUEST_HOST_CONTEXT" }, DIAG_REQUEST_HOST_CONTEXT_TIMEOUT_MS)
      .then((ctx) => log("REQUEST_HOST_CONTEXT OK", ctx))
      .catch((e) =>
        error("REQUEST_HOST_CONTEXT ERROR", { code: e.code, message: e.message, raw: e.raw })
      );

    // 3) timeout de diagnóstico
    window.setTimeout(() => {
      if (isReady()) {
        log("bridge READY ✅", { activeOrigin });
        return;
      }
      error("bridge NOT READY ❌ (no handshake)", {
        allowedOrigin,
        hint: [
          "1) allowedOrigin inferido debe ser el ORIGIN exacto del host (sin path).",
          "2) Debes estar embebido (iframe) o abierto por el host (window.opener). Si opener es null, el host pudo usar noopener.",
          "3) Verifica en el host que al recibir APP_READY responde con HOST_CONTEXT/BRIDGE_READY.",
        ],
      });
    }, DIAG_READY_TIMEOUT_MS);

    return Promise.resolve({ ok: true, allowedOrigin });
  }

  async function sendTransactionToHost(payload, idempotencyKey, { timeoutMs } = {}) {
    if (!hostWindow) {
      throw Object.assign(new Error("Host window not available"), { code: "NO_HOST_WINDOW" });
    }
    if (!allowedOrigin) {
      throw Object.assign(new Error("allowedParentOrigin is required (or inferable)"), {
        code: "MISSING_ALLOWED_PARENT_ORIGIN",
      });
    }

    // Si el host NO soporta MBS_SEND_TRANSACTION, esto termina en TIMEOUT (y lo verás en consola)
    return request(
      {
        type: "MBS_SEND_TRANSACTION",
        payload,
        idempotencyKey: String(idempotencyKey || ""),
      },
      timeoutMs
    );
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

export async function getHostContext(opts = {}) {
  const b = getOrCreateSingleton(opts);
  await bootPromise;
  return b.request({ type: "REQUEST_HOST_CONTEXT" }, opts.timeoutMs);
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