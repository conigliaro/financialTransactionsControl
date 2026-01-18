# Financial Transactions Control (Mini App)

An iframe-ready, offline-first mini app for tracking business financial movements (income/expense) with local catalogs (vendors, expense types, currencies) and optional “Send to MyBudgetSocial / Finanzas” integration via Bridge v1 (`postMessage`).

## Key Features

- **Movements ledger**: create/edit/delete movements with **Transaction Type** (`income`/`expense`) and money fields stored as numbers in IndexedDB.
- **Catalogs (auto-grow)**:
  - Vendors and Expense Types with a **combobox** experience (type → suggestions → create if missing).
  - Catalog CRUD screens for Vendors, Expense Types, and Currencies.
- **Currencies**:
  - Seeded catalog: **USD / EUR / BRL**.
  - Default currency selection stored in IndexedDB meta and used for **amount formatting**.
- **Offline-first storage**: everything persists locally via **IndexedDB**.
- **Export**: CSV export (XLSX is not implemented).
- **Send to MyBudgetSocial (Bridge v1)**:
  - Allowed-origins enforcement (mandatory).
  - Request/response correlation + timeout.
  - **Idempotency keys** and safe retries.
  - **Per-movement send history** and **change history**.

## Quickstart (Local Development)

### Prereqs
- Node.js (recommended: latest LTS)

### Install
```bash
npm install
```

### Run (static server)
This app is plain HTML/JS/CSS. Serve the repo root:
```bash
npx http-server .
```
Then open `http://localhost:8080` (or the URL printed by the server).

### Test
```bash
npm test
```

### iOS/Safari dev tips
- Use Safari Remote Debugging (Mac Safari → Develop → your iPhone → the page inside the iframe).
- If “Save” fails, the app shows a custom error dialog with copyable details (no native alerts).

## Data Storage (IndexedDB)

- **DB name**: `ledgerlite`
- **DB version**: `4`

### Main stores
- `movements` (keyPath: `id`)
  - Movement fields include: `id` (string), `rev` (int), `txnType` (`income`/`expense`), amounts, vendor/type strings, `status` (internal).
  - **Migration defaults**:
    - Existing records missing `txnType` → `expense` (migration default).
    - Existing records missing `rev` → `1`.
    - New records default `txnType` in the UI → `income`.
- `meta` (keyPath: `key`)
  - `theme` (`light`/`dark`), `language` (`en`/`es`/`pt-BR`), `companyName`, `companySubtitle`, `defaultCurrencyCode`, etc.
- `catalog_vendors` (autoIncrement `id`): `{ name, normalizedName, createdAt }`
- `catalog_expense_types` (autoIncrement `id`): `{ name, normalizedName, createdAt }`
- `catalog_currencies` (keyPath: `code`): `{ code, name, symbol, createdAt }` (seeded with USD/EUR/BRL)

### Bridge/send-specific stores
- `movement_remote_map` (keyPath: `movementId`)
  - Maps a local movement → remote transaction id: `{ movementId, idempotencyKey, remoteTxnId, firstSentAt, lastSentAt, sentCount }`
- `movement_send_attempts` (keyPath: `attemptId`, indexed by `movementId`)
  - Append-only attempt log per send: status, duration, payload/response, error code/message.
- `movement_change_log` (keyPath: `changeId`, indexed by `movementId`)
  - Audit trail for `create` / `update` / `delete`, including internal updates like `status="sent"` (`source="send_status_update"`).

### Reserved/legacy stores
- `mappings`, `outbox_ops`: present for compatibility/future work; not required for current send flow.

## Integration with MyBudgetSocial (Finanzas)

### A) Embedding example (iframe)
Serve the mini app from a stable HTTPS origin and embed it:
```html
<iframe
  src="https://your-cdn.example.com/finanzas-miniapp/index.html"
  title="Finanzas"
  style="width:100%;height:100%;border:0"
  sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
></iframe>
```

Notes:
- Export uses a download; `allow-downloads` is recommended for iframe sandbox.
- If you use clipboard copy inside dialogs, consider allowing `clipboard-write` depending on your host policy.

### B) Bridge v1 protocol (postMessage)
Bridge runtime lives in:
- `host/bridge-client.js`
- `host/bridge-config.js` (allowed origins)

#### Handshake / readiness
On init, the mini app broadcasts:
```js
{ type: "APP_READY" }
```
to each origin in `ALLOWED_ORIGINS`. The bridge becomes “ready” only after it receives a handshake message from **an allowed origin** (and `event.source === window.parent`).

Supported handshake types include (host → app):
- `BRIDGE_READY` (recommended)
- also accepted: `HOST_CONTEXT`, `MBS_HOST_CONTEXT`, `MBS_BRIDGE_READY`, `BRIDGE_HANDSHAKE`, `MBS_BRIDGE_HANDSHAKE`

