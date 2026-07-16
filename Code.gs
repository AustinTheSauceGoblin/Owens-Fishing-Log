// ═══════════════════════════════════════════════════════════
//  FISHING LOG — Google Apps Script Backend  v6
//
//  HOW TO UPDATE:
//  1. Select ALL text (Ctrl+A) and delete it
//  2. Paste this entire file
//  3. Set YOUR_SHEET_ID_HERE to your actual Sheet ID
//  4. Save, then Deploy → Manage Deployments → New version → Deploy
//
//  NEW COLUMNS in this version (City, Lat, Lon, Sunrise, Sunset):
//  If you already have a Catches tab, add these 5 headers to
//  columns M-Q in row 1: City | Lat | Lon | Sunrise | Sunset
//  New catches will fill them automatically.
// ═══════════════════════════════════════════════════════════

const SHEET_ID    = "1OX2gqMVyQDfwJKoBrFKAC2uhqeCxPnpBDYNE3i3HTj0";
const SHEET_TAB   = "Catches";
const APPDATA_TAB = "AppData";
const SHOPS_TAB   = "FishShops";

const COLS = [
  "ID","Date","Fish","Weight_lbs","Location","State",
  "Lure","Rod","FishWith","Trip","Notes","PhotoUrl",
  "City","Lat","Lon","Sunrise","Sunset"
];
const COL = {
  ID:0,DATE:1,FISH:2,WEIGHT:3,LOCATION:4,STATE:5,
  LURE:6,ROD:7,FISHWITH:8,TRIP:9,NOTES:10,PHOTOURL:11,
  CITY:12,LAT:13,LON:14,SUNRISE:15,SUNSET:16
};

const SHOP_COLS = ["ID","Name","Address","City","State","ShopType","Notes","PhotoUrl"];
const SCOL = { ID:0,NAME:1,ADDRESS:2,CITY:3,STATE:4,SHOPTYPE:5,NOTES:6,PHOTOURL:7 };

// ═══════════════════════════════════════════════════════════
//  ENTRY POINTS
// ═══════════════════════════════════════════════════════════

function doGet(e) {
  try {
    const action = (e.parameter && e.parameter.action) || "getCatches";
    if (action === "getCatches")  return jsonResponse(getCatches());
    if (action === "getAppData")  return jsonResponse(getAppData());
    if (action === "getShops")    return jsonResponse(getShops());
    return jsonResponse({ error: "Unknown GET action: " + action });
  } catch (err) { return jsonResponse({ error: err.message }); }
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action  = payload.action;
    if (action === "addCatch")    return jsonResponse(addCatch(payload));
    if (action === "editCatch")   return jsonResponse(editCatch(payload));
    if (action === "deleteCatch") return jsonResponse(deleteCatch(payload.id));
    if (action === "saveAppData") return jsonResponse(saveAppData(payload));
    if (action === "addShop")     return jsonResponse(addShop(payload));
    if (action === "editShop")    return jsonResponse(editShop(payload));
    if (action === "deleteShop")  return jsonResponse(deleteShop(payload.id));
    return jsonResponse({ error: "Unknown POST action: " + action });
  } catch (err) { return jsonResponse({ error: err.message }); }
}

// ═══════════════════════════════════════════════════════════
//  CATCHES
// ═══════════════════════════════════════════════════════════

