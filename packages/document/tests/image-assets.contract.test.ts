import { describe, expect, it } from "vitest";
import {
  DEKS_IMAGE_LIMITS,
  DeksImageError,
  inspectAndNormalizeDeksImage,
  inspectDeksImage,
  normalizeDeksFileAssets,
  normalizeDeksSvg,
  sniffDeksImageMediaType,
} from "../src";

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

function png(width: number, height: number): Uint8Array {
  return pngChunks(width, height, []);
}

function gif(width: number, height: number): Uint8Array {
  return gifFrames(width, height, [[width, height]]);
}

function jpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08,
    height >> 8, height & 0xff, width >> 8, width & 0xff,
    0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
  ]);
}

function webp(width: number, height: number): Uint8Array {
  const payload = new Uint8Array(10);
  const encodedWidth = width - 1;
  const encodedHeight = height - 1;
  payload.set([encodedWidth & 0xff, (encodedWidth >> 8) & 0xff, (encodedWidth >> 16) & 0xff], 4);
  payload.set([encodedHeight & 0xff, (encodedHeight >> 8) & 0xff, (encodedHeight >> 16) & 0xff], 7);
  return riff([["VP8X", payload]]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(12 + data.byteLength);
  new DataView(result.buffer).setUint32(0, data.byteLength, false);
  result.set(encode(type), 4);
  result.set(data, 8);
  return result;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.byteLength; }
  return output;
}

function pngChunks(width: number, height: number, animationFrames: Array<[number, number]>): Uint8Array {
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width, false);
  new DataView(ihdr.buffer).setUint32(4, height, false);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const animation = animationFrames.length === 0 ? [] : [
    chunk("acTL", (() => { const value = new Uint8Array(8); new DataView(value.buffer).setUint32(0, animationFrames.length, false); return value; })()),
    ...animationFrames.map(([frameWidth, frameHeight], sequence) => {
      const value = new Uint8Array(26);
      const view = new DataView(value.buffer);
      view.setUint32(0, sequence, false);
      view.setUint32(4, frameWidth, false);
      view.setUint32(8, frameHeight, false);
      return chunk("fcTL", value);
    }),
  ];
  return concat(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), ...animation, chunk("IDAT", new Uint8Array()), chunk("IEND", new Uint8Array()));
}

