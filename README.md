# acme-expenses — external app starter

1) Serve these files with any static server.
2) Set `entryUrl` to your app URL (current: https://acme.example/app).
3) In `app.js`, set `allowedParentOrigin` to the exact host origin (example: http://localhost:8088).
4) Register the app in the host portal (My apps) so it can be opened from the App Store:
   - appId: acme-expenses
   - name: acme-expenses
   - entryUrl: https://acme.example/app
   - allowedOrigins: http://localhost:5173
   - permissionsRequested: finance:transactions:create
5) Open the app from the host App Store or test the flow from the API Playground.

## Bridge v1 capabilities

This starter can call:
- getHostContext
- createExpense / createIncome (requires: user logged in + finance:transactions:create)
- listTransactionsMonth
- getTransactionRangeDetails
- listCategories
- createPaymentPlan / listPaymentPlans
- createIncomePlan / listIncomePlans
- listOverduePayments

## Security notes (important)

- Never use "*" as targetOrigin. This starter uses a strict `allowedParentOrigin`.
- The bridge validates `event.origin` and `event.source` and uses requestId + timeouts.
- Call `destroy()` when unmounting to remove listeners and reject pending requests.

## Troubleshooting

- NOT_AUTHED: log into the host first (the iframe calls operate on the authenticated user session).
- MISSING_PERMISSION: request `finance:transactions:create` for createExpense/createIncome.
- UNKNOWN: host-side exception or validation error.
