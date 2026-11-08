import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {createApp} from '../server.mjs';
import {initializeLibraries, planLibrary} from '../lib/libraries.mjs';
import {movieAccess, visibleLibraries} from '../lib/library-access.mjs';
import {libraryChoices, scopedMovies} from '../public/library-scope.js';
import {isTelevision, selectedEpisode} from '../public/episodes.js';

test('影片库独立于来源：升级只归入一个默认库，允许多来源组合、重叠来源和空库',()=>{
  const state={sources:[{id:'a'},{id:'b'}]};initializeLibraries(state);
  assert.equal(state.libraries.length,1);assert.deepEqual(state.libraries[0].sourceIds,['a','b']);
  state.sources.push({id:'future'});initializeLibraries(state);assert.deepEqual(state.libraries[0].sourceIds,['a','b']);
  const group=planLibrary([],state.sources,{name:'我的影院',sourceIds:['a','b','a']});
  assert.deepEqual(group.sourceIds,['a','b']);assert.equal(group.revision,1);
  assert.deepEqual(planLibrary([],state.sources,{name:'空库',sourceIds:[]}).sourceIds,[]);
  assert.throws(()=>planLibrary([group],state.sources,{id:group.id,revision:0,name:'旧编辑',sourceIds:[]}),/修改/);
  assert.throws(()=>planLibrary([],state.sources,{name:'<script>',sourceIds:['a']}));
  assert.throws(()=>planLibrary([],state.sources,{name:'测试',sourceIds:['missing']}));
  assert.throws(()=>initializeLibraries({sources:[],libraries:[{}]}),/停止启动/);
  const data={sources:state.sources,libraries:[group,{id:'shared',name:'精选',sourceIds:['b']}],movies:[{id:'1',sourceId:'a'},{id:'2',sourceId:'b'}]};
  assert.equal(libraryChoices(data).length,2);assert.equal(scopedMovies(data,group.id).length,2);assert.equal(scopedMovies(data,'all').length,2);
});

test('库授权与旧来源限制取交集，未归库来源不自动向普通账号开放',()=>{
  const libraries=[{id:'group',name:'合集',sourceIds:['a','b']}];
  const user={enabled:true,role:'user',libraryAccess:{libraryIds:['group'],genres:null}};
  assert.equal(movieAccess(user,libraries)({sourceId:'a'}),true);
  assert.equal(movieAccess(user,libraries)({sourceId:'b'}),true);
  assert.equal(movieAccess(user,libraries)({sourceId:'future'}),false);
  assert.equal(movieAccess(user)({sourceId:'a'}),false);
  const legacy={...user,libraryAccess:{libraryIds:['group'],sourceIds:['a'],genres:null}};
  assert.equal(movieAccess(legacy,libraries)({sourceId:'b'}),false);
  assert.deepEqual(visibleLibraries(legacy,libraries)[0].sourceIds,['a']);
});

