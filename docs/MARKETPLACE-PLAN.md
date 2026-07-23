# Meeting BaaS — ChatGPT Apps + Claude Marketplace Plan

Goal: one canonical hosted MCP server (`https://mcp.meetingbaas.com/mcp`) that ships as:

1. **ChatGPT App** (Apps SDK directory) — Plus/Team/Enterprise reach
2. **Claude Connector** (claude.ai connectors directory) — Pro/Max/Team/Enterprise one-click install
3. **Claude Code plugin** (plugin marketplace) — dev audience
4. **Codex CLI / any MCP client** — same URL, plain MCP, no store needed

This repo (`mcp-on-vercel`) is the canonical server. It already has Streamable HTTP
transport, v1/v2 tools built on `@meeting-baas/sdk`, and session lifecycle management.
What's missing for the directories: **OAuth 2.1**, **tool annotations**, **well-known
metadata endpoints**, and (ChatGPT only) an optional **embedded UI component**.

---

## Phase 0 — Consolidation

| Repo | Decision |
|------|----------|
| `mcp-on-vercel` | **Canonical.** All marketplace work lands here. |
| `meeting-mcp` | Archive with a README pointer to the hosted URL. |
| `speaking-bots-mcp` | Keep separate for now (speaking personas need the Pipecat stack); fold in later as an optional tool group once the core listing is live. |
| `mcp-on-vercel-documentation` | Unchanged (docs/context server, not user-facing). |

Server-identity cleanup in this repo:

- Rename `McpServer` name from `"mcp-typescript server on vercel"` → `"Meeting BaaS"`, bump version.
- Default `x-api-version` to **v2** when the client is OAuth-authenticated (directory users
  should never see the v1/v2 split); keep header override for existing integrations.
- Remove or dev-gate the `echo` tool (directory reviewers flag junk tools).
- Upgrade `@modelcontextprotocol/sdk` (currently `^1.10.2`) to latest — needed for
  `registerTool` + annotations + auth helper types.

## Phase 1 — OAuth 2.1 layer (hard blocker for both stores)

Both directories require real user OAuth; the current API-key-header model stays as a
side door but can't be the listed auth.

Per the MCP auth spec we need:

- **Authorization Code + PKCE** (OAuth 2.1)
- **RFC 9728** Protected Resource Metadata at `/.well-known/oauth-protected-resource`
- **RFC 8414** Authorization Server Metadata at `/.well-known/oauth-authorization-server`
- **RFC 7591** Dynamic Client Registration (`/register`) — Claude requires DCR;
  ChatGPT supports DCR or a manually configured client
- `401` responses carrying `WWW-Authenticate` with the resource-metadata URL so clients
  can discover the flow

### Architecture: embedded AS backed by Meeting BaaS accounts

Rather than deploying a separate authorization server, add AS routes to this deployment:

```
GET  /.well-known/oauth-protected-resource   → static JSON (resource + AS URL)
GET  /.well-known/oauth-authorization-server → static JSON (endpoints, PKCE S256, scopes)
POST /register                               → DCR: store client in Redis, return client_id
GET  /authorize                              → redirect to meetingbaas.com login/consent;
                                               callback issues auth code (Redis, 60s TTL)
POST /token                                  → PKCE verify → issue opaque access token
                                               (Redis: token → { userId, baasApiKey, scopes })
                                               + refresh token rotation
```

- **Token ↔ API key mapping**: at consent time, resolve (or mint) the user's Meeting BaaS
  API key server-side and store it against the token. The MCP handler then validates the
  Bearer token, looks up the BaaS key, and passes it to `registerTools` exactly as the
  header path does today — zero changes to the tools layer.
- **Storage**: Redis (`REDIS_URL` already in `.env.example`) for clients, codes, tokens.
  Opaque tokens (not JWTs) keep revocation trivial and nothing sensitive client-side.
- **Login/consent UI**: smallest viable = a consent page on the existing meetingbaas.com
  dashboard (user already authenticated there) that POSTs approval back to `/authorize`
  callback. Needs one endpoint on the dashboard side to confirm identity + hand back the
  API key — coordinate with the main app.
- **Dual auth in `mcp-api-handler.ts`**: `Authorization: Bearer <oauth-token>` (Redis
  lookup) OR legacy `x-meeting-baas-api-key` / raw key headers. Reject with 401 +
  `WWW-Authenticate` only when neither is present.

### Scopes (keep coarse for v1)

- `bots:read`, `bots:write`, `calendars:read`, `calendars:write`, `data:delete`

## Phase 2 — Tool annotations + review hygiene

Migrate `server.tool(...)` calls (`api/tools-v1.ts`, `api/tools-v2.ts`) to
`registerTool` with annotations — both stores check these:

| Annotation | Tools |
|------------|-------|
| `readOnlyHint: true` | getMeetingData, listBots, getBotDetails, getBotStatus, getTranscript, listCalendars, listEvents, getCalendarDetails, getEventDetails, listScheduledBots, getScheduledBot, botsWithMetadata |
| `destructiveHint: true` | deleteData, deleteBotData, deleteCalendar(Connection), deleteScheduledBot, deleteCalendarBot, leaveMeeting, leaveBot, unscheduleRecordEvent |
| `openWorldHint: true` | joinMeeting, createBot (bot enters an external meeting) |

Also: tighten tool descriptions (reviewers read them), ensure errors never leak keys,
confirm no request bodies/headers are logged (handler currently logs env + baseUrl only — keep it that way).

## Phase 3 — ChatGPT Apps specifics

- **Identity verification** in the OpenAI Platform dashboard (org-level, do early — takes days).
- **Demo credentials** for reviewers: seeded Meeting BaaS test account + a recorded test meeting.
- **UI component (differentiator, optional for v1)**: Apps SDK component rendered in chat —
  bot status card / meeting summary card. MCP resource with `_meta.openai/outputTemplate`
  on `createBot` / `getBotDetails` results. Ship listing first, component in v1.1.
- Submit via the Apps SDK developer portal; meanwhile test end-to-end in ChatGPT
  **Developer Mode** against the prod URL.

## Phase 4 — Claude specifics

- **Connectors directory**: submit the URL via claude.ai settings portal. The two
  known instant-rejects: missing public privacy policy, missing/wrong tool annotations —
  both covered by Phases 1–2.
- **Claude Code plugin**: add `.claude-plugin/` (plugin manifest + `mcpServers` entry
  pointing at the hosted URL) in a `meeting-baas-plugins` repo; PR to
  `claude-plugins-official`.

## Phase 5 — Submission checklist (both)

- [ ] Public privacy policy URL (stable, on meetingbaas.com)
- [ ] Support contact + terms
- [ ] OAuth flow works from a cold client (test with MCP Inspector + Claude + ChatGPT dev mode)
- [ ] Rate limiting on `/token` + `/register` (Redis counters)
- [ ] Latency: tool calls < a few seconds; long joins return immediately with bot id
- [ ] Annotations verified against actual behavior
- [ ] Reviewer test credentials documented

## Suggested implementation order on this branch

1. SDK upgrade + server rename + v2 default (small, unblocks everything)
2. Annotations migration (mechanical, big surface — `tools-v2.ts` is 48K)
3. Well-known endpoints + DCR + token endpoint + Redis store
4. Consent handshake with meetingbaas.com dashboard (cross-repo, longest pole — start coordination now)
5. Dual-auth in `mcp-api-handler.ts` + 401/WWW-Authenticate
6. E2E test with MCP Inspector, Claude, ChatGPT dev mode
7. Submissions (OpenAI identity verification can run in parallel from day 1)
