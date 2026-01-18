// host/bridge-client.js
import { uuidv4 } from "../utils/uuid.js";
import { ALLOWED_HOST_ORIGINS, normalizeAllowedOrigin } from "./bridge-config.js";

const DEFAULT_TIMEOUT_MS = 15_000;

function safeMessageType(data) {
  if (!data || typeof data !== "object") return null;
  const type = data.type;
  return typeof type === "string" ? type : null;
}

// En tu versión vieja solo aceptabas 3 códigos. Eso hace que pierdas ERRORES reales del host.
// Aquí aceptamos cualquier string para code si viene con message string.
function normalizeHostError(err) {
  const code = typeof err?.code === "string" ? err.code : "UNKNOWN";
  const message = typeof err?.message === "string" ? err.message : "Unknown host error";
  return { code, message, raw: err };
}

function isHandshakeMessage(type, data) {
  if (type === "HOST_CONTEXT") return true;
  if (type === "MBS_HOST_CONTEXT") return true;
  if (type === "MBS_BRIDGE_READY") return true;
  if (type === "BRIDGE_READY") return true;
  if (type === "BRIDGE_HANDSHAKE") return true;
  if (type === "MBS_BRIDGE_HANDSHAKE") return true;

  // compat viejo: HOST_CONTEXT con payload.v=1
  return Boolean(data?.payload?.v === 1 && type === "HOST_CONTEXT");
}

// Detecta si estás embedded (iframe) o standalone con opener.
// - Embedded: window.parent !== window
// - Standalone lanzado desde host: window.opener existe
function inferHostWindow() {
  try {
    if (window.parent && window.parent !== window) return window.parent;
  } catch {
    // cross-origin access al parent puede tirar, pero postMessage igual sirve si tienes referencia
    // si explota, seguimos al opener.
  }
  if (window.opener) return window.opener;
  return null;
}

