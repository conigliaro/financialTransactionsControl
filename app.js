// Starter kit (vanilla) — Bridge v1 client helper
//
// Fuente de verdad: apps/web/src/features/apps/bridge/apps-bridge-v1.ts
// Este archivo incluye una versión JS equivalente para que puedas probar sin bundler.

export function createAppsBridgeV1(opts) {
  function normalizeAllowedOrigin(input) {
    const raw = (input || "").trim();
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

  function isBridgeV1ErrorCode(x) {
    return x === "MISSING_PERMISSION" || x === "NOT_AUTHED" || x === "UNKNOWN";
  }

  function isAppMode(x) {
    return x === "embedded" || x === "standalone";
  }

  const allowedOrigin = normalizeAllowedOrigin(opts.allowedParentOrigin);
  if (!allowedOrigin) {
    throw new Error(
      "[apps-bridge-v1] allowedParentOrigin is required (must be a valid http/https URL origin)",
    );
  }

  const parentWin = opts.parentWindow ?? window.parent;
  const defaultTimeoutMs = Math.max(500, opts.defaultTimeoutMs ?? 8000);

  const pending = new Map();
  let destroyed = false;

  function newRequestId() {
    const g = globalThis;
    if (g?.crypto?.randomUUID) return g.crypto.randomUUID();
    return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function safeParseMessage(data) {
    if (!data || typeof data !== "object") return null;
    const type = data.type;
    if (typeof type !== "string") return null;

    if (type === "HOST_CONTEXT") {
      const payload = data.payload;
      if (!payload || typeof payload !== "object") return null;
      if (payload.v !== 1) return null;

      const app = payload.app;
      const platform = payload.platform;
      if (!app || typeof app !== "object") return null;
      if (!platform || typeof platform !== "object") return null;

      if (typeof app.id !== "string") return null;
      if (typeof app.kind !== "string") return null;
      if (!isAppMode(app.mode)) return null;

      if (!isAppMode(platform.mode)) return null;
      if (typeof platform.host !== "string") return null;
      if (typeof platform.isDevHost !== "boolean") return null;
      if (typeof platform.isMobile !== "boolean") return null;

      if (!Array.isArray(payload.permissions)) return null;
      if (!payload.permissions.every((p) => typeof p === "string")) return null;
      if (typeof payload.isAuthed !== "boolean") return null;

      if ("requestId" in data && data.requestId != null && typeof data.requestId !== "string") return null;
      return data;
    }

    if (type === "RESULT") {
      if (typeof data.requestId !== "string") return null;
      return data;
    }

    if (type === "ERROR") {
      if (typeof data.requestId !== "string") return null;
      const err = data.error;
      if (!err || typeof err !== "object") return null;
      if (!isBridgeV1ErrorCode(err.code)) return null;
      if (typeof err.message !== "string") return null;
      return data;
    }

    return null;
  }

  function postToHost(msg) {
    parentWin.postMessage(msg, allowedOrigin);
  }

  function request(msg, timeoutMs) {
    if (destroyed) return Promise.reject(new Error("[apps-bridge-v1] bridge destroyed"));

    const requestId = newRequestId();
    const tms = Math.max(500, timeoutMs ?? defaultTimeoutMs);

    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`[apps-bridge-v1] request timeout (${tms}ms) type=${msg.type}`));
      }, tms);

      pending.set(requestId, { resolve, reject, timer });
      postToHost({ ...msg, requestId });
    });
  }

  function onMessage(event) {
    if (event.origin !== allowedOrigin) return;
    if (event.source !== parentWin) return;

    const parsed = safeParseMessage(event.data);
    if (!parsed) return;

    if (parsed.type === "HOST_CONTEXT") {
      const reqId = parsed.requestId;
      if (reqId && pending.has(reqId)) {
        const p = pending.get(reqId);
        window.clearTimeout(p.timer);
        pending.delete(reqId);
        p.resolve(parsed.payload);
      }
      return;
    }

    if (parsed.type === "RESULT") {
      const p = pending.get(parsed.requestId);
      if (!p) return;
      window.clearTimeout(p.timer);
      pending.delete(parsed.requestId);
      p.resolve(parsed.result);
      return;
    }

    if (parsed.type === "ERROR") {
      const p = pending.get(parsed.requestId);
      if (!p) return;
      window.clearTimeout(p.timer);
      pending.delete(parsed.requestId);

      const err = parsed.error;
      const e = new Error(err.message);
      e.code = err.code;
      p.reject(e);
    }
  }

  window.addEventListener("message", onMessage);

  return {
    ready(requestId) {
      postToHost({ type: "APP_READY", requestId });
    },
    getHostContext(opts2) {
      return request({ type: "REQUEST_HOST_CONTEXT" }, opts2?.timeoutMs);
    },
    createExpense(input, opts2) {
      return request({ type: "CREATE_EXPENSE", payload: input }, opts2?.timeoutMs);
    },
    createIncome(input, opts2) {
      return request({ type: "CREATE_INCOME", payload: input }, opts2?.timeoutMs);
    },
    listTransactionsMonth(params, opts2) {
      return request({ type: "LIST_TRANSACTIONS_MONTH", payload: params }, opts2?.timeoutMs);
    },
    getTransactionRangeDetails(params, opts2) {
      return request({ type: "GET_TRANSACTION_RANGE_DETAILS", payload: params }, opts2?.timeoutMs);
    },
    listCategories(params = {}, opts2) {
      return request({ type: "LIST_CATEGORIES", payload: params }, opts2?.timeoutMs);
    },
    createPaymentPlan(payload, opts2) {
      return request({ type: "CREATE_PAYMENT_PLAN", payload }, opts2?.timeoutMs);
    },
    listPaymentPlans(opts2) {
      return request({ type: "LIST_PAYMENT_PLANS" }, opts2?.timeoutMs);
    },
    createIncomePlan(payload, opts2) {
      return request({ type: "CREATE_INCOME_PLAN", payload }, opts2?.timeoutMs);
    },
    listIncomePlans(opts2) {
      return request({ type: "LIST_INCOME_PLANS" }, opts2?.timeoutMs);
    },
    listOverduePayments(params = {}, opts2) {
      return request({ type: "LIST_OVERDUE_PAYMENTS", payload: params }, opts2?.timeoutMs);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      window.removeEventListener("message", onMessage);
      for (const [id, p] of pending.entries()) {
        window.clearTimeout(p.timer);
        p.reject(new Error("[apps-bridge-v1] destroyed"));
        pending.delete(id);
      }
    },
  };
}

