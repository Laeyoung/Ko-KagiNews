import { generateNewsSnapshots } from "./generate-news-snapshots";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const batch = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const category = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const other = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const body = (categoryId = category) => ({
  batchId: batch,
  categoryId,
  categoryName: "World",
  timestamp: 123,
  readCount: 0,
  totalStories: 1,
  domains: [],
  stories: [
    { id: "story-1", title: "English", short_summary: "Summary", articles: [] },
  ],
});
const sidecar = (categoryUuid = category) =>
  JSON.stringify({
    version: 1,
    batchId: batch,
    categoryUuid,
    model: "model",
    createdAt: "2026-11-24T00:00:00Z",
    stories: { "story-1": { title: "한국어" } },
  });
const sha = (raw: string) => createHash("sha256").update(raw).digest("hex");
let cwd: string;
let root: string;
let out: string;
let target: string;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "news-generator-"));
  root = join(cwd, "translations");
  out = join(cwd, "snapshots");
  target = join(out, `${batch}_${category}.json`);
  await mkdir(join(root, batch), { recursive: true });
  await mkdir(out);
  await writeFile(join(root, batch, `${category}.json`), sidecar());
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(cwd, { recursive: true, force: true });
});

describe("generateNewsSnapshots", () => {
  it("generates translated snapshots and reuses valid unchanged content without fetching", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(body())));
    expect(await generateNewsSnapshots({ root, out, fetcher })).toEqual({
      generated: 1,
      reused: 0,
      removed: 0,
      failures: 0,
    });
    const written = await readFile(target, "utf8");
    expect(JSON.parse(written).body.stories[0].title).toBe("한국어");
    expect(await generateNewsSnapshots({ root, out, fetcher })).toEqual({
      generated: 0,
      reused: 1,
      removed: 0,
      failures: 0,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await readFile(target, "utf8")).toBe(written);
  });

  it.each(["missing-body", "invalid-json", "wrong-category"])(
    "repairs a %s cached snapshot",
    async (kind) => {
      const cached =
        kind === "invalid-json"
          ? "{broken"
          : JSON.stringify({
              sourceHash: sha(sidecar()),
              ...(kind === "wrong-category" ? { body: body(other) } : {}),
            });
      await writeFile(target, cached);
      const fetcher = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(body())));
      expect(
        (await generateNewsSnapshots({ root, out, fetcher })).generated,
      ).toBe(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(JSON.parse(await readFile(target, "utf8")).body.categoryId).toBe(
        category,
      );
    },
  );

  it.each(["http", "network", "wrong-category", "invalid-story"])(
    "removes stale cache after %s upstream failure",
    async (kind) => {
      await writeFile(
        target,
        JSON.stringify({ sourceHash: "old", body: body() }),
      );
      const fetcher = vi.fn();
      if (kind === "network") fetcher.mockRejectedValue(new Error("offline"));
      else if (kind === "http")
        fetcher.mockResolvedValue(new Response("", { status: 503 }));
      else
        fetcher.mockResolvedValue(
          new Response(
            JSON.stringify(
              kind === "wrong-category"
                ? body(other)
                : { ...body(), stories: [null] },
            ),
          ),
        );
      expect(
        (await generateNewsSnapshots({ root, out, fetcher })).failures,
      ).toBe(1);
      expect(await readdir(out)).toEqual([]);
    },
  );

  it("isolates malformed sidecars, generates remaining categories, and prunes orphaned snapshots", async () => {
    await writeFile(join(root, batch, `${category}.json`), "{broken");
    await writeFile(
      target,
      JSON.stringify({ sourceHash: sha(sidecar()), body: body() }),
    );
    await writeFile(join(root, batch, `${other}.json`), sidecar(other));
    await writeFile(join(out, "old-batch.json"), "{}");
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(body(other))));
    expect(await generateNewsSnapshots({ root, out, fetcher })).toEqual({
      generated: 1,
      reused: 0,
      removed: 1,
      failures: 1,
    });
    expect(await readdir(out)).toEqual([`${batch}_${other}.json`]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
