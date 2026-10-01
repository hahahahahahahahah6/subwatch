// subwatch dedupe tests — run: node --test tests/
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { filterNew, trimSeen, serializeSeen } = require("../src/store.js");

const P = (id) => ({ id, title: "t" + id });

describe("filterNew", () => {
  it("marks every post fresh on first sight", () => {
    const { fresh, seen } = filterNew([P("t3_a"), P("t3_b")], new Set());
    assert.equal(fresh.length, 2);
    assert.ok(seen.has("t3_a") && seen.has("t3_b"));
  });

  it("marks nothing fresh when all ids were seen", () => {
    const { fresh } = filterNew([P("t3_a")], new Set(["t3_a"]));
    assert.deepEqual(fresh, []);
  });

  it("only returns unseen posts on a mixed run and grows the seen set", () => {
    const first = filterNew([P("t3_a"), P("t3_b")], null);
    const second = filterNew([P("t3_a"), P("t3_b"), P("t3_c")], first.seen);
    assert.deepEqual(
      second.fresh.map((p) => p.id),
      ["t3_c"]
    );
    assert.ok(second.seen.has("t3_a"));
  });

  it("accepts a plain-object seen map (chrome.storage.local shape)", () => {
    const { fresh } = filterNew([P("t3_a"), P("t3_b")], { t3_a: 123 });
    assert.deepEqual(
      fresh.map((p) => p.id),
      ["t3_b"]
    );
  });

  it("ignores posts without a usable id", () => {
    const { fresh, seen } = filterNew(
      [{ title: "no id" }, null, P("t3_ok")],
      new Set()
    );
    assert.deepEqual(
      fresh.map((p) => p.id),
      ["t3_ok"]
    );
    assert.equal(seen.size, 1);
  });
});

describe("trimSeen", () => {
  it("keeps the set untouched under the cap", () => {
    const s = new Set(["a", "b"]);
    assert.equal(trimSeen(s, 10), s);
  });

  it("trims to the cap, keeping the most recently added ids", () => {
    const s = new Set(["old1", "old2", "new1", "new2"]);
    const trimmed = trimSeen(s, 2);
    assert.deepEqual(Array.from(trimmed), ["new1", "new2"]);
  });
});

describe("serializeSeen", () => {
  it("serializes to a plain object keyed by id", () => {
    const out = serializeSeen(new Set(["t3_a"]), 999);
    assert.deepEqual(out, { t3_a: 999 });
  });
});
