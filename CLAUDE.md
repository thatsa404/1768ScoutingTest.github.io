# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development

```bash
npm run dev      # Start Vite dev server (hot-reload)
```

There are no build, lint, or test scripts. The app is served directly via Vite from `index.html` + `main.js`. Deploy by pushing to GitHub Pages — no build step required for the dev workflow.

The TBA API key lives in `.env` as `VITE_TBA_KEY` and is accessed in JS via `import.meta.env.VITE_TBA_KEY`. Never hardcode it.

## Architecture

Everything lives in two files: `index.html` (markup + all CSS) and `main.js` (all logic). There is no component framework.

### Data flow

1. **Sync buttons** on the Home tab call fetch functions that hit external APIs and write to IndexedDB via Dexie.
2. **Display functions** read from IndexedDB and render into existing DOM elements.
3. On boot, `bootApp()` calls all display functions to hydrate the UI from cache — so the app works offline after first sync.

### Storage (Dexie / IndexedDB) — `ScoutingAppDB` v2

| Table | Key | Contents |
|---|---|---|
| `teams` | `teamNumber` | Statbotics EPA data, match history, ceiling analysis |
| `matches` | `key` | TBA qual match records; `redBreakdown`/`blueBreakdown` populated after "Sync TBA Matches" |
| `tbaTeams` | `teamNumber` | TBA OPR/DPR/CCWM + component OPRs from COPRs endpoint |

When adding a new table, increment `db.version()` and include **all** tables in the new version block.

### External APIs

| API | Base | Auth | Used for |
|---|---|---|---|
| Statbotics v3 | `https://api.statbotics.io/v3` | None | Team EPA, match history |
| The Blue Alliance v3 | `https://www.thebluealliance.com/api/v3` | `X-TBA-Auth-Key` header via `fetchTBA()` | Schedule, OPR, COPRs, full match data |

TBA is always called through the `fetchTBA(endpoint)` helper which handles the auth header.

The COPRs endpoint (`/event/{key}/coprs`) returns `{ componentName: { frcXXXX: value } }`. Field names are game-specific and detected at runtime — always log `Object.keys(coprData)` when debugging a new season. For 2026 (Rebuilt): auto=`totalAutoPoints`, teleop=`totalTeleopPoints`, endgame=`Hub Endgame Fuel Count` + `endGameTowerPoints`.

**2026 Ranking Points (Rebuilt):** 3 RP win / 1 RP tie / 0 RP loss, plus up to 3 bonus RPs stored as booleans in the match breakdown: `energizedAchieved`, `superchargedAchieved`, `traversalAchieved`. TBA also provides a pre-computed `rp` field per alliance — use that when present and fall back to summing the above.

### Views

Navigation is handled by `switchView(viewId)` which shows/hides `<div class="app-view">` containers. `teamDetailView` is a fixed full-screen overlay managed separately from the main nav. It has its own tab system (`switchDetailTab`) with four tabs: Overview, EPA/OPR, Scouting, Pit Data.

The match detail modal (`matchDetailView`) is a separate overlay triggered from the schedule result cells. It shows score breakdowns from `match.redBreakdown`/`match.blueBreakdown` — only populated after "Sync TBA Matches".

### Key algorithmic pieces

- **Ceiling projection** (`fitExponentialGrowth`): fits `y = A - B·e^(-kx)` to a team's EPA timeline, with 100-sample bootstrap for 90% confidence intervals.
- **OPR computation** (`computeOPR`, `gaussianElim`): least-squares matrix solve for component OPRs from match score breakdowns. Superseded by the COPRs endpoint for high-level auto/teleop/endgame splits, but retained as a fallback.
- **Team highlighting** (`highlightTeam`, `refreshPrepHighlight`): toggling a focused team updates schedule cells, match prep cards, and the Chart.js prep chart simultaneously. Chart colors must be updated via `prepChartInstance.update()` (not `update('none')`) to force full element re-resolution.

### Chart instances

Three Chart.js instances are module-level globals: `teamChartInstance` (Statbotics bar chart), `prepChartInstance` (match prep horizontal bars), `tbaChartInstance` (TBA OPR bar chart), and `performanceChart` (team detail EPA timeline). Always destroy before recreating. The performance chart is rendered lazily — only when the EPA/OPR detail tab is opened — because Chart.js cannot size itself against a hidden canvas.

# Compact Instructions

When compacting, always preserve:
- All modified file paths with line numbers
- Current test results (pass/fail with file names)
- The active task plan and remaining TODO items
- Error messages and stack traces from the current debug session
- Architecture decisions with their reasoning