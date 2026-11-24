// Offline build step: publish only snapshots matching the committed translation.
import { isNewsSnapshotBody } from "../src/lib/translation/newsSnapshot.js";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { loadEnv } from "vite";

/** @param {string} text */
const hash = (text) => createHash("sha256").update(text).digest("hex");

// Match Vite's .env loading, with real deployment variables taking precedence.
const modeIndex = process.argv.indexOf("--mode");
const mode =
  modeIndex >= 0 ? process.argv[modeIndex + 1] || "production" : "production";
const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
const translationsDir = env.TRANSLATIONS_DIR ?? "data/translations";

const out = "static/news";
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });
/** @type {Record<string, string>} */
const manifest = {};
if (env.TRANSLATIONS_ENABLED !== "false") {
  for (const name of await fs.readdir("data/news-snapshots").catch(() => [])) {
    if (!/^[a-f0-9-]{36}_[a-f0-9-]{36}\.json$/i.test(name)) continue;
    const [batch, category] = name.replace(/\.json$/, "").split("_");
    /** @type {unknown} */
    let snapshot;
    try {
      snapshot = JSON.parse(
        await fs.readFile(`data/news-snapshots/${name}`, "utf8"),
      );
    } catch {
      console.warn(`[static-news] skipping unreadable snapshot ${name}`);
      continue;
    }
    if (
      typeof snapshot !== "object" ||
      snapshot === null ||
      !("sourceHash" in snapshot) ||
      !("body" in snapshot) ||
      !isNewsSnapshotBody(snapshot.body, batch, category)
    ) {
      console.warn(`[static-news] skipping invalid snapshot ${name}`);
      continue;
    }
    const sidecar = await fs
      .readFile(path.join(translationsDir, batch, `${category}.json`), "utf8")
      .catch(() => null);
    if (!sidecar || hash(sidecar) !== snapshot.sourceHash) continue;
    const body = JSON.stringify(snapshot.body);
    const asset = `${hash(body)}.json`;
    await fs.writeFile(`${out}/${asset}`, body);
    manifest[`${batch}/${category}`] = `/news/${asset}`;
  }
}
await fs.writeFile(`${out}/manifest.json`, JSON.stringify(manifest));
console.log(
  `[static-news] published ${Object.keys(manifest).length} snapshots`,
);
