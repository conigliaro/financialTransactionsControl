import { uuidv4 } from '../utils/uuid.js';
import { ALLOWED_ORIGINS } from './bridge-config.js';

const DEFAULT_TIMEOUT_MS = 15_000;

function isAllowedOrigin(origin, allowedOrigins) {
  return Array.isArray(allowedOrigins) && allowedOrigins.includes(origin);
}

function safeMessageType(data) {
  if (!data || typeof data !== 'object') return null;
  const type = data.type;
  return typeof type === 'string' ? type : null;
}

function isBridgeV1ErrorCode(x) {
  return x === 'MISSING_PERMISSION' || x === 'NOT_AUTHED' || x === 'UNKNOWN';
}

function isHandshakeMessage(type, data) {
  if (type === 'HOST_CONTEXT') return true;
  if (type === 'MBS_HOST_CONTEXT') return true;
  if (type === 'MBS_BRIDGE_READY') return true;
  if (type === 'BRIDGE_READY') return true;
  if (type === 'BRIDGE_HANDSHAKE') return true;
  if (type === 'MBS_BRIDGE_HANDSHAKE') return true;
  return Boolean(data?.payload?.v === 1 && type === 'HOST_CONTEXT');
}

export function createBridgeClient({
  allowedOrigins = ALLOWED_ORIGINS,
  parentWindow = window.parent,
  selfWindow = window,
  defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const pending = new Map();
  const warnedOrigins = new Set();
  const readyWaiters = new Set();

  let destroyed = false;
  let initialized = false;
  let ready = false;
  let activeOrigin = null;

  function warnOnce(origin) {
    if (warnedOrigins.has(origin)) return;
    warnedOrigins.add(origin);
    console.warn(`[bridge] Ignoring message from disallowed origin: ${origin}`);
  }

  function _notifyReady() {
    for (const fn of readyWaiters) {
      try {
        fn(true);
      } catch {
        // no-op
      }
      readyWaiters.delete(fn);
    }
  }

  function postToHost(message) {
    if (!activeOrigin) {
      const err = new Error('Host not connected');
      err.code = 'HOST_NOT_CONNECTED';
      throw err;
    }
    parentWindow.postMessage(message, activeOrigin);
  }

  function request(msg, timeoutMs) {
    if (!isReady()) {
      const err = new Error('Host not connected');
      err.code = 'HOST_NOT_CONNECTED';
      return Promise.reject(err);
    }
    const requestId = uuidv4();
    const tms = Math.max(500, Number(timeoutMs ?? defaultTimeoutMs) || DEFAULT_TIMEOUT_MS);
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pending.delete(requestId);
        reject(Object.assign(new Error('timeout'), { code: 'TIMEOUT' }));
      }, tms);
      pending.set(requestId, { resolve, reject, timer });
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
    const origin = event.origin;
    if (!isAllowedOrigin(origin, allowedOrigins)) {
      warnOnce(origin);
      return;
    }
    if (event.source !== parentWindow) return;

    const type = safeMessageType(event.data);
    if (!type) return;

    if (!ready && isHandshakeMessage(type, event.data)) {
      activeOrigin = origin;
      ready = true;
      _notifyReady();
      return;
    }

    if (!ready) return;
    if (origin !== activeOrigin) return;

    const requestId = event.data?.requestId;
    if (typeof requestId !== 'string') return;
    const entry = pending.get(requestId);
    if (!entry) return;

    if (type === 'MBS_SEND_TRANSACTION_RESULT' || type === 'MBS_SEND_TRANSACTION_RESPONSE') {
      window.clearTimeout(entry.timer);
      pending.delete(requestId);
      entry.resolve(event.data);
      return;
    }

    if (type === 'RESULT') {
      window.clearTimeout(entry.timer);
      pending.delete(requestId);
      entry.resolve(event.data?.result);
      return;
    }

    if (type === 'ERROR') {
      const err = event.data?.error;
      const code = err?.code;
      const message = err?.message;
      if (!isBridgeV1ErrorCode(code) || typeof message !== 'string') return;
      window.clearTimeout(entry.timer);
      pending.delete(requestId);
      const e = new Error(message);
      e.code = code;
      entry.reject(e);
      return;
    }
  }

  function initializeBridge() {
    if (destroyed) {
      const err = new Error('Bridge destroyed');
      err.code = 'BRIDGE_DESTROYED';
      return Promise.reject(err);
    }
    if (!initialized) {
      initialized = true;
      selfWindow.addEventListener('message', onMessage);
    }
    for (const origin of allowedOrigins) {
      parentWindow.postMessage({ type: 'APP_READY' }, origin);
    }
    return Promise.resolve({ ready, activeOrigin });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (initialized) selfWindow.removeEventListener('message', onMessage);
    for (const [id, entry] of pending.entries()) {
      window.clearTimeout(entry.timer);
      entry.reject(Object.assign(new Error('Bridge destroyed'), { code: 'BRIDGE_DESTROYED' }));
      pending.delete(id);
    }
    for (const fn of readyWaiters) {
      try {
        fn(false);
      } catch {
        // no-op
      }
      readyWaiters.delete(fn);
    }
  }

  function isReady() {
    return ready && Boolean(activeOrigin);
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

  function sendTransactionToHost(payload, idempotencyKey, { timeoutMs } = {}) {
    if (!isReady()) {
      const err = new Error('Host not connected');
      err.code = 'HOST_NOT_CONNECTED';
      return Promise.reject(err);
    }

    const requestId = uuidv4();
    const tms = Math.max(500, Number(timeoutMs ?? defaultTimeoutMs) || DEFAULT_TIMEOUT_MS);

    const rawPromise = new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pending.delete(requestId);
        reject(Object.assign(new Error('timeout'), { code: 'TIMEOUT' }));
      }, tms);

      pending.set(requestId, { resolve, reject, timer });
      try {
        postToHost({
          type: 'MBS_SEND_TRANSACTION',
          requestId,
          idempotencyKey: String(idempotencyKey || ''),
          payload,
        });
      } catch (err) {
        window.clearTimeout(timer);
        pending.delete(requestId);
        reject(err);
      }
    });

    return rawPromise.then((data) => {
      const status = String(data?.status || '').toLowerCase();
      const remoteTxnId = data?.remoteTxnId;
      if (status === 'success' && typeof remoteTxnId === 'string' && remoteTxnId.trim()) return data;

      const err = new Error('Invalid host confirmation');
      err.code = status && status !== 'success' ? 'HOST_FAILURE' : 'INVALID_ACK';
      err.responsePayload = data;
      throw err;
    });
  }

  function getUserProfile({ timeoutMs } = {}) {
    return request({ type: 'GET_USER_PROFILE' }, timeoutMs);
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
    sendTransactionToHost,
    getUserProfile,
  };
}

