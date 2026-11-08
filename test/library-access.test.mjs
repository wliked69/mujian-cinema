import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import vm from 'node:vm';
import { createApp } from '../server.mjs';
import { libraryAccess, canViewMovie } from '../lib/library-access.mjs';
import { libraryChoices, resolveLibrary, scopedMovies } from '../public/library-scope.js';

test('访问白名单：旧账号保持原权限，空范围禁止访问，片库与类别取交集', () => {
  const user = { enabled: true, role: 'user' }, movie = { sourceId: 'a', genres: ['动画', '喜剧'] };
  const groups=[{id:'group',sourceIds:['a']}], canView=(u,m)=>canViewMovie(u,m,groups);
  assert.equal(canView(user, movie), true);
  for (const access of [{sourceIds: [], genres:null}, {sourceIds:['b'],genres:null}, {sourceIds:['a'],genres:[]}, {sourceIds:['a'],genres:['剧情']}])
    assert.equal(canView({...user,libraryAccess:access}, movie), false);
  assert.equal(canView({...user,libraryAccess:{sourceIds:['a'],genres:['动画']}}, movie),true);
  assert.equal(canView({...user,enabled:false}, movie),false);
  assert.equal(canView({...user,role:'admin',libraryAccess:{sourceIds:[],genres:[]}}, movie),true);
  assert.equal(canView({...user,libraryAccess:{sourceIds:'a',genres:null}}, movie),false);
  for (const input of [null, [], {sourceIds:'all',genres:null}, {sourceIds:null,genres:['']}, {sourceIds:null,genres:null,role:'admin'}]) assert.throws(()=>libraryAccess(input));
});

test('多库先选、单库直入；选库只在已经授权的数据中取子集', () => {
  const data = {sources:[{id:'a',name:'来源A'},{id:'b',name:'来源B'}],libraries:[{id:'a',name:'家庭片库',sourceIds:['a']},{id:'b',name:'动作片库',sourceIds:['b']}],movies:[{id:'1',sourceId:'a'},{id:'2',sourceId:'b'}]};
  assert.equal(resolveLibrary(data,null),null);
  assert.equal(resolveLibrary(data,'forbidden'),null);
  assert.deepEqual(scopedMovies(data,null),[]);
  assert.deepEqual(scopedMovies(data,resolveLibrary(data,'a')).map(m=>m.id),['1']);
  assert.equal(scopedMovies(data,'all').length,2);
  const one={libraries:[data.libraries[0]],sources:[data.sources[0]],movies:[data.movies[0]]};
  assert.equal(resolveLibrary(one,null),'a');
  assert.equal(libraryChoices(one).length,1);
  assert.equal(resolveLibrary({sources:[],movies:[]},null),null);
  assert.equal(resolveLibrary({sources:[],movies:[{}],isDemo:true},null),'demo');
});

test('图形化授权、独立选库页、所有设备封面播放与主列表标签导航', async () => {
  const js=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const html=await fs.readFile(new URL('../public/index.html',import.meta.url),'utf8');
  for(const id of ['user-access','access-all-libraries','access-libraries','access-all-genres','access-genres','library-picker','library-choices','switch-library','custom-library-form']) assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(js,/data\.libraryAccess =/);
  assert.match(js,/libraryQuery\(\), view/);
  assert.match(js,/function usesDirectCoverPlayback\(\) \{ return true; \}/);
  assert.doesNotMatch(js,/class="related-section"|function renderRelated/);
  const code=js.slice(js.indexOf('function showRelated('),js.indexOf('function paintComments('));
  for(const key of ['studios','series','genres']) {
    const state={facetFilter:'',facetFilterValue:'',view:'',closed:0,opened:0,focused:0,$:()=>({close:()=>state.closed++,focus:()=>state.focused++}),resetFilters:()=>{},openLibraryPage:()=>state.opened++};
    vm.runInNewContext(code+';showRelated({dataset:{facet:'+JSON.stringify(key)+',facetValue:"标签甲"}})',state);
    assert.equal(state.facetFilter,key);assert.equal(state.facetFilterValue,'标签甲');assert.equal(state.opened,1);assert.equal(state.closed,2);assert.equal(state.focused,1);
  }
});