function getCatches() {
  const sheet = getSheet();
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { catches: [] };
  const rawHeader = rows[0];
  const hIdx = {};
  rawHeader.forEach((h,i) => { hIdx[String(h).trim().toLowerCase().replace(/[^a-z]/g,'')] = i; });
  const get = (row,key) => {
    const idx = hIdx[key.toLowerCase().replace(/[^a-z]/g,'')];
    return (idx!==undefined && row[idx]!==undefined && row[idx]!==null) ? String(row[idx]) : '';
  };
  const catches = rows.slice(1).filter(row=>row[0]&&String(row[0]).trim()).map(row=>({
    id:       get(row,'id'),
    date:     row[hIdx['date']] ? new Date(row[hIdx['date']]).toISOString() : '',
    fish:     get(row,'fish'),
    weight:   get(row,'weightlbs')!=='' ? (Number(get(row,'weightlbs'))||'') : '',
    location: get(row,'location'),
    state:    get(row,'state'),
    lure:     get(row,'lure'),
    rod:      get(row,'rod'),
    fishWith: get(row,'fishwith'),
    trip:     get(row,'trip'),
    notes:    get(row,'notes'),
    photoUrl: get(row,'photourl'),
    city:     get(row,'city'),
    lat:      get(row,'lat')  !== '' ? Number(get(row,'lat'))  : '',
    lon:      get(row,'lon')  !== '' ? Number(get(row,'lon'))  : '',
    sunrise:  get(row,'sunrise'),
    sunset:   get(row,'sunset'),
  }));
  return { catches };
}

function addCatch(data) {
  const sheet  = getSheet();
  const id     = Utilities.getUuid();
  const date   = data.date ? new Date(data.date) : new Date();
  const photoUrl = (data.photo&&data.photo.startsWith('data:image')) ? savePhoto(data.photo,id) : '';
  const row = new Array(COLS.length).fill('');
  row[COL.ID]=id; row[COL.DATE]=date; row[COL.FISH]=data.fish||'';
  row[COL.WEIGHT]=(data.weight!==undefined&&data.weight!=='') ? data.weight : '';
  row[COL.LOCATION]=data.location||''; row[COL.STATE]=data.state||'';
  row[COL.LURE]=data.lure||''; row[COL.ROD]=data.rod||'';
  row[COL.FISHWITH]=data.fishWith||''; row[COL.TRIP]=data.trip||'';
  row[COL.NOTES]=data.notes||''; row[COL.PHOTOURL]=photoUrl;
  row[COL.CITY]=data.city||'';
  row[COL.LAT]=data.lat!==undefined&&data.lat!=='' ? data.lat : '';
  row[COL.LON]=data.lon!==undefined&&data.lon!=='' ? data.lon : '';
  row[COL.SUNRISE]=data.sunrise ? String(data.sunrise) : '';
  row[COL.SUNSET]=data.sunset   ? String(data.sunset)  : '';
  sheet.appendRow(row);
  return { success:true, id };
}

function editCatch(data) {
  const sheet  = getSheet();
  const values = sheet.getDataRange().getValues();
  for (let i=1;i<values.length;i++) {
    if (String(values[i][COL.ID])!==String(data.id)) continue;
    const rowNum = i+1;
    let photoUrl = data.existingPhoto||'';
    if (data.photo&&data.photo.startsWith('data:image')) photoUrl=savePhoto(data.photo,data.id);
    const newRow = new Array(COLS.length).fill('');
    newRow[COL.ID]=data.id;
    newRow[COL.DATE]=data.date ? new Date(data.date) : new Date(values[i][COL.DATE]);
    newRow[COL.FISH]=data.fish!==undefined?(data.fish||''):'';
    newRow[COL.WEIGHT]=(data.weight!==undefined&&data.weight!=='') ? Number(data.weight) : '';
    newRow[COL.LOCATION]=data.location!==undefined?(data.location||''):'';
    newRow[COL.STATE]=data.state!==undefined?(data.state||''):'';
    newRow[COL.LURE]=data.lure!==undefined?(data.lure||''):'';
    newRow[COL.ROD]=data.rod!==undefined?(data.rod||''):'';
    newRow[COL.FISHWITH]=data.fishWith!==undefined?(data.fishWith||''):'';
    newRow[COL.TRIP]=data.trip!==undefined?(data.trip||''):'';
    newRow[COL.NOTES]=data.notes!==undefined?(data.notes||''):'';
    newRow[COL.PHOTOURL]=photoUrl;
    newRow[COL.CITY]=data.city!==undefined?(data.city||''):(values[i][COL.CITY]||'');
    newRow[COL.LAT]=data.lat!==undefined&&data.lat!=='' ? data.lat : (values[i][COL.LAT]||'');
    newRow[COL.LON]=data.lon!==undefined&&data.lon!=='' ? data.lon : (values[i][COL.LON]||'');
    newRow[COL.SUNRISE]=data.sunrise!==undefined ? (data.sunrise ? String(data.sunrise) : '') : String(values[i][COL.SUNRISE]||'');
    newRow[COL.SUNSET]=data.sunset!==undefined   ? (data.sunset  ? String(data.sunset)  : '') : String(values[i][COL.SUNSET]||'');
    sheet.getRange(rowNum,1,1,COLS.length).setValues([newRow]);
    return { success:true };
  }
  return { error:'Catch not found: '+data.id };
}

