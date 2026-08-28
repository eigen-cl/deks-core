import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { icons as officialIcons } from "@lucide/icons";

const VERSION = "1.34.0";
const SAFE_TAGS = new Set(["path", "circle", "ellipse", "line", "polyline", "polygon", "rect"]);
const SAFE_ATTRIBUTES = new Set([
  "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "x2", "y1", "y2",
  "width", "height", "points", "fill", "fill-rule", "clip-rule", "stroke",
  "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity",
]);
const CAMEL_ATTRIBUTES = {
  fillRule: "fill-rule",
  clipRule: "clip-rule",
  strokeWidth: "stroke-width",
  strokeLinecap: "stroke-linecap",
  strokeLinejoin: "stroke-linejoin",
};

function sanitize(icon) {
  const nodes = icon.node.map(([tag, attributes]) => {
    if (!SAFE_TAGS.has(tag)) throw new Error(`${icon.name} uses unsupported SVG tag ${tag}`);
    const clean = {};
    for (const [rawName, rawValue] of Object.entries(attributes)) {
      if (rawName === "key") continue;
      const name = SAFE_ATTRIBUTES.has(rawName) ? rawName : CAMEL_ATTRIBUTES[rawName];
      if (!name || (typeof rawValue !== "string" && typeof rawValue !== "number")) {
        throw new Error(`${icon.name} uses unsupported SVG attribute ${rawName}`);
      }
      clean[name] = String(rawValue);
    }
    return [tag, clean];
  });
  return {
    name: icon.name,
    aliases: [...new Set(icon.aliases ?? [])].sort(),
    width: icon.width ?? icon.size,
    height: icon.height ?? icon.size,
    nodes,
  };
}

const byName = new Map();
for (const icon of Object.values(officialIcons)) {
  if (!byName.has(icon.name)) byName.set(icon.name, sanitize(icon));
}
const catalog = {
  family: "lucide",
  version: VERSION,
  license: "ISC",
  icons: [...byName.values()].sort((left, right) => left.name.localeCompare(right.name)),
};
const output = resolve(process.argv[2] ?? `artifacts/lucide-${VERSION}.json`);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(catalog)}\n`, "utf8");
console.log(`${catalog.icons.length} Lucide ${VERSION} icons written to ${output}`);