const out = document.getElementById("out");
const actionEl = document.getElementById("action");
const btnRun = document.getElementById("btnRun");
const hostOriginEl = document.getElementById("hostOrigin");

const amountEl = document.getElementById("amount");
const noteEl = document.getElementById("note");
const monthEl = document.getElementById("month");
const yearEl = document.getElementById("year");
const txTypeEl = document.getElementById("txType");
const categoryTypeEl = document.getElementById("categoryType");
const startIsoEl = document.getElementById("startIso");
const endIsoEl = document.getElementById("endIso");
const currencyCodeEl = document.getElementById("currencyCode");
const includeCountsEl = document.getElementById("includeCounts");
const planTitleEl = document.getElementById("planTitle");
const planStartDateEl = document.getElementById("planStartDate");
const paymentCadenceEl = document.getElementById("paymentCadence");
const dayOfMonthEl = document.getElementById("dayOfMonth");
const incomeFrequencyEl = document.getElementById("incomeFrequency");
const lookbackDaysEl = document.getElementById("lookbackDays");
const limitEl = document.getElementById("limit");

let bridge = null;

function write(kind, payload) {
  const safe = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  out.textContent = kind + "\n" + safe;
}

function requireBridge() {
  if (bridge) return bridge;
  const allowedParentOrigin = String(hostOriginEl.value || "").trim();
  bridge = createAppsBridgeV1({ allowedParentOrigin, defaultTimeoutMs: 8000 });
  bridge.ready();
  return bridge;
}

function readNumber(el, fallback) {
  const n = Number(el.value);
  return Number.isFinite(n) ? n : fallback;
}

function nonEmpty(s) {
  const v = String(s || "").trim();
  return v ? v : undefined;
}

function readBool(el) {
  return String(el.value) === "true";
}

