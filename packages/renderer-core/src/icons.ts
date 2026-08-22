const LUCIDE_PATHS: Readonly<Record<string, readonly string[]>> = {
  bot: ["M12 8V4H8", "M2 14h2", "M20 14h2", "M15 13v2", "M9 13v2", "M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2"],
  "building-2": ["M6 22V4c0-.5.4-1 1-1h10c.6 0 1 .5 1 1v18", "M6 12H4c-.6 0-1 .4-1 1v9", "M18 9h2c.6 0 1 .4 1 1v12", "M10 6h4", "M10 10h4", "M10 14h4", "M10 18h4"],
  cloud: ["M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9"],
  database: ["M12 2C7.6 2 4 3.8 4 6s3.6 4 8 4 8-1.8 8-4-3.6-4-8-4", "M4 6v6c0 2.2 3.6 4 8 4s8-1.8 8-4V6", "M4 12v6c0 2.2 3.6 4 8 4s8-1.8 8-4v-6"],
  eye: ["M2.1 12a10.8 10.8 0 0 1 19.8 0 10.8 10.8 0 0 1-19.8 0", "M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6"],
  "file-text": ["M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z", "M14 2v6h6", "M8 13h8", "M8 17h8", "M8 9h2"],
  laptop: ["M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9", "M2 16h20v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-2z"],
  "lock-keyhole": ["M5 10V7a7 7 0 0 1 14 0v3", "M5 10h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2", "M12 14v4"],
  network: ["M9 2h6v6H9z", "M3 16h6v6H3z", "M15 16h6v6h-6z", "M12 8v4", "M6 16v-2h12v2"],
  plug: ["M12 22v-5", "M9 8V2", "M15 8V2", "M18 8v4a6 6 0 0 1-12 0V8z"],
  "shield-check": ["M20 13c0 5-3.5 7.5-7.7 8.9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1v7z", "M9 12l2 2 4-4"],
  "triangle-alert": ["M21.7 18 13.7 4a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3", "M12 9v4", "M12 17h.01"],
  "user-round": ["M18 21a8 8 0 0 0-12 0", "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8"],
  workflow: ["M4 3h4v4H4z", "M16 17h4v4h-4z", "M4 17h4v4H4z", "M8 5h4a4 4 0 0 1 4 4v8", "M8 19h8"],
};

export function lucidePaths(name: string): readonly string[] {
  const paths = LUCIDE_PATHS[name];
  if (!paths) throw new Error(`Unknown bundled Lucide icon: ${name}`);
  return paths;
}

/** Serializes a bundled icon for transport adapters such as editable PPTX export. */
export function iconSvgMarkup(name: string, color: string, strokeWidth: number): string {
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) throw new Error("Icon color must be a six-digit hex value");
  if (!Number.isFinite(strokeWidth) || strokeWidth < 0.5 || strokeWidth > 8) {
    throw new Error("Icon stroke width must be between 0.5 and 8");
  }
  const paths = lucidePaths(name).map((path) => `<path d="${path}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

export function createIconSvg(name: string, strokeWidth: number): SVGSVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", String(strokeWidth));
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const data of lucidePaths(name)) {
    const path = document.createElementNS(namespace, "path");
    path.setAttribute("d", data);
    svg.append(path);
  }
  return svg;
}
