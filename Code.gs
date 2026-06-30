// ═══════════════════════════════════════════════════════════
//  FISHING LOG — Google Apps Script Backend  v4  (FIXED)
//
//  HOW TO UPDATE:
//  1. In Apps Script, select ALL text (Ctrl+A) and delete it
//  2. Paste this entire file
//  3. Change YOUR_SHEET_ID_HERE to your actual Sheet ID
//  4. Click Save (floppy disk)
//  5. Click Deploy → Manage Deployments → click the pencil ✏️
//     on your existing deployment → set Version to "New version"
//     → click Deploy
//  You MUST create a new version or changes won't take effect.
// ═══════════════════════════════════════════════════════════

// ── YOUR SHEET ID ───────────────────────────────────────────
const SHEET_ID    = "10rqVPyLthOjmbVY0z9k8bPjidEKc7LK0nhCLo2pVY-s";
const SHEET_TAB   = "Catches";
const APPDATA_TAB = "AppData";  // stores tackle/rods/favorites/settings as JSON

// ── COLUMN ORDER (do not reorder without clearing your sheet) ──
const COLS = [
  "ID",        // A
  "Date",      // B
  "Fish",      // C
  "Weight_lbs",// D
  "Location",  // E
  "State",     // F  ← NEW
  "Lure",      // G
  "Rod",       // H  ← NEW
  "FishWith",  // I  ← NEW
  "Trip",      // J
  "Notes",     // K
  "PhotoUrl"   // L
];

// Column index map (0-based) — keep in sync with COLS above
const COL = {
  ID:       0,
  DATE:     1,
  FISH:     2,
  WEIGHT:   3,
  LOCATION: 4,
  STATE:    5,
  LURE:     6,
  ROD:      7,
  FISHWITH: 8,
  TRIP:     9,
  NOTES:    10,
  PHOTOURL: 11,
};

// ═══════════════════════════════════════════════════════════
//  ENTRY POINTS
// ═══════════════════════════════════════════════════════════

