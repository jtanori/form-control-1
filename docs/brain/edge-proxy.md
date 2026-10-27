# Edge proxy & key custody (C-3)

## Trust boundary

```text
                    ┌──────────────────────────── browser ────────────────────────────┐
 [page DOM] ──────► │ content script ──► extension service worker ──► chrome.storage │
   (no keys)        │        no provider keys anywhere in the extension              │
                    └───────────────────────────────┬─────────────────────────────────┘
                                                    │ HTTPS + Bearer session token
                                                    ▼
                                   ┌────────────────────────────────┐
                                   │  edge proxy  :8788 (Hono)      │
                                   │  • origin allowlist / CORS     │
                                   │  • HMAC session verification   │
                                   │  • rate + concurrency limits   │
                                   │  • body size limits            │
                                   │  • server-side provider keys   │
                                   └───────┬───────────────┬────────┘
                              BRAIN_AUTH   │               │  provider keys
                                           ▼               ▼
                                   ┌──────────────┐  ┌────────────────────┐
                                   │ brain :8787  │  │ Groq / Deepgram    │
                                   │ (OpenAI key) │  │ (STT)              │
                                   └──────────────┘  └────────────────────┘
```

The extension is fully readable by its user, so it is treated as public:
`VFE_EDGE_URL` and a short-lived session token are the only configuration it
holds. Provider keys exist only in the edge and brain environments.

## Session flow

1. On install/refresh the extension calls `POST /v1/session` with its
   `chrome.runtime.id`.
2. The proxy checks the id against `ALLOWED_EXTENSION_IDS` (`*` only outside
   production) and returns `{ token, expiresAt }`, an HMAC-SHA256 signed
   payload `{ sub, iat, exp, jti }` valid for 24 hours.
3. The token is stored in `chrome.storage.local` — never `sync`, never in the
   page's `window` context.
4. Every other `/v1/*` call sends `Authorization: Bearer <token>`. A 401 means
   "re-register once", then surface the failure.

## Endpoints

| Method | Path          | Notes                                                       |
| ------ | ------------- | ----------------------------------------------------------- |
| POST   | `/v1/session` | `{ extensionId }` → `{ token, expiresAt }`                  |
| GET    | `/v1/config`  | protocol version, supported actions, STT provider, shortcut |
| POST   | `/v1/brain`   | schema-validated pass-through to the brain                  |
| POST   | `/v1/stt`     | multipart `audio` (+ `language`) → transcript               |
| POST   | `/v1/tts`     | `501` — browser `speechSynthesis` is used for the MVP       |
| GET    | `/healthz`    | no origin/auth; reports whether the proxy is configured     |

## Enforced invariants

- **Origin allowlist.** Only `chrome-extension://<ALLOWED_EXTENSION_IDS>` plus
  `http://localhost:5173` outside production. Missing or foreign `Origin` →
  `403 ORIGIN_NOT_ALLOWED`, without CORS headers.
- **Fail closed.** Missing `EDGE_SESSION_SECRET` (min 16 chars) or an STT key
  without `MOCK_STT=1` makes every `/v1/*` route return
  `503 NOT_CONFIGURED`; `/healthz` still answers so orchestration can see it.
- **Limits.** 60 req/min per token (20/min for STT), one in-flight request per
  token, 5 MB audio, 512 KB JSON. Every rejection carries `Retry-After` where
  meaningful.
- **Protocol first.** `/v1/brain` validates `ProcessCommandRequestSchema` and
  the protocol version before any upstream call, so a version-skewed extension
  gets a fast `409` instead of a model bill.
- **Header scrubbing.** The client's `Authorization`, `Cookie`, `X-Forwarded-*`
  and any other header are dropped. The proxy sends only `content-type`,
  `idempotency-key`, `x-request-id` and its own `BRAIN_AUTH_TOKEN`.
- **Typed failures.** Every error is `{ code, message, requestId }`; upstream
  5xx becomes `502 UPSTREAM_ERROR`, an aborted upstream becomes
  `504 UPSTREAM_TIMEOUT`.
- **Privacy.** Logs contain request id, route, status, latency and a hashed
  token id. Never audio, transcripts, page content or secrets.

## Local development

```bash
MOCK_LLM=1 pnpm --filter @vfe/brain dev          # brain on :8787
MOCK_STT=1 \
EDGE_SESSION_SECRET=dev-secret-at-least-32-chars \
ALLOWED_EXTENSION_IDS='*' \
NODE_ENV=development \
pnpm --filter @vfe/brain dev:edge                # proxy on :8788
```

No provider keys are required in this mode. The extension's manifest
`host_permissions` must include the edge host (see D-2).
