# Aisle — weekly shopping list

A phone-and-computer web app for planning the weekly shop and checking things off in the store.
The Google Sheet stays the database: the app keeps a copy on each device, so it is instant and works
with no signal, and syncs changes to the Sheet in the background.

```
web/          the app (React + TypeScript + Vite, installable, works offline)
apps-script/  the Sheet side: a small API, the data tables, and the one-time copy of the old tabs
```

## How it fits together

- **The app** reads and writes only its on-device copy (IndexedDB). Every change is queued in an outbox
  and sent in a batch about a second later, or as soon as there is signal again. While open it checks
  for changes from other devices every 20 seconds.
- **The API** (`apps-script/Api.js`) is the Apps Script project deployed as a web app. One `sync` call
  applies the queued changes under a lock and returns everything that changed since the device last
  synced.
- **The data** lives in `db_*` tabs in the spreadsheet: plain values, one row per record, keyed by ID.
  `apps-script/Core.js` defines the tables and is shared by the API, the local dev server and the tests.
- The original tabs (Products, List Builder, Shopping List, …) and their menus are left untouched.

## One-time setup

1. **Push the script.** From the repo root: `clasp push`. This adds the API files and an **Aisle app** menu
   to the spreadsheet. The old menus keep working.
2. **Copy the data.** Reload the spreadsheet, then **Aisle app → 1. Copy data into the app tables**.
   Approve the permissions prompt the first time. It creates the `db_*` tabs and shows a summary,
   including the access key. The estimated total should match the Shopping List total.
3. **Deploy the API.** In the Apps Script editor: **Deploy → New deployment → Web app**, Execute as **Me**,
   Who has access **Anyone**. Copy the web app URL (it ends in `/exec`).
   - If your Google Workspace domain doesn't allow "Anyone", the app can't reach the API from a phone.
     Copy the spreadsheet to a personal Google account and repeat these steps there.
4. **Host the app.** Any static host works; the build uses relative paths.
   - **Cloudflare Pages** (works with a private repo): connect the GitHub repo, set the root directory to
     `web`, the build command to `npm run build`, and the output directory to `dist`.
   - **GitHub Pages** (needs a public repo on the free plan): build `web/` and publish `web/dist`.
5. **Connect each device.** Open the app, paste the web app URL and the access key
   (**Aisle app → 2. Show access key**). On a phone, use **Add to Home Screen** to install it.

After the first deployment, changes to the API need **Deploy → Manage deployments → Edit → New version**
(or `clasp deploy -i <deploymentId>`) to go live. The URL stays the same.

## Developing

```sh
cd web
npm install
npm run dev        # http://localhost:5173 — web app address /api, access key: dev
npm test           # unit tests for the server core, the actions and the sync engine
npm run build      # type-check + production build into web/dist
```

`npm run dev` includes a stand-in for the Apps Script API that runs the same `Core.js`, keeps its data
in `web/.dev-db.json` (delete the file to start over) and seeds itself from `web/dev/sample-legacy.json`.
To try it with a full export of the real sheet instead, set `AISLE_DEV_LEGACY=/path/to/export.json`.

`node dev/make-icons.mjs` regenerates the app icons.
