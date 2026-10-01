/* subwatch — background service worker (MV3)
 * Alarm loop: poll old.reddit.com/r/<sub>/new/ (server-rendered HTML, NOT the
 * official API), parse, dedupe against chrome.storage.local, notify on matches.
 */
importScripts("parse.js", "store.js");

const POLL_ALARM = "subwatch-poll";
const STATE_KEY = "subwatch:state";
const SEEN_KEY = "subwatch:seen";
const PENDING_KEY = "subwatch:pending";
const SEEN_CAP = 2000;
const MAX_NOTIFS_PER_CYCLE = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function defaultState() {
  return {
    enabled: true,
    pollMinutes: 10,
    monitors: [], // {id, subreddit, keywords:[], mode:"all"|"keywords", enabled:true}
    lastCheck: null,
    lastResult: null,
    needsLogin: false,
    backoff: {}, // subreddit -> unix ms until which polling is paused
  };
}

async function getState() {
  const got = await chrome.storage.local.get(STATE_KEY);
  return Object.assign(defaultState(), got[STATE_KEY] || {});
}

async function setState(patch) {
  const state = await getState();
  Object.assign(state, patch);
  await chrome.storage.local.set({ [STATE_KEY]: state });
  return state;
}

async function scheduleAlarm() {
  const state = await getState();
  await chrome.alarms.clear(POLL_ALARM);
  const mins = Math.min(60, Math.max(1, state.pollMinutes | 0 || 10));
  await chrome.alarms.create(POLL_ALARM, {
    delayInMinutes: mins,
    periodInMinutes: mins,
  });
}

chrome.runtime.onInstalled.addListener(scheduleAlarm);
chrome.runtime.onStartup.addListener(scheduleAlarm);

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === POLL_ALARM) {
    try {
      await pollAll();
    } catch (e) {
      console.warn("subwatch poll failed:", e);
    }
  }
});

// Popup can trigger an immediate check ("Check now") and ask for a
// re-schedule after settings change.
chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  (async () => {
    if (msg && msg.type === "subwatch:poll-now") {
      await pollAll();
      respond({ ok: true });
    } else if (msg && msg.type === "subwatch:reschedule") {
      await scheduleAlarm();
      respond({ ok: true });
    } else {
      respond({ ok: false });
    }
  })();
  return true; // async response
});

/**
 * Fetch the newest posts of a subreddit via old.reddit's server-rendered HTML.
 * Uses the user's own logged-in Reddit cookies (credentials:"include") —
 * anonymous requests are bounced to a login page by Reddit.
 */
async function fetchSubredditNew(subreddit) {
  const url =
    "https://old.reddit.com/r/" + encodeURIComponent(subreddit) + "/new/";
  const resp = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  });
  if (resp.status === 429) {
    const e = new Error("rate limited by reddit");
    e.rateLimited = true;
    throw e;
  }
  if (!resp.ok) {
    const e = new Error("reddit returned HTTP " + resp.status);
    e.httpStatus = resp.status;
    throw e;
  }
  const html = await resp.text();
  if (!/class="[^"]*\bthing\b/.test(html)) {
    const e = new Error("unexpected reddit page (no post blocks)");
    e.loginRequired = /Welcome to Reddit|\/login\//.test(html);
    throw e;
  }
  return SubwatchParse.parseOldRedditNew(html);
}

function matches(post, monitor) {
  if (monitor.mode !== "keywords") return true; // "all" mode
  const kws = (monitor.keywords || []).filter(Boolean);
  if (kws.length === 0) return true; // keyword mode, no keywords yet → everything
  const hay = (post.title || "").toLowerCase();
  return kws.some((k) => hay.includes(String(k).toLowerCase()));
}

async function pollAll() {
  const state = await getState();
  if (!state.enabled) return;

  const seenRaw = (await chrome.storage.local.get(SEEN_KEY))[SEEN_KEY] || {};
  let seenSet = new Set(Object.keys(seenRaw));
  const now = Date.now();
  const backoff = Object.assign({}, state.backoff);
  let needsLogin = false;
  let checked = 0;
  let notified = 0;

  for (const monitor of state.monitors.filter((m) => m && m.enabled)) {
    const sub = String(monitor.subreddit || "").replace(/^r\//i, "").trim();
    if (!sub) continue;
    if (backoff[sub] && backoff[sub] > now) continue;

    // Politeness: random stagger so one user's monitors (and many users'
    // installs) don't hit reddit in lockstep.
    await sleep(Math.random() * 20000);

    let posts;
    try {
      posts = await fetchSubredditNew(sub);
      checked++;
    } catch (e) {
      if (e && e.loginRequired) {
        needsLogin = true;
      } else if (e && e.rateLimited) {
        backoff[sub] = now + 30 * 60 * 1000; // 30 min
      } else {
        backoff[sub] = now + 5 * 60 * 1000; // 5 min
      }
      console.warn(`subwatch: r/${sub} poll skipped:`, e && e.message);
      continue;
    }

    const { fresh, seen } = SubwatchStore.filterNew(posts, seenSet);
    seenSet = seen;
    const hits = fresh.filter((p) => matches(p, monitor));

    for (const post of hits.slice(0, MAX_NOTIFS_PER_CYCLE)) {
      const notifId = "subwatch:" + post.id;
      const title =
        monitor.mode === "keywords"
          ? `r/${sub} — keyword match`
          : `r/${sub} — new post`;
      try {
        await chrome.notifications.create(notifId, {
          type: "basic",
          iconUrl: chrome.runtime.getURL("icons/icon48.png"),
          title,
          message: post.title || "(no title)",
          contextMessage: post.author ? "u/" + post.author : undefined,
        });
        const pending =
          (await chrome.storage.local.get(PENDING_KEY))[PENDING_KEY] || {};
        pending[notifId] = post.url;
        await chrome.storage.local.set({ [PENDING_KEY]: pending });
        notified++;
      } catch (e) {
        console.warn("subwatch: notification failed:", e);
      }
    }
  }

  seenSet = SubwatchStore.trimSeen(seenSet, SEEN_CAP);
  await chrome.storage.local.set({
    [SEEN_KEY]: SubwatchStore.serializeSeen(seenSet, now),
  });
  await setState({
    lastCheck: now,
    lastResult: { checked, notified },
    needsLogin,
    backoff,
  });
}

async function openPendingUrl(notifId) {
  const pending =
    (await chrome.storage.local.get(PENDING_KEY))[PENDING_KEY] || {};
  const url = pending[notifId];
  if (url) {
    delete pending[notifId];
    await chrome.storage.local.set({ [PENDING_KEY]: pending });
    await chrome.tabs.create({ url });
  }
  await chrome.notifications.clear(notifId);
}

chrome.notifications.onClicked.addListener(openPendingUrl);
chrome.notifications.onClosed.addListener(async (notifId) => {
  const pending =
    (await chrome.storage.local.get(PENDING_KEY))[PENDING_KEY] || {};
  if (pending[notifId]) {
    delete pending[notifId];
    await chrome.storage.local.set({ [PENDING_KEY]: pending });
  }
});
