/* subwatch — store.js
 * Pure dedupe / seen-set helpers. No chrome APIs here so the logic is
 * unit-testable in plain Node. The background worker injects persistence
 * (chrome.storage.local) around these functions.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.SubwatchStore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * Split posts into fresh (never seen) vs already-seen, and return an
   * updated seen-set that includes every post id passed in.
   *
   * @param {Array<{id:string}>} posts
   * @param {Set<string>|Object<string,number>|null} seen  ids already known
   * @returns {{ fresh: Array, seen: Set<string> }}
   */
  function filterNew(posts, seen) {
    const seenSet =
      seen instanceof Set ? new Set(seen) : new Set(Object.keys(seen || {}));
    const fresh = [];
    for (const post of posts || []) {
      if (!post || typeof post.id !== "string" || post.id === "") continue;
      if (!seenSet.has(post.id)) {
        fresh.push(post);
      }
      seenSet.add(post.id);
    }
    return { fresh, seen: seenSet };
  }

  /**
   * Trim a seen-set down to `cap` ids, keeping the most recently added.
   * (Set preserves insertion order, so we drop from the front.)
   *
   * @param {Set<string>} seenSet
   * @param {number} cap
   * @returns {Set<string>}
   */
  function trimSeen(seenSet, cap) {
    const limit = Math.max(1, cap | 0 || 2000);
    const ids = Array.from(seenSet);
    if (ids.length <= limit) return seenSet;
    return new Set(ids.slice(ids.length - limit));
  }

  /**
   * Serialize a seen-set for chrome.storage.local (plain object).
   * Values are unix-ms timestamps so a future "expire old ids" pass is easy.
   */
  function serializeSeen(seenSet, nowMs) {
    const out = {};
    const now = nowMs == null ? Date.now() : nowMs;
    for (const id of seenSet) out[id] = now;
    return out;
  }

  return { filterNew, trimSeen, serializeSeen };
});
