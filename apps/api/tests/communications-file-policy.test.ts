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

test('Chat archive policy rejects traversal, executables, nested archives, encryption and expansion bombs',async()=>{
 const archive=(name:string,expanded=1,flags=0)=>{
  const filename=Buffer.from(name),local=Buffer.alloc(30+filename.length+1),central=Buffer.alloc(46+filename.length),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(flags,6);local.writeUInt32LE(1,18);local.writeUInt32LE(expanded,22);local.writeUInt16LE(filename.length,26);filename.copy(local,30);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(flags,8);central.writeUInt32LE(1,20);central.writeUInt32LE(expanded,24);central.writeUInt16LE(filename.length,28);filename.copy(central,46);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(local.length,16);
  return Buffer.concat([local,central,end]);
 };
 for(const bytes of [archive('../secret.txt'),archive('tool.exe'),archive('nested.zip'),archive('word/vbaProject.bin'),archive('safe.txt',1,1),archive('safe.txt',1000000)])
  await assert.rejects(validateChatFile(bytes,'files.zip',async()=> 'CLEAN'));
 const clean=await validateChatFile(archive('safe.txt'),'files.zip',async()=> 'CLEAN');assert.ok(clean.available);
 await assert.rejects(validateChatFile(Buffer.from('name,value\n"=BAD()",1'),'sheet.csv'));
});
