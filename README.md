# Gym Log

A simple, free, offline workout log for iPhone (or any phone), inspired by the
workflow of the Android app FitNotes. It is a Progressive Web App (PWA): plain
HTML/CSS/JavaScript, no build step, no account, no server. All data stays on your
device in IndexedDB.

Units: weight in **lbs**, distance in **miles**.

## Features

- **Daily log**: one page per day. Swipe or tap to move between days, or jump
  via the date picker or calendar. Reorder or remove exercises, add a workout note,
  or copy your previous workout onto an empty day.
- **Exercise library**: 45 starter exercises in 8 colour-coded categories.
  Add, rename, recategorise or delete exercises and categories. Four exercise types:
  weight & reps, reps only, distance & time, time only.
- **Fast set entry**: large +/− steppers pre-filled from your last set.
  Tap a logged set to edit it, add a comment or delete it.
- **Rest timer**: starts automatically after each set (configurable), with ±15 s,
  a beep and a progress bar. It stays correct if the phone locks.
- **Personal records**: 🏆 marks sets that were a PR when performed. For lifts
  that means no earlier set had at least that weight for at least that many reps.
  The Records tab shows estimated 1RM (Epley), heaviest weight, most reps,
  best set and day volume, and a rep-max table. Cardio records cover distance,
  time and fastest pace.
- **History and graphs** per exercise: estimated 1RM, max weight, volume, reps,
  distance, time or pace over 1M / 3M / 1Y / all.
- **Calendar** with category-coloured dots on workout days.
- **Backup / restore** (JSON) through the iOS share sheet (e.g. save to iCloud
  Drive), plus **CSV export** using FitNotes-style columns
  (`Date, Exercise, Category, Weight, Weight Unit, Reps, Distance, Distance Unit, Time, Comment`).
- Works offline, supports light/dark mode and respects iPhone safe areas.

## Install on iPhone

1. Open the hosted URL in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Launch it from the Home Screen icon. It runs full-screen and offline.

**Back up regularly** (Settings → Back up). Web-app data lives only on the phone.
Apple can clear storage for sites that are *not* added to the Home Screen, and
deleting the app deletes its data. The app nudges you when your last backup is
more than 14 days old.

## Hosting

Any static host works; no server code is needed.

- **GitHub Pages**: `.github/workflows/pages.yml` runs the tests and deploys on
  every push to `main`. Enable it under *Settings → Pages → Source: GitHub Actions*.
  Free GitHub accounts can only use Pages on **public** repositories.
- **Netlify / Cloudflare Pages**: connect the repo (private is fine) with no build
  command and the repository root as the publish directory, or drag and drop the
  folder into Netlify.

HTTPS is required for offline support. All static hosts above provide it.

When you change app files, bump `VERSION` in `sw.js` so installed copies update.

## Develop

```sh
npm start            # serves on http://localhost:8080
npm test             # unit tests for records, graphs, CSV, dates (node:test)
npm install && npm run test:e2e   # end-to-end test in an iPhone-sized Chromium (Playwright)
```

Code layout:

| File | Purpose |
|---|---|
| `js/logic.js` | Pure functions: dates, formatting, PRs, records, graph series, CSV, backup validation |
| `js/db.js` | IndexedDB storage with an in-memory mirror; seed data on first run |
| `js/main.js` | Hash router and all screens |
| `js/timer.js` | Rest timer (absolute end time, WebAudio beep) |
| `js/chart.js` | Dependency-free SVG line chart |
| `sw.js` | Service worker for offline use |

## Known limitations

- iOS suspends web apps in the background, so the rest-timer beep only plays when
  the app is open. The countdown is still correct when you return.
- No cloud sync. Use backup/restore to move between devices.
- Not yet built: routines/templates, a bodyweight tracker, a plate calculator,
  kg/km units, and FitNotes CSV import.
