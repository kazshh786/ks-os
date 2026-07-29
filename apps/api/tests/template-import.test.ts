import assert from 'node:assert/strict';
import test from 'node:test';
import { analyseTrustedTemplateFiles } from '@ks-os/template-intelligence';
import { inspectTemplateZip } from '../src/modules/sites/template-import.service.js';

interface ZipEntry { name: string; content: string; flags?: number }

function storedZip(entries: ZipEntry[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const content = Buffer.from(entry.content, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.flags || 0x800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.flags || 0x800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.length + name.length + content.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

test('template import safely inventories and analyses stored ZIP entries', () => {
  const archive = storedZip([
    { name: 'index.html', content: '<!doctype html><html><head><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="assets/main.css"></head><body><header><nav>Menu</nav></header><main><section class="hero"><h1>Luxury salon</h1><a href="/book">Book now</a></section><section class="services"><h2>Services</h2></section></main><footer>Footer</footer></body></html>' },
    { name: 'assets/main.css', content: ':root{--brand:#7c3aed} body{display:grid} @media(max-width:768px){body{display:block}}' },
    { name: 'assets/main.js', content: 'console.log("not executed")' },
  ]);
  const inspected = inspectTemplateZip(archive);
  assert.equal(inspected.files.length, 3);
  assert.equal(inspected.findings.length, 0);
  const analysis = analyseTrustedTemplateFiles(inspected.files);
  assert.equal(analysis.layouts.length, 1);
  assert.equal(analysis.layouts[0]?.sourceFile, 'index.html');
  assert.equal(analysis.files.find(file => file.relativePath === 'assets/main.js')?.containsExecutableCode, true);
});

test('template import rejects ZIP path traversal', () => {
  const archive = storedZip([{ name: '../outside.html', content: '<html></html>' }]);
  assert.throws(() => inspectTemplateZip(archive), (error: any) => error?.code === 'TEMPLATE_PATH_TRAVERSAL');
});

test('template import rejects encrypted ZIP entries', () => {
  const archive = storedZip([{ name: 'index.html', content: '<html></html>', flags: 0x801 }]);
  assert.throws(() => inspectTemplateZip(archive), (error: any) => error?.code === 'TEMPLATE_ENCRYPTED_ENTRY_REJECTED');
});
