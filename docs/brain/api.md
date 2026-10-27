# Brain HTTP API (C-1)

Base URL: `http://localhost:8787` in development. All routes except `/healthz`
honour `BRAIN_AUTH_TOKEN` as `Authorization: Bearer <token>` when it is set.

## `GET /healthz`

No auth, safe for CI and the extension preflight.

```json
{
  "ok": true,
  "version": "1.0.0",
  "status": "ok",
  "provider": "openai",
  "model": "gpt-4o-mini",
  "uptimeSeconds": 42
}
```

## `GET /api/capabilities`

```json
{
  "protocolVersion": "1.0.0",
  "supportedProtocolVersions": ["1.0.0"],
  "providers": ["openai", "groq", "anthropic", "mock"],
  "activeProvider": "openai",
  "model": "gpt-4o-mini",
  "actionKinds": [
    "FILL",
    "SELECT",
    "SET_CHECKED",
    "CLICK",
    "FOCUS",
    "CLEAR",
    "SCROLL",
    "ASK_CLARIFICATION"
  ],
  "limits": {
    "maxElements": 250,
    "maxTranscriptChars": 2000,
    "maxTimeoutMs": 30000,
    "requestsPerMinute": 60
  },
  "features": { "structuredOutputs": true, "cache": true, "idempotency": true }
}
```

## `POST /api/process-command`

Headers: `content-type: application/json`, optional `Idempotency-Key`,
optional `X-Request-Id` (echoed in `meta.requestId`).

```json
{
  "pageState": { "urlOrAppTitle": "Checkout — Acme", "elements": [ … ] },
  "transcript": "my name is Alice and my email is alice at wonderland dot com",
  "conversationHistory": [{ "role": "user", "text": "…", "at": 1730000000000 }],
  "clientContext": { "client": "extension", "clientVersion": "0.1.0", "protocolVersion": "1.0.0", "locale": "en-US" }
}
```

Response `200`:

```json
{
  "brainResponse": {
    "thoughtProcess": "User is providing name and email.",
    "spokenFeedback": "Filled in your name and email.",
    "actions": [
      { "action": "FILL", "targetId": "vfe_1", "value": "Alice" },
      { "action": "FILL", "targetId": "vfe_2", "value": "alice@wonderland.com" }
    ]
  },
  "meta": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "latencyMs": 812,
    "requestId": "req_…",
    "promptVersion": "1.0.0",
    "cached": false
  }
}
```

### Errors

| Status | `code`                         | When                                                        |
| ------ | ------------------------------ | ----------------------------------------------------------- |
| 400    | `INVALID_REQUEST`              | schema validation failed (`issues[]` lists paths)           |
| 401    | `UNAUTHORIZED`                 | bearer token missing/invalid                                |
| 409    | `UNSUPPORTED_PROTOCOL_VERSION` | `clientContext.protocolVersion` incompatible with server    |
| 409    | `IDEMPOTENCY_MISMATCH`         | `Idempotency-Key` reused with a different body              |
| 422    | `UNPROCESSABLE_BRAIN_OUTPUT`   | model output invalid twice (repair retry already attempted) |
| 422    | `UNKNOWN_TARGET`               | model still references ids absent from `pageState`          |
| 429    | `RATE_LIMITED`                 | per-client budget exceeded (`details.retryAfterMs`)         |
| 503    | `PROVIDER_UNAVAILABLE`         | upstream failed or is not configured                        |
| 504    | `PROVIDER_TIMEOUT`             | exceeded `LLM_TIMEOUT_MS` (default 8000)                    |

Error bodies: `{ code, message, requestId, issues?, details? }`.

### Guarantees

- **No invented targets.** Every `targetId` is checked against the request's
  `pageState.elements`. A violation triggers one corrective model call; a
  repeat returns `UNKNOWN_TARGET`.
- **No prose parsing.** Output is validated against `BrainResponseSchema`; the
  OpenAI path uses `zodResponseFormat(..., 'brain_response')` with
  `strict: true`.
- **No secrets in logs.** Logs contain request ids, provider/model, token
  counts, latency, action counts and error codes — never transcripts or values.
- **Bounded work.** At most three model calls per request (initial + repair +
  target correction), each capped by `LLM_TIMEOUT_MS`.
- **Repeatable.** `temperature: 0` and a cache keyed by
  `sha256(pageState + transcript + history tail)`; `Idempotency-Key` replays
  the exact response for 5 minutes.
