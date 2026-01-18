// host/bridge-client.js (DEBUG SIMPLE)
import { uuidv4 } from "../utils/uuid.js";
import { normalizeAllowedOrigin } from "./bridge-config.js";

const DEFAULT_TIMEOUT_MS = 8000;

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
  allowedParentOrigin, // REQUIRED: exact host origin (e.g. https://finanzas.verenzuela.com)
  parentWindow,
  selfWindow = window,
  defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
  debug = true,
} = {}) {
  const pending = new Map();

  let destroyed = false;
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

  function err(...args) {
    // eslint-disable-next-line no-console
    console.error("[bridge]", ...args);
  }

  function isReady() {
    return ready && Boolean(activeOrigin) && Boolean(hostWindow);
  }

  function dumpEnv() {
    log("boot env", {
      selfOrigin: window.location.origin,
      allowedOrigin,
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
    if (!hostWindow) throw Object.assign(new Error("NO_HOST_WINDOW"), { code: "NO_HOST_WINDOW" });
    if (!allowedOrigin) throw Object.assign(new Error("MISSING_ALLOWED_PARENT_ORIGIN"), { code: "MISSING_ALLOWED_PARENT_ORIGIN" });
    hostWindow.postMessage(message, allowedOrigin);
  }

  function request(msg, timeoutMs) {
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

  function onMessage(event) {
    if (destroyed) return;

    const type = safeMessageType(event.data);
    if (!type) return;

    // LOG crudo (lo que llega)
    log("message in", {
      type,
      origin: event.origin,
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

    // 2) source must match hostWindow (si tenemos hostWindow)
    if (!hostWindow) {
      warn("blocked: no hostWindow (not iframe and no opener)");
      return;
    }
    if (event.source !== hostWindow) {
      warn("blocked: source mismatch (event.source !== hostWindow)");
      return;
    }

    // 3) handshake: considera ready si llega cualquiera de estos
    if (!ready && (type === "HOST_CONTEXT" || type === "BRIDGE_READY" || type === "MBS_BRIDGE_READY" || type === "MBS_HOST_CONTEXT")) {
      ready = true;
      activeOrigin = event.origin;
      log("HANDSHAKE OK", { activeOrigin });
      // no retornamos; puede traer payload + requestId
    }

    // 4) correlación de requests
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
      const e = Object.assign(new Error(message), { code, raw });
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
      err("NO CONNECT: allowedParentOrigin inválido o vacío. Debe ser el ORIGIN exacto del host.");
      return Promise.reject(Object.assign(new Error("allowedParentOrigin is required"), { code: "MISSING_ALLOWED_PARENT_ORIGIN" }));
    }
    if (!hostWindow) {
      err("NO CONNECT: no hay hostWindow. Debes abrir la miniapp dentro del host (iframe) o desde el host (window.opener).");
      return Promise.reject(Object.assign(new Error("Host window not available"), { code: "NO_HOST_WINDOW" }));
    }

    selfWindow.addEventListener("message", onMessage);

    // 1) enviar ready
    try {
      postToHost({ type: "APP_READY" });
      log("sent APP_READY");
    } catch (e) {
      err("failed to post APP_READY", e);
    }

    // 2) ping: pedir host context aunque no estés ready (diagnóstico)
    // Si el host responde, aquí ya verás en consola qué llega.
    void request({ type: "REQUEST_HOST_CONTEXT" }, 6000)
      .then((ctx) => log("REQUEST_HOST_CONTEXT OK", ctx))
      .catch((e) => err("REQUEST_HOST_CONTEXT ERROR", { code: e.code, message: e.message, raw: e.raw }));

    // 3) timeout de diagnóstico
    window.setTimeout(() => {
      if (isReady()) {
        log("bridge READY ✅", { activeOrigin });
        return;
      }
      err("bridge NOT READY ❌ (no handshake)", {
        allowedOrigin,
        hint: [
          "1) Verifica que allowedParentOrigin sea EXACTAMENTE el origin del host (sin path).",
          "2) Verifica que realmente estás embebido en iframe dentro de ese host (o abierto desde el host con window.opener).",
          "3) Revisa en el host si al recibir APP_READY está respondiendo con HOST_CONTEXT/BRIDGE_READY.",
          "4) Si el host usa otro tipo de handshake, dime cuál mensaje manda.",
        ],
      });
    }, 1200);

    return Promise.resolve({ ok: true });
  }

  // Para tu caso: enviar transacción solo si ready (como antes)
  async function sendTransactionToHost(payload, idempotencyKey, { timeoutMs } = {}) {
    if (!isReady()) {
      const e = Object.assign(new Error("Host not connected"), {
        code: "HOST_NOT_CONNECTED",
        debug: { allowedOrigin, activeOrigin, ready, hasHostWindow: !!hostWindow },
      });
      throw e;
    }

    // Si tu host real NO soporta MBS_SEND_TRANSACTION, aquí se va a quedar en timeout.
    // Por debug, también te conviene probar CREATE_EXPENSE como el starter kit.
    const data = await request(
      {
        type: "MBS_SEND_TRANSACTION",
        payload,
        idempotencyKey: String(idempotencyKey || ""),
      },
      timeoutMs
    );
    return data;
  }

  // API mínima
  return {
    initializeBridge,
    isReady,
    sendTransactionToHost,

    // te dejo request por si quieres probar CREATE_EXPENSE directamente:
    request,
  };
}