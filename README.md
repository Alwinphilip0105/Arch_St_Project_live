# Arch Street Burial Site — React Dashboard

A 3D interactive archaeological visualization dashboard for the Arch Street burial site in Philadelphia (18th–19th century, 324 burials).

## Features

- **3D Scatter Plot** — Three.js-powered coffin markers in 3D space, positioned by real N/E/Depth coordinates
- **Color Coding** — Switch between Sex / Age / Ancestry / Preservation coloring
- **Filters** — Filter by sex, age group, preservation state, or named persons only
- **Click-to-Inspect** — Click any 3D marker to open a full burial record detail panel
- **G-Number Search** — Search by burial ID number
- **Analytics Tab** — Recharts bar + pie charts for demographics, preservation, ancestry, and depth distribution

## Tech Stack

- React 18
- Three.js (raw, via `three` package + `OrbitControls`)
- Recharts for analytics charts
- No Tailwind — custom dark archaeological CSS theme

## Getting Started

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000)

## Build for Production

```bash
npm run build
```

Builds to `build/` directory — static files ready to deploy to GitHub Pages, Netlify, Vercel, etc.

## Deploy to GitHub Pages

1. Add to `package.json`: `"homepage": "https://YOUR_USERNAME.github.io/Arch_St_project"`
2. Install: `npm install --save-dev gh-pages`
3. Add scripts:
   ```json
   "predeploy": "npm run build",
   "deploy": "gh-pages -d build"
   ```
4. Run: `npm run deploy`

## Project Structure

```
src/
  App.jsx         — Main dashboard component (3D view + charts)
  App.css         — Dark archaeological theme
  burialData.js   — 324 burial records (extracted from Three.js HTML)
  index.js        — React entry point
public/
  index.html      — HTML shell
```

## Data

324 burial records from the Arch Street archaeological excavation. Each record includes:
- Spatial coordinates (North, East, Depth in feet)
- Biological profile (Age, Sex, Ancestry)
- Preservation state & soft tissue presence
- Coffin details (shape, lid type, handles, dimensions)
- Material culture & artifacts
- Historical identification (named individuals, date of death)

Source: RUC AI Campus Team 2 analysis notebook (Google Drive dataset)
