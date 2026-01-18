// host/bridge-client.js (DEBUG SIMPLE, CORRECTO)
//
// Objetivo:
// - Log claro al cargar (env + handshake + mensajes que entran)
// - NO bloquear requests por handshake (como el starter kit)
// - Auto-boot: si llamas getUserProfile/sendTransaction sin initializeBridge(), igual inicializa
// - Acepta Bridge v1 (RESULT/ERROR/HOST_CONTEXT) y compat legacy (MBS_*)
// - Diagnóstico: REQUEST_HOST_CONTEXT automático al boot
//
// Uso recomendado desde tu miniapp:
//   import { initializeBridge, getUserProfile, sendTransactionToHost } from "./host/bridge-client.js";
//   initializeBridge({ allowedParentOrigin: "https://mybudgetsocial.com" });
//   const profile = await getUserProfile({ allowedParentOrigin: "https://mybudgetsocial.com" });
//   await sendTransactionToHost(payload, key, { allowedParentOrigin: "https://mybudgetsocial.com" });
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

export function createBridgeClient({
  allowedParentOrigin, // REQUIRED: exact host origin (e.g. https://mybudgetsocial.com)
  parentWindow,
  selfWindow = window,
  defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
  debug = true,
} = {}) {
  const pending = new Map();

  let destroyed = false;
  let initialized = false;

  // "ready" es solo diagnóstico / UI, NO bloquea requests.
  let ready = false;
  let activeOrigin = null;

  const allowedOrigin = normalizeAllowedOrigin(allowedParentOrigin);
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
    const ancestor0 =
      (window.location?.ancestorOrigins && window.location.ancestorOrigins.length
        ? window.location.ancestorOrigins[0]
        : null);

    log("boot env", {
      selfUrl: window.location.href,
      selfOrigin: window.location.origin,
      allowedOrigin,
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
      hint: "allowedParentOrigin debe ser EXACTAMENTE el ORIGIN del host real (mira ancestor0/referrer).",
    });
  }

  function postToHost(message) {
    if (!hostWindow) throw Object.assign(new Error("Host window not available"), { code: "NO_HOST_WINDOW" });
    if (!allowedOrigin) throw Object.assign(new Error("allowedParentOrigin is required"), { code: "MISSING_ALLOWED_PARENT_ORIGIN" });
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
    // Handshake "best-effort": si llega cualquiera, marcamos ready
    if (type === "HOST_CONTEXT" || type === "BRIDGE_READY" || type === "MBS_BRIDGE_READY" || type === "MBS_HOST_CONTEXT") {
      ready = true;
      activeOrigin = event.origin;
      log("HANDSHAKE OK", { activeOrigin, type });
    }
  }

  function onMessage(event) {
    if (destroyed) return;

    const type = safeMessageType(event.data);
    if (!type) return;

    // Log crudo de TODO lo que llega (clave para debug)
    log("message in", {
      type,
      origin: event.origin,
      expectedOrigin: allowedOrigin || null,
      fromHostWindow: hostWindow ? event.source === hostWindow : null,
      hasRequestId: typeof event.data?.requestId === "string",
      dataKeys: Object.keys(event.data || {}),
    });

    // 1) origin must match allowedOrigin
    if (!allowedOrigin) {
      warn("blocked: missing allowedOrigin");
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

    // 4) correlación de requests
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

    // HOST_CONTEXT (cuando lo pides con REQUEST_HOST_CONTEXT)
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
      const e = Object.assign(new Error(message), { code, raw, requestId, requestType: p.type });
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
    dumpEnv();

    if (!allowedOrigin) {
      error("NO CONNECT: allowedParentOrigin inválido o vacío. Debe ser el ORIGIN exacto del host.");
      return Promise.reject(Object.assign(new Error("allowedParentOrigin is required"), { code: "MISSING_ALLOWED_PARENT_ORIGIN" }));
    }
    if (!hostWindow) {
      error("NO CONNECT: no hay hostWindow. Debes abrir la miniapp dentro del host (iframe) o desde el host (window.opener).");
      return Promise.reject(Object.assign(new Error("Host window not available"), { code: "NO_HOST_WINDOW" }));
    }

    if (!initialized) {
      initialized = true;
      selfWindow.addEventListener("message", onMessage);
    }

    // 1) enviar ready
    try {
      postToHost({ type: "APP_READY" });
      log("sent APP_READY");
    } catch (e) {
      error("failed to post APP_READY", e);
    }

    // 2) ping: pedir host context aunque no estés ready (diagnóstico)
    void request({ type: "REQUEST_HOST_CONTEXT" }, DIAG_REQUEST_HOST_CONTEXT_TIMEOUT_MS)
      .then((ctx) => log("REQUEST_HOST_CONTEXT OK", ctx))
      .catch((e) => error("REQUEST_HOST_CONTEXT ERROR", { code: e.code, message: e.message, raw: e.raw }));

    // 3) timeout de diagnóstico (no bloquea funcionalidad)
    window.setTimeout(() => {
      if (isReady()) {
        log("bridge READY ✅", { activeOrigin });
        return;
      }
      error("bridge NOT READY ❌ (no handshake)", {
        allowedOrigin,
        hint: [
          "1) allowedParentOrigin debe ser EXACTAMENTE el origin del host real (ver ancestor0/referrer).",
          "2) Debes estar embebido (iframe) o abierto por el host (window.opener). Si opener es null, el host pudo usar noopener.",
          "3) Revisa en el host si al recibir APP_READY responde con HOST_CONTEXT/BRIDGE_READY.",
        ],
      });
    }, DIAG_READY_TIMEOUT_MS);

    return Promise.resolve({ ok: true });
  }

  // Transacción: NO exige handshake (como el starter kit).
  // Solo exige que exista hostWindow + allowedOrigin (para poder postMessage).
  async function sendTransactionToHost(payload, idempotencyKey, { timeoutMs } = {}) {
    if (!hostWindow) {
      throw Object.assign(new Error("Host window not available"), { code: "NO_HOST_WINDOW" });
    }
    if (!allowedOrigin) {
      throw Object.assign(new Error("allowedParentOrigin is required"), { code: "MISSING_ALLOWED_PARENT_ORIGIN" });
    }

    // Si tu host NO soporta MBS_SEND_TRANSACTION, esto dará TIMEOUT.
    // En ese caso prueba con request({type:"CREATE_EXPENSE", payload:{...}}) estilo starter kit.
    return request(
      {
        type: "MBS_SEND_TRANSACTION",
        payload,
        idempotencyKey: String(idempotencyKey || ""),
      },
      timeoutMs
    );
  }

  // API mínima
  return {
    initializeBridge,
    isReady,
    sendTransactionToHost,
    request,
  };
}

