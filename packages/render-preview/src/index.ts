import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { fromDeksV1Document } from "@deks-js/document";
import type { LayoutMeasurement } from "@deks-js/renderer-core";

const SAFE_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const SAFE_BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const MAX_PREVIEW_PIXELS = 2_600_000;
const MAX_ASSET_BYTES = 20_000_000;

export interface PreviewAsset {
  mediaType: string;
  base64: string;
}

export interface PreviewRequest {
  document: unknown;
  slideId: string;
  width: 1280 | 1600;
  assets: Record<string, PreviewAsset>;
}

export interface PreviewResult {
  png: Buffer;
  width: number;
  height: number;
  measurements: LayoutMeasurement[];
}

interface RouteLike { abort(errorCode: "blockedbyclient"): Promise<void> | void }
interface LocatorLike { screenshot(options: { animations: "disabled"; type: "png" }): Promise<Buffer> }
interface PageLike {
  setContent(html: string, options?: { waitUntil: "domcontentloaded" }): Promise<unknown>;
  addStyleTag(options: { content: string }): Promise<unknown>;
  addScriptTag(options: { content: string }): Promise<unknown>;
  evaluate<R, A>(callback: (argument: A) => R | Promise<R>, argument: A): Promise<R>;
  locator(selector: string): LocatorLike;
}
interface ContextLike {
  route(pattern: string, handler: (route: RouteLike) => Promise<void> | void): Promise<unknown>;
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}
interface BrowserLike { newContext(options: { viewport: { width: number; height: number }; deviceScaleFactor: number }): Promise<ContextLike>; close(): Promise<void> }
type BrowserLaunch = () => Promise<BrowserLike>;

export interface PreviewRendererOptions {
  launch?: BrowserLaunch;
  browserBundle?: string;
  fontCss?: string;
}

function dataFontCss(family: "Poppins" | "Roboto", weights: number[], files: Buffer[]): string {
  return weights.map((weight, index) => `@font-face{font-family:'${family}';font-style:normal;font-display:block;font-weight:${weight};src:url(data:font/woff2;base64,${files[index]?.toString("base64")}) format('woff2');}`).join("\n");
}

async function loadFontCss(): Promise<string> {
  const weights = [100, 200, 300, 400, 500, 600, 700, 800, 900];
  const load = async (name: "poppins" | "roboto") => Promise.all(weights.map(async (weight) => {
    const path = import.meta.resolve(`@fontsource/${name}/files/${name}-latin-${weight}-normal.woff2`);
    return readFile(new URL(path));
  }));
  const [poppins, roboto] = await Promise.all([load("poppins"), load("roboto")]);
  return `${dataFontCss("Poppins", weights, poppins)}\n${dataFontCss("Roboto", weights, roboto)}`;
}

function validateAssets(assets: Record<string, PreviewAsset>): void {
  let total = 0;
  for (const [assetId, asset] of Object.entries(assets)) {
    if (!assetId || !SAFE_MEDIA_TYPES.has(asset.mediaType)) throw new Error("Preview asset media type is not allowed.");
    if (!asset.base64 || asset.base64.length % 4 !== 0 || !SAFE_BASE64.test(asset.base64)) {
      throw new Error("Preview asset base64 is invalid.");
    }
    total += Buffer.byteLength(asset.base64, "base64");
    if (total > MAX_ASSET_BYTES) throw new Error("Preview assets exceed the byte limit.");
  }
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}*{box-sizing:border-box}</style></head><body></body></html>`;

export class PreviewRenderer {
  private readonly launch: BrowserLaunch;
  private readonly suppliedBrowserBundle: string | undefined;
  private readonly suppliedFontCss: string | undefined;
  private browserPromise: Promise<BrowserLike> | undefined;
  private browserBundlePromise: Promise<string> | undefined;
  private fontCssPromise: Promise<string> | undefined;

  constructor(options: PreviewRendererOptions = {}) {
    this.launch = options.launch ?? (() => chromium.launch({ headless: true }) as unknown as Promise<BrowserLike>);
    this.suppliedBrowserBundle = options.browserBundle;
    this.suppliedFontCss = options.fontCss;
  }

  async render(request: PreviewRequest): Promise<PreviewResult> {
    if (request.width !== 1280 && request.width !== 1600) throw new Error("Preview width is not allowed.");
    validateAssets(request.assets);
    const document = fromDeksV1Document(request.document);
    if (!document.slides.some(({ id }) => id === request.slideId)) throw new Error("Preview slide not found.");
    const height = Math.round(request.width * document.canvasHeight / document.canvasWidth);
    if (height <= 0 || request.width * height > MAX_PREVIEW_PIXELS) throw new Error("Preview pixel limit exceeded.");
    const [browser, browserBundle, fontCss] = await Promise.all([
      this.browser(),
      this.browserBundle(),
      this.fontCss(),
    ]);
    const context = await browser.newContext({
      viewport: { width: request.width, height },
      deviceScaleFactor: 1,
    });
    try {
      await context.route("**/*", (route) => route.abort("blockedbyclient"));
      const page = await context.newPage();
      await page.setContent(PAGE, { waitUntil: "domcontentloaded" });
      await page.addStyleTag({ content: fontCss });
      await page.addScriptTag({ content: browserBundle });
      const measurements = await page.evaluate(async (input) => {
        const runtime = (globalThis as typeof globalThis & {
          DeksPreviewBrowser?: { mount(value: typeof input): Promise<LayoutMeasurement[]> };
        }).DeksPreviewBrowser;
        if (!runtime) throw new Error("Preview browser runtime is unavailable.");
        return runtime.mount(input);
      }, { document, slideId: request.slideId, assets: request.assets });
      const png = await page.locator("[data-deks-stage]").screenshot({ animations: "disabled", type: "png" });
      return { png, width: request.width, height, measurements };
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    const browser = await this.browserPromise;
    this.browserPromise = undefined;
    if (browser) await browser.close();
  }

  private browser(): Promise<BrowserLike> {
    this.browserPromise ??= this.launch();
    return this.browserPromise;
  }

  private browserBundle(): Promise<string> {
    this.browserBundlePromise ??= this.suppliedBrowserBundle === undefined
      ? readFile(new URL("./browser-entry.js", import.meta.url), "utf8")
      : Promise.resolve(this.suppliedBrowserBundle);
    return this.browserBundlePromise;
  }

  private fontCss(): Promise<string> {
    this.fontCssPromise ??= this.suppliedFontCss === undefined ? loadFontCss() : Promise.resolve(this.suppliedFontCss);
    return this.fontCssPromise;
  }
}

export function previewSha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
