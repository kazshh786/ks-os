import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { validateChatFile,safeFileName,fileLimits } from '../src/modules/communications/communications.file-policy.js';

test('Chat file validation rejects spoofed types, executable and active content',async()=>{
 for(const [name,bytes] of [['report.pdf',Buffer.from('MZ executable')],['photo.png',Buffer.from('<svg onload="evil()"/>')],['notes.txt',Buffer.from('<html><script>bad()</script></html>')],['x.svg',Buffer.from('<svg/>')],['x.zip',Buffer.from('PK invalid')],['x.docx',Buffer.from('not a document')]] as const)
  await assert.rejects(validateChatFile(bytes,name));
 assert.ok(!safeFileName('../../\\evil\u0000.txt').includes('/'));
 assert.ok(fileLimits().maxBytes<=25*1024*1024);
});
test('Chat thumbnails re-encode images, bound pixels, and never depend on supplied MIME',async()=>{
 const source=await sharp({create:{width:640,height:480,channels:3,background:'red'}}).png().toBuffer();
 const result=await validateChatFile(source,'picture.png');
 assert.equal(result.mime,'image/webp');assert.equal(result.scanStatus,'REENCODED');assert.ok(result.available);
 const metadata=await sharp(result.thumbnail).metadata();assert.ok(metadata.width!<=320);assert.ok(metadata.height!<=240);
 const huge=await sharp({create:{width:5000,height:5000,channels:3,background:'blue'}}).png().toBuffer();
 await assert.rejects(validateChatFile(huge,'huge.png'));
});
test('Chat scanner integration fails closed and distinguishes quarantine from scanned documents',async()=>{
 const pdf=Buffer.from('%PDF-1.7\n%%EOF');
 const unavailable=await validateChatFile(pdf,'report.pdf',async()=> 'UNAVAILABLE');assert.equal(unavailable.available,false);assert.equal(unavailable.scanStatus,'PENDING_SCAN');
 const clean=await validateChatFile(pdf,'report.pdf',async()=> 'CLEAN');assert.ok(clean.available);assert.equal(clean.scanStatus,'SCANNED');
 await assert.rejects(validateChatFile(pdf,'report.pdf',async()=> 'INFECTED'));
});
