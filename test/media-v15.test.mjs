import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { probeDuration, durationLabel } from '../lib/duration.mjs';
import { normalizeMovie, publicMovie, toolMovie, releaseDate } from '../lib/catalog.mjs';
import { scanDirectory } from '../lib/scanner.mjs';
import { durationStamp, actorIndex, facetValues } from '../public/movie-utils.js';
import { editableFacts } from '../lib/facts.mjs';
import { createApp } from '../server.mjs';
const box=(type,data)=>{const b=Buffer.alloc(data.length+8);b.writeUInt32BE(b.length);b.write(type,4);data.copy(b,8);return b;};
function mp4(seconds=5,version=0){const b=Buffer.alloc(version?32:20);b[0]=version;if(version){b.writeUInt32BE(1000,20);b.writeBigUInt64BE(BigInt(Math.round(seconds*1000)),24);}else{b.writeUInt32BE(1000,12);b.writeUInt32BE(Math.round(seconds*1000),16);}return Buffer.concat([box('mdat',Buffer.alloc(23)),box('moov',box('mvhd',b))]);}
function mkv(){const scale=Buffer.from('2ad7b1830f4240','hex'),d=Buffer.alloc(11);d.writeUIntBE(0x448988,0,3);d.writeDoubleBE(12345,3);const info=Buffer.concat([Buffer.from([0x15,0x49,0xa9,0x66,0x80+scale.length+d.length]),scale,d]);return Buffer.concat([Buffer.from('1a45dfa38018538067ff','hex'),info]);}

