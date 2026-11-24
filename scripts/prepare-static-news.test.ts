import { execFileSync } from "node:child_process";
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
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

const batch = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const category = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const script = resolve("scripts/prepare-static-news.mjs");
const raw = '{"stories":{}}';
const sourceHash = createHash("sha256").update(raw).digest("hex");
const validBody = {
  batchId: batch,
  categoryId: category,
  categoryName: "World",
  timestamp: 123,
  readCount: 1,
  totalStories: 1,
  domains: [],
  stories: [
    { id: "story", title: "한국어", short_summary: "요약", articles: [] },
  ],
};
async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), "news-assets-"));
  await mkdir(join(cwd, `data/translations/${batch}`), { recursive: true });
  await mkdir(join(cwd, "data/news-snapshots"), { recursive: true });
  await writeFile(
    join(cwd, `data/translations/${batch}/${category}.json`),
    raw,
  );
  await writeFile(
    join(cwd, `data/news-snapshots/${batch}_${category}.json`),
    JSON.stringify({ sourceHash, body: validBody }),
  );
  return {
    cwd,
    build: (enabled?: string, mode = "production") => {
      const env = { ...process.env };
      delete env.TRANSLATIONS_ENABLED;
      delete env.TRANSLATIONS_DIR;
      if (enabled !== undefined) env.TRANSLATIONS_ENABLED = enabled;
      return execFileSync(process.execPath, [script, "--mode", mode], {
        cwd,
        env,
        stdio: "pipe",
      });
    },
    manifest: async () =>
      JSON.parse(
        await readFile(join(cwd, "static/news/manifest.json"), "utf8"),
      ),
    cleanup: () => rm(cwd, { recursive: true, force: true }),
  };
}

it("publishes matching snapshots, rejects stale ones, and honors the kill switch", async () => {
  const { cwd, build, manifest, cleanup } = await setup();
  try {
    build();
    const first = await manifest();
    expect(Object.keys(first)).toEqual([`${batch}/${category}`]);
    expect(
      JSON.parse(
        await readFile(
          join(cwd, `static${first[`${batch}/${category}`]}`),
          "utf8",
        ),
      ),
    ).toEqual(validBody);
    build("false");
    expect(await manifest()).toEqual({});
    expect(await readdir(join(cwd, "static/news"))).toEqual(["manifest.json"]);
    await writeFile(
      join(cwd, `data/translations/${batch}/${category}.json`),
      "{}",
    );
    build();
    expect(await manifest()).toEqual({});
  } finally {
    await cleanup();
  }
});

it.each([
  ["malformed JSON", "{"],
  ["null snapshot", "null"],
  ["missing body", JSON.stringify({ sourceHash })],
  [
    "wrong batch",
    JSON.stringify({
      sourceHash,
      body: {
        ...validBody,
        batchId: "other",
        categoryId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      },
    }),
  ],
  ["wrong category", JSON.stringify({ sourceHash, body: validBody })],
  [
    "missing metadata",
    JSON.stringify({
      sourceHash,
      body: {
        ...validBody,
        categoryId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        readCount: undefined,
      },
    }),
  ],
  [
    "null story",
    JSON.stringify({
      sourceHash,
      body: {
        ...validBody,
        categoryId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        stories: [null],
      },
    }),
  ],
])(
  "skips %s without losing another valid category",
  async (_label, contents) => {
    const { cwd, build, manifest, cleanup } = await setup();
    const brokenCategory = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    try {
      await writeFile(
        join(cwd, `data/translations/${batch}/${brokenCategory}.json`),
        raw,
      );
      await writeFile(
        join(cwd, `data/news-snapshots/${batch}_${brokenCategory}.json`),
        contents,
      );
      build();
      expect(Object.keys(await manifest())).toEqual([`${batch}/${category}`]);
      expect(await readdir(join(cwd, "static/news"))).toHaveLength(2);
    } finally {
      await cleanup();
    }
  },
);

it("loads mode-specific dotenv flags and lets deployment environment override them", async () => {
  const { cwd, build, manifest, cleanup } = await setup();
  try {
    await writeFile(join(cwd, ".env"), "TRANSLATIONS_ENABLED=true\n");
    await writeFile(
      join(cwd, ".env.production.local"),
      "TRANSLATIONS_ENABLED=false\n",
    );
    build();
    expect(await manifest()).toEqual({});
    build("true");
    expect(Object.keys(await manifest())).toEqual([`${batch}/${category}`]);
    build(undefined, "development");
    expect(Object.keys(await manifest())).toEqual([`${batch}/${category}`]);
  } finally {
    await cleanup();
  }
});

it("validates snapshots against TRANSLATIONS_DIR instead of the default directory", async () => {
  const { cwd, build, manifest, cleanup } = await setup();
  try {
    await mkdir(join(cwd, `custom-translations/${batch}`), { recursive: true });
    await writeFile(
      join(cwd, `custom-translations/${batch}/${category}.json`),
      raw,
    );
    await writeFile(
      join(cwd, `data/translations/${batch}/${category}.json`),
      "{}",
    );
    await writeFile(
      join(cwd, ".env"),
      "TRANSLATIONS_DIR=./custom-translations\n",
    );
    build();
    expect(Object.keys(await manifest())).toEqual([`${batch}/${category}`]);
  } finally {
    await cleanup();
  }
});
