import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { communicationError } from './communications.authorization.js';

sharp.cache({memory:16,files:0,items:16});
sharp.concurrency(2);
export const fileTypes:Record<string,string>={pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',txt:'text/plain',csv:'text/csv',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',zip:'application/zip'};
export function fileLimits(){
 const number=(key:string,fallback:number,max:number)=>{const n=Number(process.env[key]??fallback);return Number.isInteger(n)&&n>0?Math.min(n,max):fallback;};
 return {maxBytes:number('CHAT_FILE_MAX_BYTES',10*1024*1024,25*1024*1024),maxPending:number('CHAT_UPLOAD_PENDING_LIMIT',20,50),
  perHour:number('CHAT_UPLOADS_PER_HOUR',60,200),allowed:(process.env.CHAT_FILE_ALLOWLIST??Object.keys(fileTypes).join(',')).split(',').map(s=>s.trim().toLowerCase()).filter(s=>s in fileTypes)};
}
export function safeFileName(input:string){
 // Strip separators, controls, bidi overrides and device syntax; names are never paths.
 return input.normalize('NFKC').replace(/[\\/<>:"|?*\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,'_').replace(/^\.+/,'').slice(0,180).trim() || 'attachment';
}
const bad=()=>communicationError(422,'UNSAFE_FILE','This file is unsupported, damaged or contains unsafe content.');
function archiveNames(bytes:Buffer){
 let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0 || bytes.readUInt16LE(end+4)!==0 || bytes.readUInt16LE(end+6)!==0)throw bad();
 const count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12),offset=bytes.readUInt32LE(end+16);
 if(!count || count>500 || offset+size!==end || end+22+bytes.readUInt16LE(end+20)!==bytes.length)throw bad();
 let p=offset,total=0;const names:string[]=[];
 for(let i=0;i<count;i++){
  if(p+46>end || bytes.readUInt32LE(p)!==0x02014b50)throw bad();
  const flags=bytes.readUInt16LE(p+8),method=bytes.readUInt16LE(p+10),compressed=bytes.readUInt32LE(p+20),expanded=bytes.readUInt32LE(p+24);
  const n=bytes.readUInt16LE(p+28),extra=bytes.readUInt16LE(p+30),comment=bytes.readUInt16LE(p+32),local=bytes.readUInt32LE(p+42);
  if(flags&1 || ![0,8].includes(method) || expanded>25*1024*1024 || expanded>Math.max(compressed,1)*100 || p+46+n+extra+comment>end || local+30>offset)throw bad();
  total+=expanded;if(total>50*1024*1024)throw bad();
  const name=bytes.subarray(p+46,p+46+n).toString('utf8');
  if(/(^\/|\\|(^|\/)\.\.(\/|$)|:|[\u0000-\u001f])/.test(name) || /\.(exe|dll|com|bat|cmd|ps1|js|mjs|vbs|scr|msi|html?|svg|jar|zip|7z|rar|sh|php|py)$/i.test(name) || /vbaproject|activex/i.test(name))throw bad();
  if(bytes.readUInt32LE(local)!==0x04034b50)throw bad();
  names.push(name);p+=46+n+extra+comment;
 }
 if(p!==end)throw bad();return names;
}
export type FileScan=(bytes:Buffer,mime:string)=>Promise<'CLEAN'|'INFECTED'|'UNAVAILABLE'>;
export const configuredFileScan:FileScan=async(bytes,mime)=>{
 const endpoint=process.env.CHAT_SCAN_URL;if(!endpoint)return 'UNAVAILABLE';
 try{
  const url=new URL(endpoint);if(url.protocol!=='https:' && !(url.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname)))return 'UNAVAILABLE';
  const digest=createHash('sha256').update(bytes).digest('hex');
  const response=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':mime,'X-Content-SHA256':digest,...(process.env.CHAT_SCAN_TOKEN?{Authorization:'Bearer '+process.env.CHAT_SCAN_TOKEN}:{})},body:new Uint8Array(bytes)});
  if(!response.ok)return 'UNAVAILABLE';
  const value=await response.json() as {status?:string;sha256?:string};
  if(value.sha256!==digest)return 'UNAVAILABLE';return value.status==='CLEAN'?'CLEAN':value.status==='INFECTED'?'INFECTED':'UNAVAILABLE';
 }catch{return 'UNAVAILABLE';}
};
export async function validateChatFile(bytes:Buffer,name:string,scan:FileScan=configuredFileScan){
 const ext=name.split('.').at(-1)!.toLowerCase(),limits=fileLimits();if(!limits.allowed.includes(ext) || !bytes.length || bytes.length>limits.maxBytes)throw bad();
 const mime=fileTypes[ext],hex=bytes.subarray(0,8).toString('hex');
 if(mime.startsWith('image/')){
  const magic=ext==='png'?hex==='89504e470d0a1a0a':['jpg','jpeg'].includes(ext)?hex.startsWith('ffd8ff'):ext==='gif'?/^GIF8[79]a/.test(bytes.subarray(0,6).toString()):bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
  if(!magic)throw bad();
  try {
   // Re-encode one frame, discard metadata, bound decompression and execution time.
   const image=sharp(bytes,{limitInputPixels:20000000,failOn:'warning',pages:1}).timeout({seconds:5});
   const clean=await image.rotate().webp({quality:90}).toBuffer();
   const thumbnail=await sharp(clean,{limitInputPixels:20000000}).resize({width:320,height:240,fit:'inside',withoutEnlargement:true}).webp({quality:75}).timeout({seconds:5}).toBuffer();
   return {bytes:clean,mime:'image/webp',thumbnail,scanStatus:'REENCODED',available:true};
  }catch{throw bad();}
 }
 if(ext==='txt'||ext==='csv'){
  let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw bad();}
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)||/<\s*(?:!doctype|html|script|svg|iframe)\b/i.test(text)||/^\s*(?:#!|MZ)/.test(text))throw bad();
  // Text is always downloaded as an attachment; CSV formulas are neutralized.
  const clean=ext==='csv'?Buffer.from(text.replace(/(^|[,;\n])([ \t]*)([=+@-])/g,'$1$2\'$3')):bytes;
  return {bytes:clean,mime,thumbnail:undefined,scanStatus:'NOT_SCANNED',available:true};
 }
 if(ext==='pdf'){if(!bytes.subarray(0,5).equals(Buffer.from('%PDF-')) || !bytes.subarray(-1024).includes(Buffer.from('%%EOF')))throw bad();}
 else if(['doc','xls','ppt'].includes(ext)){if(hex!=='d0cf11e0a1b11ae1')throw bad();}
 else {
  if(!hex.startsWith('504b0304'))throw bad();const names=archiveNames(bytes);
  const root=ext==='docx'?'word/':ext==='xlsx'?'xl/':ext==='pptx'?'ppt/':null;
  if(root && (!names.includes('[Content_Types].xml')||!names.some(n=>n.startsWith(root))))throw bad();
 }
 const verdict=await scan(bytes,mime);if(verdict==='INFECTED')throw bad();
 return {bytes,mime,thumbnail:undefined,scanStatus:verdict==='CLEAN'?'SCANNED':'PENDING_SCAN',available:verdict==='CLEAN'};
}
