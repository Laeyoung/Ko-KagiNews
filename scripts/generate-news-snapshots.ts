// Run in the translation workflow, never at request time or during a Vercel build.
import type { Sidecar } from "../src/lib/server/translations";
import { applyTranslations } from "../src/lib/translation/applyTranslations";
import { isNewsSnapshotBody } from "../src/lib/translation/newsSnapshot.js";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

interface SnapshotOptions {
  root?: string;
  out?: string;
  api?: string;
  fetcher?: typeof fetch;
}

export async function generateNewsSnapshots({
  root = process.env.TRANSLATIONS_DIR ?? "data/translations",
  out = "data/news-snapshots",
  api = process.env.KITE_API_BASE ?? "https://kite.kagi.com/api",
  fetcher = fetch,
}: SnapshotOptions = {}) {
  await fs.mkdir(out, { recursive: true });
  const retained = new Set<string>();
  const result = { generated: 0, reused: 0, removed: 0, failures: 0 };
  for (const batchEntry of await fs.readdir(root, { withFileTypes: true })) {
    const batch = batchEntry.name;
    if (!batchEntry.isDirectory() || !UUID.test(batch)) continue;
    for (const file of await fs.readdir(path.join(root, batch))) {
      const category = file.replace(/\.json$/, "");
      if (!file.endsWith(".json") || !UUID.test(category)) continue;
      const name = `${batch}_${category}.json`;
      retained.add(name);
      const target = path.join(out, name);
      try {
        // Parse failures are local to one category, not the whole daily job.
        const raw = await fs.readFile(path.join(root, batch, file), "utf8");
        const sidecar: Sidecar = JSON.parse(raw);
        if (
          !sidecar ||
          sidecar.batchId !== batch ||
          sidecar.categoryUuid !== category ||
          !sidecar.stories ||
          typeof sidecar.stories !== "object" ||
          Array.isArray(sidecar.stories)
        )
          throw new Error("Invalid translation sidecar");
        const sourceHash = createHash("sha256").update(raw).digest("hex");
        try {
          const existing = JSON.parse(await fs.readFile(target, "utf8"));
          if (
            existing?.sourceHash === sourceHash &&
            isNewsSnapshotBody(existing.body, batch, category)
          ) {
            result.reused++;
            continue;
          }
        } catch {
          /* Missing or malformed snapshots must be regenerated. */
        }
        const response = await fetcher(
          `${api}/batches/${batch}/categories/${category}/stories?limit=12&lang=en`,
          {
            signal: AbortSignal.timeout(30_000),
          },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body: unknown = await response.json();
        if (!isNewsSnapshotBody(body, batch, category))
          throw new Error("Invalid batch stories response");
        const translated = applyTranslations(body, sidecar);
        if (!isNewsSnapshotBody(translated, batch, category))
          throw new Error("Invalid translated stories response");
        await fs.writeFile(
          `${target}.tmp`,
          JSON.stringify({ sourceHash, body: translated }),
        );
        await fs.rename(`${target}.tmp`, target);
        result.generated++;
        console.log(`[snapshots] generated ${name}`);
      } catch (error) {
        // Never leave invalid or superseded snapshots available to a build.
        await fs.rm(target, { force: true });
        await fs.rm(`${target}.tmp`, { force: true });
        result.failures++;
        console.error(`[snapshots] ${name}:`, error);
      }
    }
  }
  for (const name of await fs.readdir(out)) {
    if (name.endsWith(".json") && !retained.has(name)) {
      await fs.rm(path.join(out, name));
      result.removed++;
    }
  }
  return result;
}

// Keep imports side-effect-free so failure handling can be tested offline.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = await generateNewsSnapshots();
    if (result.failures) process.exitCode = 1;
  } catch (error) {
    console.error("[snapshots] generation failed:", error);
    process.exitCode = 1;
  }
}
