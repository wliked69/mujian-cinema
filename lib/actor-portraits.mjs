import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { clean, names } from './catalog.mjs';
import { within } from './scanner.mjs';

export const MAX_PORTRAIT_BYTES = 5 * 1024 * 1024;
export const actorKey = name => clean(name, 100).toLocaleLowerCase();
export const movieActors = movie => [...new Set([...names(movie.cast || ''), ...(movie.actors || []).map(a => a.name).filter(Boolean)])];
export const portraitMap = entries => new Map((entries || []).map(p => [actorKey(p.name), p.photo]));
export function initializePortraits(state) {
  if (state.actorPortraits === undefined) state.actorPortraits = [];
  if (!Array.isArray(state.actorPortraits) || state.actorPortraits.some(p => !p || typeof p.name !== 'string' || !p.name || p.name.length > 100 || typeof p.photo !== 'string' || !/^\/media\/actors\/manual-[a-f0-9]{64}\.(png|jpg|webp)$/.test(p.photo))) throw new Error('手动演员头像资料格式错误，已停止启动以避免覆盖。');
}
export function portraitFormat(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 24 || bytes.length > MAX_PORTRAIT_BYTES) throw new Error('请选择不超过 5 MB 的 JPG、PNG 或 WebP 图片。');
  let width, height, extension, mime;
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString('ascii',12,16) === 'IHDR' && bytes.length >= 45 && bytes.toString('ascii',bytes.length-8,bytes.length-4) === 'IEND') {
    width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);extension='png';mime='image/png';
  } else if (bytes[0]===255 && bytes[1]===216 && bytes[bytes.length-2]===255 && bytes[bytes.length-1]===217) {
    let offset=2;
    while(offset+4<=bytes.length) {
      if(bytes[offset++]!==255)break;
      while(bytes[offset]===255)offset++;
      const marker=bytes[offset++];
      if(marker===0xda || marker===0xd9)break;
      if(marker===1 || marker>=0xd0&&marker<=0xd7)continue;
      if(offset+2>bytes.length)break;
      const size=bytes.readUInt16BE(offset);if(size<2 || offset+size>bytes.length)break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&size>=8) {height=bytes.readUInt16BE(offset+3);width=bytes.readUInt16BE(offset+5);break;}
      offset+=size;
    }
    extension='jpg';mime='image/jpeg';
  } else if(bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP' && bytes.readUInt32LE(4)===bytes.length-8 && bytes.length>=30) {
    const chunk=bytes.toString('ascii',12,16);
    if(chunk==='VP8X' && !(bytes[20]&2)) {width=bytes.readUIntLE(24,3)+1;height=bytes.readUIntLE(27,3)+1;}
    else if(chunk==='VP8 ' && bytes.subarray(23,26).equals(Buffer.from([157,1,42]))) {width=bytes.readUInt16LE(26)&0x3fff;height=bytes.readUInt16LE(28)&0x3fff;}
    else if(chunk==='VP8L' && bytes[20]===47) {const bits=bytes.readUInt32LE(21);width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1;}
    extension='webp';mime='image/webp';
  }
  if(!width || !height || width>8192 || height>8192 || width*height>32000000 || !extension) throw new Error('图片格式不支持或尺寸过大，请选择静态 JPG、PNG 或 WebP（最长边 8192 像素）。');
  return {extension,mime,width,height};
}
export async function readPortrait(req) {
  const declared=Number(req.headers['content-length']);
  if(Number.isFinite(declared)&&declared>MAX_PORTRAIT_BYTES){const error=new Error('头像不能超过 5 MB。');error.status=413;throw error;}
  const parts=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>MAX_PORTRAIT_BYTES){const error=new Error('头像不能超过 5 MB。');error.status=413;throw error;}parts.push(chunk);}
  const bytes=Buffer.concat(parts),format=portraitFormat(bytes),type=String(req.headers['content-type']||'').split(';')[0].toLowerCase();
  if(type && type!=='application/octet-stream' && type!==format.mime)throw new Error('图片内容与格式不一致。');
  return {bytes,...format};
}
export async function savePortraitFile(dataDir, image) {
  const dir=path.join(dataDir,'actors');await fs.mkdir(dir,{recursive:true});
  if((await fs.lstat(dir)).isSymbolicLink())throw new Error('演员图片目录不能是链接。');
  const root=await fs.realpath(dataDir),actual=await fs.realpath(dir);
  if(!within(root,actual))throw new Error('演员图片目录超出数据目录。');
  const hash=createHash('sha256').update(image.bytes).digest('hex'),name='manual-'+hash+'.'+image.extension,file=path.join(actual,name);
  try{await fs.writeFile(file,image.bytes,{flag:'wx',mode:0o600});}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    const info=await fs.lstat(file);
    if(!info.isFile() || info.isSymbolicLink() || info.size!==image.bytes.length || createHash('sha256').update(await fs.readFile(file)).digest('hex')!==hash)throw new Error('同名头像缓存异常，未覆盖原文件。');
  }
  return '/media/actors/'+name;
}
