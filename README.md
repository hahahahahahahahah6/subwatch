# subwatch

Reddit is killing RSS on **November 13, 2026** and shutting down the public API
in **March 2027** — the "RSS Feed Reeder"-style extensions that pinged you
about new subreddit posts will stop working, and Reddit says there is no
replacement for regular users. **subwatch is that replacement**: a Chrome
extension that watches subreddits and sends you desktop notifications when new
posts appear — or only when they match your keywords.

## How it works

No API key, no OAuth app, no waiting for approval (Reddit stopped accepting new
API applications on Oct 31, 2026 anyway). subwatch polls the **server-rendered
HTML** of `old.reddit.com/r/<sub>/new/` on a timer, parses out the posts,
dedupes against what it has already seen, and fires a desktop notification for
matches. Clicking a notification opens the post.

Data source is plain HTML parsing of old.reddit.com — **not** the official
Reddit API. This is deliberate: it is the only programmatic access Reddit
leaves for regular users after the shutdowns.

## Install (load unpacked)

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this folder.
3. Click the subwatch icon to add subreddits to watch.

Not published to the Chrome Web Store.

## Usage

- **Add a monitor**: subreddit name (e.g. `ClaudeCode`), optional comma-separated
  keywords, and a mode — *all new posts* or *keyword matches only*
  (case-insensitive match against the post title).
- **Check now** forces an immediate poll; the global toggle pauses everything.
- Poll interval is configurable (default 10 minutes, 1–60).

> **Requires login:** Reddit login-walls anonymous listing views, so you must be
> logged into Reddit in the same Chrome profile. If subwatch detects the login
> wall, the popup shows a warning banner.

## Politeness

- Random 0–20s stagger before each subreddit fetch (no lockstep polling).
- 30-minute backoff per subreddit on HTTP 429; 5-minute backoff on other errors.
- One request per subreddit per cycle — far below what a human tab generates.

## Permissions (minimal)

| Permission | Why |
|---|---|
| `storage` | monitors, seen post IDs, settings |
| `notifications` | desktop alerts for new / matching posts |
| `alarms` | polling timer in the service worker |
| `https://old.reddit.com/*` | the only host ever fetched |

No `tabs` permission, no `<all_urls>`, no content scripts.

## Tests

Zero-dependency, run with plain Node:

```bash
node --test "tests/*.test.js"
```

- `tests/parser.test.js` — parses a committed old.reddit HTML fixture and
  asserts post id / title / URL / author / timestamp extraction, HTML-entity
  decoding, stickied/promoted skipping, and the id/timestamp fallbacks.
- `tests/dedupe.test.js` — unit tests for the seen-set logic (fresh detection,
  cap trimming, storage serialization).

The fixture is a faithful synthetic slice of old.reddit's long-stable listing
markup (anonymous fetches are login-gated, so a live snapshot wasn't
obtainable); see the header comment in `tests/fixtures/oldreddit-new.html`.

## Limitations

- Keyword matching is title-only (the `/new/` listing page doesn't include
  post bodies).
- If Reddit radically changes old.reddit's HTML structure, parsing breaks —
  the fixture test will catch regressions in the known structure.
- Notifications are capped at 5 per subreddit per cycle to avoid spam.

## License

MIT — see [LICENSE](LICENSE).