let bridgeSingleton = null;

export async function initializeBridge() {
  if (!bridgeSingleton) bridgeSingleton = createBridgeClient();
  return bridgeSingleton.initializeBridge();
}

export function sendTransactionToHost(payload, idempotencyKey, opts) {
  if (!bridgeSingleton) bridgeSingleton = createBridgeClient();
  return bridgeSingleton.sendTransactionToHost(payload, idempotencyKey, opts);
}

export function waitForBridgeReady(opts) {
  if (!bridgeSingleton) bridgeSingleton = createBridgeClient();
  if (typeof bridgeSingleton.waitForReady !== 'function') return Promise.resolve(false);
  return bridgeSingleton.waitForReady(opts);
}

export function getUserProfile(opts) {
  if (!bridgeSingleton) bridgeSingleton = createBridgeClient();
  if (typeof bridgeSingleton.getUserProfile !== 'function') {
    const err = new Error('Bridge method not available');
    err.code = 'UNKNOWN';
    return Promise.reject(err);
  }
  return bridgeSingleton.getUserProfile(opts);
}

export function isBridgeReady() {
  if (!bridgeSingleton) return false;
  return bridgeSingleton.isReady();
}

export function __resetBridgeForTests() {
  if (bridgeSingleton) bridgeSingleton.destroy();
  bridgeSingleton = null;
  try {
    window.dispatchEvent(new CustomEvent('bridge:user-profile', { detail: { username: null } }));
  } catch {
    // no-op
  }
}

export function __setBridgeForTests(bridge) {
  if (bridgeSingleton) bridgeSingleton.destroy();
  bridgeSingleton = bridge;
}
