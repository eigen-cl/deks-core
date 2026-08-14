import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  isIconCatalog,
  isPaletteRecommendation,
  type IconCatalog,
  type PaletteRecommendation,
} from "../src";

const catalog: IconCatalog = {
  family: {
    id: "lucide",
    label: "Lucide",
    license: "ISC",
    viewBox: "0 0 24 24",
    defaultFill: "none",
    defaultStrokeLinecap: "round",
    defaultStrokeLinejoin: "round",
  },
  availableFamilies: [{ id: "lucide", label: "Lucide", license: "ISC" }],
  icons: [{ name: "shield-check", label: "Shield check", tags: ["security"], paths: ["M20 13"] }],
};

const palette: PaletteRecommendation = {
  id: "governed-ember",
  label: "Governed Ember",
  mode: "dark",
  flavor: "warm-technical",
  matchedTags: ["governance"],
  roles: {
    primary: "#FF8A65",
    secondary: "#5EEAD4",
    accent: "#93C5FD",
    background: "#0B1020",
    text: "#F8FAFC",
    subtext: "#B8C0D4",
  },
  onColors: { onPrimary: "#0B1020", onSecondary: "#0B1020", onAccent: "#0B1020" },
  contrastChecks: [
    { pair: "text/background", ratio: 17.54, threshold: 4.5, passes: true },
    { pair: "subtext/background", ratio: 10.41, threshold: 4.5, passes: true },
    { pair: "primary/background", ratio: 8.16, threshold: 3, passes: true },
    { pair: "onPrimary/primary", ratio: 8.16, threshold: 4.5, passes: true },
  ],
};

describe("portable visual design contracts", () => {
  it("accepts an offline icon catalog and rejects remote or malformed vector data", () => {
    expect(isIconCatalog(catalog)).toBe(true);
    expect(isIconCatalog({ ...catalog, icons: [{ ...catalog.icons[0], paths: ["https://cdn.invalid/icon.svg"] }] })).toBe(false);
    expect(isIconCatalog({ ...catalog, family: { ...catalog.family, viewBox: "javascript:alert(1)" } })).toBe(false);
  });

  it("accepts deterministic semantic palettes only when every declared contrast check passes", () => {
    expect(isPaletteRecommendation(palette)).toBe(true);
    expect(isPaletteRecommendation({
      ...palette,
      contrastChecks: [{ pair: "text/background", ratio: 1.1, threshold: 4.5, passes: false }],
    })).toBe(false);
  });

  it("calculates WCAG contrast symmetrically from hex colors", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBe(21);
    expect(contrastRatio("#FFFFFF", "#000000")).toBe(21);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
  });
});
