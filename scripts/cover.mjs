// Generates cover.png (800x534) for gladys-drivebc: plain Node, no dependency.
// A highway winding between mountains, a closure barrier, a traffic cone and a
// map pin, on a sky gradient (no logo, no brand).
// Usage: node scripts/cover.mjs cover.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 800;
const H = 534;
const px = Buffer.alloc(W * H * 3);
const set = (x, y, [r, g, b], a = 1) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = px[i] * (1 - a) + r * a;
  px[i + 1] = px[i + 1] * (1 - a) + g * a;
  px[i + 2] = px[i + 2] * (1 - a) + b * a;
};
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const t = y / H;
    set(x, y, [40 + 90 * t, 110 + 90 * t, 190 + 40 * t]);
  }
}
const white = [255, 255, 255];
const dark = [40, 46, 58];
const orange = [255, 140, 30];
const red = [220, 50, 50];
const green = [60, 140, 80];
const snow = [235, 240, 248];
const yellow = [255, 210, 60];
const disc = (cx, cy, r, color, alpha = 1) => {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y += 1) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x += 1) {
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const box = (x0, y0, x1, y1, r, color, alpha = 1) => {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const cx = Math.min(Math.max(x, x0 + r), x1 - r);
      const cy = Math.min(Math.max(y, y0 + r), y1 - r);
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const line = (x0, y0, x1, y1, width, color) => {
  const minX = Math.floor(Math.min(x0, x1) - width);
  const maxX = Math.ceil(Math.max(x0, x1) + width);
  const minY = Math.floor(Math.min(y0, y1) - width);
  const maxY = Math.ceil(Math.max(y0, y1) + width);
  const len2 = (x1 - x0) ** 2 + (y1 - y0) ** 2 || 1;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / len2));
      const d = Math.hypot(x - (x0 + t * (x1 - x0)), y - (y0 + t * (y1 - y0)));
      const a = Math.max(0, Math.min(1, width / 2 - d + 0.5));
      if (a > 0) set(x, y, color, a);
    }
  }
};
const triangle = (ax, ay, bx, by, cx, cy, color, alpha = 1) => {
  const minX = Math.floor(Math.min(ax, bx, cx));
  const maxX = Math.ceil(Math.max(ax, bx, cx));
  const minY = Math.floor(Math.min(ay, by, cy));
  const maxY = Math.ceil(Math.max(ay, by, cy));
  const edge = (x0, y0, x1, y1, x, y) => (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0);
  const area = edge(ax, ay, bx, by, cx, cy);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const w0 = edge(bx, by, cx, cy, x, y) / area;
      const w1 = edge(cx, cy, ax, ay, x, y) / area;
      const w2 = edge(ax, ay, bx, by, x, y) / area;
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) set(x, y, color, alpha);
    }
  }
};

// Mountains with snowy tops, then the green valley.
for (const [cx, top, half, shade] of [
  [150, 120, 230, 0.75],
  [420, 80, 260, 0.85],
  [680, 140, 220, 0.7],
]) {
  triangle(cx - half, 360, cx + half, 360, cx, top, [70 * shade, 90 * shade, 120 * shade]);
  triangle(cx - 45, top + 60, cx + 45, top + 60, cx, top, snow);
}
box(0, 340, W, H, 0, green);

// The highway, from the bottom to the pass, with its center line.
let previous;
for (let y = H; y >= 350; y -= 3) {
  const t = (H - y) / (H - 350);
  const x = 330 + 120 * Math.sin(t * Math.PI * 1.2);
  const width = 150 - 120 * t;
  if (previous) line(previous[0], previous[1], x, y, width, dark);
  previous = [x, y];
}
previous = undefined;
for (let y = H; y >= 360; y -= 3) {
  const t = (H - y) / (H - 350);
  const x = 330 + 120 * Math.sin(t * Math.PI * 1.2);
  if (previous && Math.floor(y / 18) % 2 === 0)
    line(previous[0], previous[1], x, y, 6 - 4 * t, yellow);
  previous = [x, y];
}

// A closure barrier across the road: red and white stripes on two legs.
line(250, 470, 250, 520, 8, white);
line(450, 470, 450, 520, 8, white);
box(225, 430, 475, 475, 6, white);
for (let k = 0; k < 6; k += 1) {
  const x0 = 235 + k * 40;
  triangle(x0, 470, x0 + 18, 470, x0 + 38, 435, red);
}

// A traffic cone.
triangle(560, 520, 640, 520, 600, 380, orange);
box(570, 440, 630, 455, 2, white);
box(548, 515, 652, 530, 4, orange);

// A map pin above the valley: the watch zone.
disc(640, 210, 70, white, 0.25);
disc(640, 200, 34, red);
triangle(612, 220, 668, 220, 640, 275, red);
disc(640, 200, 13, white);
// PNG encoding.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) {
  raw[y * (W * 3 + 1)] = 0;
  px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(process.argv[2] ?? 'cover.png', png);
console.log('cover', png.length, 'bytes');
