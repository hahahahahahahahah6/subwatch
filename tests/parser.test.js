// subwatch parser tests — run: node --test tests/
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { parseOldRedditNew } = require("../src/parse.js");

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "fixtures", "oldreddit-new.html"),
  "utf8"
);
const LOGIN_GATE = fs.readFileSync(
  path.join(__dirname, "fixtures", "login-gate.html"),
  "utf8"
);

describe("parseOldRedditNew — old.reddit /new/ fixture", () => {
  it("extracts the 4 real posts, skipping stickied + promoted", () => {
    const posts = parseOldRedditNew(FIXTURE);
    assert.deepEqual(
      posts.map((p) => p.id),
      ["t3_aaa111", "t3_bbb222", "t3_eee555", "t3_fff666"]
    );
  });

  it("extracts id/title/url/author/time/subreddit for a full post", () => {
    const [p] = parseOldRedditNew(FIXTURE);
    assert.equal(p.id, "t3_aaa111");
    assert.equal(p.title, "How do you structure MCP servers?");
    assert.equal(
      p.url,
      "https://old.reddit.com/r/mcp/comments/aaa111/how_do_you_structure_mcp_servers/"
    );
    assert.equal(p.author, "mcp_fan");
    assert.equal(p.createdUtc, 1759315200000);
    assert.equal(p.subreddit, "mcp");
  });

  it("decodes HTML entities in titles and prefers the permalink URL", () => {
    const [, p] = parseOldRedditNew(FIXTURE);
    assert.equal(p.title, "MCP vs REST: a practical & honest comparison");
    assert.equal(
      p.url,
      "https://old.reddit.com/r/mcp/comments/bbb222/mcp_vs_rest_a_practical_comparison/"
    );
  });

  it("falls back to id attribute and <time datetime> when data-* is missing", () => {
    const posts = parseOldRedditNew(FIXTURE);
    const p = posts.find((x) => x.id === "t3_eee555");
    assert.ok(p, "t3_eee555 parsed via id= fallback");
    assert.equal(p.title, "Minimal markup post");
    assert.equal(p.author, "minimalist");
    assert.equal(p.createdUtc, Date.parse("2025-10-01T05:30:00+00:00"));
  });

  it("normalizes 10-digit (second) timestamps to milliseconds", () => {
    const posts = parseOldRedditNew(FIXTURE);
    const p = posts.find((x) => x.id === "t3_fff666");
    assert.equal(p.createdUtc, 1759299600 * 1000);
  });

  it("returns [] for empty / unexpected pages (incl. the login gate)", () => {
    assert.deepEqual(parseOldRedditNew(""), []);
    assert.deepEqual(parseOldRedditNew(null), []);
    assert.deepEqual(
      parseOldRedditNew("<html><body>hello</body></html>"),
      []
    );
    assert.deepEqual(parseOldRedditNew(LOGIN_GATE), []);
  });
});
