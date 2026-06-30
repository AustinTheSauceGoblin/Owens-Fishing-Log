# 🎣 Fishing Log — Complete Setup Guide

Everything you need to go from zero to a fully working personal fishing diary in about 15 minutes.

---

## What You're Building

```
Your Browser  ←→  index.html + app.js  ←→  Google Apps Script  ←→  Google Sheet
```

- **index.html / app.js** — the app you open in any browser
- **Code.gs** — a tiny server running free on Google's computers
- **Google Sheet** — your database (you already have one started)

---

## Prerequisites

- A Google account (Gmail)
- Your existing Google Sheet (or create a new one)
- A text editor (VS Code, Notepad++, anything)
- A browser (Chrome, Firefox, Safari, Edge — all work)

No server, no npm, no terminal needed.

---

## Step 1 — Get Your Google Sheet ID

1. Open your Google Sheet in the browser
2. Look at the URL:
   ```
   https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/edit
   ```
3. Copy the long string between `/d/` and `/edit` — that's your **Sheet ID**
   ```
   1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
   ```
   Keep this handy — you'll need it in Step 3.

> **Note:** The app will auto-create a tab called "Catches" with the right column headers. If you already have data in your sheet, don't worry — it won't touch other tabs.

---

## Step 2 — Open Google Apps Script

1. In your Google Sheet, click the menu: **Extensions → Apps Script**
2. A new tab opens — this is the Apps Script editor
3. You'll see a default file with some code in it

---

## Step 3 — Paste the Backend Code

1. Select **all** the text in the editor (Ctrl+A / Cmd+A) and delete it
2. Open the file `Code.gs` from the project folder
3. Copy the entire contents and paste it into the Apps Script editor
4. Find this line near the top:
   ```javascript
   const SHEET_ID = "YOUR_SHEET_ID_HERE";
   ```
5. Replace `YOUR_SHEET_ID_HERE` with your actual Sheet ID from Step 1:
   ```javascript
   const SHEET_ID = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms";
   ```
6. Click the **Save** button (floppy disk icon, or Ctrl+S)

---

## Step 4 — Deploy as a Web App

1. Click the blue **Deploy** button (top right)
2. Click **New deployment**
3. Click the gear icon ⚙️ next to "Select type" → choose **Web app**
4. Fill in the settings:
   - **Description:** `Fishing Log v1` (or anything)
   - **Execute as:** `Me`
   - **Who has access:** `Anyone`
5. Click **Deploy**
6. Google will ask you to authorize — click **Authorize access**
   - Choose your Google account
   - Click **Advanced** → **Go to Fishing Log (unsafe)** (it's your own code, this is normal)
   - Click **Allow**
7. After authorization, you'll see a screen with your **Web App URL**
   - It looks like: `https://script.google.com/macros/s/AKfycb.../exec`
8. **Copy this URL** — you need it in the next step

> ⚠️ **Important:** Every time you change Code.gs, you must deploy a *new version* (Deploy → Manage deployments → New version) for changes to take effect.

---

## Step 5 — Configure the App

1. Open the file `config.js` in a text editor
2. Paste your Web App URL between the quotes:
   ```javascript
   const CONFIG = {
     WEB_APP_URL: "https://script.google.com/macros/s/AKfycb.../exec",
     OWNER_NAME: "Austin's Fishing Log",
   };
   ```
3. Set your name in `OWNER_NAME`
4. Save the file

---

## Step 6 — Open the App

1. In your file explorer, find `index.html`
2. Double-click it — it opens in your default browser
3. The app loads your catches from Google Sheets automatically

**That's it!** You're live. 🎣

---

## Using the App

### Logging a Catch
- Click **"+ Log a Catch"**
- Fill in fish type, weight, date/time, lure, location, trip tag, notes
- Optionally attach a photo (it uploads to your Google Drive automatically)
- Click **Save Catch**

### Trip Tags
- Type any label in the **Trip Tag** field when logging a catch
- Examples: `Yellowstone 2026`, `Family Summer`, `Lake Toho Tournament`
- Use the **All Trips** dropdown to filter the whole dashboard by trip

### Filtering
- Use the dropdowns at the top to filter by trip or species
- Use the search box to search across all fields

### Deleting a Catch
- Click the 🗑 **Delete** button on any catch card
- Confirms before deleting

---

## Sharing With Friends

Each person gets their **own separate log**. Here's how:

1. **Zip the project folder** (the folder containing `index.html`, `app.js`, `config.js`, `Code.gs`, `SETUP.md`)
2. **Send the zip** to your friend
3. Your friend:
   - Unzips the folder
   - Creates (or opens) their own Google Sheet
   - Follows Steps 1–6 above with their own Google account
   - Their Sheet ID → their own `Code.gs` → their own Web App URL → their own `config.js`
4. Their log is 100% separate from yours — different Sheet, different data

> You don't "share" your URL with friends to see your data — each person runs their own copy of everything.

---

## Accessing From Your Phone

Since this runs in a browser, you have options:

**Option A — Local network (easiest):**
1. On your computer, note your local IP address (e.g. `192.168.1.5`)
   - Windows: run `ipconfig` in Command Prompt
   - Mac: run `ifconfig` in Terminal
2. On your phone (same WiFi), open: `http://192.168.1.5/path/to/index.html`
   - Actually the easiest way: use VS Code Live Server extension or Python:
   ```
   python3 -m http.server 8080
   ```
   Then visit `http://192.168.1.5:8080` on your phone

**Option B — Host on GitHub Pages (free, public URL):**
1. Create a free GitHub account
2. Create a new repository, upload `index.html`, `app.js`, `config.js`
3. Go to repository Settings → Pages → Deploy from main branch
4. GitHub gives you a URL like `https://yourusername.github.io/fishing-log/`
5. Works on any device, anywhere

**Option C — Netlify Drop (free, 30 seconds):**
1. Go to https://app.netlify.com/drop
2. Drag your project folder onto the page
3. Instant URL, works everywhere

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Yellow config banner shows | Paste your Web App URL into `config.js` and save |
| "Could not load catches" error | Check that your Web App URL is correct and re-deployed |
| Catches not saving | Re-deploy your Apps Script (Deploy → Manage → New version) |
| Photos not showing | Make sure your Google Drive file-sharing is set to "Anyone with link" |
| Changes to Code.gs not working | You must create a **new deployment version** every time |

---

## Project Files

```
fishing-log/
├── index.html   — The app UI (open this in browser)
├── app.js       — All the JavaScript logic
├── config.js    — YOUR settings (URL + name) ← edit this
├── Code.gs      — Google Apps Script backend ← paste into Apps Script
└── SETUP.md     — This file
```

---

## What Gets Stored Where

| Data | Where |
|---|---|
| Catch records (fish, weight, date, etc.) | Your Google Sheet, "Catches" tab |
| Photos | Your Google Drive, "FishingLog Photos" folder |
| App settings | `config.js` on your computer |
| The app itself | Your computer (or wherever you host it) |

Everything stays in your Google account. Anthropic/Claude sees nothing after setup.
