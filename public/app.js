import { applyTheme, cachedTheme } from './theme.js';
import { DEFAULT_APPEARANCE, loadDeviceAppearance, saveDeviceAppearance } from './device-appearance.js?v=1.6.0-mobile';
import { mobileAvailable, mobileRequest } from './mobile.js?v=1.6.0-home';
import { libraryChoices, resolveLibrary, scopedMovies, scopeSourceIds } from './library-scope.js?v=1.6.0-custom-libraries';
import { isTelevision, selectedEpisode } from './episodes.js?v=1.6.0-episode-grid';
const appVersion = navigator.userAgent.match(/ScreenRoomAndroid\/(\d+)\.(\d+)/);
const androidApp = !!appVersion;
document.documentElement.classList.toggle('screenroom-android', androidApp);
import { sampleMovies, facetLabels, facetValues, durationStamp, actorIndex, fitMovieColumns, movieModifiedTime } from './movie-utils.js?v=1.6.0-portrait';
applyTheme(cachedTheme());
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const canConfigureConnection = () => !!appVersion && (Number(appVersion[1]) > 1 || Number(appVersion[1]) === 1 && Number(appVersion[2]) >= 2) && mobileAvailable();
function updateConnectionButtons() {
  $$('[data-action="mobile-connection-settings"]').forEach(button => { button.hidden = !canConfigureConnection(); });
}
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = {
  shuffle: '<path d="M3 5h3l12 14h3m-4-4 4 4-4 3M3 19h3l4-5m4-7 4-2h3m-4-3 4 3-4 4"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5Z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  heart: '<path d="M20.8 4.8a5.5 5.5 0 0 0-7.8 0L12 5.9l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.4a5.5 5.5 0 0 0 0-7.8Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sliders: '<path d="M4 7h7m4 0h5M4 17h3m4 0h9"/><circle cx="13" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M16 6.5h2M16 17.5h2M8 10v4m8-4v4"/>',
  settings: '<path d="m9 3-.5 2.2-2 .9L4.4 5.4 2.5 8.6l1.6 1.5v2.3l-1.6 1.5 1.9 3.2 2.1-.7 2 .9L9 20h4l.5-2.7 2-.9 2.1.7 1.9-3.2-1.6-1.5v-2.3l1.6-1.5-1.9-3.2-2.1.7-2-.9L13 3Z"/><circle cx="11" cy="11.5" r="3"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3"/>',
  sort: '<path d="M8 4v16m-4-4 4 4 4-4M14 5h6m-6 5h4m-4 5h2"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  plug: '<path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-6 6v4m0-4a6 6 0 0 1-6-6V8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  play: '<path d="m8 4 13 8-13 8Z" fill="currentColor" stroke="none"/>',
  star: '<path d="m12 2 3.1 6.3L22 9.4l-5 4.8 1.2 6.8L12 17.8l-6.2 3.2L7 14.2 2 9.4l6.9-1.1Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  film: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4m-4 8h4m10-8h4m-4 8h4"/>',
  spark: '<path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6ZM20 2v4m-2-2h4"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.film}</svg>`;
function icons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
icons();
let library = { movies: [], sources: [], history: {}, isDemo: true };
let view = 'all', genre = '', pageSize = 48, selectedMovie = null, currentMovie = null, routeReady = false;
let toastTimer, jobTimer, pollInFlight = false, progressAt = 0;
let currentUser = null, needsSetup = false, adminUsers = [];
let userPreferences = { ...DEFAULT_APPEARANCE, playback: 'browser', player: 'default' };
let heartbeatTimer = null, loginMonitorTimer = null, networkState = null, launchingExternal = false;
let shutdownRequested = false, launchingMobile = false;
let streamChangeVersion = 0;
let portraitUploading = false;
let activeLibrary = null;
const visibleMovies = () => scopedMovies(library, activeLibrary);
let facetFilter = '', facetFilterValue = '';
function libraryQuery() { return activeLibrary ? { library: activeLibrary } : {}; }
function libraryName() { return activeLibrary === 'all' ? '全部可见片库' : libraryChoices(library).find(s => s.id === activeLibrary)?.name || '选择影片库'; }
function renderLibraryChooser() {
  const choices = libraryChoices(library), picker = $('#library-picker');
  picker.hidden = !!activeLibrary;
  document.body.toggleAttribute('data-library-picker', !activeLibrary);
  $('#switch-library').hidden = choices.length < 2;
  $('#mobile-actors-toggle').hidden = !activeLibrary;
  $('#search').disabled = !activeLibrary;
  $('#library-picker-title').textContent = choices.length ? '选择影片库' : '暂无可访问的影片库';
  $('#library-picker-description').textContent = choices.length ? '选择这次想浏览的影片库，进入后可随时切换。' : isAdmin() ? '请在设置中的“影片库管理”创建库，再勾选要包含的来源。' : '请联系管理员分配影片库和可见类别。';
  $('#library-choices').innerHTML = choices.map(s => `<button class="library-choice" data-choose-library="${esc(s.id)}">${icon('folder')}<strong>${esc(s.name)}</strong><small>${s.count} 部可见影片</small><span>进入片库 →</span></button>`).join('')
    + (choices.length > 1 ? `<button class="library-choice library-choice-all" data-choose-library="all">${icon('grid')}<strong>全部可见片库</strong><small>${library.movies.length} 部影片</small><span>一起浏览 →</span></button>` : '');
  $('#picker-settings').hidden = !isAdmin();
}
function chooseLibrary(id) {
  if (!['all', ...libraryChoices(library).map(s => s.id)].includes(id)) return;
  $('#detail-dialog').close(); $('#player-dialog').close();
  resetFilters(); activeLibrary = id; routeReady = false; randomFingerprint = '';
  history.pushState(null, '', '/?' + new URLSearchParams({ library: id }));
  render(); window.scrollTo({ top: 0 });
}
function openLibraryChooser() {
  $('#detail-dialog').close(); $('#player-dialog').close();
  history.pushState(null, '', '/'); routeReady = false; resetFilters(); render();
  $('#library-picker-title').focus({ preventScroll: true }); window.scrollTo({ top: 0 });
}
let activeSettingsPanel = 'playback', randomSelection = [], randomFingerprint = '', isRandomPage = false, actorFilter = '', actorPageSize = 24, currentEpisodeId = '';
let actorDirectory = [];
const isAdmin = () => currentUser?.role === 'admin';
const effectivePreferences = () => ({
  playback: 'browser', player: 'default', ...library.preferences,
  ...loadDeviceAppearance(currentUser?.id, library.preferences),
});
const viewNames = { all: '全部影片', favorites: '我的收藏', history: '最近观看' };
async function api(url, data, method = 'POST') {
  let response;
  try { response = await fetch(url, data === undefined ? {} : { method, headers: { 'Content-Type': 'application/json', 'X-Cinema-Client': 'local' }, body: JSON.stringify(data) }); }
  catch { throw new Error('无法连接本地服务，请确认网站服务仍在运行。'); }
  const result = await response.json();
  if (response.status === 401 && !url.includes('/api/auth/')) { currentUser = null; showAuth(false); }
  if (!response.ok) throw new Error(result.error || '操作失败，请重试。');
  return result;
}
function toast(message) { clearTimeout(toastTimer); const notice = $('#toast'); ($$('dialog[open]').at(-1) || document.body).append(notice); notice.textContent = message; notice.hidden = false; toastTimer = setTimeout(() => { notice.hidden = true; }, 4200); }
function showDialog(id) { const dialog = $(`#${id}`); if (!dialog.open) dialog.showModal(); }
function safeImage(url) { return /^(\/assets\/|\/media\/|https?:\/\/)/i.test(url || '') ? url : ''; }
function image(movie, className = '') {
  return safeImage(movie.poster) ? `<img src="${esc(movie.poster)}" alt="${esc(movie.title)} 海报" class="${className}" loading="lazy">` : fallback(movie.title);
}
function fallback(title) { return `<div class="poster-fallback">${icon('film')}<strong>${esc(title)}</strong></div>`; }
document.addEventListener('error', event => {
  const el = event.target;
  if (el.tagName !== 'IMG') return;
  if (el.id === 'actor-profile-image') { el.hidden = true; return; }
  if (el.classList.contains('actor-image')) { el.replaceWith(document.createElement('span')); return; }
  const title = el.alt.replace(/ 海报$/, '');
  el.outerHTML = fallback(title);
}, true);
function dateLabel(iso) { return iso ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : '尚未同步'; }
async function load() {
  try {
    library = await api('/api/library'); $('#fatal-error').hidden = true; render(); startHeartbeat();
    if (/^\/admin\/?$/.test(location.pathname)) {
      if (isAdmin()) await openPreferences('sources');
      else { history.replaceState(null, '', '/'); applyPageRoute(true); toast('请使用管理员账号进入后台'); }
    }
    if (isAdmin() && library.job?.status === 'running') pollJob();
  } catch (error) { $('#fatal-error').hidden = false; toast(error.message); }
}
function genres() {
  const order = ['科幻', '剧情', '动画', '悬疑', '喜剧', '冒险', '奇幻'];
  return [...new Set(visibleMovies().flatMap(m => m.genres || []))].sort((a, b) => (order.includes(a) ? order.indexOf(a) : 100) - (order.includes(b) ? order.indexOf(b) : 100) || a.localeCompare(b, 'zh'));
}
function render() {
  activeLibrary = resolveLibrary(library, new URLSearchParams(location.search).get('library'));
  renderLibraryChooser();
  currentUser = library.user || currentUser;
  userPreferences = effectivePreferences();
  if (!$('#preferences-dialog').open) applyPreferences(userPreferences);
  document.body.dataset.role = currentUser?.role || '';
  $$('.admin-only').forEach(el => { el.hidden = !isAdmin(); });
  $('#profile-name').textContent = `${currentUser?.displayName || '我的账号'} · ${isAdmin() ? '管理员' : '普通用户'}`;
  $('.avatar').textContent = (currentUser?.displayName || 'M').slice(0, 1).toUpperCase();
  $('#total-count').textContent = visibleMovies().length;
  $('#favorite-count').textContent = visibleMovies().filter(m => m.favorite).length;
  $('#library-status').innerHTML = `<i></i>${esc(activeLibrary === 'all' ? '全部可见片库' : libraryChoices(library).find(s => s.id === activeLibrary)?.name || '请选择影片库')} · ${visibleMovies().length} 部影片`;
  const gs = genres();
  if (genre && !gs.includes(genre)) genre = '';
  $('#side-genres').innerHTML = gs.slice(0, 5).map((g, i) => `<button class="genre-nav ${genre === g ? 'active' : ''}" data-genre="${esc(g)}"><span>${icon(['spark', 'film', 'play', 'search', 'heart'][i])}${esc(g)}</span><span class="count">${visibleMovies().filter(m => m.genres?.includes(g)).length}</span></button>`).join('');
  $('#genre-tabs').innerHTML = ['', ...gs].map(g => `<button class="genre-tab ${g === genre ? 'active' : ''}" data-genre="${esc(g)}" aria-pressed="${g === genre}">${esc(g || '全部')}</button>`).join('');
  const oldYear = $('#year-filter').value, oldSource = $('#source-filter').value, oldFolder = $('#folder-filter').value;
  $('#year-filter').innerHTML = '<option value="">所有年份</option>' + [...new Set(visibleMovies().map(m => m.year).filter(Boolean))].sort((a, b) => b - a).map(y => `<option value="${y}">${y}</option>`).join('');
  $('#year-filter').value = oldYear;
  $('#source-filter').innerHTML = '<option value="">所有来源</option>' + library.sources.filter(s => scopeSourceIds(library, activeLibrary).includes(s.id)).map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  $('#source-filter').value = oldSource;
  $('#folder-filter').innerHTML = '<option value="">全部文件夹归档</option>' + [...new Set(visibleMovies().map(m => m.folderCategory).filter(Boolean))].sort((a,b) => a.localeCompare(b,'zh')).map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
  $('#folder-filter').value = oldFolder;
  actorDirectory = actorIndex(visibleMovies());
  updateConnectionButtons(); renderSources(); renderActors(); applyPageRoute();
  $('#connect-banner').hidden = library.sources.length > 0 || !isAdmin();
  $('#sync-button').classList.toggle('spin', library.job?.status === 'running');
}
function filteredMovies() {
  const search = $('#search').value.trim().toLocaleLowerCase();
  let result = visibleMovies().filter(m => (!genre || m.genres?.includes(genre)) && (!actorFilter || facetValues(m, 'cast').some(name => name.toLocaleLowerCase() === actorFilter.toLocaleLowerCase())) && (!facetFilter || facetValues(m, facetFilter).some(value => value.toLocaleLowerCase() === facetFilterValue.toLocaleLowerCase())) && (!$('#year-filter').value || String(m.year) === $('#year-filter').value) && (!$('#source-filter').value || m.sourceId === $('#source-filter').value) && (!$('#folder-filter').value || m.folderCategory === $('#folder-filter').value));
  if (view === 'favorites') result = result.filter(m => m.favorite);
  if (view === 'history') result = result.filter(m => library.history[m.id]);
  if (search) result = result.filter(m => [m.title, m.originalTitle, m.director, m.cast, ...facetValues(m, 'studios'), ...facetValues(m, 'series'), ...facetValues(m, 'genres')].join(' ').toLocaleLowerCase().includes(search));
  const sort = $('#sort').value;
  if (sort === 'rating') result.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  else if (sort === 'year') result.sort((a, b) => (b.year || 0) - (a.year || 0));
  else if (sort === 'title') result.sort((a, b) => a.title.localeCompare(b.title, 'zh'));
  else if (sort === 'modified' || sort === 'default' && view === 'all') result.sort((a,b) => movieModifiedTime(b)-movieModifiedTime(a) || a.title.localeCompare(b.title,'zh'));
  else if (view === 'history') result.sort((a, b) => library.history[b.id].updatedAt.localeCompare(library.history[a.id].updatedAt));
  return result;
}
function usesDirectCoverPlayback() { return true; }
function coverCanPlay(movie) { return usesDirectCoverPlayback() && movie.playable && !isTelevision(movie); }
function coverAction(movie) {
  const action = coverCanPlay(movie) ? 'play' : 'detail';
  const label = action === 'play' ? '播放 ' + movie.title : '查看 ' + movie.title + ' 详情';
  return 'data-' + action + '="' + esc(movie.id) + '" aria-label="' + esc(label) + '"';
}
function coverPlaybackMark(movie) {
  return coverCanPlay(movie) ? '<span class="detail-cover-play" aria-hidden="true">' + icon('play') + '</span>' : '';
}
function renderGrid() {
  const filtered = filteredMovies();
  $('#sort [value=default]').textContent = view === 'all' ? '默认（最近修改）' : '默认排序';
  const query = $('#search').value;
  const searching = !!query.trim();
  $('#actor-film-search-label').hidden = !(actorFilter || facetFilter);
  const searchHint = actorFilter ? '在这位演员的影片中搜索…' : '在此标签的影片中搜索…';
  $('#actor-film-search').placeholder = searchHint;
  $('#actor-film-search').setAttribute('aria-label', actorFilter ? '在该演员的影片中搜索' : '在该标签的影片中搜索');
  const actorSearch = $('#actor-film-search');
  if (actorSearch.value !== query) actorSearch.value = query;
  renderActorProfile();
  $('#breadcrumb-view').textContent = !activeLibrary ? '选择影片库' : isRandomPage ? libraryName() + ' / 九宫格' : actorFilter ? `演员：${actorFilter}` : facetFilter ? `${facetLabels[facetFilter]}：${facetFilterValue}` : viewNames[view];
  $$('.actor-item').forEach(el => el.classList.toggle('active', el.dataset.actor === actorFilter));
  $$('#main-nav .nav-item').forEach(el => {
    const active = isRandomPage ? el.dataset.action === 'home' : el.dataset.view === view;
    el.classList.toggle('active', active); el.setAttribute('aria-current', active ? 'page' : 'false');
  });
  $$('[data-genre]').forEach(el => { el.classList.toggle('active', el.dataset.genre === genre); if (el.classList.contains('genre-tab')) el.setAttribute('aria-pressed', el.dataset.genre === genre); });
  $('#section-title').textContent = actorFilter ? '参演影片' : facetFilter ? `${facetLabels[facetFilter]}：${facetFilterValue}` : searching ? '搜索结果' : viewNames[view];
  $('#result-count').textContent = `${filtered.length} 部影片`;
  $('#active-filter').hidden = !(actorFilter || facetFilter || genre || searching || $('#year-filter').value || $('#source-filter').value || $('#folder-filter').value);
  $('#active-filter').innerHTML = `正在筛选：${esc([actorFilter ? `演员：${actorFilter}` : '', searching ? `“${$('#search').value.trim()}”` : '', genre, $('#year-filter').value, $('#folder-filter').value ? `归档：${$('#folder-filter').value}` : '', library.sources.find(s => s.id === $('#source-filter').value)?.name].filter(Boolean).join(' / '))}<button data-action="reset-filters">清除筛选 ×</button>`;
  $('#movie-grid').innerHTML = filtered.slice(0, pageSize).map(m => {
    const h = library.history[m.id];
    return `<article class="movie-card"><button class="poster-button" ${coverAction(m)}>${image(m)}<span class="poster-overlay"></span>${durationOverlay(m)}${m.rating ? `<span class="rating-badge">${icon('star')}${Number(m.rating).toFixed(1)}</span>` : ''}<span class="source-badge">${m.kind === 'demo' ? '精选电影' : m.episodeCount ? `电视剧 · ${m.episodeCount} 集` : m.kind === 'local' ? `NAS / ${esc(m.extension)}` : 'API 片库'}</span>${coverCanPlay(m) ? coverPlaybackMark(m) : '<span class="poster-play" aria-hidden="true">' + icon('info') + '</span>'}${h?.duration ? `<span class="movie-progress" data-progress="${Math.min(100, h.position / h.duration * 100)}"></span>` : ''}</button><button class="favorite-button ${m.favorite ? 'is-favorite' : ''}" data-favorite="${esc(m.id)}" title="${m.favorite ? '移除收藏' : '收藏影片'}" aria-label="${m.favorite ? '移除收藏' : '收藏'} ${esc(m.title)}" aria-pressed="${m.favorite}">${icon('heart')}</button><button class="movie-title" data-detail="${esc(m.id)}">${esc(m.title)}</button><div class="movie-info"><span>${m.year || '未知年份'}</span><span>·</span><span class="genre-text">${esc(m.genres?.slice(0, 2).join(' / ') || '未分类')}</span></div></article>`;
  }).join('');
  $$('[data-progress]').forEach(el => { el.style.width = `${el.dataset.progress}%`; });
  $('#empty-state').hidden = filtered.length > 0;
  $('#empty-state').innerHTML = `${icon(view === 'favorites' ? 'heart' : view === 'history' ? 'clock' : 'search')}<h3>${view === 'favorites' ? '暂无收藏' : view === 'history' ? '暂无观看记录' : '没有符合条件的影片'}</h3><p>${view === 'favorites' ? '点击影片的收藏按钮可添加。' : view === 'history' ? '开始播放后会记录观看进度。' : library.movies.length ? '可修改搜索词或清除筛选。' : (isAdmin() ? '请添加本地文件夹、NAS 或 API 来源。' : '此片库没有可见影片，请联系管理员。')}</p><button class="button secondary" data-action="${visibleMovies().length || !isAdmin() ? 'reset-filters' : 'settings'}">${visibleMovies().length || !isAdmin() ? '浏览全部影片' : '添加片库'}</button>`;
  $('#load-more').hidden = filtered.length <= pageSize;
  if (isRandomPage) drawRandom(false);
}
function openRandom() { setMobileActorPanel(false); const url = randomUrl(); if (location.pathname === '/random') drawRandom(true); else { history.pushState(null,'',url); applyPageRoute(true); } }
function openHome() {
  setMobileActorPanel(false);
  history.pushState(null, '', '/' + (activeLibrary ? '?' + new URLSearchParams(libraryQuery()) : ''));
  randomFingerprint = '';
  applyPageRoute(true);
}
function drawRandom(force = true) {
  $('#random-click-hint').textContent = usesDirectCoverPlayback()
    ? '打开或刷新首页自动抽取。电影点封面播放，电视剧点封面选集；片名查看详情。'
    : '打开或刷新首页自动抽取。点影片查看详情，按播放才会开始播放。';
  const pool = filteredMovies(), fingerprint = JSON.stringify([randomUrl(),pool.map(m=>m.id)]);
  if (force || fingerprint !== randomFingerprint) randomSelection = sampleMovies(pool,9);
  else randomSelection = randomSelection.map(m=>visibleMovies().find(item=>item.id===m.id)).filter(Boolean);
  randomFingerprint = fingerprint;
  if (/^\/random\/?$/.test(location.pathname)) history.replaceState(null,'',randomUrl());
  $('#random-context').textContent = `${libraryName()} · ${viewNames[view]} / ${actorFilter ? `演员：${actorFilter}` : genre || '全部类别'} · 当前筛选 ${pool.length} 部候选 · 本次抽出 ${randomSelection.length} 部，不重复`;
  $('#random-grid').innerHTML = Array.from({ length: 9 }, (_, index) => {
    const movie = randomSelection[index];
    return movie ? `<article class="random-card"><button class="random-poster poster-direct" ${coverAction(movie)}>${image(movie)}${durationOverlay(movie)}${coverPlaybackMark(movie)}</button><button class="random-copy" data-detail="${esc(movie.id)}" aria-label="查看 ${esc(movie.title)} 的详情与选集"><span class="random-number">0${index + 1}</span><strong>${esc(movie.title)}</strong><small>${movie.year || '未知年份'}${movie.rating ? ` · ★ ${Number(movie.rating).toFixed(1)}` : ''}</small><small>${esc(movie.genres.slice(0, 2).join(' / '))}</small></button></article>` : `<div class="random-slot-empty">${icon('film')}<span>${pool.length ? '候选不足 9 部' : '当前筛选没有影片'}</span></div>`;
  }).join('');
  $('#random-reroll').disabled = !pool.length;
}
$('#random-reroll').addEventListener('click', () => drawRandom(true));
function resetFilters() { genre = ''; actorFilter = ''; facetFilter = ''; facetFilterValue = ''; $('#search').value = ''; $('#year-filter').value = ''; $('#source-filter').value = ''; $('#folder-filter').value = ''; pageSize = 48; }
function openDetail(id) {
  selectedMovie = visibleMovies().find(m => m.id === id); if (!selectedMovie) return;
  const m = selectedMovie, source = library.sources.find(s => s.id === m.sourceId);
  $('#detail-content').innerHTML = `<div class="detail-art" id="detail-art"><button class="icon-button" data-close="detail-dialog" aria-label="关闭影片详情">${icon('close')}</button></div><div class="detail-main"><div><div class="detail-poster"><button class="detail-poster-play" data-play="${esc(m.id)}" aria-label="播放 ${esc(m.title)}">${image(m)}${m.playable ? `<span class="detail-cover-play" aria-hidden="true">${icon('play')}</span>` : ''}</button></div><p class="detail-note">${esc(source?.name || '本地示例片库')}${m.kind === 'demo' ? '<br>仅供资料展示 · 不含正片' : ''}</p></div><div class="detail-info"><h2>${esc(m.title)}</h2>${m.episodeCount ? `<p class="tv-label">电视剧 · 共 ${m.episodeCount} 集</p>` : ''}<div class="detail-original">${esc(m.originalTitle)}</div><div class="movie-meta">${m.rating ? `<span class="rating-inline">${icon('star')}${Number(m.rating).toFixed(1)}</span><span>·</span>` : ''}<span>${m.year || '年份待补全'}</span>${m.duration ? `<span>·</span><span>${esc(m.duration)}</span>` : ''}${m.extension ? `<span>·</span><span>${esc(m.extension)}</span>` : ''}</div>${renderFactRows(m)}${renderGenreEditor(m)}${episodePicker(m)}<p class="detail-overview">${esc(m.overview || '暂无剧情简介，可通过 NFO 或 API 补全影片资料。')}</p><div class="detail-credit">${m.metadataGenres?.length ? `<div><strong>电影类型</strong>${esc(m.metadataGenres.join(' / '))}</div>` : ''}${m.director ? `<div><strong>导演</strong>${esc(m.director)}</div>` : ''}${m.folderCategory ? `<div><strong>文件夹归档</strong>${esc(m.folderCategory)}</div>` : ''}${m.fileName ? `<div><strong>文件</strong>${esc(m.fileName)}</div>` : ''}</div><div class="detail-actions">${m.playable ? `<button class="button primary" data-play="${esc(m.id)}">${icon('play')} 播放</button>` : `<button class="button primary" data-action="settings">${icon('folder')} 连接自己的片库</button>`}<button class="button secondary" data-favorite="${esc(m.id)}">${icon(m.favorite ? 'check' : 'heart')}${m.favorite ? '已收藏' : '加入收藏'}</button>${m.kind === 'local' && m.mediaType !== 'tv' && isAdmin() ? `<button class="text-button" data-match="${esc(m.id)}">${icon('spark')}匹配资料</button>` : ''}</div>${m.kind === 'demo' ? '<p class="detail-note">这是示例电影资料。连接 NAS 后，可播放你自己有权使用的视频文件。</p>' : !m.playable ? '<p class="detail-note">该接口只提供电影资料，没有可播放的视频地址。</p>' : m.kind === 'local' ? '<p class="detail-note">自动采用设置中的播放器。切换播放器请到左下角设置；网页模式不含转码。</p>' : ''}<div id="match-results" class="match-results" hidden></div></div></div>`;
  const bg = safeImage(m.backdrop || m.poster); $('#detail-dialog').classList.toggle('has-no-art', !bg); if (bg) $('#detail-art').style.backgroundImage = `url(${JSON.stringify(bg)})`;
  $('#detail-content').insertAdjacentHTML('beforeend', movieDiscussion(m, false));
  showDialog('detail-dialog'); $('#detail-dialog').scrollTop = 0; loadComments(m.id);
}
async function favorite(id) {
  const movie = visibleMovies().find(m => m.id === id); if (!movie) return;
  try {
    const result = await api(`/api/movies/${id}/favorite`, { favorite: !movie.favorite }); movie.favorite = result.favorite;
    render(); if ($('#detail-dialog').open && selectedMovie?.id === id) openDetail(id);
    toast(movie.favorite ? '已加入你的电影收藏' : '已移出收藏');
  } catch (error) { toast(error.message); }
}
async function openSettings(tab = 'nas') { if (!isAdmin() && tab !== 'guide') { toast('请联系管理员配置片库来源'); return; } $('#settings-error').hidden = true; await openPreferences(tab === 'guide' ? 'about' : 'sources'); if (tab !== 'guide') selectTab(tab); renderSources(); }
function selectTab(tab) {
  $$('.settings-tabs [data-tab]').forEach(el => { const active = el.dataset.tab === tab; el.classList.toggle('active', active); el.setAttribute('aria-selected', active); el.tabIndex = active ? 0 : -1; });
  ['nas', 'api'].forEach(key => { $(`#panel-${key}`).hidden = key !== tab; });
}
$('.settings-tabs').addEventListener('keydown', event => { if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const tabs = $$('[data-tab]'); let i = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true'); i = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (i + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; selectTab(tabs[i].dataset.tab); tabs[i].focus(); });
function renderSources() {
  $('#source-count').textContent = `${library.sources.length} / 10`;
  $('#sources-list').innerHTML = library.sources.length ? library.sources.map(s => `<div class="source-item"><span data-icon="${s.type === 'local' ? 'server' : 'plug'}"></span><div class="source-description"><strong>${esc(s.name)}</strong><small>${esc(s.type === 'local' ? s.path : s.provider === 'tmdb' ? 'TMDB 资料服务 · 令牌已' + (s.hasToken ? '配置' : '留空') : s.url)}</small><small>${s.count} 部影片 · ${esc(dateLabel(s.lastSync))}</small>${s.lastError ? `<small class="source-error">${esc(s.lastError)}</small>` : ''}</div><div class="source-buttons"><button class="icon-button" data-edit-source="${esc(s.id)}" aria-label="编辑 ${esc(s.name)}" title="编辑">${icon('edit')}</button><button class="icon-button" data-sync-source="${esc(s.id)}" aria-label="同步 ${esc(s.name)}" title="扫描或同步">${icon('refresh')}</button><button class="icon-button" data-delete-source="${esc(s.id)}" aria-label="移除 ${esc(s.name)}" title="移除来源">${icon('trash')}</button></div></div>`).join('') : '<p class="sources-empty">还没有连接来源。添加文件夹后，即可开始构建你的私人电影库。</p>';
  icons($('#sources-list'));
}
function providerChanged() {
  const tmdb = $('#api-provider').value === 'tmdb';
  $('#api-url-label').hidden = tmdb; $('#api-form [name=url]').required = !tmdb;
  $('#token-label').textContent = tmdb ? 'TMDB API Read Access Token（必填）' : 'Bearer Token（可选）';
  $('#api-notice p').textContent = tmdb ? '仅保存可用于 NAS 影片的资料匹配；保存并同步会导入 TMDB 热门电影资料。TMDB 不提供电影正片。请使用 Read Access Token，而非 v3 API Key。' : '支持 title / poster / genres / year 等字段，或 vod_name / vod_pic 等兼容字段。API 电影资料本身不包含影片播放权。';
}
$('#api-provider').addEventListener('change', providerChanged);
function nasMoveSource(form) {
  const existing = library.sources.find(s => s.type === 'local' && s.id === form.elements.id.value);
  return existing && form.elements.path.value.trim() !== existing.path ? existing : null;
}
function updateNasSave() {
  const form = $('#nas-form'), moving = !!nasMoveSource(form);
  $('#nas-save').textContent = moving ? '迁移目录（保留资料）' : '仅保存';
  form.querySelector('[name=scan]').hidden = moving;
}
$('#nas-form [name=path]').addEventListener('input', updateNasSave);
function resetForm(form) { form.reset(); form.elements.id.value = ''; form.querySelector('.cancel-edit').hidden = true; if (form.id === 'api-form') providerChanged(); else updateNasSave(); }
function editSource(id) {
  const source = library.sources.find(s => s.id === id); if (!source) return;
  const form = $(source.type === 'local' ? '#nas-form' : '#api-form'); resetForm(form); selectTab(source.type === 'local' ? 'nas' : 'api');
  for (const key of ['id', 'name', 'path', 'category', 'url', 'provider', 'pages']) if (form.elements[key]) form.elements[key].value = source[key] || (key === 'pages' ? '1' : '');
  form.querySelector('.cancel-edit').hidden = false; if (source.type !== 'local') providerChanged(); else updateNasSave();
  $('#settings-scroll').scrollTop = 0; form.querySelector('input:not([type=hidden])').focus();
}
for (const form of [$('#nas-form'), $('#api-form')]) form.addEventListener('submit', async event => {
  event.preventDefault(); $('#settings-error').hidden = true;
  const shouldScan = event.submitter?.name === 'scan';
  const data = Object.fromEntries(new FormData(form)); data.type = form.getAttribute('id') === 'nas-form' ? 'local' : 'api'; data.clearToken = !!form.elements.clearToken?.checked;
  const moving = data.type === 'local' && nasMoveSource(form);
  if (moving && !confirm('请确认同一批视频和配套图片已放到新目录，并保留原子目录及文件名。网站只核对并更新路径，不移动文件。确定迁移？')) return;
  const buttons = [...form.querySelectorAll('button[type=submit]')]; buttons.forEach(b => { b.disabled = true; });
  try {
    const result = moving ? await api(`/api/admin/sources/${encodeURIComponent(moving.id)}/relocate`, { ...data, confirm: true }) : await api('/api/sources', data);
    resetForm(form);
    library = await api('/api/library'); render();
    if (moving) toast(`目录已迁移，保留 ${result.moved} 部影片的资料。`);
    else if (shouldScan) await beginSync(result.id); else toast('来源已保存，点击同步按钮即可导入');
  } catch (error) { $('#settings-error').textContent = error.message; $('#settings-error').hidden = false; }
  finally { buttons.forEach(b => { b.disabled = false; }); }
});
async function beginSync(sourceId) {
  if (!library.sources.length) { openSettings(); return; }
  try { const job = await api('/api/sync', sourceId ? { sourceId } : {}); renderJob(job); $('#sync-button').classList.add('spin'); toast('已开始扫描，可继续浏览片库'); pollJob(); }
  catch (error) { toast(error.message); }
}
function renderJob(job) {
  const panel = $('#job-panel'); panel.hidden = job.status === 'idle';
  panel.innerHTML = `<strong>${esc(job.message)}</strong>${job.status === 'running' ? `<p>已找到 ${job.found} 部影片 · 已检查 ${job.folders} 个文件夹</p><div class="job-anim"></div>` : ''}${(job.warnings || []).map(w => `<p>${esc(w)}</p>`).join('')}`;
}
async function pollJob() {
  clearTimeout(jobTimer); if (pollInFlight) return; pollInFlight = true;
  try {
    const job = await api('/api/job'); renderJob(job);
    if (job.status === 'running') jobTimer = setTimeout(pollJob, 1000);
    else if (job.status === 'done' || job.status === 'error') { $('#sync-button').classList.remove('spin'); library = await api('/api/library'); render(); toast(job.message); }
  } catch (error) { $('#sync-button').classList.remove('spin'); toast(error.message); }
  finally { pollInFlight = false; }
}
async function matchMovie(id, query = '') {
  const el = $('#match-results'); el.hidden = false;
  const title = query || visibleMovies().find(m => m.id === id)?.title || '';
  el.innerHTML = `<form id="metadata-search" data-movie-id="${esc(id)}"><label class="sr-only" for="metadata-query">用于匹配的电影名称</label><input id="metadata-query" name="query" value="${esc(title)}" maxlength="200" placeholder="输入准确片名，可中英文搜索" required><button class="button secondary" type="submit">搜索资料</button></form><div id="match-candidates">正在搜索电影资料…</div>`;
  try {
    const { results } = await api(`/api/movies/${id}/match`, { query: title });
    if (!$('#match-candidates')) return;
    $('#match-candidates').innerHTML = `<h3>确认影片后再导入，避免匹配错误</h3>${results.length ? results.map(m => `<button class="match-choice" data-enrich="${esc(m.id)}" data-movie-id="${esc(id)}">${m.poster ? `<img src="${esc(m.poster)}" alt="${esc(m.title)} 海报">` : ''}<span><strong>${esc(m.title)} · ${esc(m.year || '未知年份')}</strong><p>${esc(m.overview || '暂无简介')}</p></span></button>`).join('') : '<p class="detail-note">没有找到匹配影片，请尝试更准确的中英文片名，或使用 NFO 文件。</p>'}`;
  } catch (error) { if ($('#match-candidates')) $('#match-candidates').innerHTML = `<p class="inline-error">${esc(error.message)}</p>`; }
}
document.addEventListener('submit', event => { if (event.target.id === 'metadata-search') { event.preventDefault(); matchMovie(event.target.dataset.movieId, new FormData(event.target).get('query')); } });
async function enrich(id, tmdbId, button) {
  button.disabled = true;
  try { const m = await api(`/api/movies/${id}/enrich`, { tmdbId }); const i = library.movies.findIndex(item => item.id === id); if (i >= 0) library.movies[i] = m; render(); openDetail(id); toast('电影资料已补全，本地视频文件未改动'); }
  catch (error) { toast(error.message); } finally { button.disabled = false; }
}
async function updateGenres(id, data, form) {
  const errorPanel = form?.querySelector('[data-genre-error]'); if (errorPanel) errorPanel.hidden = true;
  const buttons = form ? [...form.querySelectorAll('button')] : []; buttons.forEach(b => { b.disabled = true; });
  try {
    const movie = await api(`/api/movies/${id}/genres`, data);
    const i = library.movies.findIndex(m => m.id === id); if (i >= 0) library.movies[i] = movie;
    render();
    if ($('#detail-dialog').open && selectedMovie?.id === id) openDetail(id);
    if (currentMovie?.id === id) { currentMovie = movie; $('#player-extras').innerHTML = movieDiscussion(movie, true); loadComments(id); }
    toast(data.reset ? '已恢复资料类别，不使用文件夹名称' : '影片类别已保存，与文件夹归档无关');
  } catch (error) { if (errorPanel) { errorPanel.textContent = error.message; errorPanel.hidden = false; } else toast(error.message); }
  finally { buttons.forEach(b => { b.disabled = false; }); }
}
document.addEventListener('submit', event => {
  if (!event.target.dataset.genresForm) return;
  event.preventDefault();
  const genres = String(new FormData(event.target).get('genres')).split(/[,，、/|\n]+/).map(g => g.trim()).filter(Boolean);
  updateGenres(event.target.dataset.genresForm, { genres }, event.target);
});
async function launchPreferredPlayer(id, episodeId = '') {
  if (library.canLaunchLocalPlayer === false) { toast('局域网设备请使用网页播放，不能启动服务器电脑上的播放器'); return; }
  if (launchingExternal) return;
  launchingExternal = true;
  try {
    await api(`/api/movies/${id}/open-external`, { player: userPreferences.player, ...(episodeId ? {episodeId} : {}), streamIndex: currentMovie?.id === id ? Number($('#stream-select').value || 0) : 0 });
    if ($('#player-dialog').open) { $('#video').pause(); $('#player-dialog').close(); }
  } catch (error) { toast(error.message); await openPreferences(); }
  finally { launchingExternal = false; }
}
async function play(id) {
  const requested = $('#detail-dialog').open && $('#detail-episode')?.dataset.movieId === id ? $('#detail-episode').dataset.episodeId : library.history[id]?.episodeId || '';
  const movie = visibleMovies().find(m => m.id === id);
  if (!movie?.playable) { toast('这部影片暂时没有可播放的视频来源，可在详情中查看资料。'); return; }
  if (mobileAvailable()) {
    if (launchingMobile) return;
    launchingMobile = true;
    try {
      if (await mobileRequest('getPlayback') === 'external') {
        let address, mime;
        if (movie.kind === 'local') {
          const episodeId = movie.episodes?.find(e => e.id === requested)?.id || movie.episodes?.[0]?.id || '';
          const ticket = await api('/api/movies/' + encodeURIComponent(id) + '/playback-ticket', { ...(episodeId ? { episodeId } : {}) });
          address = ticket.url;
          mime = ticket.mime;
        } else address = playbackStreams(movie)[0]?.url;
        if (!address) throw new Error('没有可播放的视频地址。');
        await mobileRequest('openVideo', { url: address, ...(mime ? { mime } : {}) });
        if ($('#player-dialog').open) { $('#video').pause(); $('#player-dialog').close(); }
        if ($('#detail-dialog').open) $('#detail-dialog').close();
        return;
      }
    } catch (error) { toast(error.message || '无法打开手机播放器，请检查 App 设置。'); return; }
    finally { launchingMobile = false; }
  } else if (!androidApp && userPreferences.playback === 'external' && library.canLaunchLocalPlayer !== false) { await launchPreferredPlayer(id, requested); return; }
  if (currentMovie && currentMovie.id !== id) await saveProgress();
  ++streamChangeVersion;
  currentMovie = movie; currentEpisodeId = movie.episodes?.find(e=>e.id===requested)?.id || movie.episodes?.[0]?.id || ''; progressAt = 0;
  $('#player-extras').innerHTML = movieDiscussion(movie, true); loadComments(movie.id);
  const video = $('#video'); $('#player-title').textContent = movie.title; $('#player-error').hidden = true;
  const streams = playbackStreams(movie), index = Math.max(0,streams.findIndex(s=>s.episodeId===currentEpisodeId));
  if (movie.episodeCount) $('#player-title').textContent = `${movie.title} · ${streams[index].name}`;
  $('#stream-select').innerHTML = streams.map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join(''); $('#stream-select').hidden = streams.length < 2; $('#stream-select').value = String(index); $('#stream-select').setAttribute('aria-label', movie.episodeCount ? '选择集数' : '选择播放线路');
  // Keep the internal selector for older Android fold controls; TV users see only the numbered grid.
  $('#stream-select').toggleAttribute('data-episodes-only', isTelevision(movie));
  $('#stream-select').setAttribute('aria-hidden', String(isTelevision(movie)));
  renderPlayerEpisodes(movie, currentEpisodeId);
  $('#copy-file').hidden = movie.kind !== 'local' || !isAdmin();
  $('#player-note').textContent = `${movie.kind === 'local' ? '正在读取 NAS / 本地文件。' : '正在播放 API 提供的视频地址。'}不转码；如无画面或声音，请检查视频编码或改用外部播放器。`;
  video.src = streams[index].url; video.load();
  if ($('#detail-dialog').open) $('#detail-dialog').close();

  showDialog('player-dialog'); $('#player-dialog').scrollTop = 0;
  try { await video.play(); } catch (error) { if (error.name === 'NotAllowedError') toast('请点视频画面中的播放键。'); }
}
$('#stream-select').addEventListener('change', async () => {
  if (!currentMovie) return;
  const movie = currentMovie, index = Number($('#stream-select').value), version = ++streamChangeVersion;
  await saveProgress();
  if (currentMovie !== movie || version !== streamChangeVersion) return;
  const stream = playbackStreams(movie)[index]; if (!stream) return;
  currentEpisodeId = stream.episodeId || '';
  if (movie.episodeCount) $('#player-title').textContent = `${movie.title} · ${stream.name}`;
  renderPlayerEpisodes(movie, currentEpisodeId);
  $('#video').src = stream.url; $('#player-error').hidden = true; $('#video').load(); $('#video').play().catch(()=>{});
});
$('#video').addEventListener('loadedmetadata', () => { const h = library.history[currentMovie?.id]; if ((!currentEpisodeId || h?.episodeId === currentEpisodeId) && h?.position > 5 && h.position < $('#video').duration - 15) $('#video').currentTime = h.position; });
$('#video').addEventListener('error', () => { if (!currentMovie || !$('#video').getAttribute('src')) return; $('#player-error').textContent = '无法在浏览器中播放该视频。可能是 NAS 断开、网络地址失效或视频/音频编码不兼容。本版不含转码：可复制原文件路径，在 VLC / PotPlayer 中打开。'; $('#player-error').hidden = false; });
async function saveProgress() {
  if (!currentMovie || !Number.isFinite($('#video').duration) || $('#video').currentTime < 1) return;
  const data = { position: $('#video').currentTime, duration: $('#video').duration, ...(currentEpisodeId ? {episodeId:currentEpisodeId} : {}) };
  library.history[currentMovie.id] = { ...data, updatedAt: new Date().toISOString() };
  try { await api(`/api/movies/${currentMovie.id}/progress`, data); } catch { /* 暂时断网不打断播放。 */ }
}
$('#video').addEventListener('timeupdate', () => { if (Date.now() - progressAt > 10000) { progressAt = Date.now(); saveProgress(); } });
$('#player-dialog').addEventListener('close', () => { saveProgress(); $('#video').pause(); $('#video').removeAttribute('src'); $('#video').load(); currentMovie = null; currentEpisodeId = ''; renderGrid(); });
$('#copy-file').addEventListener('click', async () => {
  if (!currentMovie) return;
  try { const result = await api(`/api/movies/${currentMovie.id}/file`, {episodeId:currentEpisodeId || undefined}); await navigator.clipboard.writeText(result.path); toast('已复制原文件路径，可粘贴到 VLC / PotPlayer 中打开'); }
  catch (error) { toast(error.message || '无法复制，请在 NAS 文件夹中打开原视频。'); }
});
document.addEventListener('click', async event => {
  const el = event.target.closest('button'); if (!el) return;
  if (el.dataset.chooseLibrary) { chooseLibrary(el.dataset.chooseLibrary); return; }
  if (el.dataset.action === 'choose-library') { openLibraryChooser(); return; }
  if (el.dataset.action === 'manage-libraries') { await openPreferences('libraries'); return; }
  if (el.dataset.close) { $(`#${el.dataset.close}`).close(); return; }
  if (el.dataset.detailEpisode) {
    const picker = el.closest('#detail-episode');
    picker.dataset.episodeId = el.dataset.detailEpisode;
    picker.querySelectorAll('[data-detail-episode]').forEach(button => { const selected = button === el; button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected)); });
    picker.querySelector('[data-episode-label]').textContent = el.getAttribute('aria-label');
    return;
  }
  if (el.hasAttribute('data-player-episode')) {
    $('#stream-select').value = el.dataset.playerEpisode; $('#stream-select').dispatchEvent(new Event('change', { bubbles: true })); return;
  }
  if (el.dataset.view) { view = el.dataset.view; resetFilters(); openLibraryPage(); return; }
  if (el.hasAttribute('data-genre')) { genre = el.dataset.genre; pageSize = 48; renderGrid(); return; }
  if (el.dataset.detail) { openDetail(el.dataset.detail); return; }
  if (el.dataset.favorite) { await favorite(el.dataset.favorite); return; }
  if (el.dataset.tab) { selectTab(el.dataset.tab); return; }
  if (el.dataset.editSource) { editSource(el.dataset.editSource); return; }
  if (el.dataset.syncSource) { await beginSync(el.dataset.syncSource); return; }
  if (el.dataset.deleteSource) {
    const s = library.sources.find(s => s.id === el.dataset.deleteSource);
    if (!confirm(`移除「${s?.name}」及其片库索引？\n不会删除 NAS / 本地原文件。`)) return;
    try { await api(`/api/sources/${el.dataset.deleteSource}`, {}, 'DELETE'); library = await api('/api/library'); render(); toast('来源已移除，原始文件未改动'); } catch (error) { toast(error.message); } return;
  }
  if (el.classList.contains('cancel-edit')) { resetForm(el.closest('form')); return; }
  if (el.dataset.play) { await play(el.dataset.play); return; }
  if (el.dataset.action === 'mobile-player-settings') { try { await mobileRequest('settings'); } catch (error) { toast(error.message); } return; }
  if (el.dataset.action === 'mobile-connection-settings' && canConfigureConnection()) {
    try { await mobileRequest('connectionSettings'); } catch (error) { toast(error.message); }
    return;
  }
  if (el.dataset.editGenres) { const form = el.closest('.genre-editor-wrap').querySelector('form'); form.hidden = !form.hidden; if (!form.hidden) form.querySelector('input').focus(); return; }
  if (el.dataset.resetGenres) { await updateGenres(el.dataset.resetGenres, { reset: true }, el.closest('form')); return; }
  if (el.dataset.match) { await matchMovie(el.dataset.match); return; }
  if (el.dataset.enrich) { await enrich(el.dataset.movieId, el.dataset.enrich, el); return; }
  if (el.dataset.action === 'settings') openSettings();
  if (el.dataset.action === 'preferences') await openPreferences();
  if (el.dataset.action === 'about') openSettings('guide');
  if (el.dataset.action === 'sync') await beginSync();
  if (el.dataset.action === 'admin') await openAdmin();
  if (el.dataset.action === 'account') await openPreferences('account');
  if (el.dataset.settingPanel) { await selectSettingsPanel(el.dataset.settingPanel); return; }
  if (el.dataset.action === 'random') openRandom();
  if (el.dataset.action === 'home') openHome();
  if (el.dataset.actor) { openActorPage(el.dataset.actor); return; }
  if (el.dataset.action === 'reset-filters') { resetFilters(); view = 'all'; if (isRandomPage) renderGrid(); else openLibraryPage(); }
});
$('#search').addEventListener('input', () => { pageSize = 48; renderGrid(); });
$('#actor-film-search').addEventListener('input', event => {
  $('#search').value = event.target.value;
  pageSize = 48;
  renderGrid();
});
for (const selector of ['#year-filter', '#source-filter', '#folder-filter', '#sort']) $(selector).addEventListener('change', () => { pageSize = 48; renderGrid(); });
$('#load-more').addEventListener('click', () => { pageSize += 48; renderGrid(); });
$('#retry').addEventListener('click', load);
document.addEventListener('keydown', event => { if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !document.querySelector('dialog[open]')) { event.preventDefault(); $('#search').focus(); } });
for (const dialog of $$('dialog')) dialog.addEventListener('click', event => { if (event.target !== dialog) return; const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); });
function showAuth(setup) {
  setMobileActorPanel(false);
  updateConnectionButtons();
  needsSetup = setup; clearTimeout(jobTimer); clearInterval(heartbeatTimer); clearInterval(loginMonitorTimer);
  $$('dialog[open]').forEach(d => d.close());
  $('#fatal-error').hidden = true; $('#auth-screen').hidden = false; document.body.classList.add('signed-out');
  $('#auth-title').textContent = setup ? '创建管理员' : '登录';
  $('#auth-subtitle').textContent = setup ? '首次使用需要创建管理员账号。' : '';
  $('#auth-subtitle').hidden = !setup;
  $('#auth-submit').innerHTML = `${setup ? '创建管理员并进入' : '登录'} ${icon('arrow')}`;
  $('#auth-display-label').hidden = !setup; $('#auth-confirm-label').hidden = !setup;
  $('#auth-form [name=confirmPassword]').required = setup;
  $('#auth-form [name=password]').removeAttribute('minlength');
  $('#auth-form [name=password]').removeAttribute('maxlength');
  $('#auth-form [name=password]').autocomplete = setup ? 'new-password' : 'current-password';
  $('#auth-form [name=password]').placeholder = setup ? '设置密码（不限长度，不能为空）' : '输入你的密码';
  $('#auth-help').textContent = setup ? '账号和片库资料只保存在本机。请记住管理员密码。' : '没有账号？请联系你的影院管理员。';
}
async function initAuth() {
  try {
    const result = await api('/api/auth/me');
    if (!result.user) showAuth(result.needsSetup);
    else { currentUser = result.user; $('#auth-screen').hidden = true; document.body.classList.remove('signed-out'); await load(); }
  } catch (error) { showAuth(false); $('#auth-error').textContent = error.message; $('#auth-error').hidden = false; }
}
$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#auth-error').hidden = true;
  const data = Object.fromEntries(new FormData(event.target)); data.remember = event.target.elements.remember.checked;
  if (needsSetup && data.password !== data.confirmPassword) { $('#auth-error').textContent = '两次输入的密码不一致。'; $('#auth-error').hidden = false; return; }
  $('#auth-submit').disabled = true;
  try { const result = await api(`/api/auth/${needsSetup ? 'setup' : 'login'}`, data); currentUser = result.user; event.target.reset(); $('#auth-screen').hidden = true; document.body.classList.remove('signed-out'); resetFilters(); routeReady = false; await load(); }
  catch (error) { $('#auth-error').textContent = error.message; $('#auth-error').hidden = false; }
  finally { $('#auth-submit').disabled = false; }
});
$('#logout').addEventListener('click', async () => { try { await api('/api/auth/logout', {}); currentUser = null; library = { movies: [], sources: [], history: {}, isDemo: true }; $('#movie-grid').innerHTML = ''; showAuth(false); } catch (error) { toast(error.message); } });
$('#password-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#password-error').hidden = true;
  try { await api('/api/auth/password', Object.fromEntries(new FormData(event.target))); event.target.reset(); currentUser = null; showAuth(false); toast('密码已修改，请重新登录'); }
  catch (error) { $('#password-error').textContent = error.message; $('#password-error').hidden = false; }
});
function adminError(error) { $('#admin-error').textContent = error.message; $('#admin-error').hidden = false; }
async function openAdmin(panel = 'users') { if (isAdmin()) await openPreferences(panel); }
async function refreshUsers() {
  const result = await api('/api/admin/users'); adminUsers = result.users;
  if (!$('#user-form').elements.id.value) paintUserAccess();
  $('#users-list').innerHTML = adminUsers.map(u => `<div class="user-row"><span class="avatar">${esc(u.displayName.slice(0, 1))}</span><div><strong>${esc(u.displayName)}</strong><small>${esc(u.username)} · ${u.enabled ? '已启用' : '已停用'} · ${u.online ? '在线' : '离线'}</small><small>最近登录：${esc(dateLabel(u.lastLoginAt))}</small><small>${u.role === 'admin' ? '全部片库 · 全部类别' : (u.libraryAccess?.libraryIds == null ? '全部片库' : u.libraryAccess.libraryIds.length + ' 个片库') + ' · ' + (u.libraryAccess?.genres === null || !u.libraryAccess ? '全部类别' : u.libraryAccess.genres.length + ' 个类别')}</small></div><span class="role-label ${u.role === 'admin' ? 'role-admin' : ''}">${u.role === 'admin' ? '管理员' : '普通用户'}</span><button class="text-button" data-edit-user="${esc(u.id)}">编辑</button></div>`).join('');
}
function paintUserAccess(access = { sourceIds: null, libraryIds: null, genres: null }) {
  $('#access-all-libraries').checked = access.libraryIds == null;
  $('#access-all-genres').checked = access.genres === null;
  const libraryNames = new Map((library.libraries || []).map(l => [l.id, l.name]));
  const ids = [...new Set([...libraryNames.keys(), ...(access.libraryIds || [])])];
  $('#access-libraries').innerHTML = ids.map(id => `<label><input type="checkbox" data-access-library value="${esc(id)}" ${(access.libraryIds || []).includes(id) ? 'checked' : ''}>${esc(libraryNames.get(id) || '已移除的影片库')} </label>`).join('') || '<p class="field-hint">尚未创建自定义影片库，请先到“影片库管理”创建并归入来源。</p>';
  $('#access-legacy-note').hidden = !Array.isArray(access.sourceIds);
  $('#access-replace-legacy').checked = false;
  const gs = [...new Set([...library.movies.flatMap(m => m.genres || []), ...(access.genres || [])])].sort((a,b) => a.localeCompare(b,'zh'));
  $('#access-genres').innerHTML = gs.map(g => `<label><input type="checkbox" data-access-genre value="${esc(g)}" ${(access.genres || []).includes(g) ? 'checked' : ''}>${esc(g)}</label>`).join('') || '<p class="field-hint">尚无类别；“全部类别”包含未分类影片。</p>';
  syncAccessControls();
}
function syncAccessControls() {
  $$('[data-access-library]').forEach(input => { input.disabled = $('#access-all-libraries').checked; });
  $$('[data-access-genre]').forEach(input => { input.disabled = $('#access-all-genres').checked; });
  $('#access-admin-note').hidden = $('#user-form').elements.role.value !== 'admin';
}
function fillLibrarySources(selected = []) {
  $('#custom-library-sources').innerHTML = library.sources.map(s => `<label><input type="checkbox" data-library-source value="${esc(s.id)}" ${selected.includes(s.id) ? 'checked' : ''}>${esc(s.name)}</label>`).join('') || '<p class="field-hint">请先在“片库来源”添加来源。</p>';
}
function renderCustomLibraries() {
  $('#custom-libraries-list').innerHTML = (library.libraries || []).map(l => `<div class="custom-library-row"><div><strong>${esc(l.name)}</strong><small>${l.sourceIds.length} 个来源 · ${library.movies.filter(m => l.sourceIds.includes(m.sourceId)).length} 部影片</small><small>${esc(l.sourceIds.map(id => library.sources.find(s => s.id === id)?.name || '已移除来源').join(' / ') || '暂未归入来源')}</small></div><button type="button" class="text-button" data-edit-library="${esc(l.id)}">编辑</button><button type="button" class="text-button" data-delete-library="${esc(l.id)}">移除</button></div>`).join('') || '<p class="field-hint">还没有自定义影片库。可在下面创建，名称不必与来源相同。</p>';
  if (!$('#custom-library-form').elements.id.value) resetCustomLibraryForm();
}
function resetCustomLibraryForm() {
  $('#custom-library-form').reset(); $('#custom-library-form').elements.id.value = ''; $('#custom-library-form').elements.revision.value = '';
  $('#custom-library-title').textContent = '创建影片库'; $('#cancel-library-edit').hidden = true; $('#custom-library-error').hidden = true;
  fillLibrarySources();
}
$('#cancel-library-edit').addEventListener('click', resetCustomLibraryForm);
$('#custom-library-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.target, button = form.querySelector('[type=submit]'); button.disabled = true; $('#custom-library-error').hidden = true;
  try {
    const input = Object.fromEntries(new FormData(form)); input.revision = Number(input.revision); input.sourceIds = $$('[data-library-source]:checked').map(el => el.value);
    await api('/api/admin/libraries', input);
    library = await api('/api/library'); resetCustomLibraryForm(); render(); renderCustomLibraries(); toast('影片库已保存，视频与资料未移动。');
  } catch (error) { $('#custom-library-error').textContent = error.message; $('#custom-library-error').hidden = false; }
  finally { button.disabled = false; }
});
document.addEventListener('click', async event => {
  const el = event.target.closest('[data-edit-library], [data-delete-library]'); if (!el || !isAdmin()) return;
  const group = library.libraries?.find(l => l.id === (el.dataset.editLibrary || el.dataset.deleteLibrary)); if (!group) return;
  if (el.dataset.editLibrary) {
    const form = $('#custom-library-form'); form.elements.id.value = group.id; form.elements.revision.value = group.revision || 1; form.elements.name.value = group.name;
    fillLibrarySources(group.sourceIds); $('#custom-library-title').textContent = '编辑影片库：' + group.name; $('#cancel-library-edit').hidden = false; $('#custom-library-error').hidden = true; form.elements.name.focus();
    return;
  }
  if (!confirm('移除影片库“' + group.name + '”？只移除分组，不删除来源、影片或文件；仅获此库权限的账号将无法访问其中内容。')) return;
  try {
    await api('/api/admin/libraries/' + encodeURIComponent(group.id), { confirm: true, revision: group.revision || 1 }, 'DELETE');
    library = await api('/api/library'); resetCustomLibraryForm(); render(); renderCustomLibraries(); toast('影片库分组已移除，影片文件未改动。');
  } catch (error) { $('#custom-library-error').textContent = error.message; $('#custom-library-error').hidden = false; }
});
$('#user-access').addEventListener('change', syncAccessControls);
$('#user-form').elements.role.addEventListener('change', syncAccessControls);
function resetUserForm() { const f = $('#user-form'); f.reset(); f.elements.id.value = ''; f.elements.username.disabled = false; f.elements.password.required = true; $('#user-form-title').textContent = '创建用户'; $('#user-password-label').textContent = '初始密码（不限长度，不能为空）'; $('#cancel-user-edit').hidden = true; paintUserAccess(); }
$('#cancel-user-edit').addEventListener('click', resetUserForm);
$('#user-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#admin-error').hidden = true;
  const data = Object.fromEntries(new FormData(event.target)); data.enabled = data.enabled === 'true';
  data.libraryAccess = {
    libraryIds: $('#access-all-libraries').checked ? null : $$('[data-access-library]:checked').map(input => input.value),
    sourceIds: $('#access-replace-legacy').checked ? null : adminUsers.find(u => u.id === data.id)?.libraryAccess?.sourceIds ?? null,
    genres: $('#access-all-genres').checked ? null : $$('[data-access-genre]:checked').map(input => input.value),
  };
  data.confirmLibraryMigration = $('#access-replace-legacy').checked;
  const button = event.target.querySelector('[type=submit]'); button.disabled = true;
  try { await api(data.id ? `/api/admin/users/${data.id}` : '/api/admin/users', data); resetUserForm(); await refreshUsers(); toast('用户已保存。角色、状态或密码变更后需重新登录。'); }
  catch (error) { adminError(error); } finally { button.disabled = false; }
});
async function refreshTokens() {
  const result = await api('/api/admin/tokens');
  $('#tokens-list').innerHTML = result.tokens.filter(t => !t.revoked).map(t => `<div class="token-row"><div><strong>${esc(t.name)}</strong><small>${esc(t.prefix)}… · ${t.scope === 'write' ? '完整资料写入' : t.scope === 'classify' ? 'AI 分类专用' : '只读'} · 到期 ${esc(dateLabel(t.expiresAt))}</small></div><button class="text-button" data-revoke-token="${esc(t.id)}">撤销</button></div>`).join('');
}
$('#token-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#admin-error').hidden = true;
  const button = event.target.querySelector('[type=submit]'); button.disabled = true;
  try { const result = await api('/api/admin/tokens', Object.fromEntries(new FormData(event.target))); $('#new-token').value = result.token; $('#new-token-panel').hidden = false; event.target.reset(); await refreshTokens(); }
  catch (error) { adminError(error); } finally { button.disabled = false; }
});
function clearToken() { $('#new-token').value = ''; $('#new-token-panel').hidden = true; }
$('#hide-token').addEventListener('click', clearToken);
$('#preferences-dialog').addEventListener('close', clearToken);
$('#copy-token').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#new-token').value); toast('令牌已复制，请勿粘贴到公开聊天或代码库'); } catch { toast('无法访问剪贴板，请选择并手动复制令牌'); } });
$('#load-diagnostics').addEventListener('click', async () => { try { $('#diagnostics-output').textContent = JSON.stringify(await api('/api/admin/diagnostics'), null, 2); $('#diagnostics-output').hidden = false; } catch (error) { adminError(error); } });
$('#load-audit').addEventListener('click', async () => { try { $('#diagnostics-output').textContent = JSON.stringify(await api('/api/admin/audit'), null, 2); $('#diagnostics-output').hidden = false; } catch (error) { adminError(error); } });
document.addEventListener('click', async event => {
  const el = event.target.closest('button'); if (!el) return;
  if (el.dataset.editUser) { const u = adminUsers.find(u => u.id === el.dataset.editUser); if (!u) return; const f = $('#user-form'); f.elements.id.value = u.id; f.elements.username.value = u.username; f.elements.username.disabled = true; f.elements.displayName.value = u.displayName; f.elements.role.value = u.role; f.elements.enabled.value = String(u.enabled); f.elements.password.value = ''; f.elements.password.required = false; $('#user-form-title').textContent = `编辑用户：${u.displayName}`; $('#user-password-label').textContent = '重置密码（留空则不修改）'; $('#cancel-user-edit').hidden = false; paintUserAccess(u.libraryAccess); f.elements.displayName.focus(); }
  if (el.dataset.revokeToken) { try { await api(`/api/admin/tokens/${el.dataset.revokeToken}`, {}, 'DELETE'); await refreshTokens(); toast('调试令牌已撤销'); } catch (error) { adminError(error); } }
});
function startHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => { if (currentUser && document.visibilityState === 'visible') api('/api/auth/heartbeat', {}).catch(() => {}); }, 60000);
}
document.addEventListener('visibilitychange', () => { if (currentUser && document.visibilityState === 'visible') api('/api/auth/heartbeat', {}).catch(() => {}); });
const settingsLabels = { playback: '播放器设置', appearance: '外观与主题', account: '账号与登录', libraries: '影片库管理', sources: '片库来源', backup: '影片备份', users: '用户管理', logins: '登录设备管理', network: '服务与网络', debug: 'AI / 调试接口', about: '关于与帮助' };
async function selectSettingsPanel(panel) {
  if (!settingsLabels[panel]) panel = 'playback';
  if (['libraries', 'sources', 'backup', 'users', 'logins', 'network', 'debug'].includes(panel) && !isAdmin()) { toast('该页面需要管理员账号'); panel = 'playback'; }
  activeSettingsPanel = panel;
  const personal = ['playback', 'appearance'].includes(panel);
  $('#preferences-form').hidden = !personal;
  $('#preferences-save-hint').textContent = panel === 'appearance' ? '仅保存在本机的当前浏览器或 App，关闭会取消未保存的预览。' : '保存当前页面的播放器设置。';
  $$('[data-setting-content]').forEach(el => { el.hidden = el.dataset.settingContent !== panel; });
  $$('[data-setting-panel]').forEach(el => { const active = el.dataset.settingPanel === panel; el.classList.toggle('active', active); el.setAttribute('aria-selected', active); el.tabIndex = active ? 0 : -1; });
  $('#preferences-title').textContent = settingsLabels[panel];
  $('#settings-role').textContent = isAdmin() ? '管理员 · 可管理全部用户' : '普通用户 · 个人设置';
  $('#settings-context').textContent = `${currentUser?.displayName || ''} · ${isAdmin() ? '管理员后台与个人设置' : '当前账号的个人设置'}`;
  $('#account-description').textContent = `${currentUser?.displayName} / ${currentUser?.username} · ${isAdmin() ? '管理员' : '普通用户'}`;
  $('#admin-error').hidden = true; $('#password-error').hidden = true;
  $('#settings-scroll').scrollTop = 0;
  try {
    if (panel === 'libraries') { library = await api('/api/library'); render(); renderCustomLibraries(); }
    if (panel === 'sources') { selectTab('nas'); renderSources(); }
    if (panel === 'users') { await refreshUsers(); await refreshLoginMonitor(); }
    if (panel === 'logins') { await refreshLoginMonitor(); startLoginMonitor(); }
    if (panel === 'network') await loadNetworkSettings();
    if (panel === 'debug') await refreshTokens();
  } catch (error) { adminError(error); }
}
async function openPreferences(panel = activeSettingsPanel) {
  $('#preferences-error').hidden = true; $('#settings-save-status').hidden = true;
  const form = $('#preferences-form');
  for (const [key, value] of Object.entries(userPreferences)) if (form.elements[key]) form.elements[key].value = value;
  $('#accent-value').textContent = form.elements.accent.value;
  showDialog('preferences-dialog');
  await selectSettingsPanel(panel);
  $('#mobile-player-settings').hidden = !mobileAvailable();
  for (const field of ['playback', 'player']) form.elements[field].closest('label').hidden = mobileAvailable() || androidApp;
  if (mobileAvailable()) {
    $('#preferences-player-note').textContent = '手机 App 使用独立的播放器设置，不调用服务器电脑上的播放器。点击“设置手机播放器”选择内置播放、手机外部播放器及默认应用。';
    return;
  }
  if (androidApp) { $('#preferences-player-note').textContent = '请安装新版 App 并更新系统 WebView，以使用手机外部播放器；当前仍可内置播放，不会调用电脑播放器。'; return; }
  try {
    const available = await api('/api/players');
    const ids = available.players.map(p => p.id);
    const canLaunch = available.supported && library.canLaunchLocalPlayer !== false;
    form.elements.playback.querySelector('[value=external]').disabled = !canLaunch;
    form.elements.player.disabled = !canLaunch;
    for (const option of form.elements.player.options) option.disabled = !ids.includes(option.value);
    if (canLaunch && !ids.includes(form.elements.player.value)) form.elements.player.value = ids.includes('potplayer') ? 'potplayer' : 'default';
    if (!canLaunch) form.elements.playback.value = 'browser';
    $('#preferences-player-note').textContent = canLaunch ? `检测到：${available.players.map(p => p.name).join('、')}。点击影片的播放按钮直接使用这里的设置，不再单独显示播放器或继续观看按钮。网络视频需要 PotPlayer / VLC。` : (mobileLayout.matches ? '手机浏览器只能网页播放；要选择手机外部播放器，请使用幕间 Android App。' : available.note || '此设备只能使用网页播放。');
  } catch (error) { $('#preferences-player-note').textContent = error.message; }
}
$('.settings-navigation [role=tablist]').addEventListener('keydown', event => {
  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = $$('[data-setting-panel]').filter(el => !el.closest('[hidden]')); if (!tabs.length) return;
  event.preventDefault(); let index = tabs.findIndex(el => el.dataset.settingPanel === activeSettingsPanel);
  index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1) + tabs.length) % tabs.length;
  selectSettingsPanel(tabs[index].dataset.settingPanel); tabs[index].focus();
});
const movieGrid = $('#movie-grid');
const twoColumnScreen = matchMedia('(max-width: 600px)');
let preferredColumns = 'auto';
function updateMovieGridColumns() {
  const width = movieGrid.clientWidth;
  const columns = preferredColumns === 'auto' ? null : fitMovieColumns(preferredColumns, width, parseFloat(getComputedStyle(movieGrid).columnGap));
  const layout = columns ? `repeat(${twoColumnScreen.matches ? Math.min(columns, 2) : columns}, minmax(0, 1fr))` : '';
  if (movieGrid.style.gridTemplateColumns !== layout) movieGrid.style.gridTemplateColumns = layout;
}
if (typeof ResizeObserver === 'function') new ResizeObserver(updateMovieGridColumns).observe(movieGrid);
else window.addEventListener('resize', updateMovieGridColumns);
twoColumnScreen.addEventListener('change', updateMovieGridColumns);
function applyPreferences(prefs, persistTheme = true) {
  applyTheme(prefs, persistTheme);
  preferredColumns = prefs.columns || 'auto';
  updateMovieGridColumns();
}
function previewPreferences() {
  if (activeSettingsPanel !== 'appearance') return;
  const form = $('#preferences-form');
  $('#accent-value').textContent = form.elements.accent.value;
  applyPreferences({ theme: form.elements.theme.value, accent: form.elements.accent.value, columns: form.elements.columns.value }, false);
}
$('#preferences-form').addEventListener('input', previewPreferences);
$('#preferences-form').addEventListener('change', previewPreferences);
for (const button of $$('[data-accent]')) {
  button.style.backgroundColor = button.dataset.accent;
  button.addEventListener('click', () => { $('#preferences-form').elements.accent.value = button.dataset.accent; previewPreferences(); });
}
$('#preferences-reset').addEventListener('click', () => { const form = $('#preferences-form'); form.elements.theme.value = 'dark'; form.elements.accent.value = '#beeec8'; form.elements.columns.value = 'auto'; previewPreferences(); });
$('#preferences-dialog').addEventListener('close', () => applyPreferences(userPreferences));
$('#preferences-dialog').addEventListener('close', () => {
  if (currentUser && /^\/admin\/?$/.test(location.pathname)) { history.replaceState(null, '', '/'); applyPageRoute(true); }
});
$('#preferences-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#preferences-error').hidden = true;
  const form = event.target, button = form.querySelector('[type=submit]'); button.disabled = true;
  try {
    const isAppearance = activeSettingsPanel === 'appearance';
    if (isAppearance) {
      saveDeviceAppearance(currentUser?.id, Object.fromEntries(['theme', 'accent', 'columns'].map(k => [k, form.elements[k].value])));
    } else {
      library.preferences = await api('/api/preferences', Object.fromEntries(['playback', 'player'].map(k => [k, form.elements[k].value])));
    }
    userPreferences = effectivePreferences();
    applyPreferences(userPreferences);
    for (const key of ['theme', 'accent', 'columns']) form.elements[key].value = userPreferences[key];
    $('#accent-value').textContent = userPreferences.accent;
    $('#settings-save-status').textContent = isAppearance ? '外观已保存到本机，不影响其他设备。' : '当前页面的设置已保存。'; $('#settings-save-status').hidden = false; toast('设置已保存');
  } catch (error) { $('#preferences-error').textContent = error.message; $('#preferences-error').hidden = false; }
  finally { button.disabled = false; }
});
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (userPreferences.theme === 'system') applyTheme(userPreferences); });
function metrics(items) { return items.map(([label, value]) => `<div class="metric-card"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`).join(''); }
async function refreshLoginMonitor() {
  if (!isAdmin()) return;
  try {
    const data = await api('/api/admin/logins');
    $('#admin-overview').innerHTML = metrics([['用户', data.users.length], ['影片', library.movies.length], ['近期在线', data.users.filter(u => u.online).length], ['记住的设备', data.sessions.filter(s => s.remember).length]]);
    $('#login-summary').innerHTML = metrics([['近期在线用户', data.users.filter(u => u.online).length], ['有效登录设备', data.sessions.length], ['最近记录中的失败', data.events.filter(e => !e.success).length]]);
    $('#login-users').innerHTML = data.users.map(u => `<div class="login-user"><span class="presence ${u.online ? 'online' : ''}">${u.online ? '在线' : '离线'}</span><div><strong>${esc(u.displayName)} <small>${esc(u.username)}</small></strong><p>最近登录：${esc(dateLabel(u.lastLoginAt))} · 最近活动：${esc(dateLabel(u.lastSeenAt))} · ${u.activeSessions} 个登录设备</p></div></div>`).join('');
    const names = new Map(data.users.map(u => [u.id, `${u.displayName} (${u.username})`]));
    $('#login-sessions').innerHTML = data.sessions.length ? `<table class="admin-table"><thead><tr><th>用户 / 设备</th><th>来源 IP</th><th>最近活动</th><th>状态</th><th>操作</th></tr></thead><tbody>${data.sessions.map(s => `<tr><td>${esc(names.get(s.userId) || '已移除用户')}<small>${esc(s.device)} · 登录 ${esc(dateLabel(s.createdAt))}</small></td><td>${esc(s.ip)}</td><td>${esc(dateLabel(s.lastSeenAt))}<small>到期 ${esc(dateLabel(s.expiresAt))}</small></td><td>${s.online ? '近期在线' : '暂未活动'}<small>${s.remember ? '已记住设备' : '临时登录'}</small></td><td><button class="text-button" data-revoke-session="${esc(s.id)}">退出设备</button></td></tr>`).join('')}</tbody></table>` : '<p class="field-hint">暂无有效登录设备。</p>';
    $('#login-events').innerHTML = data.events.length ? `<table class="admin-table"><thead><tr><th>用户</th><th>时间</th><th>设备 / IP</th><th>结果</th></tr></thead><tbody>${data.events.map(e => `<tr><td>${esc(e.username)}</td><td>${esc(dateLabel(e.at))}</td><td>${esc(e.device)}<small>${esc(e.ip)}</small></td><td><span class="presence ${e.success ? 'online' : 'failed'}">${e.success ? '成功' : '失败'}</span></td></tr>`).join('')}</tbody></table>` : '<p class="field-hint">暂无登录记录。</p>';
  } catch (error) { adminError(error); }
}
function startLoginMonitor() { clearInterval(loginMonitorTimer); loginMonitorTimer = setInterval(() => { if ($('#preferences-dialog').open && !$('#admin-logins').hidden) refreshLoginMonitor(); }, 15000); }
$('#preferences-dialog').addEventListener('close', () => clearInterval(loginMonitorTimer));
$('#refresh-logins').addEventListener('click', refreshLoginMonitor);
function renderNetwork(data) {
  networkState = data;
  $('#shutdown-open').disabled = shutdownRequested || data.canShutdown !== true;
  $('#shutdown-unavailable').hidden = data.canShutdown === true;
  const form = $('#network-form'); form.elements.port.value = data.saved.port; form.elements.allowLan.checked = data.saved.allowLan; form.elements.enableIpv6.checked = !!data.saved.enableIpv6;
  form.elements.enableDiscovery.checked = data.saved.enableDiscovery !== false;
  form.elements.confirmLan.checked = false; form.elements.confirmIpv6.checked = false;
  $('#network-status').innerHTML = metrics([['当前端口', data.running.port], ['当前访问范围', data.running.allowLan ? '网络可访问' : '仅本机'], ['当前协议', data.running.enableIpv6 ? 'IPv4 + IPv6' : '仅 IPv4'], ['配置状态', data.restartRequired ? '重启后生效' : '已生效']]);
  $('#network-urls').innerHTML = data.urls.map(url => `<a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(url)}</a>`).join('');
  $('#network-discovery-note').textContent = data.discovery?.status === 'listening' ? 'App 搜索服务正在运行（UDP 43210），只回应同一 IPv4 子网的发现请求，不广播账号或片库内容。'
    : data.discovery?.status === 'error' ? data.discovery.error : 'App 搜索服务当前未运行。需勾选允许局域网与此开关，保存并重启；纯 IPv6 / 广播隔离网络请手动填写地址。';
  $('#network-ipv6-note').textContent = !data.running.enableIpv6 ? 'IPv6 当前未启用。勾选上方开关、保存并手动重启后生效。'
    : !data.running.allowLan ? 'IPv6 已启用，但当前仅本机可访问：http://[::1]:' + data.running.port
    : data.urls.filter(url => url.includes('[')).length < 2 ? 'IPv6 已启用，未发现可直接生成浏览器链接的 IPv6 网络地址。本机 [::1] 可用；跨设备需服务器具备可达的 ULA 或全局 IPv6 地址。'
    : 'IPv6 地址请保留方括号。能否跨设备访问仍取决于路由、系统防火墙及网络隔离；有 IPv6 地址不等于已经可从公网访问。';
  if (data.portOverride) $('#network-status').insertAdjacentHTML('beforeend', '<p class="field-hint">当前端口由 PORT 环境变量覆盖；若要采用页面配置，请在下次启动前取消该环境变量。</p>');
  updateLanConfirmation();
}
async function loadNetworkSettings() { if (!isAdmin()) return; try { renderNetwork(await api('/api/admin/network')); } catch (error) { adminError(error); } }
function updateLanConfirmation() {
  const form = $('#network-form'); const required = form.elements.allowLan.checked && !networkState?.saved.allowLan;
  $('#network-confirm-label').hidden = !required; form.elements.confirmLan.required = required;
  const ipv6Required = form.elements.allowLan.checked && form.elements.enableIpv6.checked && !(networkState?.saved.allowLan && networkState?.saved.enableIpv6);
  $('#network-ipv6-confirm-label').hidden = !ipv6Required; form.elements.confirmIpv6.required = ipv6Required;
  if (!required) form.elements.confirmLan.checked = false;
  if (!ipv6Required) form.elements.confirmIpv6.checked = false;
}
$('#network-form [name=allowLan]').addEventListener('change', updateLanConfirmation);
$('#network-form [name=enableIpv6]').addEventListener('change', updateLanConfirmation);
$('#network-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#admin-error').hidden = true;
  const form = event.target, button = form.querySelector('[type=submit]'); button.disabled = true;
  try {
    const data = await api('/api/admin/network', { port: Number(form.elements.port.value), allowLan: form.elements.allowLan.checked, enableIpv6: form.elements.enableIpv6.checked,
      enableDiscovery: form.elements.enableDiscovery.checked, confirmLan: form.elements.confirmLan.checked, confirmIpv6: form.elements.confirmIpv6.checked });
    renderNetwork(data); $('#network-message').textContent = data.message; $('#network-message').hidden = false; toast('服务配置已保存，手动重启后生效');
  } catch (error) { adminError(error); } finally { button.disabled = false; }
});
function toggleShutdownConfirmation(open) {
  $('#shutdown-confirmation').hidden = !open;
  $('#shutdown-open').setAttribute('aria-expanded', String(open));
}
$('#shutdown-open').addEventListener('click', () => {
  if (shutdownRequested || networkState?.canShutdown !== true) return;
  $('#shutdown-status').hidden = true;
  toggleShutdownConfirmation(true);
  $('#shutdown-cancel').focus();
});
$('#shutdown-cancel').addEventListener('click', () => {
  toggleShutdownConfirmation(false);
  $('#shutdown-status').hidden = true;
  $('#shutdown-open').focus();
});
$('#preferences-dialog').addEventListener('close', () => toggleShutdownConfirmation(false));
$('#shutdown-confirm').addEventListener('click', async () => {
  if (!isAdmin() || shutdownRequested || networkState?.canShutdown !== true) return;
  shutdownRequested = true;
  const buttons = ['#shutdown-open', '#shutdown-confirm', '#shutdown-cancel'].map($);
  buttons.forEach(button => { button.disabled = true; });
  const status = $('#shutdown-status');
  status.textContent = '正在提交关闭请求…'; status.hidden = false;
  try {
    const result = await api('/api/admin/shutdown', { confirm: true });
    toggleShutdownConfirmation(false);
    status.textContent = result.message;
  } catch (error) {
    status.textContent = error.message;
    shutdownRequested = false;
    buttons.forEach(button => { button.disabled = false; });
  }
});
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-revoke-session]'); if (!button) return;
  if (!confirm('退出这个登录设备？该设备下次操作时需要重新登录，不会删除用户或片库数据。')) return;
  try { await api(`/api/admin/sessions/${button.dataset.revokeSession}/revoke`, {}); await refreshLoginMonitor(); toast('该设备已退出登录'); } catch (error) { adminError(error); }
});
// Metadata facets and local-only discussions. External AI tokens cannot access comments.
const commentPages = new Map();
function renderGenreEditor(movie) {
  if (!isAdmin() || movie.kind === 'demo') return '';
  const manual = Array.isArray(movie.manualGenres);
  return `<div class="genre-editor-wrap"><div class="genre-edit-action"><button type="button" class="text-button" data-edit-genres="${esc(movie.id)}">${icon('edit')}编辑类别</button>${manual ? '<span class="manual-label">自定义类别</span>' : ''}</div><form class="genre-editor" data-genres-form="${esc(movie.id)}" hidden><label>影片类别（自己填写，多个标签用逗号分隔，与文件夹无关）<input name="genres" value="${esc((movie.genres || []).join('，'))}" maxlength="512" placeholder="例如：科幻，经典，待看"></label><p class="field-hint">可自由添加、修改或全部清空；空白就显示空白。重新扫描或匹配资料不会覆盖你的修改。</p><div class="form-actions"><button type="button" class="text-button" data-reset-genres="${esc(movie.id)}" ${manual ? '' : 'disabled'}>恢复资料类别</button><button type="submit" class="button primary">保存类别</button></div><p class="inline-error" data-genre-error role="alert" hidden></p></form></div>`;
}
function renderFactRows(movie) {
  const rows = Object.entries({ duration: '时长', releaseDate: '日期', ...facetLabels }).map(([key, label]) => {
    const text = ['duration', 'releaseDate'].includes(key) ? esc(movie[key] || '') : facetValues(movie, key).map(value => {
      const action = key === 'cast'
        ? `data-actor="${esc(value)}" title="在主片库查看参演影片"`
        : `data-facet="${key}" data-facet-value="${esc(value)}" data-origin-movie="${esc(movie.id)}"`;
      return `<button type="button" class="fact-link" ${action}>${esc(value)}</button>`;
    }).join('');
    return `<div><dt>${label}</dt><dd>${text}</dd></div>`;
  });
  return `<dl class="movie-facts">${rows.join('')}</dl>`;
}
function movieDiscussion(movie, includeFacts) {
  const editor = isAdmin() && movie.kind !== 'demo' ? `<div class="facts-editor-wrap"><button type="button" class="text-button" data-edit-facts="${esc(movie.id)}">${icon('edit')}编辑日期 / 片商 / 系列 / 演员</button><form class="facts-form" data-facts-form="${esc(movie.id)}" hidden><div class="form-two"><label>日期（上映／发行）<input name="releaseDate" type="date" value="${esc(movie.releaseDate || '')}"></label><label>片商<input name="studios" maxlength="2400" value="${esc(facetValues(movie,'studios').join(' / '))}" placeholder="多个名称用 / 分隔"></label><label>系列<input name="series" maxlength="2400" value="${esc(facetValues(movie,'series').join(' / '))}" placeholder="多个名称用 / 分隔"></label><label>演员<input name="cast" maxlength="2400" value="${esc(facetValues(movie,'cast').join(' / '))}" placeholder="多个姓名用 / 分隔"></label></div><p class="field-hint">留空即保存空白。手动资料重新扫描后保留，仅修改网站索引，不改写 NAS 文件。</p><button class="button secondary" type="submit">保存资料字段</button><p class="inline-error" data-facts-error role="alert" hidden></p></form></div>` : '';
  return `<div class="movie-context" data-context-movie="${esc(movie.id)}">${includeFacts ? renderFactRows(movie) + renderGenreEditor(movie) : ''}${editor}<section class="comments-section" data-comments-movie="${esc(movie.id)}" aria-label="影片评论区"><div class="discussion-heading"><div><h3>影片评论 <span data-comment-count></span></h3><p>仅有权访问本片的登录用户可见 · 只保存在本机</p></div><button type="button" class="text-button" data-refresh-comments="${esc(movie.id)}">刷新评论</button></div><form data-comment-form="${esc(movie.id)}"><label>说说你的观影感受<textarea name="text" maxlength="2000" rows="3" required placeholder="写下你的评论（最多 2000 字）"></textarea></label><div class="comment-form-footer"><span>可删除自己的评论；管理员可管理全部评论。</span><button class="button primary" type="submit">发表评论</button></div><p class="inline-error" data-comment-error role="alert" hidden></p></form><div class="comments-list" data-comments-list aria-live="polite"><p class="field-hint">正在读取评论…</p></div><button class="button secondary" type="button" data-comments-more="${esc(movie.id)}" hidden>更早的评论</button></section></div>`;
}
function showRelated(button) {
  if (button.dataset.facet === 'cast') { openActorPage(button.dataset.facetValue); return; }
  if (!['studios', 'series', 'genres'].includes(button.dataset.facet)) return;
  $('#detail-dialog').close(); $('#player-dialog').close();
  resetFilters(); facetFilter = button.dataset.facet; facetFilterValue = button.dataset.facetValue; view = 'all';
  openLibraryPage(); $('#section-title').focus({ preventScroll: true });
}
function paintComments(movieId, data) {
  for (const section of $$('[data-comments-movie]').filter(el=>el.dataset.commentsMovie === movieId)) {
    section.querySelector('[data-comment-count]').textContent = `(${data.total})`;
    section.querySelector('[data-comments-list]').innerHTML = data.comments.length ? data.comments.map(c=>`<article class="comment-item"><div class="comment-author"><span class="comment-avatar">${esc(c.author.slice(0,1))}</span><strong>${esc(c.author)}</strong>${c.mine ? '<span class="comment-mine">我</span>' : ''}<time datetime="${esc(c.createdAt)}">${esc(dateLabel(c.createdAt))}</time>${c.canDelete ? `<button type="button" class="text-button" data-delete-comment="${esc(c.id)}" data-comment-movie="${esc(movieId)}">删除评论</button>` : ''}</div><p class="comment-text">${esc(c.text)}</p></article>`).join('') : '<p class="comments-empty">还没有评论，写下第一条观影感受吧。</p>';
    section.querySelector('[data-comments-more]').hidden = !data.hasMore;
  }
}
async function loadComments(movieId, page = 1) {
  try {
    const data = await api(`/api/movies/${encodeURIComponent(movieId)}/comments?page=${page}`);
    const previous = commentPages.get(movieId);
    if (page > 1 && previous) data.comments = [...previous.comments, ...data.comments.filter(c=>!previous.comments.some(p=>p.id===c.id))];
    commentPages.set(movieId,data); paintComments(movieId,data);
  } catch(error) {
    for (const section of $$('[data-comments-movie]').filter(el=>el.dataset.commentsMovie===movieId)) section.querySelector('[data-comments-list]').textContent = error.message;
  }
}
document.addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.facet) { showRelated(button); return; }
  if (button.hasAttribute('data-hide-related')) button.closest('[data-related]').hidden = true;
  if (button.hasAttribute('data-related-more')) { const context=button.closest('.movie-context'); context._related.visible+=12; renderRelated(context); }
  if (button.dataset.editFacts) { const form=button.parentElement.querySelector('form'); form.hidden=!form.hidden; if(!form.hidden) form.querySelector('input').focus(); }
  if (button.dataset.refreshComments) await loadComments(button.dataset.refreshComments);
  if (button.dataset.commentsMore) { button.disabled=true; await loadComments(button.dataset.commentsMore,(commentPages.get(button.dataset.commentsMore)?.page || 1)+1); button.disabled=false; }
  if (button.dataset.deleteComment) {
    if (!confirm('确定删除这条评论？删除后无法恢复。')) return;
    try { await api(`/api/movies/${encodeURIComponent(button.dataset.commentMovie)}/comments/${encodeURIComponent(button.dataset.deleteComment)}`, {}, 'DELETE'); await loadComments(button.dataset.commentMovie); toast('评论已删除'); } catch(error) { toast(error.message); }
  }
});
document.addEventListener('submit', async event => {
  const form=event.target;
  if (!form.dataset.commentForm && !form.dataset.factsForm) return;
  event.preventDefault(); const button=form.querySelector('[type=submit]'), errorPanel=form.querySelector('[role=alert]'); errorPanel.hidden=true; button.disabled=true;
  try {
    if(form.dataset.commentForm) { await api(`/api/movies/${encodeURIComponent(form.dataset.commentForm)}/comments`,{text:new FormData(form).get('text')}); form.reset(); await loadComments(form.dataset.commentForm); toast('评论已发表'); }
    else { const id=form.dataset.factsForm, updated=await api(`/api/movies/${encodeURIComponent(id)}/facts`,Object.fromEntries(new FormData(form))); const i=library.movies.findIndex(m=>m.id===id); if(i>=0) library.movies[i]=updated; render(); if($('#detail-dialog').open && selectedMovie?.id===id) openDetail(id); if(currentMovie?.id===id) { currentMovie=updated; $('#player-extras').innerHTML=movieDiscussion(updated,true); loadComments(id); } toast('资料字段已保存'); }
  } catch(error) { errorPanel.textContent=error.message; errorPanel.hidden=false; }
  finally { button.disabled=false; }
});