export function createBridgeClient({
  // Recomendado: pasar allowedParentOrigin exacto desde tu miniapp config/env.
  // Si no lo pasas, usamos el primero de la lista como fallback (y log).
  allowedParentOrigin,
  allowedOrigins = ALLOWED_HOST_ORIGINS,

  parentWindow, // opcional: puedes inyectarlo en tests
  selfWindow = window,

  defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
  debug = false,
} = {}) {
  const pending = new Map();
  const readyWaiters = new Set();

  let destroyed = false;
  let initialized = false;
  let ready = false;

  // Fuente de verdad del origin permitido (uno solo)
  const normalizedAllowed =
    normalizeAllowedOrigin(allowedParentOrigin) ||
    normalizeAllowedOrigin(allowedOrigins?.[0]) ||
    "";

  // Ventana host a la que le hablas
  const hostWindow = parentWindow ?? inferHostWindow();

  // Origin activo (igual a allowedParentOrigin cuando handshake)
  let activeOrigin = null;

  function log(...args) {
    if (!debug) return;
    // eslint-disable-next-line no-console
    console.log("[bridge]", ...args);
  }

  function _notifyReady(ok) {
    for (const fn of readyWaiters) {
      try {
        fn(Boolean(ok));
      } catch {
        // no-op
      }
      readyWaiters.delete(fn);
    }
  }

  function isReady() {
    return ready && Boolean(activeOrigin) && Boolean(hostWindow);
  }

  function postToHost(message) {
    if (!hostWindow) {
      const err = new Error("Host window not available (not embedded and no opener)");
      err.code = "NO_HOST_WINDOW";
      throw err;
    }
    if (!activeOrigin) {
      const err = new Error("Host not connected");
      err.code = "HOST_NOT_CONNECTED";
      throw err;
    }
    hostWindow.postMessage(message, activeOrigin);
  }

  function request(msg, timeoutMs) {
    if (!isReady()) {
      const err = new Error("Host not connected");
      err.code = "HOST_NOT_CONNECTED";
      return Promise.reject(err);
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
      } catch (err) {
        window.clearTimeout(timer);
        pending.delete(requestId);
        reject(err);
      }
    });
  }

  function onMessage(event) {
    if (destroyed) return;

    const type = safeMessageType(event.data);
    if (!type) return;

    // 1) Seguridad: validar origin permitido (uno solo)
    if (!normalizedAllowed) {
      // si no hay allowed origin configurado, es mejor NO conectar.
      log("blocked message because allowedParentOrigin is missing");
      return;
    }
    if (event.origin !== normalizedAllowed) return;

    // 2) Seguridad: validar source (iframe -> parent, standalone -> opener)
    if (hostWindow && event.source !== hostWindow) return;

    // 3) Handshake
    if (!ready && isHandshakeMessage(type, event.data)) {
      activeOrigin = event.origin;
      ready = true;
      log("handshake ok", { type, origin: activeOrigin });
      _notifyReady(true);
      return;
    }

    if (!ready) return;
    if (event.origin !== activeOrigin) return;

    const requestId = event.data?.requestId;
    if (typeof requestId !== "string") return;

    const entry = pending.get(requestId);
    if (!entry) return;

    // Compat: tu flujo viejo de transacciones
    if (type === "MBS_SEND_TRANSACTION_RESULT" || type === "MBS_SEND_TRANSACTION_RESPONSE") {
      window.clearTimeout(entry.timer);
      pending.delete(requestId);
      entry.resolve(event.data);
      return;
    }

    // Bridge v1 estándar
    if (type === "RESULT") {
      window.clearTimeout(entry.timer);
      pending.delete(requestId);
      entry.resolve(event.data?.result);
      return;
    }

    // HOST_CONTEXT (cuando lo pides con REQUEST_HOST_CONTEXT)
    if (type === "HOST_CONTEXT") {
      window.clearTimeout(entry.timer);
      pending.delete(requestId);
      entry.resolve(event.data?.payload ?? event.data);
      return;
    }

    if (type === "ERROR") {
      window.clearTimeout(entry.timer);
      pending.delete(requestId);

      const { code, message, raw } = normalizeHostError(event.data?.error);
      const e = new Error(message);
      e.code = code;
      e.raw = raw;
      e.requestId = requestId;
      e.requestType = entry.type;
      entry.reject(e);
      return;
    }
  }

  function initializeBridge() {
    if (destroyed) {
      const err = new Error("Bridge destroyed");
      err.code = "BRIDGE_DESTROYED";
      return Promise.reject(err);
    }

    if (!normalizedAllowed) {
      const err = new Error("allowedParentOrigin is required (exact host origin)");
      err.code = "MISSING_ALLOWED_PARENT_ORIGIN";
      return Promise.reject(err);
    }

    if (!hostWindow) {
      const err = new Error("Host window not available (open this miniapp from the host, not directly)");
      err.code = "NO_HOST_WINDOW";
      return Promise.reject(err);
    }

    if (!initialized) {
      initialized = true;
      selfWindow.addEventListener("message", onMessage);
    }

    // Enviar APP_READY SOLO al origin permitido (como el starter kit)
    hostWindow.postMessage({ type: "APP_READY" }, normalizedAllowed);
    log("sent APP_READY to", normalizedAllowed);

    // Nota: el host debería responder con HOST_CONTEXT / BRIDGE_READY etc.
    return Promise.resolve({ ready, activeOrigin, allowedOrigin: normalizedAllowed });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;

    if (initialized) selfWindow.removeEventListener("message", onMessage);

    for (const [id, entry] of pending.entries()) {
      window.clearTimeout(entry.timer);
      entry.reject(Object.assign(new Error("Bridge destroyed"), { code: "BRIDGE_DESTROYED" }));
      pending.delete(id);
    }

    _notifyReady(false);
  }

  function waitForReady({ timeoutMs } = {}) {
    if (isReady()) return Promise.resolve(true);

    const tms = Math.max(250, Number(timeoutMs ?? defaultTimeoutMs) || DEFAULT_TIMEOUT_MS);

    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        readyWaiters.delete(resolve);
        resolve(false);
      }, tms);

      readyWaiters.add((ok) => {
        window.clearTimeout(timer);
        resolve(Boolean(ok));
      });
    });
  }

  // Tu método custom (compat). OJO: esto depende de que el host tenga handler para MBS_SEND_TRANSACTION.
  function sendTransactionToHost(payload, idempotencyKey, { timeoutMs } = {}) {
    if (!isReady()) {
      const err = new Error("Host not connected");
      err.code = "HOST_NOT_CONNECTED";
      return Promise.reject(err);
    }

    const requestId = uuidv4();
    const tms = Math.max(500, Number(timeoutMs ?? defaultTimeoutMs) || DEFAULT_TIMEOUT_MS);

    const rawPromise = new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pending.delete(requestId);
        reject(Object.assign(new Error("timeout"), { code: "TIMEOUT", requestId, type: "MBS_SEND_TRANSACTION" }));
      }, tms);

      pending.set(requestId, { resolve, reject, timer, type: "MBS_SEND_TRANSACTION" });

      try {
        postToHost({
          type: "MBS_SEND_TRANSACTION",
          requestId,
          idempotencyKey: String(idempotencyKey || ""),
          payload,
        });
      } catch (err) {
        window.clearTimeout(timer);
        pending.delete(requestId);
        reject(err);
      }
    });

    return rawPromise.then((data) => {
      const status = String(data?.status || "").toLowerCase();
      const remoteTxnId = data?.remoteTxnId;

      if (status === "success" && typeof remoteTxnId === "string" && remoteTxnId.trim()) return data;

      const err = new Error("Invalid host confirmation");
      err.code = status && status !== "success" ? "HOST_FAILURE" : "INVALID_ACK";
      err.responsePayload = data;
      throw err;
    });
  }

  // Bridge v1 estándar: esto te permite usar el mismo shape del starter kit
  function getHostContext({ timeoutMs } = {}) {
    return request({ type: "REQUEST_HOST_CONTEXT" }, timeoutMs);
  }

  // Si tu host soporta GET_USER_PROFILE (como en tu wizard)
  function getUserProfile({ timeoutMs } = {}) {
    return request({ type: "GET_USER_PROFILE" }, timeoutMs);
  }

  function getActiveOrigin() {
    return activeOrigin;
  }

  return {
    initializeBridge,
    destroy,
    isReady,
    waitForReady,
    getActiveOrigin,

    // standard v1 style
    getHostContext,
    getUserProfile,

    // compat custom
    sendTransactionToHost,

    // low-level (por si lo necesitas)
    request,
  };
}

let bridgeSingleton = null;

export async function initializeBridge(opts) {
  if (!bridgeSingleton) bridgeSingleton = createBridgeClient(opts);
  return bridgeSingleton.initializeBridge();
}

export function waitForBridgeReady(opts) {
  if (!bridgeSingleton) bridgeSingleton = createBridgeClient(opts);
  return bridgeSingleton.waitForReady(opts);
}

export function isBridgeReady() {
  if (!bridgeSingleton) return false;
  return bridgeSingleton.isReady();
}

export function getHostContext(opts) {
  if (!bridgeSingleton) bridgeSingleton = createBridgeClient(opts);
  return bridgeSingleton.getHostContext(opts);
}

export function getUserProfile(opts) {
  if (!bridgeSingleton) bridgeSingleton = createBridgeClient(opts);
  return bridgeSingleton.getUserProfile(opts);
}

export function sendTransactionToHost(payload, idempotencyKey, opts) {
  if (!bridgeSingleton) bridgeSingleton = createBridgeClient(opts);
  return bridgeSingleton.sendTransactionToHost(payload, idempotencyKey, opts);
}

export function __resetBridgeForTests() {
  if (bridgeSingleton) bridgeSingleton.destroy();
  bridgeSingleton = null;
}