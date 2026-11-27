import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SIZES = [16, 32, 48, 128];
const OUT_DIR = path.resolve(process.cwd(), 'public', 'icon');

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function sdfRoundedRect(px, py, cx, cy, hw, hh, r) {
  const dx = Math.abs(px - cx) - hw + r;
  const dy = Math.abs(py - cy) - hh + r;
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  const inside = Math.min(Math.max(dx, dy), 0);
  return outside + inside - r;
}

function blend(dst, idx, r, g, b, a) {
  const srcA = Math.max(0, Math.min(1, a));
  const dstA = dst[idx + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;
  dst[idx] = Math.round((r * srcA + dst[idx] * dstA * (1 - srcA)) / outA);
  dst[idx + 1] = Math.round((g * srcA + dst[idx + 1] * dstA * (1 - srcA)) / outA);
  dst[idx + 2] = Math.round((b * srcA + dst[idx + 2] * dstA * (1 - srcA)) / outA);
  dst[idx + 3] = Math.round(outA * 255);
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const s = size;
  const aa = 1.15;

  // Audio waveform bars (5 centered vertical capsules in upper half)
  const bars = [
    { x: 0.28, h: 0.13 },
    { x: 0.39, h: 0.24 },
    { x: 0.5, h: 0.32 },
    { x: 0.61, h: 0.21 },
    { x: 0.72, h: 0.12 },
  ];

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const idx = (y * s + x) * 4;

      // Rounded squircle background
      const bgDist = sdfRoundedRect(px, py, s / 2, s / 2, s * 0.46, s * 0.46, s * 0.22);
      const bgAlpha = Math.max(0, Math.min(1, 0.5 - bgDist / aa));
      if (bgAlpha > 0) {
        const t = (px / s) * 0.55 + (py / s) * 0.45;
        // Deep indigo -> electric violet -> cyan-teal highlight
        const r = Math.round(18 + t * 24 + Math.max(0, 0.6 - t) * 38);
        const g = Math.round(24 + t * 92 + (1 - Math.abs(t - 0.5) * 2) * 24);
        const b = Math.round(78 + (1 - t) * 120 + t * 140);
        blend(rgba, idx, Math.min(255, r), Math.min(255, g), Math.min(255, b), bgAlpha);

        // Subtle inner top-left glow
        const glowDist = Math.hypot(px - s * 0.28, py - s * 0.22) / (s * 0.62);
        const glow = Math.max(0, 1 - glowDist);
        if (glow > 0) {
          blend(rgba, idx, 129, 140, 248, glow * glow * 0.38 * bgAlpha);
        }

        // Subtle inner rim
        const rim = Math.max(0, 1 - Math.abs(bgDist + s * 0.015) / (s * 0.025));
        if (rim > 0) {
          blend(rgba, idx, 199, 210, 254, rim * 0.28 * bgAlpha);
        }
      }

      // Draw waveform bars
      for (const bar of bars) {
        const d = sdfRoundedRect(
          px,
          py,
          s * bar.x,
          s * 0.4,
          s * 0.036,
          s * (bar.h * 0.5),
          s * 0.036
        );
        const a = Math.max(0, Math.min(1, 0.5 - d / aa));
        if (a > 0) {
          const cyT = Math.abs(bar.x - 0.5) * 2;
          const r = Math.round(224 + (1 - cyT) * 31);
          const g = Math.round(242 + (1 - cyT) * 13);
          const b = 255;
          blend(rgba, idx, r, g, b, a * 0.96);
        }
      }

      // Bilingual dual subtitle lines at bottom
      const line1 = sdfRoundedRect(px, py, s * 0.5, s * 0.68, s * 0.29, s * 0.042, s * 0.042);
      const a1 = Math.max(0, Math.min(1, 0.5 - line1 / aa));
      if (a1 > 0) {
        blend(rgba, idx, 255, 255, 255, a1 * 0.96);
      }

      const line2 = sdfRoundedRect(px, py, s * 0.5, s * 0.8, s * 0.2, s * 0.036, s * 0.036);
      const a2 = Math.max(0, Math.min(1, 0.5 - line2 / aa));
      if (a2 > 0) {
        blend(rgba, idx, 56, 232, 214, a2 * 0.96);
      }
    }
  }

  return encodePng(s, s, rgba);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const png = renderIcon(size);
  fs.writeFileSync(path.join(OUT_DIR, `${size}.png`), png);
  console.log(`Generated icon/${size}.png (${png.length} bytes)`);
}
