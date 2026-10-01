/* subwatch popup — manage monitors + settings (chrome.storage.local) */
const STATE_KEY = "subwatch:state";

const $ = (id) => document.getElementById(id);
const els = {
  globalEnabled: $("globalEnabled"),
  pollMinutes: $("pollMinutes"),
  lastCheck: $("lastCheck"),
  checkNow: $("checkNow"),
  addForm: $("addForm"),
  subInput: $("subInput"),
  kwInput: $("kwInput"),
  monitorList: $("monitorList"),
  empty: $("empty"),
  loginWarn: $("loginWarn"),
};

function defaultState() {
  return {
    enabled: true,
    pollMinutes: 10,
    monitors: [],
    lastCheck: null,
    lastResult: null,
    needsLogin: false,
    backoff: {},
  };
}

async function getState() {
  const got = await chrome.storage.local.get(STATE_KEY);
  return Object.assign(defaultState(), got[STATE_KEY] || {});
}

async function saveState(state) {
  await chrome.storage.local.set({ [STATE_KEY]: state });
}

function fmtTime(ms) {
  if (!ms) return "never";
  const d = new Date(ms);
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} min ago`;
  return d.toLocaleString();
}

function render(state) {
  els.globalEnabled.checked = state.enabled;
  els.pollMinutes.value = state.pollMinutes;
  let label = fmtTime(state.lastCheck);
  if (state.lastResult) {
    label += ` — ${state.lastResult.checked} subreddit(s), ${state.lastResult.notified} alert(s)`;
  }
  els.lastCheck.textContent = label;
  els.loginWarn.hidden = !state.needsLogin;

  els.monitorList.innerHTML = "";
  els.empty.hidden = state.monitors.length > 0;
  for (const m of state.monitors) {
    const li = document.createElement("li");
    li.className = "monitor";

    const toggle = document.createElement("label");
    toggle.className = "switch small";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = m.enabled;
    cb.addEventListener("change", async () => {
      const s = await getState();
      const target = s.monitors.find((x) => x.id === m.id);
      if (target) target.enabled = cb.checked;
      await saveState(s);
    });
    const slider = document.createElement("span");
    slider.className = "slider";
    toggle.append(cb, slider);

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = "r/" + m.subreddit;
    if (m.mode === "keywords" && m.keywords.length) {
      const kw = document.createElement("span");
      kw.className = "kw";
      kw.textContent = "keywords: " + m.keywords.join(", ");
      name.append(kw);
    } else if (m.mode === "keywords") {
      const kw = document.createElement("span");
      kw.className = "kw";
      kw.textContent = "keywords: (none — matches everything)";
      name.append(kw);
    }

    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "×";
    del.title = "Remove monitor";
    del.addEventListener("click", async () => {
      const s = await getState();
      s.monitors = s.monitors.filter((x) => x.id !== m.id);
      await saveState(s);
      render(s);
    });

    li.append(toggle, name, del);
    els.monitorList.append(li);
  }
}

function notifyBackground(type) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type }, () => resolve(chrome.runtime.lastError));
  });
}

async function init() {
  let state = await getState();
  render(state);

  els.globalEnabled.addEventListener("change", async () => {
    state = await getState();
    state.enabled = els.globalEnabled.checked;
    await saveState(state);
  });

  els.pollMinutes.addEventListener("change", async () => {
    state = await getState();
    const v = Math.min(60, Math.max(1, parseInt(els.pollMinutes.value, 10) || 10));
    els.pollMinutes.value = v;
    state.pollMinutes = v;
    await saveState(state);
    await notifyBackground("subwatch:reschedule");
  });

  els.addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const sub = els.subInput.value.replace(/^r\//i, "").trim();
    if (!/^[A-Za-z0-9_]{2,21}$/.test(sub)) return;
    const mode = document.querySelector('input[name="mode"]:checked').value;
    const keywords = els.kwInput.value
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    state = await getState();
    if (state.monitors.some((m) => m.subreddit.toLowerCase() === sub.toLowerCase())) {
      els.subInput.focus();
      return; // already monitored
    }
    state.monitors.push({
      id: "m" + Date.now().toString(36),
      subreddit: sub,
      keywords,
      mode,
      enabled: true,
    });
    await saveState(state);
    els.subInput.value = "";
    els.kwInput.value = "";
    render(state);
  });

  els.checkNow.addEventListener("click", async () => {
    els.checkNow.disabled = true;
    els.checkNow.textContent = "Checking…";
    await notifyBackground("subwatch:poll-now");
    state = await getState();
    render(state);
    els.checkNow.disabled = false;
    els.checkNow.textContent = "Check now";
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STATE_KEY]) {
      render(Object.assign(defaultState(), changes[STATE_KEY].newValue || {}));
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