function doGet(e) {
  try {
    const action = (e.parameter && e.parameter.action) || "getCatches";
    if (action === "getCatches") return jsonResponse(getCatches());
    if (action === "getAppData") return jsonResponse(getAppData());
    return jsonResponse({ error: "Unknown GET action: " + action });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action  = payload.action;
    if (action === "addCatch")    return jsonResponse(addCatch(payload));
    if (action === "editCatch")   return jsonResponse(editCatch(payload));
    if (action === "deleteCatch") return jsonResponse(deleteCatch(payload.id));
    if (action === "saveAppData") return jsonResponse(saveAppData(payload));
    return jsonResponse({ error: "Unknown POST action: " + action });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ═══════════════════════════════════════════════════════════
//  GET ALL CATCHES
// ═══════════════════════════════════════════════════════════

function getCatches() {
  const sheet = getSheet();
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { catches: [] };

  // Build header→index map from actual sheet (tolerant of column order)
  const rawHeader = rows[0];
  const hIdx = {};
  rawHeader.forEach((h, i) => {
    hIdx[String(h).trim().toLowerCase().replace(/[^a-z]/g, '')] = i;
  });

  const get = (row, key) => {
    const idx = hIdx[key.toLowerCase().replace(/[^a-z]/g, '')];
    return (idx !== undefined && row[idx] !== undefined && row[idx] !== null)
      ? String(row[idx])
      : '';
  };

  const catches = rows.slice(1)
    .filter(row => row[0] && String(row[0]).trim())
    .map(row => ({
      id:       get(row, 'id'),
      date:     row[hIdx['date']] ? new Date(row[hIdx['date']]).toISOString() : '',
      fish:     get(row, 'fish'),
      weight:   get(row, 'weightlbs') !== '' ? (Number(get(row, 'weightlbs')) || '') : '',
      location: get(row, 'location'),
      state:    get(row, 'state'),
      lure:     get(row, 'lure'),
      rod:      get(row, 'rod'),
      fishWith: get(row, 'fishwith'),
      trip:     get(row, 'trip'),
      notes:    get(row, 'notes'),
      photoUrl: get(row, 'photourl'),
    }));

  return { catches };
}

// ═══════════════════════════════════════════════════════════
//  ADD CATCH
// ═══════════════════════════════════════════════════════════

function addCatch(data) {
  const sheet    = getSheet();
  const id       = Utilities.getUuid();
  const date     = data.date ? new Date(data.date) : new Date();
  const photoUrl = (data.photo && data.photo.startsWith('data:image'))
                   ? savePhoto(data.photo, id)
                   : '';

  // Build row matched to COLS order
  const row = new Array(COLS.length).fill('');
  row[COL.ID]       = id;
  row[COL.DATE]     = date;
  row[COL.FISH]     = data.fish     || '';
  row[COL.WEIGHT]   = (data.weight !== undefined && data.weight !== '') ? data.weight : '';
  row[COL.LOCATION] = data.location || '';
  row[COL.STATE]    = data.state    || '';
  row[COL.LURE]     = data.lure     || '';
  row[COL.ROD]      = data.rod      || '';
  row[COL.FISHWITH] = data.fishWith || '';
  row[COL.TRIP]     = data.trip     || '';
  row[COL.NOTES]    = data.notes    || '';
  row[COL.PHOTOURL] = photoUrl;

  sheet.appendRow(row);
  return { success: true, id };
}

// ═══════════════════════════════════════════════════════════
//  EDIT CATCH
//  Writes ALL columns so previously-blank fields can be filled in.
// ═══════════════════════════════════════════════════════════

function editCatch(data) {
  const sheet  = getSheet();
  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][COL.ID]) !== String(data.id)) continue;

    const rowNum = i + 1; // Sheets rows are 1-indexed

    // Keep existing photo unless a new one was uploaded
    let photoUrl = data.existingPhoto || '';
    if (data.photo && data.photo.startsWith('data:image')) {
      photoUrl = savePhoto(data.photo, data.id);
    }

    // Build full row — every field explicitly set so blanks overwrite old values
    const newRow = new Array(COLS.length).fill('');
    newRow[COL.ID]       = data.id;
    newRow[COL.DATE]     = data.date ? new Date(data.date) : new Date(values[i][COL.DATE]);
    newRow[COL.FISH]     = data.fish     !== undefined ? (data.fish     || '') : '';
    newRow[COL.WEIGHT]   = (data.weight !== undefined && data.weight !== '') ? Number(data.weight) : '';
    newRow[COL.LOCATION] = data.location !== undefined ? (data.location || '') : '';
    newRow[COL.STATE]    = data.state    !== undefined ? (data.state    || '') : '';
    newRow[COL.LURE]     = data.lure     !== undefined ? (data.lure     || '') : '';
    newRow[COL.ROD]      = data.rod      !== undefined ? (data.rod      || '') : '';
    newRow[COL.FISHWITH] = data.fishWith !== undefined ? (data.fishWith || '') : '';
    newRow[COL.TRIP]     = data.trip     !== undefined ? (data.trip     || '') : '';
    newRow[COL.NOTES]    = data.notes    !== undefined ? (data.notes    || '') : '';
    newRow[COL.PHOTOURL] = photoUrl;

    sheet.getRange(rowNum, 1, 1, COLS.length).setValues([newRow]);
    return { success: true };
  }

  return { error: 'Catch not found with id: ' + data.id };
}

// ═══════════════════════════════════════════════════════════
//  DELETE CATCH
// ═══════════════════════════════════════════════════════════

function deleteCatch(id) {
  const sheet  = getSheet();
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][COL.ID]) === String(id)) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { error: 'Catch not found: ' + id };
}

// ═══════════════════════════════════════════════════════════
//  PHOTO STORAGE
//  Uses lh3.googleusercontent.com URL which works in <img> tags.
//  The old drive.google.com/uc?export=view URL is blocked by
//  browsers due to Google's security policies.
// ═══════════════════════════════════════════════════════════

