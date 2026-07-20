// ═══════════════════════════════════════════════════════════
//  FISHING LOG — app.js  v5  (page-based navigation)
// ═══════════════════════════════════════════════════════════

/* ─── CONSTANTS ─────────────────────────────────────────── */
const US_STATES = [
  "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut",
  "Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa",
  "Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan",
  "Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada",
  "New Hampshire","New Jersey","New Mexico","New York","North Carolina",
  "North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island",
  "South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont",
  "Virginia","Washington","West Virginia","Wisconsin","Wyoming"
];
const STATE_EMOJI = {
  "Alabama":"🌲","Alaska":"🏔️","Arizona":"🌵","Arkansas":"🌾","California":"🌅",
  "Colorado":"⛷️","Connecticut":"🍂","Delaware":"🦅","Florida":"🐊","Georgia":"🍑",
  "Hawaii":"🌺","Idaho":"🥔","Illinois":"🌽","Indiana":"🏎️","Iowa":"🌽",
  "Kansas":"🌾","Kentucky":"🐴","Louisiana":"🎷","Maine":"🦞","Maryland":"🦀",
  "Massachusetts":"🏛️","Michigan":"🚗","Minnesota":"🌊","Mississippi":"🎸",
  "Missouri":"🏛️","Montana":"🏔️","Nebraska":"🌾","Nevada":"🎰",
  "New Hampshire":"🍁","New Jersey":"🏖️","New Mexico":"🌵","New York":"🗽",
  "North Carolina":"🌲","North Dakota":"🌾","Ohio":"🔴","Oklahoma":"🌪️",
  "Oregon":"🌲","Pennsylvania":"🔔","Rhode Island":"⚓","South Carolina":"🌴",
  "South Dakota":"🗿","Tennessee":"🎸","Texas":"⭐","Utah":"🏜️",
  "Vermont":"🍁","Virginia":"🏛️","Washington":"☕","West Virginia":"⛰️",
  "Wisconsin":"🧀","Wyoming":"🦬"
};
const FISH_EMOJI = {
  'bass':'🐟','trout':'🐟','salmon':'🐟','pike':'🐟','catfish':'🐟',
  'crappie':'🐟','walleye':'🐟','bluegill':'🐟','muskie':'🐟','carp':'🐟',
  'redfish':'🐠','snook':'🐠','tarpon':'🦈','default':'🐟'
};
function getCatchPageSize() {
  const v = parseInt(getSettings().pageSize);
  return Number.isFinite(v) && v > 0 ? v : 8;
}

/* ─── APP STATE ─────────────────────────────────────────── */
let allCatches = [];
let _bestDayCatches = [];
let filtered   = [];
let _pageStack = ['page-home'];  // navigation history

/* ─── LOCAL STORAGE (instant) + SHEETS SYNC (background) ──
   Every write updates localStorage immediately for a snappy UI,
   timestamps the change, and queues a background push to the
   AppData tab in Google Sheets. On load, Sheets data is pulled
   and merged in — whichever side has the newer timestamp wins,
   so editing on your phone then opening on your computer (or
   vice versa) picks up the latest version automatically.
──────────────────────────────────────────────────────────── */
const ls = {
  get: (k,d={}) => { try { return JSON.parse(localStorage.getItem(k)||JSON.stringify(d)); } catch { return d; } },
  set: (k,v)    => localStorage.setItem(k, JSON.stringify(v)),
};

// Map our localStorage keys to the AppData sheet keys
// Keys are namespaced per user so two sites on the same GitHub Pages
// domain never share localStorage data with each other.
let _prefix = null;
function pfx() {
  if (_prefix) return _prefix;
  // Derive a short fingerprint from the Web App URL — each person's
  // Apps Script URL is unique, so their localStorage is isolated.
  if (CONFIG.WEB_APP_URL) {
    const match = CONFIG.WEB_APP_URL.match(/\/s\/([^/]+)\//);
    const uid = match ? match[1].slice(-12) : CONFIG.WEB_APP_URL.slice(-16).replace(/[^a-z0-9]/gi,'');
    _prefix = 'fl_' + uid + '_';
  } else {
    _prefix = 'fl_default_';
  }
  return _prefix;
}

function lsTimestampKey(k) { return k + '_ts'; }

function getSettings() { return ls.get(pfx()+'settings', {}); }
function getTackle()   { return ls.get(pfx()+'tackle',   []); }
function getRods()     { return ls.get(pfx()+'rods',     []); }
function getFavs()       { return ls.get(pfx()+'favs',       []); }
function getPinnedFavs() { return ls.get(pfx()+'pinnedfavs', null); } // null = not customised yet

// Sheet key mapping (sheet keys are short, human-readable)
const SHEET_KEY_MAP = {
  get [pfx()+'tackle']()   { return 'tackle'; },
  get [pfx()+'rods']()     { return 'rods'; },
  get [pfx()+'favs']()        { return 'favorites'; },
  get [pfx()+'pinnedfavs']()  { return 'pinnedfavs'; },
  get [pfx()+'settings']() { return 'settings'; },
  get [pfx()+'crops']()    { return 'crops'; },
};

// Generic setter: writes locally + stamps time + queues a Sheets push
function setSynced(localKey, value) {
  ls.set(localKey, value);
  ls.set(lsTimestampKey(localKey), Date.now());
  queueSyncPush(localKey, value);
}
function saveTackle(a)         { setSynced(pfx()+'tackle',   a); }
function saveRods(a)           { setSynced(pfx()+'rods',     a); }
function saveFavs(a)           { setSynced(pfx()+'favs',       a); }
function savePinnedFavsLS(arr) { setSynced(pfx()+'pinnedfavs', arr); }
function saveSettingsLocal(obj){ setSynced(pfx()+'settings', obj); }



/* ─── BACKGROUND SYNC ENGINE ─────────────────────────────── */
let _syncPending = {};
let _syncTimer   = null;

function queueSyncPush(localKey, value) {
  if (!CONFIG.WEB_APP_URL) return;
  const sheetKey = { [pfx()+'tackle']:'tackle', [pfx()+'rods']:'rods', [pfx()+'favs']:'favorites', [pfx()+'pinnedfavs']:'pinnedfavs', [pfx()+'settings']:'settings', [pfx()+'crops']:'crops', [pfx()+'lostlures']:'lostlures' }[localKey];
  if (!sheetKey) return;
  _syncPending[sheetKey] = value;
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(flushSyncQueue, 1200);
}

async function flushSyncQueue() {
  if (!CONFIG.WEB_APP_URL) return;
  const updates = _syncPending;
  _syncPending = {};
  if (!Object.keys(updates).length) return;
  try {
    await fetch(CONFIG.WEB_APP_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'saveAppData', updates }),
    });
    updateSyncIndicator('synced');
  } catch (err) {
    console.error('Sync push failed:', err);
    updateSyncIndicator('error');
    // Put the failed updates back in the queue to retry on next change
    _syncPending = { ..._syncPending, ...updates };
  }
}

// Pulls AppData from Sheets on startup and merges with localStorage.
// Whichever side has the newer timestamp wins per-key.
async function pullAndMergeAppData() {
  if (!CONFIG.WEB_APP_URL) return;
  updateSyncIndicator('syncing');
  try {
    const resp = await fetch(`${CONFIG.WEB_APP_URL}?action=getAppData`);
    const remote = await resp.json();
    if (remote.error) throw new Error(remote.error);

    // Map sheet keys back to local namespaced keys
    const sheetToLocal = {
      tackle:     pfx()+'tackle',
      rods:       pfx()+'rods',
      favorites:  pfx()+'favs',
      pinnedfavs: pfx()+'pinnedfavs',
      settings:   pfx()+'settings',
      crops:      pfx()+'crops',
      lostlures:  pfx()+'lostlures',
    };

    Object.entries(sheetToLocal).forEach(([sheetKey, localKey]) => {
      const remoteEntry = remote[sheetKey];
      if (!remoteEntry || remoteEntry.value === null) return;

      const localTs  = parseInt(localStorage.getItem(lsTimestampKey(localKey))) || 0;
      const remoteTs = remoteEntry.lastModified || 0;

      if (remoteTs > localTs) {
        ls.set(localKey, remoteEntry.value);
        ls.set(lsTimestampKey(localKey), remoteTs);
      } else if (localTs > remoteTs && localStorage.getItem(localKey) !== null) {
        queueSyncPush(localKey, ls.get(localKey, sheetKey==='settings'?{}:[]));
      }
    });

    updateSyncIndicator('synced');
  } catch (err) {
    console.error('Sync pull failed:', err);
    updateSyncIndicator('error');
  }
}

function updateSyncIndicator(state) {
  const el = document.getElementById('syncIndicator');
  if (el) {
    if (state === 'syncing') { el.textContent = '🔄 Syncing…'; el.style.opacity = '1'; }
    if (state === 'synced')  { el.textContent = '✅ Synced';   el.style.opacity = '1'; setTimeout(()=>{ if(el.textContent==='✅ Synced') el.style.opacity='0'; }, 2000); }
    if (state === 'error')   { el.textContent = '⚠️ Sync error — will retry'; el.style.opacity = '1'; }
  }
  const settingsEl = document.getElementById('settingsSyncStatus');
  if (settingsEl) {
    if (state === 'syncing') settingsEl.textContent = 'Syncing…';
    if (state === 'synced')  settingsEl.textContent = 'Up to date ✓';
    if (state === 'error')   settingsEl.textContent = 'Sync failed — check connection';
  }
}

// Manually triggered from the Settings page "Sync Now" button.
// Pushes any pending local changes first, then pulls the latest
// from Sheets so this device is fully caught up.
async function manualSync() {
  await flushSyncQueue();
  await pullAndMergeAppData();
  populateStateDropdowns();
  refreshLureDropdown();
  refreshRodDropdown();
  renderCatches(filtered);
  renderFavs();
  showToast('Sync complete!', 'success');
}

/* ═══════════════════════════════════════════════════════════
   PAGE NAVIGATION
═══════════════════════════════════════════════════════════ */
let _skipLogReset      = false;
let _skipLostLureReset = false;

function navTo(pageId) {
  const current = _pageStack[_pageStack.length - 1];
  if (current === pageId) return;

  // Prep page content before showing it
  if (pageId === 'page-buddies')     prepBuddiesPage();
  if (pageId === 'page-spots')       prepSpotsPage();
  if (pageId === 'page-all-catches') prepAllCatches();
  if (pageId === 'page-all-favs')    prepAllFavs();
  if (pageId === 'page-pin-favs')    prepPinFavs();
  if (pageId === 'page-tackle')           renderTackleList();
  if (pageId === 'page-rods')             renderRodList();
  if (pageId === 'page-lost-lures')       renderLostLures();
  if (pageId === 'page-lost-lure-add' && !_skipLostLureReset) resetLostLureForm();
  _skipLostLureReset = false;
  if (pageId === 'page-shops')       { renderShops(); populateShopStateFilter(); }
  if (pageId === 'page-shop-add' && !_skipShopReset) resetShopForm();
  _skipShopReset = false;
  if (pageId === 'page-log' && !_skipLogReset) {
    document.getElementById('logPageTitle').textContent = 'Log a Catch';
    document.getElementById('logSaveBtn').textContent   = '🎣 Save Catch';
    document.getElementById('fEditId').value = '';
    document.getElementById('fExistingPhoto').value = '';
    resetForm();
  }
  _skipLogReset = false;

  const curEl  = document.getElementById(current);
  const nextEl = document.getElementById(pageId);

  // Hide current page completely off-screen to the left
  if (curEl) {
    curEl.classList.remove('active');
    curEl.classList.add('behind');
  }

  // Bring next page in from the right
  if (nextEl) {
    // Force a reflow so the transition fires correctly
    nextEl.style.transition = 'none';
    nextEl.classList.remove('behind', 'active');
    nextEl.getBoundingClientRect(); // trigger reflow
    nextEl.style.transition = '';
    nextEl.classList.add('active');
    nextEl.scrollTop = 0;
  }

  _pageStack.push(pageId);
}

function navBack() {
  if (_pageStack.length <= 1) return;
  const leaving   = _pageStack.pop();
  const returning = _pageStack[_pageStack.length - 1];

  const leaveEl  = document.getElementById(leaving);
  const returnEl = document.getElementById(returning);

  if (leaveEl) {
    leaveEl.classList.remove('active', 'behind');
    leaveEl.style.transform = '';
  }
  if (returnEl) {
    returnEl.classList.remove('behind');
    returnEl.classList.add('active');
  }
}

