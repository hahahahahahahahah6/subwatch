# subwatch — PLAN

**One-liner:** Reddit's RSS dies Nov 13, 2026 and the public API closes Mar 2027;
"RSS Feed Reeder"-style subreddit new-post alerts have no official replacement —
subwatch is the replacement: a Chrome extension that watches subreddits and
pings you when new posts (or keyword-matching posts) appear.

**Name check (2026-10-01):** `subwatch` does not collide with any of the 26
existing repos on github.com/hahahahahahahahah6.

## Background (verified, do not re-verify)

- TechCrunch 2026-09-30: Reddit RSS ends 2026-11-13; public API shuts 2027-03;
  no new API applications accepted after 10/31.
- Mashable quotes real users of the "RSS Feed Reeder" extension (subreddit
  new-post notifications) that will break; Reddit: "there is no replacement"
  for regular users.
- Ship before 11/13 = timeliness bonus. Owner is a heavy Reddit user → dogfood.

## Key technical finding (verified 2026-10-01 via curl from this VM)

- `old.reddit.com/r/<sub>/new/` **302-redirects anonymous requests to
  `/login/?reason=lor2`**. Server-rendered HTML is still served, but only to
  logged-in sessions.
- Consequence for design: the extension MUST fetch with the user's own logged-in
  Reddit cookies → `fetch(url, { credentials: "include" })` + `host_permissions`
  for old.reddit.com. README must say: *"requires you to be logged into Reddit
  in the same Chrome profile."* A `needsLogin` flag in the popup warns when the
  login gate is hit.
- Fallback decision: NO fallback to new.reddit (JS-heavy, unparseable without a
  DOM) and NO use of the public `.json` API (it is the surface being shut down;
  also requires OAuth soon). If old.reddit's HTML structure changes radically,
  that is a hard blocker — report it, do not hack around it.

## Architecture (MV3, stdlib-only, no build step, no npm deps)

```
subwatch/
  manifest.json            MV3: storage, notifications, alarms; host_permissions → old.reddit.com only
  src/background.js        service worker: alarm loop, fetch→parse→dedupe→notify
  src/parse.js             pure parser: old.reddit /new/ HTML → [{id,title,url,author,createdUtc}]
  src/store.js             pure dedupe helpers: filterNew(posts, seen) → {fresh, seen}
  popup/popup.html|js|css  add/remove monitors, keywords, all-vs-keyword mode, enable toggle, login warning
  icons/                   16/48/128 png (generated once, committed)
  tests/
    fixtures/oldreddit-new.html   real archived old.reddit snapshot (Wayback), committed
    parser.test.js                node:test — asserts id/title/time/author extraction
    dedupe.test.js                node:test — asserts dedupe logic
```

### Data flow

1. `chrome.alarms` fires every `pollMinutes` (default 10; user-configurable).
2. For each enabled monitor (subreddit + keywords + mode), if due:
   wait a random 0–20s stagger (politeness jitter, avoids thundering herd),
   then `GET https://old.reddit.com/r/<sub>/new/` with `credentials:"include"`,
   `Cache-Control: no-cache`.
3. `parse.js` extracts posts via regex on the server-rendered markup
   (MV3 service workers have no DOMParser; old.reddit HTML is stable/frozen,
   regex is the pragmatic choice). Skip `promoted`/`stickied` blocks.
4. `store.js` compares against `seenIds` in `chrome.storage.local`
   (key `subwatch:seen`, capped at ~2000 ids, FIFO trim).
5. New posts that match mode (`all` → any new post; `keywords` → title/body
   contains any keyword, case-insensitive) → `chrome.notifications.create`
   with the post title; click opens the post.
6. On any 429 / login-gate response: exponential backoff for that subreddit,
   set `needsLogin` when the login gate is detected.

### Popup

- Global on/off switch; per-monitor: subreddit name, keywords (comma separated),
  mode radio (all posts | keyword matches only), remove button.
- Shows last-check time and a warning banner if Reddit login is required.

### Permissions (minimal)

- `permissions`: `storage`, `notifications`, `alarms`
- `host_permissions`: `https://old.reddit.com/*` only
- No `tabs`, no `webRequest`, no broad `<all_urls>`.

## Testing (must be all-green before ship)

- `node --test tests/` — stdlib only.
  - `parser.test.js`: parse the committed real-HTML fixture; assert ≥1 post
    extracted; assert each has id (`t3_…`), non-empty title, valid timestamp,
    author string; assert promoted/stickied skipped; assert empty HTML → `[]`.
  - `dedupe.test.js`: first run all posts fresh; second run with same ids →
    none fresh; mixed run → only unseen fresh; seen-set trims to cap.
- Manual smoke (owner dogfoods in real Chrome): load unpacked, add r/test or a
  quiet subreddit, force `chrome.alarms` via `chrome://extensions` service-worker
  "inspect" → call the poll function, confirm notification fires.

## Ship checklist

1. PLAN.md ✓ (this file)
2. Code per above; icons generated.
3. `node --test tests/` all green.
4. `LICENSE` (MIT), `README.md` (English; paragraph 1 = RSS-dies-Nov-13
   positioning; state clearly: data source is HTML parsing of old.reddit.com,
   NOT the official API; "Load unpacked" install; requires Reddit login).
5. `~/workspace/skills/github/bin/gh-push ~/workspace/subwatch subwatch`
   (public repo). Verify the GitHub repo page loads.
6. Report back: repo link, test results, one-line positioning.
7. Do NOT publish to Chrome Web Store (owner's account, his call).
8. Do NOT touch `~/workspace/goals/` or the idea backlog (parent updates it).

## Open risks

- old.reddit HTML structure change → parser breaks (mitigated by fixture test;
  if it happens, report blocker).
- Reddit extends the login gate or rate-limits extension polling → backoff +
  user-visible status; long-term risk stays in README's "Limitations".
