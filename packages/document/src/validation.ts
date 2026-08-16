import type { HttpsUrl } from "./types.js";

export function isHttpsUrl(value: string): value is HttpsUrl {
  try {
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) return false;
    for (let index = 0; index < value.length; index += 1) {
      const unit = value.charCodeAt(index);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return false;
        index += 1;
      } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
    }
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

export function asHttpsUrl(value: string): HttpsUrl {
  if ([...value].length > 2_048 || !isHttpsUrl(value)) {
    throw new Error("URL must be absolute, credential-free HTTPS with at most 2048 code points");
  }
  return value;
}