/* ═══════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  applyOwnerName();
  populateStateDropdowns();
  setDateTimeNow('fDate');
  refreshLureDropdown();
  refreshRodDropdown();

  // Fetch sunrise/sunset when city field loses focus or state changes
  document.getElementById('fCity').addEventListener('blur', fetchSunForCity);
  document.getElementById('fState').addEventListener('change', () => {
    if (document.getElementById('fCity').value.trim()) fetchSunForCity();
  });

  if (!CONFIG.WEB_APP_URL) {
    document.getElementById('configBanner').style.display = 'flex';
    renderEmptyStats();
    renderFishBreakdown([]);
    renderStateBreakdown([]);
    renderFavs();
    renderCatches([]);
    return;
  }

  // Pull tackle/rods/favorites/settings from Sheets and merge with
  // localStorage before rendering anything that depends on them.
  await pullAndMergeAppData();
  applyOwnerName();
  populateStateDropdowns();
  refreshLureDropdown();
  refreshRodDropdown();

  loadCatches();
  loadShops();
});

function applyOwnerName() {
  const name = getSettings().ownerName || CONFIG.OWNER_NAME || 'My Fishing Log';
  document.getElementById('logOwnerLabel').textContent = name;
  document.title = name + ' — Fishing Log';
}

function setDateTimeNow(id) {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  document.getElementById(id).value = now.toISOString().slice(0,16);
  // Also set the date-only field
  const dateOnly = document.getElementById('fDateOnly');
  if (dateOnly) dateOnly.value = now.toISOString().slice(0,10);
}

function toggleTimeField() {
  const noTime   = document.getElementById('fNoTime').checked;
  const dtField  = document.getElementById('fDate');
  const doField  = document.getElementById('fDateOnly');
  dtField.style.display = noTime ? 'none' : '';
  doField.style.display = noTime ? ''     : 'none';
}

/* ─── STATE DROPDOWNS ───────────────────────────────────── */
function populateStateDropdowns() {
  const def = getSettings().defaultState || '';
  ['fState','settingsDefaultState','sState'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = id === 'settingsDefaultState'
      ? '<option value="">None</option>'
      : '<option value="">— Select State —</option>';
    US_STATES.forEach(s => {
      const o = document.createElement('option');
      o.value = s; o.textContent = s;
      if (id === 'fState' && s === def) o.selected = true;
      sel.appendChild(o);
    });
  });
  const sn = document.getElementById('settingsName');
  if (sn) sn.value = getSettings().ownerName || CONFIG.OWNER_NAME || '';
  const su = document.getElementById('shareUrlDisplay');
  if (su) su.textContent = CONFIG.WEB_APP_URL || 'Not configured';
  const sp = document.getElementById('settingsPageSize');
  if (sp) sp.value = String(getCatchPageSize());
}

/* ═══════════════════════════════════════════════════════════
   FAVORITES
═══════════════════════════════════════════════════════════ */
function isFav(id) { return getFavs().includes(String(id)); }

function toggleFav(id, e) {
  if (e) e.stopPropagation();
  const favs = getFavs();
  const sid  = String(id);
  const idx  = favs.indexOf(sid);
  if (idx >= 0) favs.splice(idx,1); else favs.push(sid);
  saveFavs(favs);
  renderFavs();
  renderCatches(filtered);
  renderStats(filtered);
  // Also refresh the all-favs page if it's currently visible
  const allFavsPage = document.getElementById('page-all-favs');
  if (allFavsPage && allFavsPage.classList.contains('active')) {
    prepAllFavs();
  }
}

function renderFavs() {
  const el     = document.getElementById('favGrid');
  const footer = document.getElementById('favLogFooter');
  const count  = document.getElementById('favLogCount');
  const favs   = getFavs();
  const pageSize = getCatchPageSize();

  // All favorited catches sorted newest first
  const allFavCatches = allCatches
    .filter(c => favs.includes(String(c.id)))
    .sort((a,b) => new Date(b.date) - new Date(a.date));

  if (!allFavCatches.length) {
    el.innerHTML = `<div class="empty-state"><div class="fish-big">🤍</div><h3>No favorites yet</h3><p>Tap the ♡ on any catch to add it here.</p></div>`;
    if (footer) footer.style.display = 'none';
    if (count)  count.textContent = '';
    return;
  }

  // If total favorites fit within page size, show them all — no need for pinning
  const pinned = getPinnedFavs();
  let shown;
  if (allFavCatches.length <= pageSize) {
    // Fits on screen — show everything, pinned list irrelevant
    shown = allFavCatches;
  } else if (pinned && Array.isArray(pinned) && pinned.length > 0) {
    // More than fit — use the pinned selection
    const pinnedSet = new Set(pinned.map(String));
    let pinnedShown = allFavCatches.filter(c => pinnedSet.has(String(c.id)));
    // If saved pinned list has fewer than pageSize (e.g. saved before a bug fix),
    // fill remaining slots with the newest non-pinned favs
    if (pinnedShown.length < pageSize) {
      const extra = allFavCatches
        .filter(c => !pinnedSet.has(String(c.id)))
        .slice(0, pageSize - pinnedShown.length);
      pinnedShown = [...pinnedShown, ...extra];
    }
    shown = pinnedShown.slice(0, pageSize);
  } else {
    // More than fit but no pinned selection yet — show most recent
    shown = allFavCatches.slice(0, pageSize);
  }

  el.innerHTML = shown.map((c,i) => buildCatchCard(c,i,true)).join('');

  // Show footer if: more favs than page size OR pinned selection hides some catches
  const hasPinnedHidden = pinned && Array.isArray(pinned) && allFavCatches.length > shown.length;
  const hasMore         = allFavCatches.length > pageSize;
  const showFooter      = hasMore || hasPinnedHidden;

  if (footer) footer.style.display = showFooter ? 'flex' : 'none';
  if (count) {
    if (hasPinnedHidden && !hasMore) {
      count.textContent = `${shown.length} pinned shown · ${allFavCatches.length} total favorites`;
    } else if (hasMore) {
      count.textContent = pinned && pinned.length
        ? `${shown.length} pinned · ${allFavCatches.length} total`
        : `Showing ${shown.length} of ${allFavCatches.length} favorites`;
    } else {
      count.textContent = `${allFavCatches.length} favorite${allFavCatches.length !== 1 ? 's' : ''}`;
    }
  }
}

function prepAllFavs() {
  const favs       = getFavs();
  const favCatches = allCatches.filter(c => favs.includes(String(c.id)));
  const sorted     = [...favCatches].sort((a,b) => new Date(b.date)-new Date(a.date));
  document.getElementById('allFavsTitle').textContent = `All Favorites (${sorted.length})`;
  document.getElementById('allFavsBody').innerHTML = sorted.map((c,i) => buildCatchCard(c,i,true)).join('');
}

// Temp selection state for the pin page
let _pinSelection = new Set();

function prepPinFavs() {
  const favs      = getFavs();
  const pageSize  = getCatchPageSize();
  const pinned    = getPinnedFavs();
  const favCatches = allCatches
    .filter(c => favs.includes(String(c.id)))
    .sort((a,b) => new Date(b.date)-new Date(a.date));

  // Pre-select currently pinned list if it exists and is full-sized,
  // otherwise pre-select the most recent up to pageSize
  if (pinned && Array.isArray(pinned) && pinned.length >= pageSize) {
    // Valid saved list — filter to only still-favorited catches
    const validIds = new Set(favCatches.map(c => String(c.id)));
    _pinSelection = new Set(pinned.map(String).filter(id => validIds.has(id)));
  } else {
    // No saved list, or saved list is undersized (old bug) — start fresh with most recent
    _pinSelection = new Set(favCatches.slice(0, pageSize).map(c => String(c.id)));
  }

  updatePinLimitBar(pageSize);
  renderPinList(favCatches, pageSize);
}

function updatePinLimitBar(pageSize) {
  const el = document.getElementById('pinLimitBar');
  if (!el) return;
  const remaining = pageSize - _pinSelection.size;
  if (remaining <= 0) {
    el.textContent = `Limit reached — ${pageSize}/${pageSize} selected. Deselect one to swap.`;
  } else {
    el.textContent = `Select up to ${pageSize} favorites to show on the home screen. ${_pinSelection.size}/${pageSize} selected.`;
  }
}

function renderPinList(favCatches, pageSize) {
  const el = document.getElementById('pinFavsList');
  el.innerHTML = favCatches.map(c => {
    const sel      = _pinSelection.has(String(c.id));
    const atLimit  = _pinSelection.size > pageSize - 1 && !sel;
    const dt       = c.date ? new Date(c.date).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : '';
    const thumb    = c.photoUrl && c.photoUrl.trim()
      ? `<img class="pin-fav-thumb" src="${esc(c.photoUrl)}" referrerpolicy="no-referrer" />`
      : `<div class="pin-fav-thumb-placeholder">${getFishEmoji(c.fish)}</div>`;
    return `<div class="pin-fav-item${sel?' selected':''}${atLimit?' disabled':''}"
        onclick="togglePinFav('${esc(c.id)}',${pageSize})">
      ${thumb}
      <div class="pin-fav-info">
        <div class="pin-fav-name">${esc(c.fish||'—')}</div>
        <div class="pin-fav-meta">${[c.weight?parseFloat(c.weight).toFixed(2)+' lb':'',c.location,dt].filter(Boolean).join(' · ')}</div>
      </div>
      <div class="pin-fav-check">${sel?'✓':''}</div>
    </div>`;
  }).join('');
}

function togglePinFav(id, pageSize) {
  const sid = String(id);
  if (_pinSelection.has(sid)) {
    _pinSelection.delete(sid);
  } else {
    if (_pinSelection.size > pageSize - 1) {
      // Already at the limit — block and show message
      showToast(`You can only pin ${pageSize} favorites. Deselect one first.`, 'error');
      return;
    }
    _pinSelection.add(sid);
  }
  updatePinLimitBar(pageSize);
  const favs      = getFavs();
  const favCatches = allCatches
    .filter(c => favs.includes(String(c.id)))
    .sort((a,b) => new Date(b.date)-new Date(a.date));
  renderPinList(favCatches, pageSize);
}

function savePinnedFavs() {
  savePinnedFavsLS([..._pinSelection]);
  showToast('Pinned favorites saved!', 'success');
  navBack();
  renderFavs();
}

/* ═══════════════════════════════════════════════════════════
   LOST LURES
═══════════════════════════════════════════════════════════ */

function getLostLures()     { return ls.get(pfx()+'lostlures', []); }
function saveLostLuresLS(a) { setSynced(pfx()+'lostlures', a); }