function gifFrames(width: number, height: number, frames: Array<[number, number]>): Uint8Array {
  const header = new Uint8Array(13);
  header.set(encode("GIF89a"));
  const view = new DataView(header.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  const images = frames.map(([frameWidth, frameHeight]) => {
    const image = new Uint8Array(12);
    image[0] = 0x2c;
    const imageView = new DataView(image.buffer);
    imageView.setUint16(5, frameWidth, true);
    imageView.setUint16(7, frameHeight, true);
    image[10] = 2;
    image[11] = 0;
    return image;
  });
  return concat(header, ...images, new Uint8Array([0x3b]));
}

function riff(chunks: Array<[string, Uint8Array]>): Uint8Array {
  const parts = chunks.map(([type, payload]) => {
    const part = new Uint8Array(8 + payload.byteLength + (payload.byteLength & 1));
    part.set(encode(type), 0);
    new DataView(part.buffer).setUint32(4, payload.byteLength, true);
    part.set(payload, 8);
    return part;
  });
  const body = concat(encode("WEBP"), ...parts);
  const output = concat(encode("RIFF"), new Uint8Array(4), body);
  new DataView(output.buffer).setUint32(4, output.byteLength - 8, true);
  return output;
}

function animatedWebp(width: number, height: number, frames: Array<[number, number]>): Uint8Array {
  const vp8x = new Uint8Array(10);
  vp8x[0] = 0x02;
  vp8x.set([width - 1 & 0xff, (width - 1) >> 8 & 0xff, (width - 1) >> 16 & 0xff], 4);
  vp8x.set([height - 1 & 0xff, (height - 1) >> 8 & 0xff, (height - 1) >> 16 & 0xff], 7);
  return riff([["VP8X", vp8x], ["ANIM", new Uint8Array(6)], ...frames.map(([frameWidth, frameHeight]) => {
    const value = new Uint8Array(16);
    value.set([frameWidth - 1 & 0xff, (frameWidth - 1) >> 8 & 0xff, (frameWidth - 1) >> 16 & 0xff], 6);
    value.set([frameHeight - 1 & 0xff, (frameHeight - 1) >> 8 & 0xff, (frameHeight - 1) >> 16 & 0xff], 9);
    return ["ANMF", value] as [string, Uint8Array];
  })]);
}

describe("canonical DEKS image contract", () => {
  it("publishes one transport-independent image policy", () => {
    expect(DEKS_IMAGE_LIMITS).toEqual({
      rasterMediaTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"],
      svgMediaType: "image/svg+xml",
      maxRasterBytes: 50_000_000,
      maxSvgBytes: 5_000_000,
      maxWidth: 16_384,
      maxHeight: 16_384,
      maxLogicalPixels: 40_000_000,
      maxFrames: 200,
      maxAggregatePixels: 100_000_000,
      maxSvgNodes: 10_000,
      maxSvgDepth: 64,
      maxSvgAttributes: 100_000,
      maxSvgPathCharacters: 2_000_000,
    });
  });

  it("recognizes raster magic and dimensions instead of trusting the claimed media type", () => {
    expect(inspectDeksImage(png(1600, 900), "image/png")).toMatchObject({
      mediaType: "image/png",
      width: 1600,
      height: 900,
    });
    expect(() => inspectDeksImage(png(1600, 900), "image/jpeg")).toThrow(/media type|signature/i);
    expect(() => inspectDeksImage(png(16_385, 1), "image/png")).toThrow(/dimension|width/i);
    expect(() => inspectDeksImage(png(8_000, 5_001), "image/png")).toThrow(/pixel/i);
    expect(() => inspectDeksImage(new Uint8Array([1, 2, 3]), "image/png")).toThrow(/invalid|truncated|signature/i);
    expect(() => inspectDeksImage(png(1, 1), "image/avif")).toThrow(/unsupported.*media type/i);
  });

  it("sniffs supported image signatures and reports stable boundary errors", () => {
    expect(sniffDeksImageMediaType(png(1, 1))).toBe("image/png");
    expect(sniffDeksImageMediaType(jpeg(1, 1))).toBe("image/jpeg");
    expect(sniffDeksImageMediaType(gif(1, 1))).toBe("image/gif");
    expect(sniffDeksImageMediaType(webp(1, 1))).toBe("image/webp");
    expect(sniffDeksImageMediaType(encode(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>',
    ))).toBe("image/svg+xml");
    expect(sniffDeksImageMediaType(new Uint8Array())).toBeUndefined();
    expect(sniffDeksImageMediaType(new Uint8Array([1, 2, 3]))).toBeUndefined();

    expect(() => inspectAndNormalizeDeksImage(new Uint8Array())).toThrow(
      expect.objectContaining({ code: "asset_empty" }),
    );
    expect(() => inspectAndNormalizeDeksImage(png(1, 1), "image/jpeg")).toThrow(
      expect.objectContaining({ code: "asset_media_type_unsupported" }),
    );
    try {
      inspectAndNormalizeDeksImage(encode(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script/></svg>',
      ));
      throw new Error("unsafe SVG must fail");
    } catch (error) {
      expect(error).toBeInstanceOf(DeksImageError);
      expect(error).toMatchObject({ code: "asset_unsafe" });
    }
  });

  it("normalizes only embedded assets declared by the portable document", () => {
    const document = {
      assets: [
        { id: "embedded", kind: "embedded", mediaType: "image/png" },
        { id: "remote", kind: "remote", mediaType: "image/png" },
      ],
    };
    const source = png(10, 10);
    const normalized = normalizeDeksFileAssets(document, [{
      id: "embedded",
      mediaType: "image/png",
      bytes: source,
      contentHash: "host-metadata-is-preserved",
    }]);
    expect(normalized).toEqual([{
      id: "embedded",
      mediaType: "image/png",
      bytes: source,
      contentHash: "host-metadata-is-preserved",
    }]);
    expect(normalized[0]!.bytes).not.toBe(source);

    expect(() => normalizeDeksFileAssets(document, [])).toThrow(
      expect.objectContaining({ code: "asset_media_type_unsupported" }),
    );
    expect(normalizeDeksFileAssets(document, [], { allowMissing: true })).toEqual([]);
    expect(() => normalizeDeksFileAssets(document, [
      { id: "embedded", mediaType: "image/png", bytes: source },
      { id: "embedded", mediaType: "image/png", bytes: source },
    ])).toThrow(expect.objectContaining({ code: "asset_media_type_unsupported" }));
    expect(() => normalizeDeksFileAssets(document, [
      { id: "remote", mediaType: "image/png", bytes: source },
    ], { allowMissing: true })).toThrow(expect.objectContaining({ code: "asset_media_type_unsupported" }));
    expect(() => normalizeDeksFileAssets(document, [
      { id: "embedded", mediaType: "image/jpeg", bytes: source },
    ])).toThrow(expect.objectContaining({ code: "asset_media_type_unsupported" }));
  });

  it.each([
    ["image/jpeg", jpeg(640, 360)],
    ["image/gif", gif(640, 360)],
    ["image/webp", webp(640, 360)],
  ] as const)("inspects %s headers", (mediaType, bytes) => {
    expect(inspectDeksImage(bytes, mediaType)).toMatchObject({ mediaType, width: 640, height: 360 });
  });

  it("walks complete raster containers and rejects truncation or trailing payload", () => {
    for (const [mediaType, bytes] of [
      ["image/png", png(640, 360)],
      ["image/jpeg", jpeg(640, 360)],
      ["image/gif", gif(640, 360)],
      ["image/webp", webp(640, 360)],
    ] as const) {
      expect(() => inspectDeksImage(bytes.subarray(0, bytes.byteLength - 1), mediaType)).toThrow(/invalid|truncated|EOI|trailer|length|IEND/i);
      expect(() => inspectDeksImage(concat(bytes, new Uint8Array([0])), mediaType)).toThrow(/trailing|length/i);
    }
  });

  it("enforces frame and aggregate pixel limits for APNG, GIF and animated WebP", () => {
    const tooMany = Array.from({ length: DEKS_IMAGE_LIMITS.maxFrames + 1 }, () => [1, 1] as [number, number]);
    const tooManyForGif = Array.from({ length: DEKS_IMAGE_LIMITS.maxFrames + 1 }, () => [1, 1] as [number, number]);
    const tooLargeAggregate = Array.from({ length: 3 }, () => [8_000, 5_000] as [number, number]);
    expect(() => inspectDeksImage(pngChunks(8_000, 5_000, tooLargeAggregate), "image/png")).toThrow(/aggregate/i);
    expect(() => inspectDeksImage(gifFrames(8_000, 5_000, tooLargeAggregate), "image/gif")).toThrow(/aggregate/i);
    expect(() => inspectDeksImage(animatedWebp(8_000, 5_000, tooLargeAggregate), "image/webp")).toThrow(/aggregate/i);
    expect(() => inspectDeksImage(pngChunks(1, 1, tooMany), "image/png")).toThrow(/frames/i);
    expect(() => inspectDeksImage(gifFrames(1, 1, tooManyForGif), "image/gif")).toThrow(/frames/i);
    expect(() => inspectDeksImage(animatedWebp(1, 1, tooMany), "image/webp")).toThrow(/frames/i);
  });

  it("enforces every animated frame geometry, not only the canvas", () => {
    expect(() => inspectDeksImage(pngChunks(16_384, 1, [[16_385, 1]]), "image/png")).toThrow(/dimension/i);
    expect(() => inspectDeksImage(gifFrames(8_000, 5_000, [[8_000, 5_001]]), "image/gif")).toThrow(/dimension|pixel/i);
    expect(() => inspectDeksImage(animatedWebp(8_000, 5_000, [[8_000, 5_001]]), "image/webp")).toThrow(/dimension|pixel/i);
  });

  it("normalizes a safe SVG to deterministic UTF-8 bytes and dimensions", () => {
    const source = encode(`
      <svg height="50px" width="100" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="paint"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient></defs>
        <title>A &amp; B</title>
        <g fill="url(#paint)" opacity=".5"><path d="M0 0 L100 50 Z"/></g>
      </svg>
    `);
    const normalized = normalizeDeksSvg(source);

    expect(normalized).toMatchObject({ mediaType: "image/svg+xml", width: 100, height: 50 });
    expect(new TextDecoder().decode(normalized.bytes)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><defs><linearGradient id="paint"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient></defs><title>A &amp; B</title><g fill="url(#paint)" opacity="0.5"><path d="M0 0 L100 50 Z"/></g></svg>',
    );
    expect(normalizeDeksSvg(normalized.bytes).bytes).toEqual(normalized.bytes);
    expect(inspectDeksImage(source, "image/svg+xml")).toEqual(normalized);
  });

  it("preserves a finite positive viewBox as the canonical geometry", () => {
    const normalized = normalizeDeksSvg(encode(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10.5 2 640 360"><rect width="640" height="360" fill="#fff"/></svg>',
    ));
    expect(normalized.width).toBe(640);
    expect(normalized.height).toBe(360);
    expect(new TextDecoder().decode(normalized.bytes)).toContain('viewBox="-10.5 2 640 360"');
  });

  it("uses language-independent decimal and transform normalization", () => {
    const normalized = normalizeDeksSvg(encode(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0 0e2 6.40e2 0360.00"><g opacity=".50" transform="translate(.5, 1e1) scale(01.00)"><circle cx="1e2" cy="0" r="1"/></g></svg>',
    ));
    expect(new TextDecoder().decode(normalized.bytes)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><g opacity="0.5" transform="translate(0.5 10) scale(1)"><circle cx="100" cy="0" r="1"/></g></svg>',
    );
  });

  it.each([
    ["invalid UTF-8", new Uint8Array([0xc3, 0x28])],
    ["doctype", encode('<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>')],
    ["processing instruction", encode('<?xml-stylesheet href="https://evil.test/a.css"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>')],
    ["script", encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script>alert(1)</script></svg>')],
    ["style", encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><style>@import url(https://evil.test)</style></svg>')],
    ["foreignObject", encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><foreignObject/></svg>')],
    ["image", encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><image href="data:image/png;base64,AA=="/></svg>')],
    ["use", encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><use href="#x"/></svg>')],
    ["text", encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><text>unsafe font surface</text></svg>')],
    ["event handler", encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" onload="alert(1)"/>')],
    ["style attribute", encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path style="fill:red" d="M0 0"/></svg>')],
    ["foreign namespace", encode('<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="https://evil.test" viewBox="0 0 1 1"><x:path/></svg>')],
    ["external paint URL", encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path fill="url(https://evil.test/a.svg#x)" d="M0 0"/></svg>')],
    ["data URL", encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path fill="url(data:image/svg+xml,x)" d="M0 0"/></svg>')],
    ["duplicate id", encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><g id="x"/><path id="x" d="M0 0"/></svg>')],
    ["dangling reference", encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path fill="url(#missing)" d="M0 0"/></svg>')],
    ["wrong reference target", encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><g id="paint"/><path fill="url(#paint)" d="M0 0"/></svg>')],
    ["missing geometry", encode('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')],
    ["non-positive viewBox", encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 1"/>')],
  ])("rejects %s", (_name, source) => {
    expect(() => normalizeDeksSvg(source)).toThrow();
  });

  it("enforces SVG node and depth limits", () => {
    const nodes = `<g/>`.repeat(DEKS_IMAGE_LIMITS.maxSvgNodes);
    expect(() => normalizeDeksSvg(encode(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">${nodes}</svg>`))).toThrow(/nodes/i);
    const nested = "<g>".repeat(DEKS_IMAGE_LIMITS.maxSvgDepth) + "</g>".repeat(DEKS_IMAGE_LIMITS.maxSvgDepth);
    expect(() => normalizeDeksSvg(encode(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">${nested}</svg>`))).toThrow(/depth/i);
  });

  it("bounds aggregate SVG attributes and path data", () => {
    const attributes = '<rect x="0" y="0" width="1" height="1" rx="0" ry="0" fill="#fff" stroke="#000" stroke-width="0" opacity="1" fill-opacity="1" stroke-opacity="1"/>'
      .repeat(8_334);
    expect(() => normalizeDeksSvg(encode(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">${attributes}</svg>`))).toThrow(/attributes/i);
    const path = "M0 0 ".repeat(Math.floor(DEKS_IMAGE_LIMITS.maxSvgPathCharacters / 5) + 1);
    expect(() => normalizeDeksSvg(encode(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="${path}"/></svg>`))).toThrow(/path characters/i);
  });
});