test('真实 HTTP 权限：目录/类别、影片图片/演员/评论/收藏/历史/网页播放/手机票据均不可越权', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cinema-access-'));
  const file=path.join(dir,'test.mp4'); await fs.writeFile(file,'0123456789abcdef');
  const dataDir=path.join(dir,'data');
  for(const name of ['covers','actors']) { await fs.mkdir(path.join(dataDir,name),{recursive:true}); await fs.writeFile(path.join(dataDir,name,'secret.jpg'),'image'); }
  let app=await createApp({dataDir,playerService:{list:async()=>({supported:true,players:[]}),open:async()=>({message:'test'})}});
  t.after(async()=>{await app.shutdown();await fs.rm(dir,{recursive:true,force:true});});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  let base='http://127.0.0.1:'+app.server.address().port;
  const req=(route,cookie='',data,method=data===undefined?'GET':'POST',extra={})=>fetch(base+route,{method,headers:{Cookie:cookie,'X-Cinema-Client':'local','Content-Type':'application/json',...extra},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const setup=await req('/api/auth/setup','',{username:'access-admin',password:'x'});
  const admin=setup.headers.get('set-cookie').split(';')[0];
  app.store.state.sources=[{id:'a',name:'家庭片库',type:'local',path:dir},{id:'b',name:'私人片库',type:'local',path:dir}];
  app.store.state.libraries=[{id:'collection',name:'自定义合集',sourceIds:['a','b'],revision:1}];
  app.store.state.movies=[
    {id:'family',sourceId:'a',genres:['动画'],cast:'家庭演员',studios:['家庭片商']},
    {id:'action',sourceId:'a',genres:['动作'],poster:'/media/covers/secret.jpg',actors:[{name:'隐藏演员',photo:'/media/actors/secret.jpg'}]},
    {id:'private',sourceId:'b',genres:['动画'],cast:'私人演员'},
    {id:'blank',sourceId:'a',genres:[]},
  ].map(m=>({...m,kind:'local',title:m.id,genreModel:2,filePath:file,posterFile:file,backdropFile:file,actorPhotoFiles:[{name:'家庭演员',filePath:file}],rootPath:dir}));
  const access={sourceIds:['a'],genres:['动画']};
  const created=await req('/api/admin/users',admin,{username:'access-viewer',password:'y',libraryAccess:access});
  assert.equal(created.status,201);const viewer=await created.json();
  const login=async()=>{const r=await req('/api/auth/login','',{username:'access-viewer',password:'y'});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
  let cookie=await login();
  app.store.state.profiles[viewer.id]={favorites:{},history:{family:{position:1},private:{position:2}}};
  let listing=await (await req('/api/library',cookie)).json();
  assert.deepEqual(listing.movies.map(m=>m.id),['family']);assert.deepEqual(listing.sources.map(s=>s.id),['a']);
  assert.equal(listing.sources[0].count,1);assert.equal(listing.sources[0].path,undefined);
  assert.deepEqual(Object.keys(listing.history),['family']);
  for(const id of ['action','private','blank']) {
    for(const route of ['/media/'+id+'/video','/media/'+id+'/poster','/media/'+id+'/backdrop','/media/'+id+'/actor?index=0','/api/movies/'+id+'/comments'])
      assert.equal((await req(route,cookie)).status,404,route);
    for(const suffix of ['favorite','progress','playback-ticket','open-external','comments'])
      assert.equal((await req('/api/movies/'+id+'/'+suffix,cookie,{})).status,404,suffix);
  }
  for(const route of ['/media/covers/secret.jpg','/media/actors/secret.jpg']) {
    assert.equal((await req(route,cookie)).status,404);
    assert.equal((await req(route,cookie,undefined,'HEAD')).status,404);
    assert.equal((await req(route,admin)).status,200);
  }
  assert.equal((await req('/media/family/video',cookie,undefined,'GET',{Range:'bytes=1-4'})).status,206);
  const ticket=await (await req('/api/movies/family/playback-ticket',cookie,{})).json();
  assert.equal((await fetch(ticket.url)).status,200);
  assert.equal((await req('/api/admin/users/'+viewer.id,cookie,{libraryAccess:{sourceIds:null,genres:null}})).status,403);
  await req('/api/preferences',cookie,{libraryAccess:{sourceIds:null,genres:null}});
  assert.equal((await (await req('/api/library',cookie)).json()).movies.length,1);
  const token=await (await req('/api/admin/tokens',admin,{scope:'write'})).json();
  assert.equal((await req('/api/admin/users/'+viewer.id,'',{libraryAccess:{sourceIds:null,genres:null}},'POST',{Authorization:'Bearer '+token.token})).status,403);
  const invalid=await req('/api/admin/users/'+viewer.id,admin,{libraryAccess:{sourceIds:'all',genres:null}});
  assert.equal(invalid.status,400);assert.deepEqual(app.store.state.users.find(u=>u.id===viewer.id).libraryAccess,libraryAccess(access));
  // Existing URL becomes unusable immediately for later requests; already downloaded bytes cannot be recalled.
  await req('/api/admin/users/'+viewer.id,admin,{libraryAccess:{sourceIds:[],genres:null}});
  assert.equal((await fetch(ticket.url,{headers:{Range:'bytes=0-1'}})).status,403);
  assert.equal((await req('/api/library',cookie)).status,401);cookie=await login();
  listing=await (await req('/api/library',cookie)).json();assert.equal(listing.movies.length,0);assert.equal(listing.sources.length,0);assert.equal(listing.isDemo,false);
  await req('/api/admin/users/'+viewer.id,admin,{libraryAccess:{sourceIds:['a','b'],genres:null}});cookie=await login();
  listing=await (await req('/api/library',cookie)).json();assert.equal(listing.movies.length,4);assert.equal(listing.sources.length,2);
  await app.store.save();await app.shutdown();app=await createApp({dataDir});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');base='http://127.0.0.1:'+app.server.address().port;
  assert.equal((await (await req('/api/library',cookie)).json()).movies.length,4);
});