function deleteCatch(id) {
  const sheet  = getSheet();
  const values = sheet.getDataRange().getValues();
  for (let i=1;i<values.length;i++) {
    if (String(values[i][COL.ID])===String(id)) { sheet.deleteRow(i+1); return { success:true }; }
  }
  return { error:'Catch not found: '+id };
}

// ═══════════════════════════════════════════════════════════
//  FISH SHOPS
// ═══════════════════════════════════════════════════════════

function getShops() {
  const sheet = getShopsSheet();
  const rows  = sheet.getDataRange().getValues();
  if (rows.length<=1) return { shops:[] };
  const shops = rows.slice(1).filter(row=>row[0]&&String(row[0]).trim()).map(row=>({
    id:       String(row[SCOL.ID]||''),
    name:     String(row[SCOL.NAME]||''),
    address:  String(row[SCOL.ADDRESS]||''),
    city:     String(row[SCOL.CITY]||''),
    state:    String(row[SCOL.STATE]||''),
    shopType: String(row[SCOL.SHOPTYPE]||''),
    notes:    String(row[SCOL.NOTES]||''),
    photoUrl: String(row[SCOL.PHOTOURL]||''),
  }));
  return { shops };
}

function addShop(data) {
  const sheet = getShopsSheet();
  const id    = Utilities.getUuid();
  const photoUrl = (data.photo&&data.photo.startsWith('data:image')) ? savePhoto(data.photo,id) : '';
  const row = new Array(SHOP_COLS.length).fill('');
  row[SCOL.ID]=id; row[SCOL.NAME]=data.name||'';
  row[SCOL.ADDRESS]=data.address||''; row[SCOL.CITY]=data.city||'';
  row[SCOL.STATE]=data.state||''; row[SCOL.SHOPTYPE]=data.shopType||'';
  row[SCOL.NOTES]=data.notes||''; row[SCOL.PHOTOURL]=photoUrl;
  sheet.appendRow(row);
  return { success:true, id };
}

function editShop(data) {
  const sheet  = getShopsSheet();
  const values = sheet.getDataRange().getValues();
  for (let i=1;i<values.length;i++) {
    if (String(values[i][SCOL.ID])!==String(data.id)) continue;
    let photoUrl = data.existingPhoto||'';
    if (data.photo&&data.photo.startsWith('data:image')) photoUrl=savePhoto(data.photo,data.id);
    const newRow = new Array(SHOP_COLS.length).fill('');
    newRow[SCOL.ID]=data.id; newRow[SCOL.NAME]=data.name||'';
    newRow[SCOL.ADDRESS]=data.address||''; newRow[SCOL.CITY]=data.city||'';
    newRow[SCOL.STATE]=data.state||''; newRow[SCOL.SHOPTYPE]=data.shopType||'';
    newRow[SCOL.NOTES]=data.notes||''; newRow[SCOL.PHOTOURL]=photoUrl;
    sheet.getRange(i+1,1,1,SHOP_COLS.length).setValues([newRow]);
    return { success:true };
  }
  return { error:'Shop not found: '+data.id };
}

function deleteShop(id) {
  const sheet  = getShopsSheet();
  const values = sheet.getDataRange().getValues();
  for (let i=1;i<values.length;i++) {
    if (String(values[i][SCOL.ID])===String(id)) { sheet.deleteRow(i+1); return { success:true }; }
  }
  return { error:'Shop not found: '+id };
}

// ═══════════════════════════════════════════════════════════
//  APP DATA SYNC
// ═══════════════════════════════════════════════════════════

