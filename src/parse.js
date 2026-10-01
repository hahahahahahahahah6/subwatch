/* subwatch — parse.js
 * Parses old.reddit.com server-rendered listing HTML (/r/<sub>/new/) into
 * post objects. Pure functions, no chrome APIs — unit-testable in Node.
 *
 * MV3 service workers have no DOMParser, so this uses targeted regexes over
 * old.reddit's long-frozen markup. Structural hooks:
 *   post block : <div class=" thing id-t3_<base36> ..." data-fullname="t3_...">
 *   title      : <p class="title"><a class="title ..." href="...">TITLE</a>
 *   timestamp  : data-timestamp (ms) on the block, else <time datetime="...">
 *   author     : data-author on the block
 *   permalink  : data-permalink on the block
 * Skips blocks whose class list contains promoted / stickied / spam.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.SubwatchParse = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var THING_OPEN_RE = /<div\b[^>]*\bclass="([^"]*)"[^>]*>/gi;
  var MAX_BLOCK = 65536; // safety cap per post block

  function hasThingClass(cls) {
    return /(^|\s)thing(\s|$)/.test(cls || "");
  }
  function classId(cls) {
    var m = /(^|\s)id-(t3_[a-z0-9]+)(\s|$)/i.exec(cls || "");
    return m ? m[2].toLowerCase() : null;
  }
  function isSkippable(cls) {
    return /(^|\s)(promoted|stickied|spam)(\s|$)/i.test(cls || "");
  }

  function attr(tag, name) {
    var m = new RegExp(name + '\\s*=\\s*"([^"]*)"', "i").exec(tag);
    return m ? m[1] : null;
  }

  function decodeEntities(s) {
    return String(s)
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&#(\d+);/g, function (_, n) {
        return String.fromCharCode(parseInt(n, 10));
      })
      .replace(/&#x([0-9a-f]+);/gi, function (_, n) {
        return String.fromCharCode(parseInt(n, 16));
      });
  }

  function stripTags(s) {
    return decodeEntities(String(s).replace(/<[^>]*>/g, ""))
      .replace(/\s+/g, " ")
      .trim();
  }

  // data-timestamp magnitude-agnostic: 13 digits -> ms, 10 digits -> seconds.
  function parseTimestamp(block, openTag) {
    var raw = attr(openTag, "data-timestamp");
    if (raw && /^\d+$/.test(raw)) {
      var n = parseInt(raw, 10);
      if (n > 0) return n > 1e12 ? n : n * 1000;
    }
    var tm = /<time\b[^>]*\bdatetime="([^"]+)"[^>]*>/i.exec(block);
    if (tm) {
      var t = Date.parse(tm[1]);
      if (!isNaN(t)) return t;
    }
    return null;
  }

  function parseTitle(block) {
    var scope = block;
    var p = /<p\b[^>]*\bclass="[^"]*\btitle\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(
      block
    );
    if (p) scope = p[1];
    var a =
      /<a\b[^>]*\bclass="[^"]*\btitle\b[^"]*"[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i.exec(
        scope
      );
    if (!a) return { title: null, href: null };
    return { title: stripTags(a[2]) || null, href: decodeEntities(a[1]) };
  }

  function parseAuthor(block, openTag) {
    var fromAttr = attr(openTag, "data-author");
    if (fromAttr) return fromAttr;
    var a = /<a\b[^>]*\bclass="[^"]*\bauthor\b[^"]*"[^>]*>([^<]*)<\/a>/i.exec(
      block
    );
    return a ? stripTags(a[1]) : null;
  }

  function resolveUrl(href, permalink) {
    var u = permalink || href || null;
    if (!u) return null;
    if (u.charAt(0) === "/") u = "https://old.reddit.com" + u;
    return u;
  }

  function parseBlock(open, end, html) {
    var block = html.slice(open.index, Math.min(end, open.index + MAX_BLOCK));
    var id =
      attr(open.tag, "data-fullname") ||
      classId(open.cls) ||
      (function () {
        var raw = attr(open.tag, "id");
        return raw ? raw.replace(/^thing_/, "").toLowerCase() : null;
      })();
    if (!id || id.indexOf("t3_") !== 0) return null;

    var t = parseTitle(block);
    var url = resolveUrl(t.href, attr(open.tag, "data-permalink"));
    return {
      id: id,
      title: t.title,
      url: url,
      author: parseAuthor(block, open.tag),
      createdUtc: parseTimestamp(block, open.tag),
      subreddit: attr(open.tag, "data-subreddit"),
    };
  }

  /**
   * @param {string} html  old.reddit /new/ page source
   * @returns {Array<{id,title,url,author,createdUtc,subreddit}>}
   */
  function parseOldRedditNew(html) {
    var posts = [];
    if (!html || typeof html !== "string") return posts;
    var opens = [];
    var m;
    THING_OPEN_RE.lastIndex = 0;
    while ((m = THING_OPEN_RE.exec(html)) !== null) {
      if (hasThingClass(m[1])) opens.push({ index: m.index, tag: m[0], cls: m[1] });
    }
    for (var i = 0; i < opens.length; i++) {
      if (isSkippable(opens[i].cls)) continue;
      var end = i + 1 < opens.length ? opens[i + 1].index : html.length;
      var post = parseBlock(opens[i], end, html);
      if (post) posts.push(post);
    }
    return posts;
  }

  return { parseOldRedditNew: parseOldRedditNew };
});
