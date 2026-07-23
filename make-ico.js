'use strict';
// 여러 크기 PNG를 하나의 멀티 해상도 ICO 로 묶는다 (작업표시줄=32/48, 탭=16, 고해상=256)
// 사용: node make-ico.js out.ico in16.png in32.png in48.png in256.png ...
const fs = require('fs');
const icoPath = process.argv[2];
const pngPaths = process.argv.slice(3);
if (!icoPath || !pngPaths.length) {
  console.error('사용: node make-ico.js out.ico in1.png [in2.png ...]');
  process.exit(1);
}
const imgs = pngPaths.map((p) => fs.readFileSync(p));
const count = imgs.length;

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);      // reserved
header.writeUInt16LE(1, 2);      // type: 1 = icon
header.writeUInt16LE(count, 4);  // image count

let offset = 6 + count * 16;     // 데이터 시작 오프셋
const entries = [];
const sizes = [];
for (const png of imgs) {
  const w = png.readUInt32BE(16); // PNG IHDR width
  const h = png.readUInt32BE(20); // PNG IHDR height
  sizes.push(w);
  const e = Buffer.alloc(16);
  e.writeUInt8(w >= 256 ? 0 : w, 0); // 0 = 256
  e.writeUInt8(h >= 256 ? 0 : h, 1);
  e.writeUInt8(0, 2);   // palette
  e.writeUInt8(0, 3);   // reserved
  e.writeUInt16LE(1, 4);  // planes
  e.writeUInt16LE(32, 6); // bpp
  e.writeUInt32LE(png.length, 8);  // size
  e.writeUInt32LE(offset, 12);     // offset
  entries.push(e);
  offset += png.length;
}
fs.writeFileSync(icoPath, Buffer.concat([header, ...entries, ...imgs]));
console.log(`ICO 생성: ${icoPath} (${count}개 크기: ${sizes.join('/')})`);