function savePhoto(dataUrl, id) {
  try {
    const folderName = 'FishingLog Photos';
    const folders    = DriveApp.getFoldersByName(folderName);
    const folder     = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);

    const [header, b64] = dataUrl.split(',');
    const mimeType = header.match(/data:([^;]+);/)[1];
    const blob     = Utilities.newBlob(Utilities.base64Decode(b64), mimeType, id + '.jpg');
    const file     = folder.createFile(blob);

    // Must be publicly viewable for <img> tags to load it
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    // lh3 URL works directly in browsers; uc?export=view does NOT
    return 'https://lh3.googleusercontent.com/d/' + file.getId();
  } catch (err) {
    Logger.log('Photo save error: ' + err.message);
    return '';
  }
}

// ═══════════════════════════════════════════════════════════
//  APP DATA SYNC  (tackle, rods, favorites, settings)
//  Stored as JSON blobs in a simple key/value tab so it never
//  conflicts with or touches the Catches tab.
//  Each key has a "lastModified" timestamp for simple
//  last-write-wins conflict resolution across devices.
// ═══════════════════════════════════════════════════════════

const APPDATA_KEYS = ["tackle", "rods", "favorites", "settings"];

function getAppData() {
  const sheet = getAppDataSheet();
  const rows  = sheet.getDataRange().getValues();
  const result = {};

  APPDATA_KEYS.forEach(key => result[key] = { value: null, lastModified: 0 });

  rows.slice(1).forEach(row => {
    const key = String(row[0] || '').trim();
    if (!APPDATA_KEYS.includes(key)) return;
    let parsed = null;
    try { parsed = row[1] ? JSON.parse(row[1]) : null; } catch (e) { parsed = null; }
    result[key] = {
      value: parsed,
      lastModified: row[2] ? new Date(row[2]).getTime() : 0,
    };
  });

  return result;
}

function saveAppData(data) {
  const sheet = getAppDataSheet();
  const rows  = sheet.getDataRange().getValues();
  const now   = new Date();

  // data.updates is an object like { tackle: [...], rods: [...] }
  // Only keys present in data.updates get written/overwritten.
  const updates = data.updates || {};

  Object.keys(updates).forEach(key => {
    if (!APPDATA_KEYS.includes(key)) return;
    const jsonStr = JSON.stringify(updates[key]);

    // Find existing row for this key
    let rowIdx = -1;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).trim() === key) { rowIdx = i; break; }
    }

    if (rowIdx >= 0) {
      sheet.getRange(rowIdx + 1, 2, 1, 2).setValues([[jsonStr, now]]);
    } else {
      sheet.appendRow([key, jsonStr, now]);
    }
  });

  return { success: true, lastModified: now.getTime() };
}

function getAppDataSheet() {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  let   sheet = ss.getSheetByName(APPDATA_TAB);

  if (!sheet) {
    sheet = ss.insertSheet(APPDATA_TAB);
    sheet.appendRow(["Key", "ValueJSON", "LastModified"]);
    const hdr = sheet.getRange(1, 1, 1, 3);
    hdr.setFontWeight('bold');
    hdr.setBackground('#4a6741');
    hdr.setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 120);
    sheet.setColumnWidth(2, 500);
    sheet.setColumnWidth(3, 160);
  }

  return sheet;
}

// ═══════════════════════════════════════════════════════════
//  SHEET SETUP
//  Auto-creates the Catches tab with correct headers if missing.
//  If you already have a sheet WITHOUT State/Rod/FishWith columns,
//  you need to manually add those column headers in row 1, or
//  delete the Catches tab and let this recreate it.
// ═══════════════════════════════════════════════════════════

function getSheet() {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  let   sheet = ss.getSheetByName(SHEET_TAB);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_TAB);
    sheet.appendRow(COLS);
    const hdr = sheet.getRange(1, 1, 1, COLS.length);
    hdr.setFontWeight('bold');
    hdr.setBackground('#2c6e8a');
    hdr.setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 240);   // ID
    sheet.setColumnWidth(2, 160);   // Date
    sheet.setColumnWidth(12, 300);  // PhotoUrl
  }

  return sheet;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