function renderLostLures() {
  const lures   = getLostLures();
  const list    = document.getElementById('lostLureList');
  const empty   = document.getElementById('lostLureEmpty');
  const statBar = document.getElementById('lostStatBar');
  if (!list) return;

  if (statBar) {
    const total     = lures.length;
    const totalCost = lures.reduce((sum,l) => sum + (parseFloat(l.price)||0), 0);
    if (total) {
      statBar.style.display = 'flex';
      statBar.innerHTML = `
        <div class="lost-stat"><div class="lost-stat-val">${total}</div><div class="lost-stat-lbl">Lost</div></div>
        <div class="lost-stat"><div class="lost-stat-val">$${totalCost.toFixed(2)}</div><div class="lost-stat-lbl">Total Value</div></div>`;
    } else {
      statBar.style.display = 'none';
    }
  }

  if (!lures.length) {
    list.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  const sorted = [...lures].sort((a,b) => (b.dateLost||'') > (a.dateLost||'') ? 1 : -1);
  list.innerHTML = sorted.map(l => {
    const label = l.name + (l.color ? ` (${l.color})` : '');
    const meta  = [l.dateLost, l.where, l.price ? '$'+parseFloat(l.price).toFixed(2) : ''].filter(Boolean).join(' · ');
    return `<div class="lost-lure-item" onclick="openLostLureDetail('${esc(l.id)}')">
      <div class="lost-lure-icon">💀</div>
      <div class="lost-lure-info">
        <div class="lost-lure-name">${esc(label)}</div>
        ${meta ? `<div class="lost-lure-meta">${esc(meta)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function openLostLureDetail(id) {
  const l = getLostLures().find(x => x.id === id);
  if (!l) return;
  document.getElementById('lostLureDetailName').textContent = l.name + (l.color ? ` (${l.color})` : '');
  const fields = [
    {label:'Lure Name',      value: l.name     ||'—'},
    {label:'Color',          value: l.color    ||'—'},
    {label:'Brand',          value: l.brand    ||'—'},
    {label:'Details',        value: l.details  ||'—'},
    {label:'Price',          value: l.price    ? '$'+parseFloat(l.price).toFixed(2) : '—'},
    {label:'Date Lost',      value: l.dateLost ||'—'},
    {label:'Where Lost',     value: l.where    ||'—'},
    {label:'Cause of Death', value: l.cause    ||'—'},
  ];
  document.getElementById('lostLureDetailGrid').innerHTML = fields.map(f =>
    `<div class="gear-detail-item"><div class="gear-detail-label">${f.label}</div><div class="gear-detail-value">${esc(f.value)}</div></div>`
  ).join('');
  document.getElementById('lleNameInput').value    = l.name     || '';
  document.getElementById('lleColorInput').value   = l.color    || '';
  document.getElementById('lleBrandInput').value   = l.brand    || '';
  document.getElementById('llePriceInput').value   = l.price    || '';
  document.getElementById('lleDetailsInput').value = l.details  || '';
  document.getElementById('lleDateInput').value    = l.dateLost || '';
  document.getElementById('lleWhereInput').value   = l.where    || '';
  document.getElementById('lleCauseInput').value   = l.cause    || '';
  document.getElementById('lostLureEditForm').classList.remove('show');
  document.getElementById('lostLureDetailActions').innerHTML = `
    <button class="btn btn-outline" onclick="toggleLostLureEditForm()">✏️ Edit</button>
    <button class="btn btn-danger"  onclick="deleteLostLure('${esc(id)}')">🗑 Delete</button>
    <button class="btn btn-primary" id="lostLureEditSaveBtn" onclick="saveLostLureEdit('${esc(id)}')" style="display:none">💾 Save</button>
    <button class="btn btn-outline" id="lostLureEditCancelBtn" onclick="toggleLostLureEditForm()" style="display:none">Cancel</button>`;
  navTo('page-lost-lure-detail');
}

function toggleLostLureEditForm() {
  const form    = document.getElementById('lostLureEditForm');
  const saveBtn = document.getElementById('lostLureEditSaveBtn');
  const canBtn  = document.getElementById('lostLureEditCancelBtn');
  const editBtn = document.querySelector('#lostLureDetailActions .btn-outline');
  const show    = form.classList.toggle('show');
  saveBtn.style.display = show ? '' : 'none';
  canBtn.style.display  = show ? '' : 'none';
  if (editBtn) editBtn.style.display = show ? 'none' : '';
}

function saveLostLureEdit(id) {
  const name = document.getElementById('lleNameInput').value.trim();
  if (!name) { showToast('Lure name is required.','error'); return; }
  const lures = getLostLures();
  const idx   = lures.findIndex(x => x.id === id);
  if (idx < 0) return;
  lures[idx] = { ...lures[idx], name,
    color:    document.getElementById('lleColorInput').value.trim(),
    brand:    document.getElementById('lleBrandInput').value.trim(),
    price:    document.getElementById('llePriceInput').value,
    details:  document.getElementById('lleDetailsInput').value.trim(),
    dateLost: document.getElementById('lleDateInput').value,
    where:    document.getElementById('lleWhereInput').value.trim(),
    cause:    document.getElementById('lleCauseInput').value.trim(),
  };
  saveLostLuresLS(lures);
  showToast('Lost lure updated!','success');
  navBack();
  renderLostLures();
}

function submitLostLure() {
  const name = document.getElementById('llName').value.trim();
  if (!name) { showToast('Lure name is required!','error'); return; }
  const lures = getLostLures();
  const entry = {
    id:       Date.now().toString(36) + Math.random().toString(36).slice(2),
    name,
    color:    document.getElementById('llColor').value.trim(),
    brand:    document.getElementById('llBrand').value.trim(),
    price:    document.getElementById('llPrice').value,
    details:  document.getElementById('llDetails').value.trim(),
    dateLost: document.getElementById('llDate').value,
    where:    document.getElementById('llWhere').value.trim(),
    cause:    document.getElementById('llCause').value.trim(),
  };
  lures.push(entry);
  saveLostLuresLS(lures);
  showToast('💀 Lure logged as lost!','success');
  resetLostLureForm();
  navBack();
  renderLostLures();
}

function deleteLostLure(id) {
  if (!confirm('Remove this lure from your lost list?')) return;
  saveLostLuresLS(getLostLures().filter(x => x.id !== id));
  showToast('Removed.','success');
  navBack();
  renderLostLures();
}

function resetLostLureForm() {
  ['llName','llColor','llBrand','llPrice','llDetails','llWhere','llCause'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('llDate').value = new Date().toISOString().slice(0,10);
  document.getElementById('lostLureFormTitle').textContent = 'Log Lost Lure';
  document.getElementById('lostLureSaveBtn').textContent   = '💀 Save';
}

/* ═══════════════════════════════════════════════════════════
   TACKLE BOX
═══════════════════════════════════════════════════════════ */
function tackleLabelFor(t) { return t.name + (t.color ? ` (${t.color})` : ''); }

// A catch matches a tackle item if its stored lure equals the full
// "Name (Color)" label — or, for lures logged before color existed,
// the bare name (only when the tackle item itself has no color set,
// so two different colors of the same lure don't collide).
function lureMatches(c, t) {
  const stored = (c.lure || '').trim();
  if (!stored) return false;
  if (stored === tackleLabelFor(t)) return true;
  if (!t.color && stored === t.name) return true;
  return false;
}

function renderTackleList() {
  const tackle = getTackle();
  const el = document.getElementById('tackleList');
  if (!tackle.length) {
    el.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:.76rem;color:#bbb;text-align:center;padding:24px">No lures yet. Add one below.</div>';
    return;
  }
  el.innerHTML = tackle.map((t,i) => {
    const count = allCatches.filter(c => lureMatches(c, t)).length;
    return `<div class="gear-item" onclick="openTackleDetail(${i})">
      <div class="gear-item-icon">🪱</div>
      <div class="gear-item-info">
        <div class="gear-item-name">${esc(tackleLabelFor(t))}</div>
        ${t.brand ? `<div class="gear-item-detail">${esc(t.brand)}</div>` : ''}
      </div>
      <div class="gear-item-actions" onclick="event.stopPropagation()">
        ${count > 0 ? `<span class="catch-count-badge">🎣 ${count}</span>` : ''}
        <button class="btn btn-danger btn-xs" onclick="removeTackle(${i})">✕</button>
      </div>
    </div>`;
  }).join('');
}

function openTackleDetail(i) {
  const t = getTackle()[i];
  document.getElementById('tackleDetailName').textContent = tackleLabelFor(t);
  document.getElementById('tackleDetailGrid').innerHTML = `
    <div class="gear-detail-item"><div class="gear-detail-label">Lure Name</div><div class="gear-detail-value">${esc(t.name||'—')}</div></div>
    <div class="gear-detail-item"><div class="gear-detail-label">Color</div><div class="gear-detail-value">${esc(t.color||'—')}</div></div>
    <div class="gear-detail-item"><div class="gear-detail-label">Brand</div><div class="gear-detail-value">${esc(t.brand||'—')}</div></div>
    <div class="gear-detail-item"><div class="gear-detail-label">Details</div><div class="gear-detail-value">${esc(t.details||'—')}</div></div>`;
  document.getElementById('teNameInput').value    = t.name    || '';
  document.getElementById('teColorInput').value   = t.color   || '';
  document.getElementById('teBrandInput').value   = t.brand   || '';
  document.getElementById('teDetailsInput').value = t.details || '';
  const editForm = document.getElementById('tackleEditForm');
  editForm.classList.remove('show');
  document.getElementById('tackleDetailActions').innerHTML = `
    <button class="btn btn-outline" onclick="toggleTackleEditForm()">✏️ Edit</button>
    <button class="btn btn-danger" onclick="removeTackleAndBack(${i})">🗑 Delete</button>
    <button class="btn btn-primary" id="tackleEditSaveBtn" onclick="saveTackleEdit(${i})" style="display:none">💾 Save</button>
    <button class="btn btn-outline" id="tackleEditCancelBtn" onclick="toggleTackleEditForm()" style="display:none">Cancel</button>`;
  navTo('page-tackle-detail');
}

function toggleTackleEditForm() {
  const show = document.getElementById('tackleEditForm').classList.toggle('show');
  document.getElementById('tackleEditSaveBtn').style.display   = show ? '' : 'none';
  document.getElementById('tackleEditCancelBtn').style.display  = show ? '' : 'none';
  const editBtn = document.querySelector('#tackleDetailActions .btn-outline');
  if (editBtn) editBtn.style.display = show ? 'none' : '';
}

async function saveTackleEdit(i) {
  const name = document.getElementById('teNameInput').value.trim();
  if (!name) { showToast('Lure name is required.','error'); return; }
  const tackle  = getTackle();
  const oldT    = tackle[i];
  const oldLabel = tackleLabelFor(oldT);
  const newT    = { name, color: document.getElementById('teColorInput').value.trim(), brand: document.getElementById('teBrandInput').value.trim(), details: document.getElementById('teDetailsInput').value.trim() };
  const newLabel = tackleLabelFor(newT);
  tackle[i] = newT;
  saveTackle(tackle);

  // If the name and/or color actually changed, carry it over to every
  // past catch logged under the old lure (instead of leaving them
  // orphaned as a custom lure under the old name/color). Catches logged
  // before this lure had a color may still be stored under the bare
  // old name, so we check for that too.
  const oldCandidates = [...new Set([oldLabel, oldT.name].filter(Boolean))];
  const needsRename = oldLabel !== newLabel;
  if (needsRename) {
    showLoading('Updating past catches…');
    try {
      let totalUpdated = 0;
      for (const oldName of oldCandidates) {
        if (oldName === newLabel) continue;
        const resp = await fetch(CONFIG.WEB_APP_URL, {
          method: 'POST',
          body: JSON.stringify({ action: 'renameLure', oldName, newName: newLabel }),
        });
        const data = await resp.json();
        if (data.error) throw new Error(data.error);
        totalUpdated += (data.updated || 0);
      }
      allCatches.forEach(c => { if (oldCandidates.includes((c.lure||'').trim())) c.lure = newLabel; });
      applyFilters();
      showToast(totalUpdated ? `Lure updated! ${totalUpdated} catch(es) relinked.` : 'Lure updated!', 'success');
    } catch (err) {
      console.error(err);
      showToast('Lure updated, but updating past catches failed: ' + err.message, 'error');
    } finally { hideLoading(); }
  } else {
    showToast('Lure updated!','success');
  }

  navBack();
  renderTackleList();
  refreshLureDropdown();
}

function addTackle() {
  const name = document.getElementById('tName').value.trim();
  if (!name) { showToast('Enter a lure name.','error'); return; }
  const tackle = getTackle();
  tackle.push({ name, color: document.getElementById('tColor').value.trim(), brand: document.getElementById('tBrand').value.trim(), details: document.getElementById('tDetails').value.trim() });
  saveTackle(tackle);
  ['tName','tColor','tBrand','tDetails'].forEach(id => document.getElementById(id).value='');
  renderTackleList(); refreshLureDropdown();
  showToast('Lure added!','success');
}

function removeTackle(i) {
  const tackle = getTackle(); tackle.splice(i,1); saveTackle(tackle);
  renderTackleList(); refreshLureDropdown();
}

function removeTackleAndBack(i) {
  removeTackle(i); navBack();
}

function refreshLureDropdown() {
  const sel = document.getElementById('fLure');
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Tackle Box —</option>';
  getTackle().forEach(t => {
    const o = document.createElement('option');
    o.value = tackleLabelFor(t); o.textContent = tackleLabelFor(t);
    sel.appendChild(o);
  });
  sel.value = cur;
}

/* ═══════════════════════════════════════════════════════════
   ROD RACK
═══════════════════════════════════════════════════════════ */
function renderRodList() {
  const rods = getRods();
  const el = document.getElementById('rodList');
  if (!rods.length) {
    el.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:.76rem;color:#bbb;text-align:center;padding:24px">No rods yet. Add one below.</div>';
    return;
  }
  el.innerHTML = rods.map((r,i) => {
    const count = allCatches.filter(c => c.rod === r.nickname).length;
    return `<div class="gear-item" onclick="openRodDetail(${i})">
      <div class="gear-item-icon">🎣</div>
      <div class="gear-item-info">
        <div class="gear-item-name">${esc(r.nickname||r.rod||'Unnamed')} ${r.isDefault?'<span class="default-badge">DEFAULT</span>':''}</div>
        ${r.rod ? `<div class="gear-item-detail">${esc(r.rod)}</div>` : ''}
      </div>
      <div class="gear-item-actions" onclick="event.stopPropagation()">
        ${count > 0 ? `<span class="catch-count-badge">🎣 ${count}</span>` : ''}
        <button class="btn btn-danger btn-xs" onclick="removeRod(${i})">✕</button>
      </div>
    </div>`;
  }).join('');
}

function openRodDetail(i) {
  const r = getRods()[i];
  document.getElementById('rodDetailName').textContent = r.nickname || r.rod || 'Rod';
  document.getElementById('rodDetailGrid').innerHTML = `
    <div class="gear-detail-item"><div class="gear-detail-label">Nickname</div><div class="gear-detail-value">${esc(r.nickname||'—')}</div></div>
    <div class="gear-detail-item"><div class="gear-detail-label">Rod</div><div class="gear-detail-value">${esc(r.rod||'—')}</div></div>
    <div class="gear-detail-item"><div class="gear-detail-label">Reel</div><div class="gear-detail-value">${esc(r.reel||'—')}</div></div>
    <div class="gear-detail-item"><div class="gear-detail-label">Default</div><div class="gear-detail-value">${r.isDefault?'✅ Yes':'No'}</div></div>`;
  document.getElementById('reNicknameInput').value = r.nickname || '';
  document.getElementById('reRodInput').value      = r.rod      || '';
  document.getElementById('reReelInput').value     = r.reel     || '';
  document.getElementById('rodEditForm').classList.remove('show');
  document.getElementById('rodDetailActions').innerHTML = `
    <button class="btn btn-outline" onclick="toggleRodEditForm()">✏️ Edit</button>
    ${!r.isDefault ? `<button class="btn btn-outline" onclick="setDefaultRod(${i})">⭐ Set Default</button>` : ''}
    <button class="btn btn-danger" onclick="removeRodAndBack(${i})">🗑 Delete</button>
    <button class="btn btn-primary" id="rodEditSaveBtn" onclick="saveRodEdit(${i})" style="display:none">💾 Save</button>
    <button class="btn btn-outline" id="rodEditCancelBtn" onclick="toggleRodEditForm()" style="display:none">Cancel</button>`;
  navTo('page-rod-detail');
}

function toggleRodEditForm() {
  const show = document.getElementById('rodEditForm').classList.toggle('show');
  document.getElementById('rodEditSaveBtn').style.display  = show ? '' : 'none';
  document.getElementById('rodEditCancelBtn').style.display = show ? '' : 'none';
  const editBtn = document.querySelector('#rodDetailActions .btn-outline');
  if (editBtn) editBtn.style.display = show ? 'none' : '';
}

function saveRodEdit(i) {
  const nickname = document.getElementById('reNicknameInput').value.trim();
  if (!nickname) { showToast('Nickname is required.','error'); return; }
  const rods = getRods();
  rods[i] = { ...rods[i], nickname, rod: document.getElementById('reRodInput').value.trim(), reel: document.getElementById('reReelInput').value.trim() };
  saveRods(rods);
  showToast('Rod updated!','success');
  navBack();
  renderRodList(); refreshRodDropdown();
}

function addRod() {
  const nickname = document.getElementById('rNickname').value.trim();
  if (!nickname) { showToast('Enter a nickname.','error'); return; }
  const rods = getRods();
  rods.push({ nickname, rod: document.getElementById('rRod').value.trim(), reel: document.getElementById('rReel').value.trim(), isDefault: rods.length === 0 });
  saveRods(rods);
  ['rNickname','rRod','rReel'].forEach(id => document.getElementById(id).value='');
  renderRodList(); refreshRodDropdown();
  showToast('Rod added!','success');
}

function removeRod(i) {
  const rods = getRods(); const wasDefault = rods[i].isDefault; rods.splice(i,1);
  if (wasDefault && rods.length) rods[0].isDefault = true;
  saveRods(rods); renderRodList(); refreshRodDropdown();
}

function removeRodAndBack(i) { removeRod(i); navBack(); }

function setDefaultRod(i) {
  const rods = getRods(); rods.forEach((r,j) => r.isDefault = j===i); saveRods(rods);
  showToast('Default rod set!','success'); navBack(); renderRodList(); refreshRodDropdown();
}

function refreshRodDropdown() {
  const sel = document.getElementById('fRod');
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Rod Rack —</option>';
  const rods = getRods();
  rods.forEach(r => {
    const o = document.createElement('option');
    o.value = r.nickname; o.textContent = r.nickname + (r.isDefault?' ★':'');
    sel.appendChild(o);
  });
  const def = rods.find(r => r.isDefault);
  sel.value = cur || (def ? def.nickname : '');
}

/* ═══════════════════════════════════════════════════════════
   LOAD CATCHES
═══════════════════════════════════════════════════════════ */
async function loadCatches() {
  showLoading('Loading your catches…');
  try {
    const resp = await fetch(`${CONFIG.WEB_APP_URL}?action=getCatches`);
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    allCatches = data.catches || [];
    populateFilters();
    applyFilters();
  } catch(err) {
    console.error(err);
    showToast('Could not load catches. Check your Web App URL.','error');
    renderEmptyStats(); renderFishBreakdown([]); renderStateBreakdown([]); renderFavs(); renderCatches([]);
  } finally { hideLoading(); }
}

/* ═══════════════════════════════════════════════════════════
   SUBMIT / EDIT CATCH
═══════════════════════════════════════════════════════════ */
async function submitCatch() {
  const fish   = document.getElementById('fFish').value.trim();
  const noTime = document.getElementById('fNoTime').checked;
  const date   = noTime
    ? document.getElementById('fDateOnly').value  // just YYYY-MM-DD
    : document.getElementById('fDate').value;
  const editId = document.getElementById('fEditId').value;
  if (!fish) { showToast('Fish type is required!','error'); return; }
  if (!date) { showToast('Date is required!','error'); return; }
  if (!CONFIG.WEB_APP_URL) { showToast('Set your Web App URL in config.js.','error'); return; }

  showLoading(editId ? 'Saving changes…' : 'Logging your catch…');

  const lure = document.getElementById('fLureCustom').value.trim() || document.getElementById('fLure').value;

  let photoB64 = '';
  const photoFile = document.getElementById('fPhoto').files[0];
  if (photoFile) { photoB64 = await fileToBase64(photoFile); photoB64 = await resizeImage(photoB64, 900); }

  const payload = {
    action:        editId ? 'editCatch' : 'addCatch',
    id:            editId || undefined,
    fish, weight: document.getElementById('fWeight').value !== '' ? parseFloat(document.getElementById('fWeight').value) : '',
    date, lure,
    rod:           document.getElementById('fRod').value,
    fishWith:      document.getElementById('fWith').value.trim(),
    location:      document.getElementById('fLocation').value.trim(),
    state:         document.getElementById('fState').value,
    trip:          document.getElementById('fTrip').value.trim(),
    notes:         document.getElementById('fNotes').value.trim(),
    photo:         photoB64,
    existingPhoto: document.getElementById('fExistingPhoto').value,
    cropPos:       document.getElementById('fCropPos').value || 'center center',
    city:          document.getElementById('fCity').value.trim(),
    lat:           document.getElementById('fLat').value !== '' ? parseFloat(document.getElementById('fLat').value) : '',
    lon:           document.getElementById('fLon').value !== '' ? parseFloat(document.getElementById('fLon').value) : '',
    sunrise:       document.getElementById('fSunrise').value,
    sunset:        document.getElementById('fSunset').value,
  };

  try {
    const resp = await fetch(CONFIG.WEB_APP_URL, { method:'POST', body: JSON.stringify(payload) });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    // Save crop position locally (keyed by ID returned from server, or editId)
    const savedId = data.id || editId;
    if (savedId) setCropPos(savedId, payload.cropPos);
    showToast(editId ? '✏️ Catch updated!' : '🎣 Catch logged!','success');
    navBack();
    resetForm();
    loadCatches();
  } catch(err) {
    console.error(err); showToast('Failed to save: ' + err.message,'error');
  } finally { hideLoading(); }
}

/* ─── DELETE ─────────────────────────────────────────────── */
async function deleteCatch(id) {
  if (!confirm('Delete this catch? Cannot be undone.')) return;
  showLoading('Deleting…');
  try {
    const resp = await fetch(CONFIG.WEB_APP_URL, { method:'POST', body: JSON.stringify({ action:'deleteCatch', id }) });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    const favs = getFavs().filter(f => f !== String(id)); saveFavs(favs);
    showToast('Catch deleted.','success');
    navBack();
    loadCatches();
  } catch(err) { showToast('Delete failed: ' + err.message,'error'); }
  finally { hideLoading(); }
}

/* ═══════════════════════════════════════════════════════════
   FILTERS
═══════════════════════════════════════════════════════════ */
function populateFilters() {
  const trips   = [...new Set(allCatches.map(c=>c.trip).filter(Boolean))].sort();
  const species = [...new Set(allCatches.map(c=>c.fish).filter(Boolean))].sort();
  const states  = [...new Set(allCatches.map(c=>c.state).filter(Boolean))].sort();

  const tripSel  = document.getElementById('filterTrip');
  const fishSel  = document.getElementById('filterFish');
  const stateSel = document.getElementById('filterState');
  const tripDL   = document.getElementById('tripSuggestions');

  tripSel.innerHTML  = '<option value="">All Trips</option>';
  fishSel.innerHTML  = '<option value="">All Species</option>';
  stateSel.innerHTML = '<option value="">All States</option>';
  tripDL.innerHTML   = '';

  trips.forEach(t   => { tripSel.insertAdjacentHTML('beforeend',`<option value="${esc(t)}">${esc(t)}</option>`); tripDL.insertAdjacentHTML('beforeend',`<option value="${esc(t)}">`); });
  species.forEach(s => fishSel.insertAdjacentHTML('beforeend', `<option value="${esc(s)}">${esc(s)}</option>`));
  states.forEach(s  => stateSel.insertAdjacentHTML('beforeend',`<option value="${esc(s)}">${esc(s)}</option>`));

  const lures = [...new Set(allCatches.map(c=>c.lure).filter(Boolean))].sort();
  const lureSel = document.getElementById('filterLure');
  lureSel.innerHTML = '<option value="">All Lures</option>';
  lures.forEach(l => lureSel.insertAdjacentHTML('beforeend', `<option value="${esc(l)}">${esc(l)}</option>`));

  const cities = [...new Set(allCatches.map(c=>c.city).filter(Boolean).map(c=>c.trim()))].sort();
  const citySel = document.getElementById('filterCity');
  citySel.innerHTML = '<option value="">All Cities</option>';
  cities.forEach(c => citySel.insertAdjacentHTML('beforeend', `<option value="${esc(c)}">${esc(c)}</option>`));

  // Autocomplete datalists
  const buddyDL = document.getElementById('buddySuggestions');
  if (buddyDL) { buddyDL.innerHTML = getBuddyStats().map(b=>`<option value="${esc(b.name)}">`).join(''); }
  const locDL = document.getElementById('locationSuggestions');
  if (locDL) { locDL.innerHTML = [...new Set(allCatches.map(c=>c.location).filter(Boolean).map(l=>l.trim()))].sort().map(s=>`<option value="${esc(s)}">`).join(''); }
  const cityDL = document.getElementById('citySuggestions');
  if (cityDL) { cityDL.innerHTML = [...new Set(allCatches.map(c=>c.city).filter(Boolean).map(c=>c.trim()))].sort().map(s=>`<option value="${esc(s)}">`).join(''); }
}

function applyFilters() {
  const tripVal  = document.getElementById('filterTrip').value;
  const fishVal  = document.getElementById('filterFish').value;
  const stateVal = document.getElementById('filterState').value;
  const cityVal  = document.getElementById('filterCity').value;
  const lureVal  = document.getElementById('filterLure').value;
  const monthVal = document.getElementById('filterMonth').value;
  const search   = document.getElementById('searchInput').value.toLowerCase();

  filtered = allCatches.filter(c => {
    if (tripVal  && c.trip  !== tripVal)  return false;
    if (fishVal  && c.fish  !== fishVal)  return false;
    if (stateVal && c.state !== stateVal) return false;
    if (cityVal  && (c.city||'').trim() !== cityVal) return false;
    if (lureVal  && c.lure  !== lureVal)  return false;
    if (monthVal !== '' && monthVal !== undefined) {
      if (!c.date) return false;
      const d = new Date(c.date);
      if (isNaN(d) || d.getMonth() !== parseInt(monthVal)) return false;
    }
    if (search) {
      const blob = [c.fish,c.location,c.state,c.lure,c.trip,c.notes,c.fishWith,c.rod].join(' ').toLowerCase();
      if (!blob.includes(search)) return false;
    }
    return true;
  });

  renderStats(filtered); renderFishBreakdown(filtered); renderStateBreakdown(filtered); renderFavs(); renderCatches(filtered);
}

function clearFilters() {
  ['filterTrip','filterFish','filterState','filterCity','filterLure','filterMonth','searchInput'].forEach(id => document.getElementById(id).value='');
  applyFilters();
}

/* ═══════════════════════════════════════════════════════════
   RENDER — STATS
═══════════════════════════════════════════════════════════ */
function renderStats(catches) {
  document.getElementById('statTotal').textContent   = catches.length;
  document.getElementById('statSpecies').textContent = new Set(catches.map(c=>c.fish).filter(Boolean)).size;
  document.getElementById('statTrips').textContent   = new Set(catches.map(c=>c.trip).filter(Boolean)).size;
  document.getElementById('statStates').textContent  = new Set(catches.map(c=>c.state).filter(Boolean)).size;

  const buddySet = new Set();
  allCatches.forEach(c => { if (c.fishWith) c.fishWith.split(',').forEach(b => { const t=b.trim(); if(t) buddySet.add(t); }); });
  document.getElementById('statBuddies').textContent = buddySet.size;

  const spotSet = new Set(allCatches.map(c=>c.location).filter(Boolean).map(l=>l.trim()));
  document.getElementById('statSpots').textContent = spotSet.size;

  const w = catches.filter(c=>parseFloat(c.weight)>0);
  if (w.length) {
    const big = w.reduce((a,b)=>parseFloat(a.weight)>parseFloat(b.weight)?a:b);
    document.getElementById('statBiggest').textContent    = parseFloat(big.weight).toFixed(2)+' lb';
    document.getElementById('statBiggestFish').textContent = big.fish;
  } else {
    document.getElementById('statBiggest').textContent    = '—';
    document.getElementById('statBiggestFish').textContent = '';
  }

  const best = computeBestDay(catches);
  _bestDayCatches = best.catches;
  if (best.key) {
    const [y,m,d] = best.key.split('-').map(Number);
    document.getElementById('statBestDay').textContent = new Date(y,m-1,d).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
    document.getElementById('statBestDayCount').textContent = best.catches.length + (best.catches.length===1 ? ' fish · tap →' : ' fish · tap →');
  } else {
    document.getElementById('statBestDay').textContent = '—';
    document.getElementById('statBestDayCount').textContent = '';
  }
}

// Groups catches by calendar day (local date, ignoring time) and returns
// the day with the most catches, so "Best Day" reflects a single outing
// rather than being skewed by timezone-edge timestamps.
function computeBestDay(catches) {
  const map = {};
  catches.forEach(c => {
    if (!c.date) return;
    const d = new Date(c.date);
    if (isNaN(d)) return;
    const key = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    (map[key] = map[key] || []).push(c);
  });
  let bestKey = null, bestCatches = [];
  Object.entries(map).forEach(([k,arr]) => { if (arr.length > bestCatches.length) { bestKey = k; bestCatches = arr; } });
  return { key: bestKey, catches: bestCatches };
}

function openBestDayCatches() {
  if (!_bestDayCatches.length) return;
  const sorted = [..._bestDayCatches].sort((a,b)=>new Date(a.date)-new Date(b.date));
  const dateStr = new Date(sorted[0].date).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
  document.getElementById('bestDayCatchesTitle').textContent = '🏆 '+dateStr+' ('+sorted.length+')';
  document.getElementById('bestDayCatchesBody').innerHTML = sorted.map((c,i)=>buildCatchCard(c,i,false)).join('');
  navTo('page-best-day-catches');
}
function renderEmptyStats() {
  ['statTotal','statSpecies','statBiggest','statTrips','statStates','statBuddies','statSpots','statBestDay'].forEach(id => document.getElementById(id).textContent='—');
  document.getElementById('statBestDayCount').textContent = '';
  _bestDayCatches = [];
}

/* ─── SPECIES BREAKDOWN ─────────────────────────────────── */
function getFishEmoji(name) {
  const key=(name||'').toLowerCase();
  for (const [k,v] of Object.entries(FISH_EMOJI)) { if(k!=='default'&&key.includes(k)) return v; }
  return FISH_EMOJI.default;
}
/* ─── GEOCODE + SUNRISE API ──────────────────────────────────
   When a city is entered on the catch form:
   1. Geocode city+state → lat/lon via OpenStreetMap Nominatim
   2. Fetch exact sunrise/sunset from sunrise-sunset.org
   3. Store in hidden form fields so they get saved with the catch
   Falls back to pure-math state-center calculation for old catches
   that don't have saved lat/lon/sunrise/sunset.
──────────────────────────────────────────────────────────── */

// Called when the City field loses focus
async function fetchSunForCity() {
  const city  = document.getElementById('fCity').value.trim();
  const state = document.getElementById('fState').value;
  const date  = document.getElementById('fNoTime').checked
    ? document.getElementById('fDateOnly').value
    : document.getElementById('fDate').value;

  const preview = document.getElementById('sunPreview');

  // Clear if no city entered
  if (!city) {
    preview.textContent = '';
    ['fLat','fLon','fSunrise','fSunset'].forEach(id => document.getElementById(id).value = '');
    return;
  }

  preview.textContent = '⏳ Looking up sunrise/sunset…';

  try {
    // Step 1: Geocode via OpenStreetMap Nominatim
    const query    = encodeURIComponent(`${city}${state ? ', ' + state : ''}, USA`);
    const geoResp  = await fetch(`https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1`, {
      headers: { 'Accept-Language': 'en', 'User-Agent': 'FishingLog/1.0' }
    });
    const geoData  = await geoResp.json();
    if (!geoData.length) throw new Error('City not found');

    const lat = parseFloat(geoData[0].lat);
    const lon = parseFloat(geoData[0].lon);

    // Step 2: Fetch sunrise/sunset using the location's correct timezone
    // Pass tzid so the API returns local times, not UTC
    const STATE_TZ = {
      "Alabama":"America/Chicago","Alaska":"America/Anchorage","Arizona":"America/Phoenix",
      "Arkansas":"America/Chicago","California":"America/Los_Angeles","Colorado":"America/Denver",
      "Connecticut":"America/New_York","Delaware":"America/New_York","Florida":"America/New_York",
      "Georgia":"America/New_York","Hawaii":"Pacific/Honolulu","Idaho":"America/Denver",
      "Illinois":"America/Chicago","Indiana":"America/Indiana/Indianapolis","Iowa":"America/Chicago",
      "Kansas":"America/Chicago","Kentucky":"America/New_York","Louisiana":"America/Chicago",
      "Maine":"America/New_York","Maryland":"America/New_York","Massachusetts":"America/New_York",
      "Michigan":"America/Detroit","Minnesota":"America/Chicago","Mississippi":"America/Chicago",
      "Missouri":"America/Chicago","Montana":"America/Denver","Nebraska":"America/Chicago",
      "Nevada":"America/Los_Angeles","New Hampshire":"America/New_York","New Jersey":"America/New_York",
      "New Mexico":"America/Denver","New York":"America/New_York","North Carolina":"America/New_York",
      "North Dakota":"America/Chicago","Ohio":"America/New_York","Oklahoma":"America/Chicago",
      "Oregon":"America/Los_Angeles","Pennsylvania":"America/New_York","Rhode Island":"America/New_York",
      "South Carolina":"America/New_York","South Dakota":"America/Chicago","Tennessee":"America/Chicago",
      "Texas":"America/Chicago","Utah":"America/Denver","Vermont":"America/New_York",
      "Virginia":"America/New_York","Washington":"America/Los_Angeles","West Virginia":"America/New_York",
      "Wisconsin":"America/Chicago","Wyoming":"America/Denver"
    };
    // The API returns UTC times even with tzid in some cases.
    // We'll convert UTC → local ourselves using a UTC offset for the state.
    // We use the JS Intl API to get the actual UTC offset for the state's timezone
    // on the specific catch date (handles DST automatically).
    const tzid      = STATE_TZ[document.getElementById('fState').value] || 'America/New_York';
    const catchDate = date ? date.slice(0, 10) : new Date().toISOString().slice(0, 10);
    const sunResp   = await fetch(`https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lon}&date=${catchDate}&formatted=0`);
    const sunData   = await sunResp.json();
    if (sunData.status !== 'OK') throw new Error('Sunrise API error');

    // Get UTC offset in minutes for the catch location's timezone on the catch date
    // Intl.DateTimeFormat with timeZone handles DST correctly
    const getUtcOffsetMins = (tzId, dateStr) => {
      const d = new Date(dateStr + 'T12:00:00Z');
      const utcStr   = d.toLocaleString('en-US', { timeZone: 'UTC' });
      const localStr = d.toLocaleString('en-US', { timeZone: tzId });
      const utcDate  = new Date(utcStr);
      const locDate  = new Date(localStr);
      return (locDate - utcDate) / 60000; // minutes
    };

    const offsetMins = getUtcOffsetMins(tzid, catchDate);

    // Convert UTC ISO string to local HH:MM
    const toLocalTime = (isoStr) => {
      const utcDate = new Date(isoStr);
      const localMs = utcDate.getTime() + offsetMins * 60000;
      const localDate = new Date(localMs);
      const h = localDate.getUTCHours();
      const m = localDate.getUTCMinutes();
      return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    };

    const sunriseLocal = toLocalTime(sunData.results.sunrise);
    const sunsetLocal  = toLocalTime(sunData.results.sunset);

    // Store as "HHMM" without colon — Google Sheets auto-converts "HH:MM"
    // into a time serial number, corrupting the value on read-back.
    // "2115" is just a number string Sheets won't touch.
    const toStorable = (hhmm) => hhmm ? hhmm.replace(':', '') : '';

    document.getElementById('fLat').value     = lat;
    document.getElementById('fLon').value     = lon;
    document.getElementById('fSunrise').value = toStorable(sunriseLocal);
    document.getElementById('fSunset').value  = toStorable(sunsetLocal);

    // Show preview using formatted display (still HH:MM for display)
    const srDisp = fmtTimeStr(sunriseLocal);
    const ssDisp = fmtTimeStr(sunsetLocal);
    preview.innerHTML = `🌅 Sunrise ${srDisp}<br>🌇 Sunset ${ssDisp}`;

  } catch(err) {
    console.warn('Sun fetch failed:', err.message);
    preview.textContent = '⚠️ Could not fetch — will use state average';
    ['fLat','fLon','fSunrise','fSunset'].forEach(id => document.getElementById(id).value = '');
  }
}

// Format stored "HHMM" or "HH:MM" string to "7:34 AM" display
function fmtTimeStr(hhmm) {
  if (!hhmm) return '—';
  const s = String(hhmm).trim();
  let h, m;
  if (s.includes(':')) {
    [h, m] = s.split(':').map(Number);
  } else if (s.length === 4) {
    h = parseInt(s.slice(0, 2));
    m = parseInt(s.slice(2, 4));
  } else if (s.length === 3) {
    h = parseInt(s.slice(0, 1));
    m = parseInt(s.slice(1, 3));
  } else {
    return '—';
  }
  if (isNaN(h) || isNaN(m)) return '—';
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12  = h % 12 || 12;
  return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
}

// Convert stored "HHMM" or "HH:MM" to minutes since midnight
function hmToMins(hhmm) {
  if (!hhmm) return null;
  const s = String(hhmm).trim();
  let h, m;
  if (s.includes(':')) {
    [h, m] = s.split(':').map(Number);
  } else if (s.length === 4) {
    h = parseInt(s.slice(0, 2));
    m = parseInt(s.slice(2, 4));
  } else if (s.length === 3) {
    h = parseInt(s.slice(0, 1));
    m = parseInt(s.slice(1, 3));
  } else {
    return null;
  }
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

/* ─── SUNRISE / SUNSET CALCULATION ─────────────────────────
   Pure-math implementation of the NOAA solar position algorithm.
   Uses each catch's state to look up approximate center lat/lon.
   Accurate to within ~5 minutes for any US location.
──────────────────────────────────────────────────────────── */

const STATE_COORDS = {
  "Alabama":{"lat":32.8,"lon":-86.8},"Alaska":{"lat":64.2,"lon":-153.4},
  "Arizona":{"lat":34.3,"lon":-111.1},"Arkansas":{"lat":34.8,"lon":-92.2},
  "California":{"lat":36.8,"lon":-119.4},"Colorado":{"lat":39.0,"lon":-105.5},
  "Connecticut":{"lat":41.6,"lon":-72.7},"Delaware":{"lat":39.0,"lon":-75.5},
  "Florida":{"lat":27.8,"lon":-81.6},"Georgia":{"lat":32.7,"lon":-83.4},
  "Hawaii":{"lat":20.3,"lon":-156.4},"Idaho":{"lat":44.4,"lon":-114.5},
  "Illinois":{"lat":40.0,"lon":-89.2},"Indiana":{"lat":40.0,"lon":-86.1},
  "Iowa":{"lat":42.0,"lon":-93.3},"Kansas":{"lat":38.5,"lon":-98.4},
  "Kentucky":{"lat":37.5,"lon":-85.3},"Louisiana":{"lat":31.2,"lon":-91.8},
  "Maine":{"lat":45.3,"lon":-69.0},"Maryland":{"lat":39.0,"lon":-76.8},
  "Massachusetts":{"lat":42.3,"lon":-71.8},"Michigan":{"lat":44.3,"lon":-85.4},
  "Minnesota":{"lat":46.4,"lon":-93.1},"Mississippi":{"lat":32.7,"lon":-89.7},
  "Missouri":{"lat":38.5,"lon":-92.5},"Montana":{"lat":47.0,"lon":-110.5},
  "Nebraska":{"lat":41.5,"lon":-99.9},"Nevada":{"lat":39.3,"lon":-116.6},
  "New Hampshire":{"lat":43.7,"lon":-71.6},"New Jersey":{"lat":40.1,"lon":-74.5},
  "New Mexico":{"lat":34.4,"lon":-106.1},"New York":{"lat":42.9,"lon":-75.5},
  "North Carolina":{"lat":35.5,"lon":-79.4},"North Dakota":{"lat":47.5,"lon":-100.5},
  "Ohio":{"lat":40.4,"lon":-82.8},"Oklahoma":{"lat":35.6,"lon":-97.5},
  "Oregon":{"lat":44.0,"lon":-120.5},"Pennsylvania":{"lat":40.9,"lon":-77.8},
  "Rhode Island":{"lat":41.7,"lon":-71.5},"South Carolina":{"lat":33.8,"lon":-80.9},
  "South Dakota":{"lat":44.4,"lon":-100.3},"Tennessee":{"lat":35.9,"lon":-86.4},
  "Texas":{"lat":31.5,"lon":-99.3},"Utah":{"lat":39.3,"lon":-111.1},
  "Vermont":{"lat":44.1,"lon":-72.7},"Virginia":{"lat":37.8,"lon":-78.2},
  "Washington":{"lat":47.4,"lon":-120.4},"West Virginia":{"lat":38.6,"lon":-80.6},
  "Wisconsin":{"lat":44.3,"lon":-89.8},"Wyoming":{"lat":43.0,"lon":-107.6}
};

// Returns sunrise and sunset as minutes-since-midnight (local time) for a given date + state.
// Returns null if state unknown or sun doesn't rise/set (polar extremes).
function getSunTimes(dateObj, state) {
  const coords = STATE_COORDS[state];
  if (!coords) return null;

  const lat  = coords.lat;
  const lon  = coords.lon;
  const rad  = Math.PI / 180;
  const deg  = 180 / Math.PI;

  // Julian day number
  const jd = dateObj.getTime() / 86400000 + 2440587.5;
  const n  = Math.round(jd - 2451545.0 + 0.5 - lon / 360);

  // Mean solar noon
  const jStar = n - lon / 360;

  // Solar mean anomaly
  const M = (357.5291 + 0.98560028 * jStar) % 360;

  // Equation of centre
  const C = 1.9148 * Math.sin(M * rad)
           + 0.0200 * Math.sin(2 * M * rad)
           + 0.0003 * Math.sin(3 * M * rad);

  // Ecliptic longitude
  const lam = (M + C + 180 + 102.9372) % 360;

  // Solar transit
  const jTransit = 2451545.0 + jStar + 0.0053 * Math.sin(M * rad)
                 - 0.0069 * Math.sin(2 * lam * rad);

  // Declination
  const sinDec = Math.sin(lam * rad) * Math.sin(23.4397 * rad);
  const cosDec = Math.cos(Math.asin(sinDec));

  // Hour angle
  const cosHa = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * sinDec)
               / (Math.cos(lat * rad) * cosDec);

  if (cosHa < -1 || cosHa > 1) return null; // midnight sun / polar night

  const ha = Math.acos(cosHa) * deg;

  const jRise = jTransit - ha / 360;
  const jSet  = jTransit + ha / 360;

  // Convert Julian days to local minutes-since-midnight
  // Use UTC offset from the Date object as approximation
  const utcOffsetMins = -dateObj.getTimezoneOffset();
  const jdToLocalMins = (jd) => {
    const totalMins = (jd - Math.floor(jd) + 0.5) * 1440 + utcOffsetMins;
    return ((totalMins % 1440) + 1440) % 1440;
  };

  return {
    sunrise: jdToLocalMins(jRise),
    sunset:  jdToLocalMins(jSet),
  };
}

function minsToRelStr(diffMins) {
  const abs = Math.abs(Math.round(diffMins));
  const h   = Math.floor(abs / 60);
  const m   = abs % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function minsToTimeStr(m) {
  const h=Math.floor(m/60)%24, mn=Math.round(m%60);
  return `${h%12||12}:${String(mn).padStart(2,'0')} ${h<12?'AM':'PM'}`;
}

function hasTime(c) {
  const s = String(c.date||'');
  return s.includes('T') && !s.endsWith('T00:00:00.000Z');
}

// Returns enriched time stats for a set of catches.
// Groups into AM (before noon) and PM (after noon), calculates averages,
// and for each group also computes avg offset from sunrise (AM) or sunset (PM).
function calcAvgTimes(catches) {
  const amMins=[], pmMins=[], amSunOffsets=[], pmSunOffsets=[];

  catches.forEach(c => {
    if (!c.date || !hasTime(c)) return;
    const d = new Date(c.date);
    if (isNaN(d)) return;
    const mins = d.getHours()*60 + d.getMinutes();

    // Use saved API values if available, else fall back to state-center math
    let riseMins = null, setMins = null;
    if (c.sunrise && c.sunset) {
      riseMins = hmToMins(c.sunrise);
      setMins  = hmToMins(c.sunset);
    } else if (c.state) {
      const sun = getSunTimes(d, c.state);
      if (sun) { riseMins = sun.sunrise; setMins = sun.sunset; }
    }

    if (d.getHours() < 12) {
      amMins.push(mins);
      if (riseMins !== null) amSunOffsets.push(mins - riseMins);
    } else {
      pmMins.push(mins);
      if (setMins !== null) pmSunOffsets.push(mins - setMins);
    }
  });

  const avg = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;

  return {
    amAvg:       avg(amMins),
    pmAvg:       avg(pmMins),
    amCount:     amMins.length,
    pmCount:     pmMins.length,
    amSunOffset: avg(amSunOffsets),
    pmSunOffset: avg(pmSunOffsets),
    amHasSun:    amSunOffsets.length > 0,
    pmHasSun:    pmSunOffsets.length > 0,
  };
}

function formatSunRelative(offsetMins, isAm) {
  if (offsetMins === null) return '';
  const rel = minsToRelStr(Math.abs(offsetMins));
  if (isAm) {
    return offsetMins < 0
      ? `🌅 ${rel} before sunrise`
      : `${rel} after sunrise`;
  } else {
    return offsetMins < 0
      ? `${rel} before sunset`
      : `🌙 ${rel} after sunset`;
  }
}

function renderFishBreakdown(catches) {
  const el = document.getElementById('fishBreakdown');
  if (!catches.length) { el.innerHTML='<p style="color:#aaa;font-size:.84rem;margin:0 16px">No catches yet.</p>'; return; }
  const map={};
  catches.forEach(c=>{ if(!c.fish) return; if(!map[c.fish]) map[c.fish]={count:0,best:0,catches:[]}; map[c.fish].count++; const w=parseFloat(c.weight)||0; if(w>map[c.fish].best) map[c.fish].best=w; map[c.fish].catches.push(c); });
  el.innerHTML = Object.entries(map).sort((a,b)=>b[1].count-a[1].count).map(([name,s])=>{
    const t = calcAvgTimes(s.catches);
    let ts = '';
    if (t.amAvg !== null) {
      ts += `☀️ avg ${minsToTimeStr(t.amAvg)} (${t.amCount})`;
      if (t.amHasSun) ts += ` · ${formatSunRelative(t.amSunOffset, true)}`;
    }
    if (t.amAvg !== null && t.pmAvg !== null) ts += '<br>';
    if (t.pmAvg !== null) {
      ts += `🌇 avg ${minsToTimeStr(t.pmAvg)} (${t.pmCount})`;
      if (t.pmHasSun) ts += ` · ${formatSunRelative(t.pmSunOffset, false)}`;
    }
    return `<div class="fish-card" onclick="openDrilldown('species','${esc(name)}')">
      <div class="fish-icon">${getFishEmoji(name)}</div>
      <div class="fish-info">
        <div class="fish-name">${esc(name)}</div>
        <div class="fish-stats">${s.count} catch${s.count!==1?'es':''}${s.best?' · best '+s.best.toFixed(2)+' lb':''}${ts?'<br>'+ts:''}</div>
        <div class="click-hint">tap to view all →</div>
      </div></div>`;
  }).join('');
}

function renderStateBreakdown(catches) {
  const el = document.getElementById('stateBreakdown');
  const ws = catches.filter(c=>c.state&&c.state.trim());
  if (!ws.length) { el.innerHTML='<p style="color:#aaa;font-size:.84rem;margin:0 16px">No state data yet.</p>'; return; }
  const map={};
  ws.forEach(c=>{ const s=c.state.trim(); map[s]=(map[s]||0)+1; });
  el.innerHTML = Object.entries(map).sort((a,b)=>b[1]-a[1]).map(([state,count])=>`
    <div class="state-card" onclick="openDrilldown('state','${esc(state)}')">
      <div class="state-flag">${STATE_EMOJI[state]||'📍'}</div>
      <div><div class="state-name">${esc(state)}</div><div class="state-count">${count} catch${count!==1?'es':''}</div></div>
    </div>`).join('');
}

/* ─── BUILD CATCH CARD ───────────────────────────────────── */
// Crop positions stored locally by ID (display preference, no need for sheet column)
// Crop positions stored as one synced dict: { id: "top center", ... }
function getCropDict()    { return ls.get(pfx()+'crops', {}); }
function getCropPos(id)   { return getCropDict()[id] || 'center center'; }
function setCropPos(id, pos) {
  const dict = getCropDict();
  dict[id] = pos;
  setSynced(pfx()+'crops', dict);
}

function buildCatchCard(c, i, isFavCard) {
  const dt = c.date ? new Date(c.date).toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}) : '';
  const faved   = isFav(c.id);
  const cropPos = getCropPos(c.id);
  const photoHtml = c.photoUrl && c.photoUrl.trim()
    ? `<img class="catch-photo" src="${esc(c.photoUrl)}" alt="${esc(c.fish)}" loading="lazy" referrerpolicy="no-referrer" style="object-position:${cropPos}" />`
    : `<div class="catch-photo-placeholder">${getFishEmoji(c.fish)}</div>`;
  const tags = [c.trip,c.state].filter(Boolean);
  return `<div class="catch-card${isFavCard?' fav-card':''}" style="animation-delay:${Math.min(i,8)*40}ms">
    <div class="catch-photo-wrap" onclick="openDetail('${esc(c.id)}')">
      ${photoHtml}
      <button class="heart-btn" onclick="toggleFav('${esc(c.id)}',event)" title="${faved?'Unfavorite':'Favorite'}">${faved?'❤️':'🤍'}</button>
    </div>
    <div class="catch-body" onclick="openDetail('${esc(c.id)}')">
      <div class="catch-fish-name">${esc(c.fish||'—')}</div>
      <div class="catch-meta">
        ${c.weight   ?`<span>⚖️ ${parseFloat(c.weight).toFixed(2)} lb</span>`:''}
        ${c.state    ?`<span>📍 ${esc(c.state)}</span>`:''}
        ${c.location ?`<span>🗺️ ${esc(c.location)}</span>`:''}
        ${c.lure     ?`<span>🪱 ${esc(c.lure)}</span>`:''}
        ${dt         ?`<span>🕐 ${dt}</span>`:''}
      </div>
      ${tags.length?`<div class="catch-tags">${tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div>`:''}
      <div class="catch-tap-hint">tap for details &amp; edit →</div>
    </div></div>`;
}

/* ─── RENDER CATCH LOG ───────────────────────────────────── */
function renderCatches(catches) {
  const el     = document.getElementById('catchGrid');
  const footer = document.getElementById('catchLogFooter');
  const count  = document.getElementById('catchLogCount');
  if (!catches.length) {
    el.innerHTML=`<div class="empty-state"><div class="fish-big">🎣</div><h3>No catches yet</h3><p>Hit "+ Log a Catch" to start.</p></div>`;
    if(footer) footer.style.display='none'; if(count) count.textContent=''; return;
  }
  const sorted = [...catches].sort((a,b)=>new Date(b.date)-new Date(a.date));
  const pageSize = getCatchPageSize();
  el.innerHTML = sorted.slice(0,pageSize).map((c,i)=>buildCatchCard(c,i,false)).join('');
  if(footer) footer.style.display = sorted.length>pageSize?'flex':'none';
  if(count)  count.textContent    = sorted.length>pageSize?`Showing ${pageSize} of ${sorted.length} catches`:`${sorted.length} catch${sorted.length!==1?'es':''}`;
}

/* ─── ALL CATCHES PAGE ───────────────────────────────────── */
function prepAllCatches() {
  const sorted = [...filtered].sort((a,b)=>new Date(b.date)-new Date(a.date));
  document.getElementById('allCatchesTitle').textContent = `All Catches (${sorted.length})`;
  document.getElementById('allCatchesBody').innerHTML = sorted.map((c,i) => buildCatchCard(c,i,false)).join('');
}

/* ─── CATCH DETAIL PAGE ──────────────────────────────────── */
function openDetail(id) {
  const c = allCatches.find(x=>x.id===id);
  if (!c) return;
  const dt = c.date ? new Date(c.date).toLocaleString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}) : '—';
  const faved = isFav(c.id);
  const photoHtml = c.photoUrl&&c.photoUrl.trim()
    ? `<img class="detail-photo" src="${esc(c.photoUrl)}" alt="${esc(c.fish)}" referrerpolicy="no-referrer" />`
    : `<div class="detail-photo-placeholder">${getFishEmoji(c.fish)}</div>`;

  // Use saved sunrise/sunset if available, else fall back to state-center math
  let sunriseStr = '—', sunsetStr = '—', sunRelStr = '';
  let sunIsExact = false;
  if (c.date && hasTime(c)) {
    const d = new Date(c.date);
    const catchMins = d.getHours()*60 + d.getMinutes();
    let riseMins = null, setMins = null;

    if (c.sunrise && c.sunset) {
      // Saved exact values from API
      riseMins   = hmToMins(c.sunrise);
      setMins    = hmToMins(c.sunset);
      sunriseStr = fmtTimeStr(c.sunrise);
      sunsetStr  = fmtTimeStr(c.sunset);
      sunIsExact = true;
    } else if (c.state) {
      // Fall back to pure-math state-center estimate
      const sun = getSunTimes(d, c.state);
      if (sun) {
        riseMins   = Math.round(sun.sunrise);
        setMins    = Math.round(sun.sunset);
        sunriseStr = minsToTimeStr(riseMins) + ' (est.)';
        sunsetStr  = minsToTimeStr(setMins)  + ' (est.)';
      }
    }

    if (riseMins !== null && setMins !== null) {
      if (catchMins < riseMins) {
        sunRelStr = `🌙 ${minsToRelStr(riseMins - catchMins)} before sunrise`;
      } else if (catchMins < setMins) {
        sunRelStr = `☀️ ${minsToRelStr(catchMins - riseMins)} after sunrise · ${minsToRelStr(setMins - catchMins)} before sunset`;
      } else {
        sunRelStr = `🌙 ${minsToRelStr(catchMins - setMins)} after sunset`;
      }
    }
  }

  const fields = [
    {label:'Weight',      value: c.weight?parseFloat(c.weight).toFixed(2)+' lbs':'—'},
    {label:'Date & Time', value: dt},
    {label:'State',       value: c.state?`${STATE_EMOJI[c.state]||'📍'} ${c.state}`:'—'},
    {label:'City',        value: c.city||'—'},
    {label:'Location',    value: c.location||'—'},
    {label: sunIsExact ? 'Sunrise (exact)' : 'Sunrise (est.)', value: sunriseStr},
    {label: sunIsExact ? 'Sunset (exact)'  : 'Sunset (est.)',  value: sunsetStr},
    {label:'Lure / Bait', value: c.lure||'—'},
    {label:'Rod',         value: c.rod||'—'},
    {label:'Fished With', value: c.fishWith||'—'},
    {label:'Trip',        value: c.trip||'—'},
  ];

  document.getElementById('detailPageBody').innerHTML = `
    ${photoHtml}
    <div class="page-content">
      <div class="detail-fish-name">${esc(c.fish||'—')}</div>
      <div class="detail-grid">${fields.map(f=>`<div class="detail-item"><div class="detail-item-label">${f.label}</div><div class="detail-item-value">${esc(f.value)}</div></div>`).join('')}</div>
      ${sunRelStr ? `<div class="detail-notes" style="font-family:'DM Mono',monospace;font-size:.78rem;color:var(--water-dk)">${esc(sunRelStr)}</div>` : ''}
      ${c.notes?`<div class="detail-notes"><div class="detail-item-label" style="margin-bottom:5px">Notes</div>${esc(c.notes)}</div>`:''}
      <div class="detail-actions">
        <button class="btn btn-outline" onclick="openEditCatch('${esc(c.id)}')">✏️ Edit</button>
        <button class="btn btn-outline" id="detailFavBtn" onclick="toggleFavFromDetail('${esc(c.id)}')">${faved?'💔 Unfavorite':'❤️ Favorite'}</button>
        <button class="btn btn-danger" onclick="deleteCatch('${esc(c.id)}')">🗑 Delete</button>
      </div>
    </div>`;
  navTo('page-detail');
}

function toggleFavFromDetail(id) {
  toggleFav(id, null);
  const btn = document.getElementById('detailFavBtn');
  if (btn) btn.textContent = isFav(id) ? '💔 Unfavorite' : '❤️ Favorite';
}

/* ─── EDIT CATCH ─────────────────────────────────────────── */
function openEditCatch(id) {
  const c = allCatches.find(x=>x.id===id);
  if (!c) return;
  document.getElementById('logPageTitle').textContent  = 'Edit Catch';
  document.getElementById('logSaveBtn').textContent    = '💾 Save Changes';
  document.getElementById('fEditId').value             = c.id;
  document.getElementById('fExistingPhoto').value      = c.photoUrl || '';
  document.getElementById('fFish').value               = c.fish     || '';
  document.getElementById('fWeight').value             = c.weight!==undefined&&c.weight!=='' ? c.weight : '';
  document.getElementById('fLureCustom').value         = '';
  document.getElementById('fWith').value               = c.fishWith || '';
  document.getElementById('fLocation').value           = c.location || '';
  document.getElementById('fCity').value               = c.city     || '';
  document.getElementById('fTrip').value               = c.trip     || '';
  // Restore saved sun data
  document.getElementById('fLat').value     = c.lat     || '';
  document.getElementById('fLon').value     = c.lon     || '';
  document.getElementById('fSunrise').value = c.sunrise || '';
  document.getElementById('fSunset').value  = c.sunset  || '';
  const sp = document.getElementById('sunPreview');
  if (c.sunrise && c.sunset) {
    sp.innerHTML = `🌅 Sunrise ${fmtTimeStr(c.sunrise)}<br>🌇 Sunset ${fmtTimeStr(c.sunset)}`;
  } else {
    sp.textContent = '';
  }
  document.getElementById('fNotes').value              = c.notes    || '';
  document.getElementById('fState').value              = c.state    || '';
  // Detect if this catch was saved without a time (date-only string has no 'T')
  const hasTime = c.date && c.date.includes('T') && !c.date.endsWith('T00:00:00.000Z');
  const noTimeCheck = document.getElementById('fNoTime');
  noTimeCheck.checked = !hasTime;
  document.getElementById('fDate').style.display     = hasTime ? '' : 'none';
  document.getElementById('fDateOnly').style.display = hasTime ? 'none' : '';
  if (c.date) {
    try {
      const d = new Date(c.date);
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      if (hasTime) {
        document.getElementById('fDate').value = d.toISOString().slice(0,16);
      } else {
        document.getElementById('fDateOnly').value = d.toISOString().slice(0,10);
      }
    } catch { setDateTimeNow('fDate'); }
  } else { setDateTimeNow('fDate'); }
  refreshLureDropdown();
  const matchedLure = getTackle().find(t=>lureMatches(c, t));
  document.getElementById('fLure').value = matchedLure ? tackleLabelFor(matchedLure) : '';
  if (!matchedLure) document.getElementById('fLureCustom').value = c.lure || '';
  refreshRodDropdown();
  document.getElementById('fRod').value = c.rod || '';
  const prev = document.getElementById('fPhotoPreview');
  if (c.photoUrl && c.photoUrl.trim()) {
    prev.src = c.photoUrl;
    prev.classList.add('show');
    // Restore saved crop position
    const savedCrop = c.cropPos || 'center center';
    document.getElementById('fCropPos').value = savedCrop;
    prev.style.objectPosition = savedCrop;
    document.getElementById('fCropControl').classList.add('show');
    buildCropGrid('fCropGrid','fCropPos','fPhotoPreview');
  } else {
    prev.classList.remove('show');
    document.getElementById('fCropControl').classList.remove('show');
    document.getElementById('fCropPos').value = 'center center';
  }
  document.getElementById('fPhoto').value='';
  _skipLogReset = true;
  navTo('page-log');
}

/* ─── DRILL-DOWN (species / state) ──────────────────────── */
function openDrilldown(type, value) {
  let subset, title;
  if (type==='species') { subset=filtered.filter(c=>c.fish===value); title=`${getFishEmoji(value)} ${value} (${subset.length})`; }
  else                  { subset=filtered.filter(c=>c.state&&c.state.trim()===value); title=`${STATE_EMOJI[value]||'📍'} ${value} (${subset.length})`; }
  document.getElementById('drilldownTitle').textContent = title;
  const sorted=[...subset].sort((a,b)=>new Date(b.date)-new Date(a.date));
  document.getElementById('drilldownBody').innerHTML = sorted.map((c,i)=>buildCatchCard(c,i,false)).join('');
  navTo('page-drilldown');
}

/* ─── BUDDIES PAGE ───────────────────────────────────────── */
function parseBuddies(fw) { if(!fw||!fw.trim()) return []; return fw.split(',').map(b=>b.trim()).filter(Boolean); }
function getBuddyStats() {
  const map={};
  allCatches.forEach(c=>{ parseBuddies(c.fishWith).forEach(name=>{ if(!map[name]) map[name]={name,count:0,firstDate:null}; map[name].count++; const d=c.date?new Date(c.date):null; if(d&&(!map[name].firstDate||d<map[name].firstDate)) map[name].firstDate=d; }); });
  return Object.values(map).sort((a,b)=>b.count-a.count);
}

function prepBuddiesPage() {
  const buddies = getBuddyStats();
  const el = document.getElementById('buddiesPageBody');
  if (!buddies.length) { el.innerHTML='<div class="empty-state"><div class="fish-big">🧑‍🤝‍🧑</div><h3>No buddies yet</h3><p>Add who you fished with when logging a catch.</p></div>'; return; }
  el.innerHTML = '<div class="list-rows">' + buddies.map(b=>{
    const initials=b.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const firstStr=b.firstDate?b.firstDate.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'—';
    return `<div class="list-row" onclick="openBuddyCatches('${esc(b.name)}')">
      <div class="list-avatar">${initials}</div>
      <div class="list-info"><div class="list-name">${esc(b.name)}</div><div class="list-meta">First fished: ${firstStr}</div></div>
      <div class="list-count">${b.count}</div><div class="list-arrow">›</div></div>`;
  }).join('') + '</div>';
}

function openBuddyCatches(name) {
  const catches = allCatches.filter(c=>parseBuddies(c.fishWith).includes(name)).sort((a,b)=>new Date(b.date)-new Date(a.date));
  document.getElementById('buddyCatchesTitle').textContent = name+' ('+catches.length+')';
  document.getElementById('buddyCatchesBody').innerHTML = catches.map((c,i)=>buildCatchCard(c,i,false)).join('');
  navTo('page-buddy-catches');
}

/* ─── SPOTS PAGE ─────────────────────────────────────────── */
function getSpotStats() {
  const map={};
  allCatches.forEach(c=>{ if(!c.location||!c.location.trim()) return; const loc=c.location.trim(); if(!map[loc]) map[loc]={name:loc,count:0,firstDate:null}; map[loc].count++; const d=c.date?new Date(c.date):null; if(d&&(!map[loc].firstDate||d<map[loc].firstDate)) map[loc].firstDate=d; });
  return Object.values(map).sort((a,b)=>b.count-a.count);
}

function prepSpotsPage() {
  const spots = getSpotStats();
  const el = document.getElementById('spotsPageBody');
  if (!spots.length) { el.innerHTML='<div class="empty-state"><div class="fish-big">📍</div><h3>No spots yet</h3><p>Add a location when logging a catch.</p></div>'; return; }
  const pins=['📍','🎣','🌊','🏞️','⛵','🌲'];
  el.innerHTML = '<div class="list-rows">' + spots.map(s=>{
    const firstStr=s.firstDate?s.firstDate.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'—';
    const pin=pins[s.name.charCodeAt(0)%pins.length];
    return `<div class="list-row" onclick="openSpotCatches('${esc(s.name)}')">
      <div class="list-avatar list-avatar-spot">${pin}</div>
      <div class="list-info"><div class="list-name">${esc(s.name)}</div><div class="list-meta">First fished: ${firstStr}</div></div>
      <div class="list-count">${s.count}</div><div class="list-arrow">›</div></div>`;
  }).join('') + '</div>';
}

function openSpotCatches(location) {
  const catches = allCatches.filter(c=>c.location&&c.location.trim()===location).sort((a,b)=>new Date(b.date)-new Date(a.date));
  document.getElementById('spotCatchesTitle').textContent = '📍 '+location+' ('+catches.length+')';
  document.getElementById('spotCatchesBody').innerHTML = catches.map((c,i)=>buildCatchCard(c,i,false)).join('');
  navTo('page-spot-catches');
}

/* ─────────────────────────────────────────────────────────── */

/* ═══════════════════════════════════════════════════════════
   SETTINGS
═══════════════════════════════════════════════════════════ */
function toggleHowto(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('open');
}

function saveSettings() {
  const settings={
    defaultState: document.getElementById('settingsDefaultState').value,
    ownerName:    document.getElementById('settingsName').value.trim() || CONFIG.OWNER_NAME,
    pageSize:     document.getElementById('settingsPageSize').value,
  };
  saveSettingsLocal(settings);
  applyOwnerName(); populateStateDropdowns();
  renderCatches(filtered);
  showToast('Settings saved!','success');
}

function copyShareUrl() {
  if (!CONFIG.WEB_APP_URL) { showToast('No URL configured.','error'); return; }
  navigator.clipboard.writeText(CONFIG.WEB_APP_URL).then(()=>showToast('URL copied!','success'));
}

/* ═══════════════════════════════════════════════════════════
   FORM HELPERS
═══════════════════════════════════════════════════════════ */
function resetForm() {
  ['fFish','fWeight','fLureCustom','fWith','fLocation','fCity','fTrip','fNotes'].forEach(id=>document.getElementById(id).value='');
  ['fLat','fLon','fSunrise','fSunset'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('sunPreview').textContent = '';
  document.getElementById('fPhoto').value='';
  document.getElementById('fPhotoPreview').classList.remove('show');
  document.getElementById('fCropControl').classList.remove('show');
  document.getElementById('fCropPos').value = 'center center';
  document.getElementById('fNoTime').checked = false;
  document.getElementById('fDate').style.display = '';
  document.getElementById('fDateOnly').style.display = 'none';
  setDateTimeNow('fDate');
  document.getElementById('fState').value = getSettings().defaultState||'';
  refreshLureDropdown(); refreshRodDropdown();
}

/* ─── CROP POSITION CONTROL ──────────────────────────────── */
const CROP_POSITIONS = [
  { label:'↖', pos:'top left' },    { label:'↑', pos:'top center' },    { label:'↗', pos:'top right' },
  { label:'←', pos:'center left' }, { label:'·', pos:'center center' }, { label:'→', pos:'center right' },
  { label:'↙', pos:'bottom left' }, { label:'↓', pos:'bottom center' }, { label:'↘', pos:'bottom right' },
];

function buildCropGrid(gridId, hiddenId, previewId) {
  const grid    = document.getElementById(gridId);
  const hidden  = document.getElementById(hiddenId);
  const preview = document.getElementById(previewId);
  if (!grid) return;
  const current = hidden ? hidden.value || 'center center' : 'center center';
  grid.innerHTML = CROP_POSITIONS.map(({label, pos}) =>
    `<button type="button" class="crop-btn${pos===current?' active':''}"
      onclick="setCrop('${gridId}','${hiddenId}','${previewId}','${pos}')">${label}</button>`
  ).join('');
  if (preview) preview.style.objectPosition = current;
}

function setCrop(gridId, hiddenId, previewId, pos) {
  const hidden  = document.getElementById(hiddenId);
  const preview = document.getElementById(previewId);
  if (hidden)  hidden.value = pos;
  if (preview) preview.style.objectPosition = pos;
  // Update active button
  document.querySelectorAll(`#${gridId} .crop-btn`).forEach(btn => {
    btn.classList.toggle('active', btn.textContent === CROP_POSITIONS.find(p=>p.pos===pos)?.label);
  });
}

function previewPhoto() {
  const file    = document.getElementById('fPhoto').files[0];
  const img     = document.getElementById('fPhotoPreview');
  const control = document.getElementById('fCropControl');
  if (file) {
    const r = new FileReader();
    r.onload = e => {
      img.src = e.target.result;
      img.classList.add('show');
      control.classList.add('show');
      buildCropGrid('fCropGrid','fCropPos','fPhotoPreview');
    };
    r.readAsDataURL(file);
  } else {
    img.classList.remove('show');
    control.classList.remove('show');
  }
}

function previewShopPhoto() {
  const file    = document.getElementById('sPhoto').files[0];
  const img     = document.getElementById('sPhotoPreview');
  const control = document.getElementById('sCropControl');
  if (file) {
    const r = new FileReader();
    r.onload = e => {
      img.src = e.target.result;
      img.classList.add('show');
      control.classList.add('show');
      buildCropGrid('sCropGrid','sCropPos','sPhotoPreview');
    };
    r.readAsDataURL(file);
  } else {
    img.classList.remove('show');
    control.classList.remove('show');
  }
}

/* ─── IMAGE UTILS ────────────────────────────────────────── */
function fileToBase64(file) { return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); }); }
function resizeImage(dataUrl, maxWidth) {
  return new Promise(resolve=>{ const img=new Image(); img.onload=()=>{ let w=img.width,h=img.height; if(w>maxWidth){h=Math.round(h*maxWidth/w);w=maxWidth;} const c=document.createElement('canvas'); c.width=w;c.height=h; c.getContext('2d').drawImage(img,0,0,w,h); resolve(c.toDataURL('image/jpeg',.78)); }; img.src=dataUrl; });
}

/* ─── TOAST / LOADING ────────────────────────────────────── */
let toastTimer;
function showToast(msg,type='') { const el=document.getElementById('toast'); el.textContent=msg; el.className='toast show'+(type?' '+type:''); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),3500); }
function showLoading(msg='Loading…') { document.getElementById('loadingMsg').textContent=msg; document.getElementById('loadingOverlay').classList.add('active'); }
function hideLoading() { document.getElementById('loadingOverlay').classList.remove('active'); }