async function run() {
  btnRun.disabled = true;
  const action = String(actionEl.value);

  try {
    write("PENDING", { action });

    if (action === "destroy") {
      if (bridge) bridge.destroy();
      bridge = null;
      write("OK", { destroyed: true });
      return;
    }

    const b = requireBridge();

    if (action === "getHostContext") {
      const ctx = await b.getHostContext({ timeoutMs: 8000 });
      write("OK", ctx);
      return;
    }

    if (action === "createExpense") {
      const amount = readNumber(amountEl, 0);
      const note = nonEmpty(noteEl.value);
      const res = await b.createExpense({ amount, note }, { timeoutMs: 10000 });
      write("OK", res);
      return;
    }

    if (action === "createIncome") {
      const amount = readNumber(amountEl, 0);
      const note = nonEmpty(noteEl.value);
      const res = await b.createIncome({ amount, note }, { timeoutMs: 10000 });
      write("OK", res);
      return;
    }

    if (action === "listTransactionsMonth") {
      const month = readNumber(monthEl, 1);
      const year = readNumber(yearEl, 2026);
      const type = nonEmpty(txTypeEl.value);
      const res = await b.listTransactionsMonth({ month, year, type }, { timeoutMs: 8000 });
      write("OK", res);
      return;
    }

    if (action === "getTransactionRangeDetails") {
      const start = String(startIsoEl.value || "").trim();
      const end = String(endIsoEl.value || "").trim();
      const type = nonEmpty(txTypeEl.value) || "EXPENSE";
      const currencyCode = nonEmpty(currencyCodeEl.value);
      const res = await b.getTransactionRangeDetails({ start, end, type, currencyCode }, { timeoutMs: 8000 });
      write("OK", res);
      return;
    }

    if (action === "listCategories") {
      const type = nonEmpty(categoryTypeEl.value);
      const includeCounts = readBool(includeCountsEl);
      const res = await b.listCategories({ type, includeCounts }, { timeoutMs: 8000 });
      write("OK", res);
      return;
    }

    if (action === "createPaymentPlan") {
      const payload = {
        title: String(planTitleEl.value || "Plan").trim(),
        amount: readNumber(amountEl, 1),
        currencyCode: String(currencyCodeEl.value || "EUR").trim(),
        cadence: String(paymentCadenceEl.value || "MONTHLY"),
        startDate: String(planStartDateEl.value || "2026-01-01").trim(),
        dayOfMonth: readNumber(dayOfMonthEl, 1),
      };
      const res = await b.createPaymentPlan(payload, { timeoutMs: 12000 });
      write("OK", res);
      return;
    }

    if (action === "listPaymentPlans") {
      const res = await b.listPaymentPlans({ timeoutMs: 8000 });
      write("OK", res);
      return;
    }

    if (action === "createIncomePlan") {
      const payload = {
        title: String(planTitleEl.value || "Income plan").trim(),
        amount: readNumber(amountEl, 1),
        currencyCode: String(currencyCodeEl.value || "EUR").trim(),
        frequency: String(incomeFrequencyEl.value || "MONTHLY"),
        startDate: String(planStartDateEl.value || "2026-01-01").trim(),
        dayOfMonth: readNumber(dayOfMonthEl, 1),
      };
      const res = await b.createIncomePlan(payload, { timeoutMs: 12000 });
      write("OK", res);
      return;
    }

    if (action === "listIncomePlans") {
      const res = await b.listIncomePlans({ timeoutMs: 8000 });
      write("OK", res);
      return;
    }

    if (action === "listOverduePayments") {
      const limit = readNumber(limitEl, 20);
      const lookbackDays = readNumber(lookbackDaysEl, 60);
      const res = await b.listOverduePayments({ limit, lookbackDays }, { timeoutMs: 8000 });
      write("OK", res);
      return;
    }

    write("ERROR", { message: "Unknown action", action });
  } catch (err) {
    write("ERROR", {
      code: err?.code,
      message: err?.message || String(err),
      stack: err?.stack,
    });
  } finally {
    btnRun.disabled = false;
  }
}

btnRun.addEventListener("click", () => void run());
write("READY", { hint: "Select an action and press Run" });