test('电视剧封面只开详情，历史集数回填；选集为编号按钮而非下拉菜单',async()=>{
  assert.equal(isTelevision({mediaType:'tv'}),true);assert.equal(isTelevision({episodeCount:2}),true);assert.equal(isTelevision({}),false);
  const movie={episodes:[{id:'first',title:'第1集'},{id:'second',title:'第2集'}]};
  assert.equal(selectedEpisode(movie,'second').id,'second');assert.equal(selectedEpisode(movie,'missing').id,'first');
  const js=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const picker=js.slice(js.indexOf('function episodePicker('),js.indexOf('function playbackStreams('));
  assert.doesNotMatch(picker,/<select|<option/);assert.match(picker,/class="episode-grid"/);assert.match(picker,/aria-pressed=/);
  assert.match(js,/movie\.playable && !isTelevision\(movie\)/);assert.match(js,/detail-episode'\)\.dataset\.episodeId/);
  assert.match(js,/data-episodes-only/);
});

test('真实 HTTP 自定义库：手动归源、多来源授权、修改后旧播放票据拒绝、移除不删除影片、保存持久化',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cinema-custom-libraries-')),dataDir=path.join(root,'data');
  const file=path.join(root,'sample.mp4');await fs.writeFile(file,'0123456789abcdef');
  let app=await createApp({dataDir});t.after(async()=>{await app.shutdown();await fs.rm(root,{recursive:true,force:true});});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');let base='http://127.0.0.1:'+app.server.address().port;
  const req=(route,cookie='',data,method=data===undefined?'GET':'POST',headers={})=>fetch(base+route,{method,headers:{Cookie:cookie,'X-Cinema-Client':'local','Content-Type':'application/json',...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const setup=await req('/api/auth/setup','',{username:'group-admin',password:'x'});const admin=setup.headers.get('set-cookie').split(';')[0];
  app.store.state.sources=['a','b','c'].map(id=>({id,type:'local',name:'来源 '+id,path:root}));
  app.store.state.movies=['a','b','c'].map(sourceId=>({id:'movie-'+sourceId,sourceId,kind:'local',genreModel:2,genres:['剧情'],title:'影片 '+sourceId,filePath:file,rootPath:root}));
  assert.equal(app.store.state.libraries.length,0);
  const create=await req('/api/admin/libraries',admin,{name:'我的家庭影院',sourceIds:['a','b']});assert.equal(create.status,200);let group=await create.json();
  const user=await (await req('/api/admin/users',admin,{username:'group-viewer',password:'y',libraryAccess:{libraryIds:[group.id],genres:null}})).json();
  const login=async()=>{const r=await req('/api/auth/login','',{username:'group-viewer',password:'y'});return r.headers.get('set-cookie').split(';')[0];};
  const cookie=await login();let catalog=await (await req('/api/library',cookie)).json();
  assert.deepEqual(catalog.movies.map(m=>m.sourceId),['a','b']);assert.equal(catalog.libraries.length,1);assert.equal(catalog.libraries[0].name,'我的家庭影院');assert.equal(catalog.unassignedSourceIds,undefined);
  for(const method of ['GET','POST'])assert.equal((await req('/api/admin/libraries',cookie,method==='POST'?{name:'越权',sourceIds:['c']}:undefined,method)).status,403);
  const token=await (await req('/api/admin/tokens',admin,{scope:'write'})).json();
  assert.equal((await req('/api/admin/libraries','',{name:'越权',sourceIds:['c']},'POST',{Authorization:'Bearer '+token.token})).status,403);
  const adminCatalog=await (await req('/api/library',admin)).json();assert.deepEqual(adminCatalog.unassignedSourceIds,['c']);
  const ticket=await (await req('/api/movies/movie-b/playback-ticket',cookie,{})).json();assert.equal((await fetch(ticket.url)).status,200);
  const save=await req('/api/admin/libraries',admin,{id:group.id,revision:group.revision,name:'改名后的影院',sourceIds:['a']});assert.equal(save.status,200);group=await save.json();
  assert.equal((await fetch(ticket.url)).status,404);assert.equal((await req('/media/movie-b/video',cookie)).status,404);
  assert.equal((await req('/api/admin/libraries',admin,{id:group.id,revision:1,name:'覆盖',sourceIds:['c']})).status,409);
  catalog=await (await req('/api/library',cookie)).json();assert.deepEqual(catalog.movies.map(m=>m.sourceId),['a']);assert.equal(catalog.libraries[0].name,'改名后的影院');
  const legacy=await (await req('/api/admin/users',admin,{username:'legacy-viewer',password:'z',libraryAccess:{sourceIds:['a'],genres:null}})).json();
  assert.equal((await req('/api/admin/users/'+legacy.id,admin,{libraryAccess:{libraryIds:null,sourceIds:null,genres:null}})).status,400);
  assert.equal((await req('/api/admin/users/'+legacy.id,admin,{confirmLibraryMigration:true,libraryAccess:{libraryIds:[group.id],sourceIds:null,genres:null}})).status,200);
  await app.store.save();await app.shutdown();app=await createApp({dataDir});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');base='http://127.0.0.1:'+app.server.address().port;
  catalog=await (await req('/api/library',cookie)).json();assert.equal(catalog.libraries[0].id,group.id);
  assert.equal((await req('/api/admin/libraries/'+group.id,admin,{confirm:true,revision:group.revision},'DELETE')).status,200);
  assert.equal(app.store.state.movies.length,3);assert.equal(app.store.state.sources.length,3);
  assert.equal((await (await req('/api/library',cookie)).json()).movies.length,0);
  assert.equal((await req('/media/movie-a/video',cookie)).status,404);
});