/* ═══════════════════════════════════════════════════════════
   FISH SHOPS
═══════════════════════════════════════════════════════════ */

let allShops      = [];
let _skipShopReset = false;

const SHOP_TYPES = ['Fly Fishing','Ocean Fishing','Bass Fishing','All'];
const SHOP_TYPE_EMOJI = {
  'Fly Fishing':   '🪰',
  'Ocean Fishing': '🌊',
  'Bass Fishing':  '🐟',
  'All':           '🎣',
};

async function loadShops() {
  if (!CONFIG.WEB_APP_URL) return;
  try {
    const resp = await fetch(`${CONFIG.WEB_APP_URL}?action=getShops`);
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    allShops = data.shops || [];
    renderShops();
    populateShopStateFilter();
  } catch(err) {
    console.error('Shops load error:', err);
  }
}

function populateShopStateFilter() {
  const sel = document.getElementById('shopFilterState');
  if (!sel) return;
  const current = sel.value;
  const states  = [...new Set(allShops.map(s=>s.state).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">All States</option>';
  states.forEach(s => sel.insertAdjacentHTML('beforeend',`<option value="${esc(s)}">${esc(s)}</option>`));
  sel.value = current;
}

function renderShops() {
  const el         = document.getElementById('shopGrid');
  if (!el) return;
  const stateVal   = (document.getElementById('shopFilterState')||{}).value || '';
  const typeVal    = (document.getElementById('shopFilterType')||{}).value  || '';

  const filtered   = allShops.filter(s => {
    if (stateVal && s.state    !== stateVal) return false;
    if (typeVal  && s.shopType !== typeVal)  return false;
    return true;
  });

  if (!filtered.length) {
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="fish-big">🏪</div><h3>No shops yet</h3><p>Tap "+ Add Shop" to add your first fish shop.</p></div>`;
    return;
  }

  el.innerHTML = filtered.map((s,i) => {
    const cropPos   = getCropPos(s.id);
    const photoHtml = s.photoUrl && s.photoUrl.trim()
      ? `<img class="shop-photo" src="${esc(s.photoUrl)}" alt="${esc(s.name)}" loading="lazy" referrerpolicy="no-referrer" style="object-position:${cropPos}" />`
      : `<div class="shop-photo-placeholder">${SHOP_TYPE_EMOJI[s.shopType]||'🏪'}</div>`;
    const location = [s.city, s.state].filter(Boolean).join(', ');
    return `<div class="shop-card" style="animation-delay:${Math.min(i,8)*40}ms" onclick="openShopDetail('${esc(s.id)}')">
      ${photoHtml}
      <div class="shop-body">
        <div class="shop-name">${esc(s.name)}</div>
        ${location ? `<div class="shop-location">📍 ${esc(location)}</div>` : ''}
        ${s.shopType ? `<span class="shop-type-badge">${SHOP_TYPE_EMOJI[s.shopType]||''} ${esc(s.shopType)}</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

function openShopDetail(id) {
  const s = allShops.find(x => x.id === id);
  if (!s) return;
  const photoHtml = s.photoUrl && s.photoUrl.trim()
    ? `<img class="shop-detail-photo" src="${esc(s.photoUrl)}" alt="${esc(s.name)}" referrerpolicy="no-referrer" />`
    : `<div class="shop-detail-placeholder">${SHOP_TYPE_EMOJI[s.shopType]||'🏪'}</div>`;
  const location = [s.city, s.state].filter(Boolean).join(', ');
  const fields = [
    { label:'Shop Type', value: s.shopType ? `${SHOP_TYPE_EMOJI[s.shopType]||''} ${s.shopType}` : '—' },
    { label:'City',      value: s.city    || '—' },
    { label:'State',     value: s.state   || '—' },
    { label:'Address',   value: s.address || '—' },
  ];
  document.getElementById('shopDetailBody').innerHTML = `
    ${photoHtml}
    <div class="page-content">
      <div class="detail-fish-name">${esc(s.name)}</div>
      ${location ? `<div style="font-family:'DM Mono',monospace;font-size:.75rem;color:var(--water);margin-bottom:14px">📍 ${esc(location)}</div>` : ''}
      <div class="detail-grid">
        ${fields.map(f=>`<div class="detail-item"><div class="detail-item-label">${f.label}</div><div class="detail-item-value">${esc(f.value)}</div></div>`).join('')}
      </div>
      ${s.notes ? `<div class="detail-notes"><div class="detail-item-label" style="margin-bottom:5px">Notes</div>${esc(s.notes)}</div>` : ''}
      <div class="detail-actions">
        <button class="btn btn-outline" onclick="openEditShop('${esc(s.id)}')">✏️ Edit</button>
        <button class="btn btn-danger" onclick="deleteShop('${esc(s.id)}')">🗑 Delete</button>
      </div>
    </div>`;
  navTo('page-shop-detail');
}

function openEditShop(id) {
  const s = allShops.find(x => x.id === id);
  if (!s) return;
  document.getElementById('shopFormTitle').textContent = 'Edit Shop';
  document.getElementById('shopSaveBtn').textContent   = '💾 Save Changes';
  document.getElementById('sEditId').value       = s.id;
  document.getElementById('sExistingPhoto').value = s.photoUrl || '';
  document.getElementById('sName').value    = s.name    || '';
  document.getElementById('sCity').value    = s.city    || '';
  document.getElementById('sAddress').value = s.address || '';
  document.getElementById('sNotes').value   = s.notes   || '';
  document.getElementById('sState').value   = s.state   || '';
  document.getElementById('sShopType').value = s.shopType || '';
  const prev = document.getElementById('sPhotoPreview');
  if (s.photoUrl && s.photoUrl.trim()) {
    prev.src = s.photoUrl;
    prev.classList.add('show');
    const savedCrop = s.cropPos || 'center center';
    document.getElementById('sCropPos').value = savedCrop;
    prev.style.objectPosition = savedCrop;
    document.getElementById('sCropControl').classList.add('show');
    buildCropGrid('sCropGrid','sCropPos','sPhotoPreview');
  } else {
    prev.classList.remove('show');
    document.getElementById('sCropControl').classList.remove('show');
    document.getElementById('sCropPos').value = 'center center';
  }
  document.getElementById('sPhoto').value = '';
  _skipShopReset = true;
  navTo('page-shop-add');
}

async function submitShop() {
  const name = document.getElementById('sName').value.trim();
  const city  = document.getElementById('sCity').value.trim();
  const editId = document.getElementById('sEditId').value;
  if (!name) { showToast('Shop name is required!','error'); return; }
  if (!city)  { showToast('City is required!','error'); return; }
  if (!CONFIG.WEB_APP_URL) { showToast('Set your Web App URL in config.js.','error'); return; }
  showLoading(editId ? 'Saving shop…' : 'Adding shop…');

  let photoB64 = '';
  const photoFile = document.getElementById('sPhoto').files[0];
  if (photoFile) { photoB64 = await fileToBase64(photoFile); photoB64 = await resizeImage(photoB64, 900); }

  const payload = {
    action:        editId ? 'editShop' : 'addShop',
    id:            editId || undefined,
    name,
    city,
    address:       document.getElementById('sAddress').value.trim(),
    state:         document.getElementById('sState').value,
    shopType:      document.getElementById('sShopType').value,
    notes:         document.getElementById('sNotes').value.trim(),
    photo:         photoB64,
    existingPhoto: document.getElementById('sExistingPhoto').value,
    cropPos:       document.getElementById('sCropPos').value || 'center center',
  };

  try {
    const resp = await fetch(CONFIG.WEB_APP_URL, { method:'POST', body: JSON.stringify(payload) });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    const savedId = data.id || editId;
    if (savedId) setCropPos(savedId, payload.cropPos);
    showToast(editId ? '✏️ Shop updated!' : '🏪 Shop added!','success');
    navBack();
    await loadShops();
  } catch(err) {
    console.error(err); showToast('Failed to save: '+err.message,'error');
  } finally { hideLoading(); }
}

async function deleteShop(id) {
  if (!confirm('Delete this shop? Cannot be undone.')) return;
  showLoading('Deleting…');
  try {
    const resp = await fetch(CONFIG.WEB_APP_URL, { method:'POST', body: JSON.stringify({ action:'deleteShop', id }) });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    showToast('Shop deleted.','success');
    navBack();
    await loadShops();
  } catch(err) { showToast('Delete failed: '+err.message,'error'); }
  finally { hideLoading(); }
}

function resetShopForm() {
  document.getElementById('shopFormTitle').textContent = 'Add Fish Shop';
  document.getElementById('shopSaveBtn').textContent   = '🏪 Save Shop';
  document.getElementById('sEditId').value        = '';
  document.getElementById('sExistingPhoto').value = '';
  document.getElementById('sCropPos').value        = 'center center';
  ['sName','sCity','sAddress','sNotes'].forEach(id => document.getElementById(id).value='');
  document.getElementById('sState').value    = '';
  document.getElementById('sShopType').value = '';
  document.getElementById('sPhoto').value    = '';
  document.getElementById('sPhotoPreview').classList.remove('show');
  document.getElementById('sCropControl').classList.remove('show');
}

/* ─── UTILS ──────────────────────────────────────────────── */
function esc(str) { if(str==null) return ''; return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
