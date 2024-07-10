import { resolve } from "jsr:@std/path@0.225.2/resolve";
import { normalize } from "jsr:@std/path@0.225.2/normalize";
import { join } from "jsr:@std/path@0.225.2/join";

interface ManifestEntryFile {
  kind: "file";
  gitSha1: string;
  size: number;
}

interface ManifestEntryDirectory {
  kind: "directory";
  entries: Record<string, ManifestEntry>;
}

interface ManifestEntrySymlink {
  kind: "symlink";
  target: string;
}

type ManifestEntry =
  | ManifestEntryFile
  | ManifestEntryDirectory
  | ManifestEntrySymlink;

/** Calculate git object hash, like `git hash-object` does. */
async function calculateGitSha1(bytes: Uint8Array) {
  const prefix = `blob ${bytes.byteLength}\0`;
  const prefixBytes = new TextEncoder().encode(prefix);
  const fullBytes = new Uint8Array(prefixBytes.byteLength + bytes.byteLength);
  fullBytes.set(prefixBytes);
  fullBytes.set(bytes, prefixBytes.byteLength);
  const hashBytes = await crypto.subtle.digest("SHA-1", fullBytes);
  const hashHex = Array.from(new Uint8Array(hashBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hashHex;
}

function include(
  path: string,
  include: RegExp[],
  exclude: RegExp[],
): boolean {
  if (
    include.length &&
    !include.some((pattern): boolean => pattern.test(normalize(path)))
  ) {
    return false;
  }
  if (
    exclude.length &&
    exclude.some((pattern): boolean => pattern.test(normalize(path)))
  ) {
    return false;
  }
  return true;
}

async function walk(
  cwd: string,
  dir: string,
  files: Map<string, string>,
  options: { include: RegExp[]; exclude: RegExp[] },
): Promise<Record<string, ManifestEntry>> {
  const entries: Record<string, ManifestEntry> = {};
  for await (const file of Deno.readDir(dir)) {
    const path = join(dir, file.name);
    const relative = path.slice(cwd.length);
    if (
      // Do not test directories, because --include=foo/bar must include the directory foo (same goes with --include=*/bar)
      !file.isDirectory &&
      !include(
        path.slice(cwd.length + 1),
        options.include,
        options.exclude,
      )
    ) {
      continue;
    }
    let entry: ManifestEntry;
    if (file.isFile) {
      const data = await Deno.readFile(path);
      const gitSha1 = await calculateGitSha1(data);
      entry = {
        kind: "file",
        gitSha1,
        size: data.byteLength,
      };
      files.set(gitSha1, path);
    } else if (file.isDirectory) {
      if (relative === "/.git") continue;
      entry = {
        kind: "directory",
        entries: await walk(cwd, path, files, options),
      };
    } else if (file.isSymlink) {
      const target = await Deno.readLink(path);
      entry = {
        kind: "symlink",
        target,
      };
    } else {
      throw new Error(`Unreachable`);
    }
    entries[file.name] = entry;
  }
  return entries;
}

if (import.meta.main) {
  const root = "_site";
  const cwd = resolve(Deno.cwd(), root);
  const assets = new Map();
  const entries = await walk(cwd, cwd, assets, {
    include: [],
    exclude: [],
  });
  console.log("================== Assets ==================");
  console.log("# of assets: ", assets.size);
  for (const [hash, path] of assets) {
    console.log(JSON.stringify({ hash, path }));
  }
  console.log("================== Entries ==================");
  console.log("# of entries: ", entries.length);
  console.table(entries);
}
