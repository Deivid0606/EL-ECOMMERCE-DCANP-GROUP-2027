// Genera public/dcanp-dropi-extension.zip: extensión de Chrome que, al abrir Dropi
// con un link de "Cargar a Dropi" (#dcanp=...), abre el formulario y lo completa solo.
// Usa el mismo código que el favorito "Llenar Dropi" (src/lib/dropiFill.bookmarklet.js).
import { readFileSync, writeFileSync } from 'node:fs';

const fill = readFileSync(new URL('../src/lib/dropiFill.bookmarklet.js', import.meta.url), 'utf8');

const manifest = {
  manifest_version: 3,
  name: 'DCANP → Dropi',
  version: '3.0.0',
  description: 'Completa solo el formulario de Dropi con los pedidos de DCANP Group.',
  content_scripts: [{ matches: ['https://app.dropi.com.py/*'], js: ['content.js'], run_at: 'document_start' }],
};

const content = `// DCANP → Dropi (generado por scripts/build-dropi-extension.mjs)
(() => {
  const m = location.hash.match(/dcanp=([^&]+)/);
  if (!m) return;
  try {
    window.__DCANP_DATA = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')))));
  } catch (e) {
    return;
  }
  const run = () => setTimeout(() => {
${fill}
  }, 1500);
  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run, { once: true });
})();
`;

// ZIP mínimo (sin compresión).
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const files = [
  ['manifest.json', Buffer.from(JSON.stringify(manifest, null, 2))],
  ['content.js', Buffer.from(content)],
];
const locals = [];
const centrals = [];
let offset = 0;
for (const [name, data] of files) {
  const n = Buffer.from(name);
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8);
  local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26); local.writeUInt16LE(0, 28);
  locals.push(local, n, data);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28);
  central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42);
  centrals.push(central, n);
  offset += 30 + n.length + data.length;
}
const cd = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
writeFileSync(new URL('../public/dcanp-dropi-extension.zip', import.meta.url), Buffer.concat([...locals, cd, end]));
console.log('dcanp-dropi-extension.zip generado');