test('本地文件自动识别 MP4 v0/v1、MOV、MKV/WebM 时长，坏头不猜测',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cinema-duration-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 for(const [name,bytes,seconds] of [['a.mp4',mp4(5.055),5.055],['b.mov',mp4(3661,1),3661],['c.mkv',mkv(),12.345],['d.webm',mkv(),12.345],['bad.mp4',Buffer.from('broken'),null]]){const file=path.join(dir,name);await fs.writeFile(file,bytes);assert.equal(await probeDuration(file,{external:false}),seconds);}
 assert.equal(durationLabel(5.055),'5 秒');assert.equal(durationLabel(120),'2 分钟');assert.equal(durationStamp({durationSeconds:3661}),'1:01:01');assert.equal(durationStamp({}), '');assert.deepEqual(facetValues({duration:'60 分钟'},'duration'),[]);
});
test('日期严格校验、演员照片清洗与演员参演数按影片去重',()=>{
 assert.equal(releaseDate('2024-02-29'),'2024-02-29');assert.equal(releaseDate('2023-02-29'),'');assert.equal(releaseDate('2024'),'');
 assert.throws(()=>editableFacts({releaseDate:'2024-02-30'}));assert.deepEqual(editableFacts({releaseDate:''}),{releaseDate:''});
 const a=normalizeMovie({id:1,title:'A',release_date:'2024-05-06',cast:[{name:'甲',profile_path:'/a.jpg'},{name:'乙',photo:'javascript:bad'}]},'s');
 assert.equal(a.releaseDate,'2024-05-06');assert.match(a.actors[0].photo,/image.tmdb.org/);assert.equal(a.actors[1].photo,'');
 const index=actorIndex([a,{id:'b',cast:'甲 / 甲 / 丙',actors:[]}]);assert.equal(index.find(x=>x.name==='甲').count,2);assert.equal(index.find(x=>x.name==='乙').count,1);
});
test('二级文件夹合并电视剧、集数自然排序、元数据/照片及选集安全播放',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cinema-tv-')),root=path.join(dir,'media'),show=path.join(root,'归档分类','测试剧');await fs.mkdir(path.join(show,'.actors'),{recursive:true});
 await fs.writeFile(path.join(show,'第10集.mp4'),mp4(10));await fs.writeFile(path.join(show,'第2集.mp4'),mp4(2));await fs.writeFile(path.join(root,'归档分类','电影.mp4'),mp4(4));
 await fs.writeFile(path.join(show,'tvshow.nfo'),'<tvshow><title>测试电视剧</title><premiered>2024-01-02</premiered><actor><name>测试演员</name></actor></tvshow>');await fs.writeFile(path.join(show,'.actors','测试演员.jpg'),Buffer.from([255,216,255,217]));
 const source={id:'s',name:'测试',type:'local',path:root},scanned=await scanDirectory(source);assert.equal(scanned.movies.length,2);const tv=scanned.movies.find(m=>m.mediaType==='tv');
 assert.equal(tv.title,'测试电视剧');assert.equal(tv.episodes.length,2);assert.match(tv.episodes[0].title,/第2集/);assert.equal(tv.durationSeconds,12);assert.equal(tv.releaseDate,'2024-01-02');assert.equal(tv.actorPhotoFiles.length,1);
 const safe=publicMovie(tv);assert.equal(safe.episodeCount,2);assert.equal(safe.episodes[0].filePath,undefined);assert.equal(safe.actorPhotoFiles,undefined);assert.match(safe.actors[0].photo,/\/actor\?index=0/);assert.equal(toolMovie(tv).episodes,undefined);
 const launches=[];const app=await createApp({dataDir:path.join(dir,'data'),playerService:{list:async()=>({supported:true,players:[{id:'default',name:'测试'}]}),open:async(target)=>{launches.push(target);return{message:'模拟成功'};}}});app.store.state.sources=[source];app.store.state.movies=scanned.movies;await app.store.save();
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(async()=>{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));await fs.rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${app.server.address().port}`;let cookie='';const request=(url,data,method='POST')=>fetch(base+url,{method:data===undefined?'GET':method,headers:{Cookie:cookie,'X-Cinema-Client':'local','Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
 assert.equal((await request('/random')).status,200);assert.equal((await request('/random/')).status,200);
 const setup=await request('/api/auth/setup',{username:'tv_admin',password:'a'});cookie=setup.headers.get('set-cookie').split(';')[0];
 const library=await(await request('/api/library')).json(),returned=library.movies.find(m=>m.id===tv.id);assert.equal(returned.episodeCount,2);assert.equal((await request(returned.episodes[1].mediaUrl)).status,200);assert.equal((await request(`/media/${tv.id}/video?episode=unknown`)).status,404);
 assert.equal((await request(returned.actors[0].photo)).status,200);assert.equal((await request(`/media/${tv.id}/actor?index=999`)).status,404);
 assert.equal((await request(`/api/movies/${tv.id}/open-external`,{episodeId:'wrong'})).status,400);assert.equal((await request(`/api/movies/${tv.id}/open-external`,{episodeId:tv.episodes[1].id})).status,200);assert.equal(launches[0].filePath,tv.episodes[1].filePath);
 assert.equal((await request(`/api/movies/${tv.id}/progress`,{position:2,duration:10,episodeId:'wrong'})).status,400);await request(`/api/movies/${tv.id}/progress`,{position:2,duration:10,episodeId:tv.episodes[1].id});assert.equal(app.store.state.profiles[app.store.state.users[0].id].history[tv.id].episodeId,tv.episodes[1].id);
 assert.equal((await request(`/api/movies/${tv.id}/facts`,{releaseDate:'2024-02-30'})).status,400);await request(`/api/movies/${tv.id}/facts`,{releaseDate:'2025-03-04'});await request('/api/sync',{sourceId:'s'});for(let i=0;i<100&&app.getJob().status==='running';i++)await new Promise(r=>setTimeout(r,10));assert.equal(app.store.state.movies.find(m=>m.id===tv.id).releaseDate,'2025-03-04');
 assert.equal(app.store.state.movies.find(m=>m.id===tv.id).year,2025);
 const owner=app.store.state.users[0].id,profile=app.store.state.profiles[owner];
 app.store.state.movies=[...app.store.state.movies.filter(m=>m.id!==tv.id),...tv.episodes.map((e,i)=>({...e,kind:'local',sourceId:'s',genres:['旧目录'],manualGenres:[i?'第二集标签':'第一集标签']}))];
 profile.favorites[tv.episodes[0].id]=true;profile.history[tv.episodes[1].id]={position:4,duration:10,updatedAt:new Date().toISOString()};delete profile.history[tv.id];
 app.store.state.comments.push({id:'legacy-comment',movieId:tv.episodes[0].id,userId:owner,text:'原单集评论',createdAt:new Date().toISOString()});
 await request('/api/sync',{sourceId:'s'});for(let i=0;i<100&&app.getJob().status==='running';i++)await new Promise(r=>setTimeout(r,10));
 const merged=app.store.state.movies.find(m=>m.id===tv.id);assert.deepEqual(new Set(merged.genres),new Set(['第一集标签','第二集标签']));assert.equal(profile.favorites[tv.id],true);assert.equal(profile.history[tv.id].episodeId,tv.episodes[1].id);assert.equal(app.store.state.comments.find(c=>c.id==='legacy-comment').movieId,tv.id);
 const outside=path.join(dir,'outside.jpg');await fs.writeFile(outside,'outside');merged.actorPhotoFiles=[{name:'测试演员',filePath:outside}];assert.equal((await request(`/media/${tv.id}/actor?index=0`)).status,403);

});
test('随机九宫格作为首页，保留筛选抽取，日期/时长不是筛选按钮',async()=>{
 const html=await fs.readFile(new URL('../public/index.html',import.meta.url),'utf8'),app=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8');assert.match(html,/<section id="random-page"/);assert.doesNotMatch(html,/<dialog[^>]+random/);assert.doesNotMatch(app,/random-dialog/);assert.doesNotMatch(html,/让好电影，有个家/);assert.match(html,/id="actors-list"/);assert.match(app,/history\.pushState/);assert.match(app,/currentEpisodeId/);assert.match(app,/releaseDate/);
});

test('根地址默认九宫格，首页重新抽取而详情不改抽取结果', async () => {
 const html = await fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8');
 const app = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');
 assert.match(html, /data-action="home" aria-label="首页"/);
 assert.match(app, /location.pathname === '\/' && !savedView/);
 assert.match(app, /function openHome\(\) \{[\s\S]*?randomFingerprint = '';\s*applyPageRoute\(true\)/);
 assert.match(app, /if \(force \|\| fingerprint !== randomFingerprint\) randomSelection = sampleMovies\(pool,9\)/);
 assert.doesNotMatch(app, /toast\(result.message\)|function renderHero/);
});

test('详情演员复用主片库演员筛选，提供独立入口搜索并保留影片分页', async () => {
 const html = await fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8');
 const app = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');
 assert.match(html, /id="actor-film-search"[^>]*type="search"/);
 assert.match(app, /key === 'cast'\s*\? `data-actor=/);
 assert.match(app, /if \(el\.dataset\.actor\) \{ openActorPage\(el\.dataset\.actor\)/);
 assert.match(app, /function openActorPage\(name\) \{[\s\S]*?resetFilters\(\);\s+actorFilter = name; view = 'all';\s+openLibraryPage\(\);/);
 assert.match(app, /\$\('#actor-film-search'\)\.addEventListener\('input', event => \{\s*\$\('#search'\)\.value = event\.target\.value;/);
 assert.match(app, /filtered\.slice\(0, pageSize\)/);
});

test('演员头像优先本地图片，片库顶部只显示选中的演员资料', async () => {
 const movies = [
   { id: 'a', cast: '演员甲', actors: [{ name: '演员甲', photo: '/media/a/actor?index=0' }], fileModifiedAt: '2024-01-01' },
   { id: 'b', cast: '演员甲', actors: [{ name: '演员甲', photo: 'https://example.test/portrait.jpg' }], fileModifiedAt: '2025-01-01' },
   { id: 'c', cast: '演员乙', actors: [], fileModifiedAt: '2026-01-01' },
 ];
 assert.deepEqual(actorIndex(movies), [{ name: '演员乙', photo: '', count: 1 }, { name: '演员甲', photo: '/media/a/actor?index=0', count: 2 }]);
 const html = await fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8');
 const app = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');
 assert.match(html, /<section[^>]+id="actor-profile"[^>]+hidden/);
 assert.ok(html.indexOf('id="actor-profile"') < html.indexOf('id="catalog"'));
 assert.match(app, /profile\.hidden = !actor/);
 assert.match(app, /if \(el\.id === 'actor-profile-image'\) \{ el\.hidden = true/);
 assert.doesNotMatch(html + app, /生活之外|下一场心动|值得一看的故事|STORIES, YOUR SPACE|NINE STORIES|THE SCREEN IS YOURS|WELCOME TO YOUR SCREEN ROOM|继续你的电影时光/);
});
