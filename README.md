# 🏺 Arch Street Burial Site Dashboard

Interactive 3D archaeological visualization dashboard
for the Arch Street burial site, Philadelphia PA
(18th–19th century, 324 burials excavated).

## Live Site
[https://arch-street-burials.netlify.app](https://arch-st-project.netlify.app/)

## Features
- 3D scatter plot (Three.js) — burials positioned by real coordinates
- Color by Sex / Age / Ancestry / Preservation / DBSCAN Clusters
- Bayesian + DBSCAN identity confidence matching
- Google Sheets live sync — edit master sheet, dashboard updates
- Role-based auth via Netlify Identity
- Edit burial records in-browser (admin only)
- Analytics dashboard with demographic charts
- Dark / Light theme

## Tech Stack
- React 18
- Three.js (raw)
- Recharts
- Netlify Identity
- Google Sheets CSV sync

## Local Development

### Prerequisites
- Node.js 18+
- npm

### Setup
```bash
git clone https://github.com/Alwinphilip0105/Arch_St_Project_live.git
cd Arch_St_Project_live
npm install
cp .env.example .env
# Fill in .env values
npm start
```

## Deployment
Deployed on Netlify. Auto-deploys on push to main.

## Team
RUC AI Campus Team 2
- Alwin Philip 
- Amelia Stieglitz
- Aryan Bhat
- Carla Villacis
- Kimberlee Moran (Associate Teaching Professor)
- Lindsay Peck
- Ojobo

## Data
324 burial records from the Arch Street
archaeological excavation. Source: RUC AI Campus
Team 2 analysis notebook.
