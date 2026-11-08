import test from 'node:test';
import assert from 'node:assert/strict';
import { upgradeGenres, setGenres, preserveGenres, genrePlan } from '../lib/genres.mjs';
import { facetValues, relatedMovies } from '../public/movie-utils.js';

test('旧片库升级：文件夹移出类别，保留手动类别与文件夹归档',()=>{
  const old={kind:'local',folderCategory:'家庭影院',genres:['家庭影院'],autoGenres:['家庭影院'],metadataGenres:['剧情']};
  upgradeGenres(old); assert.deepEqual(old.genres,['剧情']); assert.deepEqual(old.autoGenres,['剧情']); assert.equal(old.folderCategory,'家庭影院');
  const empty={kind:'local',folderCategory:'剧集',genres:['剧集']};upgradeGenres(empty);assert.deepEqual(empty.genres,[]);
  const manual={kind:'local',folderCategory:'归档',genres:['收藏'],manualGenres:['收藏'],metadataGenres:['剧情']};upgradeGenres(manual);assert.deepEqual(manual.genres,['收藏']);
  const cleared={kind:'local',folderCategory:'归档',genres:['归档'],manualGenres:[],metadataGenres:['剧情']};upgradeGenres(cleared);assert.deepEqual(cleared.genres,[]);
  const api={kind:'api',genres:['科幻']};upgradeGenres(api);assert.deepEqual(api.genres,['科幻']);
  const once=JSON.stringify(old);upgradeGenres(old);assert.equal(JSON.stringify(old),once);
});
test('手动类别允许清空且重扫不回填；相同文件夹不构成相同类别',()=>{
  const movie={id:'a',kind:'local',genres:['剧情'],metadataGenres:['剧情'],autoGenres:['剧情'],folderCategory:'家庭影院'};
  setGenres(movie,{genres:[],expectedGenres:['剧情']});assert.deepEqual(facetValues(movie,'genres'),[]);
  const scanned={...movie,genres:['剧情'],metadataGenres:['剧情']};preserveGenres(scanned,movie);assert.deepEqual(scanned.genres,[]);assert.deepEqual(scanned.manualGenres,[]);
  const b={id:'b',genres:['待看'],folderCategory:'家庭影院'},c={id:'c',genres:['收藏'],folderCategory:'其他目录'};
  setGenres(movie,{genres:['收藏']});assert.deepEqual(relatedMovies([movie,b,c],'genres','收藏','a').map(m=>m.id),['c']);
  const preview=genrePlan([movie],[{id:'a',genres:[],expectedGenres:['收藏']}]);assert.deepEqual(preview[0].change.after,[]);assert.equal(preview[0].change.manual,true);assert.deepEqual(movie.genres,['收藏']);
  setGenres(scanned,{reset:true});assert.deepEqual(scanned.genres,['剧情']);assert.equal(scanned.folderCategory,'家庭影院');
});