Once a valid handshake is received, the mini app locks onto that `event.origin` as `activeOrigin` and uses it for all outgoing messages.

#### Send transaction request (app → host)
```js
{
  type: "MBS_SEND_TRANSACTION",
  requestId: "<uuid>",
  idempotencyKey: "<movementId>:<rev>",
  payload: {
    movementId: "m_123",
    rev: 1,
    txnType: "income" | "expense",
    date: "YYYY-MM-DD",
    paidValue: 42.22,
    docValue: 42.22,
    interest: 0,
    discount: 0,
    vendor: "Acme",
    expenseType: "Food",
    notes: "",
    currencyCode: "EUR"
  }
}
```

#### Send transaction response (host → app)
The mini app resolves the send Promise **only** if the host replies with:
```js
{
  type: "MBS_SEND_TRANSACTION_RESULT", // or "MBS_SEND_TRANSACTION_RESPONSE"
  requestId: "<same requestId>",
  status: "success",
  remoteTxnId: "<non-empty string>"
}
```

If `status !== "success"` or `remoteTxnId` is missing/empty, the send is treated as a failure and stored as a failed attempt.

#### Timeout
If no correlated response arrives within 15 seconds, the send rejects with a timeout and records a failed attempt.

## Allowed Origins (Security)

Configure allowed host origins in:
- `host/bridge-config.js`

Rules enforced by `host/bridge-client.js`:
- **Inbound**: ignore any message whose `event.origin` is not in `ALLOWED_ORIGINS` (warns once per origin).
- **Outbound**: the app posts only to `activeOrigin` learned from the first valid handshake.
- If there is no valid handshake, sends fail gracefully with “Host not connected”.

## Idempotency, Retries & Histories

### Idempotency
- Each movement has a stable `id` (string).
- Each movement has a `rev` integer:
  - On create: `rev = 1`
  - On edit: `rev++`
- **Idempotency key**: `idempotencyKey = "${movementId}:${rev}"`

This makes retries safe for the same movement revision, while edits create a new revision/key.

### Retries
- If the last attempt failed and the movement has not been mapped to a `remoteTxnId`, the Details panel provides a **Retry** action.
- If `movement_remote_map` already contains a `remoteTxnId`, the UI prevents re-sending (no “resend” UX yet).

### Histories
- **Send history** (`movement_send_attempts`): every send attempt is recorded with payload/response and timing.
- **Change history** (`movement_change_log`): create/update/delete changes are recorded; internal updates (like `status="sent"`) are recorded with a separate `source`.

## Project Structure

High-level layout:
```text
.
├─ index.html
├─ app.js                         # runtime entry (boots app + bridge)
├─ app.bridge-v1-reference.js     # reference-only bridge notes/examples
├─ financie-app.js                # app orchestrator (db, UI wiring, send logic)
├─ styles.css
├─ db/
│  └─ indexeddb.js                # IndexedDB schema + migrations
├─ host/
│  ├─ bridge-config.js            # ALLOWED_ORIGINS
│  └─ bridge-client.js            # secure bridge client + send API
├─ components/                    # Web Components (UI)
├─ i18n/                          # dictionaries + loader
├─ utils/
│  └─ uuid.js                     # uuidv4() fallback (Safari-safe)
└─ test/                          # vitest + jsdom tests
```

## Configuration

- **Theme**: stored in `meta.theme` (`light` default unless the user switches).
- **Language**: stored in `meta.language` (`en`, `es`, `pt-BR`).
- **Company name/subtitle**: stored in `meta.companyName` and `meta.companySubtitle`.
- **Default currency**: stored in `meta.defaultCurrencyCode` (seed default: `EUR`).

## Testing

- Test runner: `vitest` + `jsdom` + `fake-indexeddb`.
- Coverage includes:
  - CRUD flows (movements, catalogs)
  - i18n completeness checks
  - combobox UX helpers
  - Bridge origin gating + send flow storage
  - movement send/change history rendering

## Troubleshooting

### “Host not connected”
- The mini app hasn’t received a handshake from an allowed origin yet.
- Ensure the host posts a handshake (e.g. `{ type: "BRIDGE_READY" }`) from a domain listed in `host/bridge-config.js`.

### “Origin not allowed”
- The host origin is not listed in `ALLOWED_ORIGINS`.
- Add it to `host/bridge-config.js` and redeploy.

### iOS Safari quirks
- `crypto.randomUUID()` is not available in older Safari; this repo uses `utils/uuid.js` as a safe fallback.
- Taps inside fixed/sticky modal footers can be flaky; Save is wired with `pointerup` + `touchend` fallback and guarded against double-submit.

### Resetting local data (fresh start)
- In DevTools → Application/Storage → IndexedDB, delete `ledgerlite`.
- Or run a quick script in the console:
  ```js
  indexedDB.deleteDatabase("ledgerlite")
  ```
