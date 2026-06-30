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
function getFavs()     { return ls.get(pfx()+'favs',     []); }

// Sheet key mapping (sheet keys are short, human-readable)
const SHEET_KEY_MAP = {
  get [pfx()+'tackle']()   { return 'tackle'; },
  get [pfx()+'rods']()     { return 'rods'; },
  get [pfx()+'favs']()     { return 'favorites'; },
  get [pfx()+'settings']() { return 'settings'; },
};

// Generic setter: writes locally + stamps time + queues a Sheets push
function setSynced(localKey, value) {
  ls.set(localKey, value);
  ls.set(lsTimestampKey(localKey), Date.now());
  queueSyncPush(localKey, value);
}
function saveTackle(a)         { setSynced(pfx()+'tackle',   a); }
function saveRods(a)           { setSynced(pfx()+'rods',     a); }
function saveFavs(a)           { setSynced(pfx()+'favs',     a); }
function saveSettingsLocal(obj){ setSynced(pfx()+'settings', obj); }



/* ─── BACKGROUND SYNC ENGINE ─────────────────────────────── */
let _syncPending = {};
let _syncTimer   = null;

function queueSyncPush(localKey, value) {
  if (!CONFIG.WEB_APP_URL) return;
  const sheetKey = { [pfx()+'tackle']:'tackle', [pfx()+'rods']:'rods', [pfx()+'favs']:'favorites', [pfx()+'settings']:'settings' }[localKey];
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
      tackle:   pfx()+'tackle',
      rods:     pfx()+'rods',
      favorites:pfx()+'favs',
      settings: pfx()+'settings',
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
let _skipLogReset = false;

function navTo(pageId) {
  const current = _pageStack[_pageStack.length - 1];
  if (current === pageId) return;

  // Prep page content before showing it
  if (pageId === 'page-buddies')     prepBuddiesPage();
  if (pageId === 'page-spots')       prepSpotsPage();
  if (pageId === 'page-all-catches') prepAllCatches();
  if (pageId === 'page-tackle')      renderTackleList();
  if (pageId === 'page-rods')        renderRodList();
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
  ['fState','settingsDefaultState'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = id === 'settingsDefaultState'
      ? '<option value="">None</option>'
      : '<option value="">— Select State —</option>';
    US_STATES.forEach(s => {
      const o = document.createElement('option');
      o.value = s; o.textContent = s;
      if (s === def) o.selected = true;
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
}

function renderFavs() {
  const el   = document.getElementById('favGrid');
  const favs = getFavs();
  const favCatches = allCatches.filter(c => favs.includes(String(c.id)));
  if (!favCatches.length) {
    el.innerHTML = `<div class="empty-state"><div class="fish-big">🤍</div><h3>No favorites yet</h3><p>Tap the ♡ on any catch to add it here.</p></div>`;
    return;
  }
  const sorted = [...favCatches].sort((a,b) => new Date(b.date)-new Date(a.date));
  el.innerHTML = sorted.map((c,i) => buildCatchCard(c,i,true)).join('');
}

/* ═══════════════════════════════════════════════════════════
   TACKLE BOX
═══════════════════════════════════════════════════════════ */
function tackleLabelFor(t) { return t.name + (t.color ? ` (${t.color})` : ''); }

function renderTackleList() {
  const tackle = getTackle();
  const el = document.getElementById('tackleList');
  if (!tackle.length) {
    el.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:.76rem;color:#bbb;text-align:center;padding:24px">No lures yet. Add one below.</div>';
    return;
  }
  el.innerHTML = tackle.map((t,i) => {
    const count = allCatches.filter(c => c.lure === t.name).length;
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

function saveTackleEdit(i) {
  const name = document.getElementById('teNameInput').value.trim();
  if (!name) { showToast('Lure name is required.','error'); return; }
  const tackle = getTackle();
  tackle[i] = { name, color: document.getElementById('teColorInput').value.trim(), brand: document.getElementById('teBrandInput').value.trim(), details: document.getElementById('teDetailsInput').value.trim() };
  saveTackle(tackle);
  showToast('Lure updated!','success');
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
    o.value = t.name; o.textContent = tackleLabelFor(t);
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
  };

  try {
    const resp = await fetch(CONFIG.WEB_APP_URL, { method:'POST', body: JSON.stringify(payload) });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
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

  // Autocomplete datalists
  const buddyDL = document.getElementById('buddySuggestions');
  if (buddyDL) { buddyDL.innerHTML = getBuddyStats().map(b=>`<option value="${esc(b.name)}">`).join(''); }
  const locDL = document.getElementById('locationSuggestions');
  if (locDL) { locDL.innerHTML = [...new Set(allCatches.map(c=>c.location).filter(Boolean).map(l=>l.trim()))].sort().map(s=>`<option value="${esc(s)}">`).join(''); }
}

function applyFilters() {
  const tripVal  = document.getElementById('filterTrip').value;
  const fishVal  = document.getElementById('filterFish').value;
  const stateVal = document.getElementById('filterState').value;
  const lureVal  = document.getElementById('filterLure').value;
  const monthVal = document.getElementById('filterMonth').value;
  const search   = document.getElementById('searchInput').value.toLowerCase();

  filtered = allCatches.filter(c => {
    if (tripVal  && c.trip  !== tripVal)  return false;
    if (fishVal  && c.fish  !== fishVal)  return false;
    if (stateVal && c.state !== stateVal) return false;
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
  ['filterTrip','filterFish','filterState','filterLure','filterMonth','searchInput'].forEach(id => document.getElementById(id).value='');
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
  document.getElementById('statFavs').textContent    = getFavs().length;

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
}
function renderEmptyStats() {
  ['statTotal','statSpecies','statBiggest','statTrips','statStates','statFavs','statBuddies','statSpots'].forEach(id => document.getElementById(id).textContent='—');
}

/* ─── SPECIES BREAKDOWN ─────────────────────────────────── */
function getFishEmoji(name) {
  const key=(name||'').toLowerCase();
  for (const [k,v] of Object.entries(FISH_EMOJI)) { if(k!=='default'&&key.includes(k)) return v; }
  return FISH_EMOJI.default;
}
function minsToTimeStr(m) { const h=Math.floor(m/60)%24,mn=Math.round(m%60); return `${h%12||12}:${String(mn).padStart(2,'0')} ${h<12?'AM':'PM'}`; }
function calcAvgTimes(catches) {
  const am=[],pm=[];
  catches.forEach(c=>{
    if (!c.date) return;
    // Skip catches with no time — date-only entries come back as midnight UTC
    // which would corrupt the averages. We detect them by checking if the
    // stored string is just a date (no T) or ends at exactly midnight.
    const dateStr = String(c.date);
    if (!dateStr.includes('T') || dateStr.endsWith('T00:00:00.000Z')) return;
    const d=new Date(c.date); if(isNaN(d)) return;
    const m=d.getHours()*60+d.getMinutes();
    (d.getHours()<12?am:pm).push(m);
  });
  const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
  return { amAvg:avg(am), pmAvg:avg(pm), amCount:am.length, pmCount:pm.length };
}

function renderFishBreakdown(catches) {
  const el = document.getElementById('fishBreakdown');
  if (!catches.length) { el.innerHTML='<p style="color:#aaa;font-size:.84rem;margin:0 16px">No catches yet.</p>'; return; }
  const map={};
  catches.forEach(c=>{ if(!c.fish) return; if(!map[c.fish]) map[c.fish]={count:0,best:0,catches:[]}; map[c.fish].count++; const w=parseFloat(c.weight)||0; if(w>map[c.fish].best) map[c.fish].best=w; map[c.fish].catches.push(c); });
  el.innerHTML = Object.entries(map).sort((a,b)=>b[1].count-a[1].count).map(([name,s])=>{
    const t=calcAvgTimes(s.catches);
    let ts='';
    if(t.amAvg!==null) ts+=`☀️ avg ${minsToTimeStr(t.amAvg)} (${t.amCount})`;
    if(t.amAvg!==null&&t.pmAvg!==null) ts+=' · ';
    if(t.pmAvg!==null) ts+=`🌇 avg ${minsToTimeStr(t.pmAvg)} (${t.pmCount})`;
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
function buildCatchCard(c, i, isFavCard) {
  const dt = c.date ? new Date(c.date).toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}) : '';
  const faved = isFav(c.id);
  const photoHtml = c.photoUrl && c.photoUrl.trim()
    ? `<img class="catch-photo" src="${esc(c.photoUrl)}" alt="${esc(c.fish)}" loading="lazy" referrerpolicy="no-referrer" />`
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
  const fields = [
    {label:'Weight',      value: c.weight?parseFloat(c.weight).toFixed(2)+' lbs':'—'},
    {label:'Date & Time', value: dt},
    {label:'State',       value: c.state?`${STATE_EMOJI[c.state]||'📍'} ${c.state}`:'—'},
    {label:'Location',    value: c.location||'—'},
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
  document.getElementById('fTrip').value               = c.trip     || '';
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
  const matchedLure = getTackle().find(t=>t.name===c.lure);
  document.getElementById('fLure').value = matchedLure ? c.lure : '';
  if (!matchedLure) document.getElementById('fLureCustom').value = c.lure || '';
  refreshRodDropdown();
  document.getElementById('fRod').value = c.rod || '';
  const prev = document.getElementById('fPhotoPreview');
  if (c.photoUrl&&c.photoUrl.trim()) { prev.src=c.photoUrl; prev.classList.add('show'); } else prev.classList.remove('show');
  document.getElementById('fPhoto').value='';
  _skipLogReset = true;
  navTo('page-log');
}

/* ─── DRILL-DOWN (species / state) ──────────────────────── */
function openDrilldown(type, value) {
  let subset, title;
  if (type==='species') { subset=allCatches.filter(c=>c.fish===value); title=`${getFishEmoji(value)} ${value} (${subset.length})`; }
  else                  { subset=allCatches.filter(c=>c.state&&c.state.trim()===value); title=`${STATE_EMOJI[value]||'📍'} ${value} (${subset.length})`; }
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
  ['fFish','fWeight','fLureCustom','fWith','fLocation','fTrip','fNotes'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('fPhoto').value='';
  document.getElementById('fPhotoPreview').classList.remove('show');
  // Reset date/time toggle back to full datetime mode
  document.getElementById('fNoTime').checked = false;
  document.getElementById('fDate').style.display = '';
  document.getElementById('fDateOnly').style.display = 'none';
  setDateTimeNow('fDate');
  document.getElementById('fState').value = getSettings().defaultState||'';
  refreshLureDropdown(); refreshRodDropdown();
}

function previewPhoto() {
  const file=document.getElementById('fPhoto').files[0];
  const img=document.getElementById('fPhotoPreview');
  if(file){ const r=new FileReader(); r.onload=e=>{img.src=e.target.result;img.classList.add('show');}; r.readAsDataURL(file); }
  else img.classList.remove('show');
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

/* ─── UTILS ──────────────────────────────────────────────── */
function esc(str) { if(str==null) return ''; return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