function durationOverlay(movie) { const text=durationStamp(movie); return text ? `<span class="duration-badge">${esc(movie.episodeCount ? '总时长 ' : '')}${esc(text)}</span>` : ''; }
function filterState() { return {...libraryQuery(),view,genre,actor:actorFilter,facet:facetFilter,value:facetFilterValue,query:$('#search').value,year:$('#year-filter').value,source:$('#source-filter').value,folder:$('#folder-filter').value}; }
function randomUrl() { const params=new URLSearchParams(Object.entries(filterState()).filter(([,value])=>value)); return '/random'+(params.size ? '?'+params : ''); }
function pageVisibility() {
  $('#library-page').hidden=!activeLibrary || isRandomPage; $('#random-page').hidden=!activeLibrary || !isRandomPage;
  document.title=!activeLibrary ? '选择影片库 · 幕间' : isRandomPage ? '随机九宫格 · 幕间' : '幕间 · 私人放映室';
  $('.skip-link').href=!activeLibrary ? '#library-picker-title' : isRandomPage ? '#random-grid' : '#catalog';
}
function applyPageRoute(scroll=false) {
  if (scroll) setMobileActorPanel(false);
  const wasRandom=isRandomPage, params=new URLSearchParams(location.search);
  const savedView=Object.hasOwn(viewNames, params.get('view')) ? params.get('view') : '';
  isRandomPage=/^\/random\/?$/.test(location.pathname) || location.pathname === '/' && !savedView;
  if(!routeReady || scroll) {
    routeReady = true; pageSize = 48; view=savedView || 'all';
    genre=(params.get('genre')||'').slice(0,40);actorFilter=(params.get('actor')||'').slice(0,100);
    facetFilter = ['studios', 'series', 'genres'].includes(params.get('facet')) ? params.get('facet') : '';
    facetFilterValue = facetFilter ? (params.get('value') || '').slice(0,100) : '';
    for(const [key,selector] of [['query','#search'],['year','#year-filter'],['source','#source-filter'],['folder','#folder-filter']]) $(selector).value=(params.get(key)||'').slice(0,300);
    if(!wasRandom)randomFingerprint='';
  }
  pageVisibility();renderGrid();
  if(scroll){window.scrollTo({top:0});if(isRandomPage)$('#random-title').focus({preventScroll:true});}
}
function openLibraryPage() {
  setMobileActorPanel(false);
  const params = new URLSearchParams({ ...libraryQuery(), view, ...(actorFilter ? { actor: actorFilter } : {}), ...(facetFilter ? { facet: facetFilter, value: facetFilterValue } : {}) });
  const target = '/?' + params;
  if(location.pathname + location.search !== target)history.pushState(null,'',target);
  isRandomPage=false;pageVisibility();renderGrid();window.scrollTo({top:0});
}
function openActorPage(name) {
  // Start from the full library instead of the old view or a subset in a dialog.
  $('#detail-dialog').close();
  $('#player-dialog').close();
  resetFilters();
  actorFilter = name; view = 'all';
  openLibraryPage();
  const heading = $('#actor-profile').hidden ? $('#section-title') : $('#actor-profile-name');
  heading.focus({ preventScroll: true });
}
window.addEventListener('popstate',()=>{ routeReady = false; render(); });
function renderActorProfile() {
  const profile = $('#actor-profile'), photo = $('#actor-profile-image');
  const actor = actorFilter && !isRandomPage && actorDirectory.find(item => item.name.toLocaleLowerCase() === actorFilter.toLocaleLowerCase());
  profile.hidden = !actor;
  const src = actor ? safeImage(actor.photo) : '';
  if ((photo.getAttribute('src') || '') !== src) {
    photo.hidden = !src;
    if (src) photo.setAttribute('src', src); else photo.removeAttribute('src');
  }
  if (!actor) return;
  $('#actor-portrait-reset').hidden = !isAdmin() || !actor.photo?.startsWith('/media/actors/manual-');
  $('#actor-profile-name').textContent = actor.name;
  $('#actor-profile-count').textContent = `${actor.count} 部参演影片`;
}
$('#actor-portrait-upload').addEventListener('click', () => {
  if (isAdmin() && !portraitUploading) $('#actor-portrait-file').click();
});
async function updateActorPortrait(file) {
  if (!isAdmin() || portraitUploading || !actorFilter) return;
  const actor = actorDirectory.find(a => a.name.toLocaleLowerCase() === actorFilter.toLocaleLowerCase()); if (!actor) return;
  const status = $('#actor-portrait-status'), buttons = [$('#actor-portrait-upload'), $('#actor-portrait-reset')];
  status.hidden = false; status.className = 'field-hint'; status.textContent = file ? '正在上传头像…' : '正在恢复资料头像…';
  portraitUploading = true; buttons.forEach(button => { button.disabled = true; });
  try {
    const endpoint = '/api/admin/actors/portrait?name=' + encodeURIComponent(actor.name);
    if (file) {
      if (file.size > 5 * 1024 * 1024) throw new Error('头像不能超过 5 MB。');
      if (file.type && !['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片。');
      const response = await fetch(endpoint, { method: 'POST', headers: { 'X-Cinema-Client': 'local', 'Content-Type': file.type === 'image/jpg' ? 'image/jpeg' : file.type || 'application/octet-stream' }, body: file });
      const result = await response.json();
      if (response.status === 401) { currentUser = null; showAuth(false); }
      if (!response.ok) throw new Error(result.error || '头像上传失败。');
    } else await api(endpoint, {}, 'DELETE');
    library = await api('/api/library'); render();
    status.textContent = actor.name + (file ? '的头像已保存，同名演员共用此头像。' : '已恢复来源资料中的头像。');
  } catch (error) { status.className = 'inline-error'; status.textContent = error.message; }
  finally { portraitUploading = false; buttons.forEach(button => { button.disabled = false; }); $('#actor-portrait-file').value = ''; }
}
$('#actor-portrait-file').addEventListener('change', event => { const file = event.target.files?.[0]; if (file) updateActorPortrait(file); });
$('#actor-portrait-reset').addEventListener('click', () => {
  if (isAdmin() && confirm('恢复资料头像？只撤销本站上传的覆盖，不改 NAS 或 NFO 图片。')) updateActorPortrait(null);
});
function renderActors() {
  const all=actorDirectory, term=$('#actor-search').value.trim().toLocaleLowerCase(), found=all.filter(a=>a.name.toLocaleLowerCase().includes(term));
  $('#actors-count').textContent=String(all.length);
  $('#actors-list').innerHTML=found.length ? found.slice(0,actorPageSize).map(a=>`<button class="actor-item ${actorFilter===a.name?'active':''}" data-actor="${esc(a.name)}" aria-label="演员 ${esc(a.name)}，${a.count} 部影片"><span class="actor-photo">${safeImage(a.photo)?`<img class="actor-image" src="${esc(a.photo)}" alt="${esc(a.name)} 照片" loading="lazy">`:'<span class="actor-photo-empty" aria-hidden="true"></span>'}</span><span><strong>${esc(a.name)}</strong><small>${a.count} 部参演影片</small></span></button>`).join('') : '<p class="field-hint">'+(term?'没有匹配的演员':'导入演员资料后显示在这里')+'</p>';
  $('#actors-more').hidden=found.length<=actorPageSize;
}
$('#actor-search').addEventListener('input',()=>{actorPageSize=24;renderActors();});
$('#actors-more').addEventListener('click',()=>{actorPageSize+=24;renderActors();});
const mobileActorToggle = $('#mobile-actors-toggle'), actorPanel = $('#actors-rail');
const mobileLayout = matchMedia('(max-width: 820px)');
function setMobileActorPanel(open) {
  actorPanel.toggleAttribute('data-mobile-open', open);
  mobileActorToggle.setAttribute('aria-expanded', String(open));
}
mobileActorToggle.addEventListener('click', () => {
  const open = !actorPanel.hasAttribute('data-mobile-open');
  setMobileActorPanel(open);
  if (open) {
    window.scrollTo({ top: 0 });
    $('#actors-title').focus({ preventScroll: true });
  }
});
mobileLayout.addEventListener('change', () => {
  setMobileActorPanel(false);
  if (androidApp || !routeReady) return;
  renderGrid();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && mobileLayout.matches && actorPanel.hasAttribute('data-mobile-open') && !$('dialog[open]')) {
    setMobileActorPanel(false);
    mobileActorToggle.focus();
  }
});
function episodePicker(movie) {
  if(!movie.episodes?.length)return '';
  const chosen = selectedEpisode(movie, library.history[movie.id]?.episodeId);
  return `<div class="episode-picker" id="detail-episode" data-movie-id="${esc(movie.id)}" data-episode-id="${esc(chosen.id)}"><div class="episode-heading"><strong>共 ${movie.episodes.length} 集</strong><span data-episode-label>已选：${esc(chosen.title)}</span></div><p class="field-hint">选择集数后点击播放。</p><div class="episode-grid" role="group" aria-label="详情选集">${episodeButtons(movie, chosen.id, false)}</div></div>`;
}
function episodeButtons(movie, chosen, inPlayer) {
  return movie.episodes.map((e, index) => `<button type="button" class="episode-tile ${e.id === chosen ? 'active' : ''}" ${inPlayer ? `data-player-episode="${index}"` : `data-detail-episode="${esc(e.id)}"`} aria-pressed="${e.id === chosen}" aria-label="第 ${index + 1} 集：${esc(e.title || '未命名')}" title="${esc(e.title || '')}">${index + 1}</button>`).join('');
}
function renderPlayerEpisodes(movie, chosen) {
  const panel = $('#player-episodes'); panel.hidden = !movie.episodes?.length;
  panel.innerHTML = panel.hidden ? '' : `<div class="episode-heading"><strong>共 ${movie.episodes.length} 集</strong><span>正在播放：${esc(selectedEpisode(movie, chosen)?.title || '')}</span></div><div class="episode-grid" role="group" aria-label="播放器选集">${episodeButtons(movie, chosen, true)}</div>`;
}
function playbackStreams(movie) {
  return movie.episodes?.length ? movie.episodes.map(e=>({url:e.mediaUrl,name:e.title,episodeId:e.id})) : movie.mediaUrl ? [{url:movie.mediaUrl,name:movie.fileName||'本地视频'}] : movie.streams;
}
providerChanged(); initAuth();
