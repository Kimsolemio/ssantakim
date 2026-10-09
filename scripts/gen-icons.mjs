// 의존성 없는 PNG 아이콘 생성기: 주황 배경 + 크림색 원(접시) + 노란 원(계란 노른자)
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "apps", "web", "public");
mkdirSync(out, { recursive: true });

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
});
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size, maskable) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const r = size / 2, cx = size / 2, cy = size * 0.54;
  const radius = maskable ? 0 : size * 0.22;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let [R, G, B, A] = [249, 115, 22, 255];
      // rounded corners
      const dx = Math.max(Math.abs(x - r) - (r - radius), 0), dy = Math.max(Math.abs(y - r) - (r - radius), 0);
      if (dx * dx + dy * dy > radius * radius) A = 0;
      const d = Math.hypot(x - cx, y - cy);
      if (d < size * 0.26) [R, G, B] = [255, 248, 240];
      if (d < size * 0.18) [R, G, B] = [253, 186, 116];
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = R; raw[i + 1] = G; raw[i + 2] = B; raw[i + 3] = A;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

writeFileSync(join(out, "icon-192.png"), png(192, false));
writeFileSync(join(out, "icon-512.png"), png(512, true));
writeFileSync(join(out, "apple-touch-icon.png"), png(180, true));
console.log("icons written to", out);