const APPDATA_KEYS = ["tackle","rods","favorites","pinnedfavs","settings","crops","lostlures"];

function getAppData() {
  const sheet = getAppDataSheet();
  const rows  = sheet.getDataRange().getValues();
  const result = {};
  APPDATA_KEYS.forEach(key => result[key]={ value:null, lastModified:0 });
  rows.slice(1).forEach(row => {
    const key = String(row[0]||'').trim();
    if (!APPDATA_KEYS.includes(key)) return;
    let parsed=null;
    try { parsed = row[1] ? JSON.parse(row[1]) : null; } catch(e) { parsed=null; }
    result[key]={ value:parsed, lastModified: row[2] ? new Date(row[2]).getTime() : 0 };
  });
  return result;
}

function saveAppData(data) {
  const sheet   = getAppDataSheet();
  const rows    = sheet.getDataRange().getValues();
  const now     = new Date();
  const updates = data.updates||{};
  Object.keys(updates).forEach(key => {
    if (!APPDATA_KEYS.includes(key)) return;
    const jsonStr = JSON.stringify(updates[key]);
    let rowIdx=-1;
    for (let i=1;i<rows.length;i++) { if (String(rows[i][0]).trim()===key) { rowIdx=i; break; } }
    if (rowIdx>=0) sheet.getRange(rowIdx+1,2,1,2).setValues([[jsonStr,now]]);
    else sheet.appendRow([key,jsonStr,now]);
  });
  return { success:true, lastModified:now.getTime() };
}

// ═══════════════════════════════════════════════════════════
//  PHOTO STORAGE
// ═══════════════════════════════════════════════════════════

function savePhoto(dataUrl,id) {
  try {
    const folderName = 'FishingLog Photos';
    const folders    = DriveApp.getFoldersByName(folderName);
    const folder     = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
    const [header,b64] = dataUrl.split(',');
    const mimeType = header.match(/data:([^;]+);/)[1];
    const blob     = Utilities.newBlob(Utilities.base64Decode(b64),mimeType,id+'.jpg');
    const file     = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK,DriveApp.Permission.VIEW);
    return 'https://lh3.googleusercontent.com/d/'+file.getId();
  } catch(err) { Logger.log('Photo error: '+err.message); return ''; }
}

// ═══════════════════════════════════════════════════════════
//  SHEET SETUP
// ═══════════════════════════════════════════════════════════

function getSheet() {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  let   sheet = ss.getSheetByName(SHEET_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_TAB);
    sheet.appendRow(COLS);
    const hdr = sheet.getRange(1,1,1,COLS.length);
    hdr.setFontWeight('bold'); hdr.setBackground('#2c6e8a'); hdr.setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  // Force Sunrise (col 16) and Sunset (col 17) to plain text so Sheets
  // doesn't auto-convert "2115" or "HH:MM" into time serial numbers
  sheet.getRange(2, COL.SUNRISE + 1, Math.max(sheet.getLastRow(), 2), 1).setNumberFormat('@STRING@');
  sheet.getRange(2, COL.SUNSET  + 1, Math.max(sheet.getLastRow(), 2), 1).setNumberFormat('@STRING@');
  return sheet;
}

function getShopsSheet() {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  let   sheet = ss.getSheetByName(SHOPS_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(SHOPS_TAB);
    sheet.appendRow(SHOP_COLS);
    const hdr = sheet.getRange(1,1,1,SHOP_COLS.length);
    hdr.setFontWeight('bold'); hdr.setBackground('#c8973a'); hdr.setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1,240); sheet.setColumnWidth(8,300);
  }
  return sheet;
}

function getAppDataSheet() {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  let   sheet = ss.getSheetByName(APPDATA_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(APPDATA_TAB);
    sheet.appendRow(["Key","ValueJSON","LastModified"]);
    const hdr = sheet.getRange(1,1,1,3);
    hdr.setFontWeight('bold'); hdr.setBackground('#4a6741'); hdr.setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1,120); sheet.setColumnWidth(2,500); sheet.setColumnWidth(3,160);
  }
  return sheet;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