// --- Singleton helpers (para imports tipo: import { getUserProfile } from ...)

let bridgeSingleton = null;
let bootPromise = null;

function getOrCreateSingleton(opts) {
  if (!bridgeSingleton) bridgeSingleton = createBridgeClient(opts);

  // Auto-boot (one-shot): garantiza listener + APP_READY + diag ping
  if (!bootPromise) {
    bootPromise = bridgeSingleton
      .initializeBridge()
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.error("[bridge] boot failed", { code: e.code, message: e.message, raw: e.raw });
        throw e;
      });
  }

  return bridgeSingleton;
}

export async function initializeBridge(opts) {
  const b = getOrCreateSingleton(opts);
  await bootPromise;
  return { ok: true };
}

export function isBridgeReady() {
  return Boolean(bridgeSingleton?.isReady?.());
}

export async function getUserProfile(opts) {
  const b = getOrCreateSingleton(opts);
  await bootPromise;
  return b.request({ type: "GET_USER_PROFILE" }, opts?.timeoutMs);
}

export async function getHostContext(opts) {
  const b = getOrCreateSingleton(opts);
  await bootPromise;
  return b.request({ type: "REQUEST_HOST_CONTEXT" }, opts?.timeoutMs);
}

export async function sendTransactionToHost(payload, idempotencyKey, opts) {
  const b = getOrCreateSingleton(opts);
  await bootPromise;
  return b.sendTransactionToHost(payload, idempotencyKey, opts);
}

export function __resetBridgeForTests() {
  try {
    bridgeSingleton = null;
    bootPromise = null;
  } catch {
    // no-op
  }
}