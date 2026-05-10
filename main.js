import Dexie from 'dexie';

// 1. DATABASE SETUP
// We use Dexie to handle larger storage (images/multiple events)
const db = new Dexie('ScoutingAppDB');
db.version(1).stores({
    teams: 'teamNumber, eventKey',
    matches: 'key, eventKey, matchNumber' // Add this table
});

// 2. CONFIG & API KEYS
const TBA_BASE = 'https://www.thebluealliance.com/api/v3';
const TBA_KEY = import.meta.env.VITE_TBA_KEY;


window.currentFocusedTeam = null;

// 3. UTILITY FUNCTIONS
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function fetchTBA(endpoint) {
    const response = await fetch(`${TBA_BASE}${endpoint}`, {
        headers: { 'X-TBA-Auth-Key': TBA_KEY }
    });
    return await response.json();
}

window.fetchSchedule = async function (eventKey) {
    const statusDiv = document.getElementById('status');
    try {
        const response = await fetch(`https://www.thebluealliance.com/api/v3/event/${eventKey}/matches/simple`, {
            headers: { 'X-TBA-Auth-Key': TBA_KEY }
        });
        const matches = await response.json();

        // Filter for Qualifications only and sort by match number
        const qualMatches = matches
            .filter(m => m.comp_level === 'qm')
            .sort((a, b) => a.match_number - b.match_number);

        // Save to Dexie
        await db.matches.bulkPut(qualMatches.map(m => ({
            key: m.key,
            eventKey: eventKey,
            matchNumber: m.match_number,
            red: m.alliances.red.team_keys.map(t => t.replace('frc', '')),
            blue: m.alliances.blue.team_keys.map(t => t.replace('frc', '')),
            redScore: m.alliances.red.score,
            blueScore: m.alliances.blue.score
        })));

        console.log(`Loaded ${qualMatches.length} matches into schedule.`);
    } catch (err) {
        console.error("TBA Fetch Error:", err);
    }
};

window.displaySchedule = async function () {
    const body = document.getElementById('scheduleBody');
    if (!body) return;

    // 1. Fetch from IndexedDB (Dexie)
    // We order by matchNumber so they show up in chronological order
    const matches = await db.matches.orderBy('matchNumber').toArray();

    // 2. If the DB is empty, show a friendly message or clear the table
    if (matches.length === 0) {
        body.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px;">No matches cached. Hit "Sync Schedule" on the Home tab.</td></tr>';
        return;
    }

    body.innerHTML = '';

    matches.forEach(m => {
        const row = document.createElement('tr');

        // Format the result string
        const result = (m.redScore > -1)
            ? `<strong>${m.redScore}</strong> - <strong>${m.blueScore}</strong>`
            : '<span style="color: #999; font-style: italic;">Upcoming</span>';

        // Build the team cells dynamically
        // Red 1, 2, 3
        const redCells = m.red.map(team => `
            <td class="red-cell" 
                data-team="${team}" 
                onclick="highlightTeam('${team}')" 
                style="cursor: pointer;">
                <strong>${team}</strong>
            </td>`).join('');
        // Blue 1, 2, 3
        const blueCells = m.blue.map(team => `
            <td class="blue-cell" 
                data-team="${team}" 
                onclick="highlightTeam('${team}')" 
                style="cursor: pointer;">
                <strong>${team}</strong>
            </td>`).join('');

        const resultCell = (m.redScore > -1)
            ? `<td onclick="viewMatchDetail('${m.key}')" style="cursor: pointer; font-weight: bold; border-left: 2px solid #334155;">
                <span class="red-alliance">${m.redScore}</span> - <span class="blue-alliance">${m.blueScore}</span>
               </td>`
            : `<td style="color: #64748b; font-style: italic; border-left: 2px solid #334155;">Upcoming</td>`;

        row.innerHTML = `
            <td class="match-number" 
                onclick="viewMatchPrep('${m.key}')" 
                style="cursor: pointer; text-decoration: underline; color: #3b82f6;">
                Qual ${m.matchNumber}
            </td>
            ${redCells}
            ${blueCells}
            ${resultCell}
        `;
        body.appendChild(row);
    });
};

let prepChartInstance = null; // Global variable to handle chart destruction

window.viewMatchPrep = async function (matchKey) {
    const match = await db.matches.get(matchKey);
    if (!match) return;

    // 1. Update the Header and Switch View
    document.getElementById('prepMatchLabel').innerText = `Match Prep: Qual ${match.matchNumber}`;
    window.switchView('matchPrepView');

    // Helper to get team data and return a stats object
    const getTeamStats = async (teamNum) => {
        const team = await db.teams.get(parseInt(teamNum));
        return {
            number: teamNum,
            total: team?.currentEPA || 0,
            auto: team?.autoEPA || 0,
            teleop: team?.teleopEPA || 0,
            endgame: team?.endgameEPA || 0
        };
    };

    // 1. Calculate Alliance Totals
    const redTeamsData = await Promise.all(match.red.map(num => getTeamStats(num)));
    const blueTeamsData = await Promise.all(match.blue.map(num => getTeamStats(num)));

    // 2. Render the Comparison Chart
    renderPrepChart(redTeamsData, blueTeamsData);

    // 2. Helper function to build a team card
    const createTeamCard = async (teamNum) => {
        const team = await db.teams.get(parseInt(teamNum));

        // 1. DATA CLEANUP: Force both to strings and trim any whitespace
        const globalFocus = (window.currentFocusedTeam || "").toString().trim();
        const currentCardTeam = (teamNum || "").toString().trim();

        // 2. THE CHECK:
        const isFocused = (globalFocus !== "" && globalFocus === currentCardTeam);

        // 3. LOGGING: Keep this in for one refresh to see the truth in the console
        console.log(`Comparing: [${globalFocus}] to [${currentCardTeam}] -> Result: ${isFocused}`);

        const focusClass = isFocused ? 'highlight-active' : '';

        // Fallback if team data hasn't been synced yet
        if (!team) {
            return `<div class="prep-team-card"><h3>Team ${teamNum}</h3><p>No data. Sync Statbotics.</p></div>`;
        }

        const ceiling = team.analysis?.ceiling || team.currentEPA || 0;

        return `
        <div class="prep-team-card ${focusClass}">
            <div class="prep-card-header">
                <div class="header-left" onclick="highlightTeam('${teamNum}')" style="cursor:pointer;">
                    <span class="prep-team-number">${teamNum}</span>
                    <span class="ceiling-label">Ceiling: <strong>${ceiling}</strong></span>
                </div>
                <button class="profile-link-btn" onclick="viewTeamDetail(${teamNum})">
                    View Profile
                </button>
            </div>
            
            <div class="prep-stats-grid" onclick="highlightTeam('${teamNum}')" style="cursor:pointer;">
                <div><div class="stat-label">Total EPA</div><div class="stat-value">${team.currentEPA.toFixed(1)}</div></div>
                <div><div class="stat-label">Auto</div><div class="stat-value">${team.autoEPA.toFixed(1)}</div></div>
                <div><div class="stat-label">Teleop</div><div class="stat-value">${team.teleopEPA.toFixed(1)}</div></div>
                <div><div class="stat-label">Endgame</div><div class="stat-value">${team.endgameEPA.toFixed(1)}</div></div>
            </div>
        </div>
    `;
    };

    // 3. Populate Red and Blue Lists
    const redCards = await Promise.all(match.red.map(num => createTeamCard(num)));
    const blueCards = await Promise.all(match.blue.map(num => createTeamCard(num)));

    document.getElementById('redPrepList').innerHTML = redCards.join('');
    document.getElementById('bluePrepList').innerHTML = blueCards.join('');
};

function renderPrepChart(redTeams, blueTeams) {
    const ctx = document.getElementById('allianceComparisonChart').getContext('2d');

    if (prepChartInstance) {
        prepChartInstance.destroy();
    }

    const redShades = ['#b91c1c', '#ef4444', '#f87171'];
    const blueShades = ['#1e3a8a', '#3b82f6', '#93c5fd'];

    const datasets = [
        ...redTeams.map((team, i) => {
            // Check if this specific team segment should be highlighted
            const isFocused = (window.currentFocusedTeam === team.number.toString());
            return {
                label: `Team ${team.number}`,
                data: [team.total, team.auto, team.teleop, team.endgame],
                backgroundColor: isFocused ? '#fde047' : redShades[i],
                borderColor: isFocused ? '#000' : 'transparent',
                borderWidth: isFocused ? 2 : 0,
                stack: 'Red'
            };
        }),
        ...blueTeams.map((team, i) => {
            const isFocused = (window.currentFocusedTeam === team.number.toString());
            return {
                label: `Team ${team.number}`,
                data: [team.total, team.auto, team.teleop, team.endgame],
                backgroundColor: isFocused ? '#fde047' : blueShades[i],
                borderColor: isFocused ? '#000' : 'transparent',
                borderWidth: isFocused ? 2 : 0,
                stack: 'Blue'
            };
        })
    ];

    prepChartInstance = new Chart(ctx, {
        type: 'bar',
        data: { labels: ['Total EPA', 'Auto', 'Teleop', 'Endgame'], datasets: datasets },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { stacked: true, grid: { color: '#334155' }, ticks: { color: '#94a3b8' } },
                y: { stacked: true, grid: { display: false }, ticks: { color: '#f8fafc', font: { weight: 'bold' } } }
            },
            plugins: {
                legend: { display: true, position: 'bottom', labels: { color: '#f8fafc', boxWidth: 12 } }
            }
        }
    });
}





window.viewMatchDetail = async function (matchKey) {
    // 1. Get match data from Dexie
    const match = await db.matches.get(matchKey);
    if (!match) return;

    // 2. Populate the labels and scores
    document.getElementById('matchDetailLabel').innerText = `Match Details: Qual ${match.matchNumber}`;
    document.getElementById('redTotalScore').innerText = match.redScore;
    document.getElementById('blueTotalScore').innerText = match.blueScore;

    // 3. Populate the team lists
    document.getElementById('redMatchTeams').innerHTML = match.red.map(t => `<div>${t}</div>`).join('');
    document.getElementById('blueMatchTeams').innerHTML = match.blue.map(t => `<div>${t}</div>`).join('');

    // 4. Show the modal
    document.getElementById('matchDetailView').style.display = 'flex';
};

window.closeMatchDetail = function () {
    document.getElementById('matchDetailView').style.display = 'none';
};





window.highlightTeam = function (teamNumber) {
    const allCells = document.querySelectorAll('.red-cell, .blue-cell');
    const allRows = document.querySelectorAll('#scheduleBody tr');

    // 1. Clear previous
    allCells.forEach(cell => cell.classList.remove('highlight-active'));
    allRows.forEach(row => row.classList.remove('row-highlight'));

    // 2. Toggle check (using window.currentFocusedTeam)
    if (window.currentFocusedTeam === teamNumber.toString()) {
        window.currentFocusedTeam = null;
        window.refreshPrepHighlight(); // Keep these in sync
        return;
    }

    // 3. Apply new
    const targets = document.querySelectorAll(`[data-team="${teamNumber}"]`);
    if (targets.length > 0) {
        targets.forEach(cell => {
            cell.classList.add('highlight-active');
            const parentRow = cell.closest('tr');
            if (parentRow) parentRow.classList.add('row-highlight');
        });

        window.currentFocusedTeam = teamNumber.toString();
    }

    // 4. Update the Prep cards if they are currently visible
    window.refreshPrepHighlight();
};

window.refreshPrepHighlight = function () {
    const allCards = document.querySelectorAll('.prep-team-card');

    // 1. Update the Team Cards
    allCards.forEach(card => {
        const teamNum = card.querySelector('.prep-card-header span').innerText;
        if (window.currentFocusedTeam === teamNum) {
            card.classList.add('highlight-active');
        } else {
            card.classList.remove('highlight-active');
        }
    });

    // 2. Update the Chart segments
    if (prepChartInstance) {
        const redShades = ['#b91c1c', '#ef4444', '#f87171'];
        const blueShades = ['#1e3a8a', '#3b82f6', '#93c5fd'];

        prepChartInstance.data.datasets.forEach((dataset, index) => {
            // Extract the team number from the label "Team 1768"
            const teamNum = dataset.label.replace('Team ', '');
            const isFocused = (window.currentFocusedTeam === teamNum);

            if (dataset.stack === 'Red') {
                dataset.backgroundColor = isFocused ? '#fde047' : redShades[index % 3];
            } else {
                // Blue teams are the 4th, 5th, and 6th datasets
                dataset.backgroundColor = isFocused ? '#fde047' : blueShades[(index - 3) % 3];
            }

            // Add a border to the highlighted segment to make it "pop"
            dataset.borderColor = isFocused ? '#000' : 'transparent';
            dataset.borderWidth = isFocused ? 2 : 0;
        });

        // Trigger the visual update
        prepChartInstance.update('none'); // 'none' skips the animation for a snappier feel
    }
};






async function getMatchHistory(teamNumber) {
    const url = `https://api.statbotics.io/v3/team_matches?team=${teamNumber}&year=2026`;
    const response = await fetch(url);
    const json = await response.json();
    const matchArray = json.data || json.results || json;

    if (!matchArray || matchArray.length === 0) return [];

    // We still sort it so the order is preserved in the database
    matchArray.sort((a, b) => a.time - b.time);

    return matchArray; // Return the full objects, not just EPA
}

async function processTeamPerformance(teamNumber, eventKey, force = false) {
    // 1. Check local DB
    const cachedTeam = await db.teams.get(teamNumber);

    // --- FIX 1: Fetch the Name correctly ---
    const nameResp = await fetch(`https://api.statbotics.io/v3/team/${teamNumber}`);
    const nameData = await nameResp.json();
    const teamName = nameData.name || "Unknown Team";

    // 2. Handshake (team_year)
    const summaryResp = await fetch(`https://api.statbotics.io/v3/team_year/${teamNumber}/2026`);
    const summary = await summaryResp.json();
    const apiMatchCount = summary.count || summary.data?.count || 0;

    console.log(`Team ${teamNumber}: Local Count ${cachedTeam?.matchCount || 0}, API Count ${apiMatchCount}`);
    console.log(`Raw Summary Data for ${teamNumber}:`, summary);

    // --- NEW: Grab the breakdowns from the summary ---
    const autoEPA = summary.epa?.breakdown?.auto_points || 0;
    const teleopEPA = summary.epa?.breakdown?.teleop_points || 0;
    const endgameEPA = summary.epa?.breakdown?.endgame_points || 0;

    // 3. REVISED LOGIC: Only skip if we have a cache AND the counts match AND force is false
    const needsUpdate = force || !cachedTeam || cachedTeam.matchCount !== apiMatchCount;

    if (!needsUpdate) {
        // --- THE CACHE HEALER ---
        // Even if we are skipping the full match history deep dive, 
        // we can silently patch the existing database with the new breakdown 
        // stats we just fetched in the handshake.
        await db.teams.update(teamNumber, {
            autoEPA: autoEPA,
            teleopEPA: teleopEPA,
            endgameEPA: endgameEPA
        });

        console.log(`-> Skipping deep dive for ${teamNumber}, but updated summary stats.`);
        return null;
    }

    // 4. THE DEEP DIVE
    console.log(`-> Fetching full matches for ${teamNumber}...`);
    const fullMatchData = await getMatchHistory(teamNumber);

    if (!fullMatchData || fullMatchData.length === 0) {
        console.warn(`-> No match data found for ${teamNumber}`);
        return null;
    }

    const playedMatches = fullMatchData.filter(m => m.status === 'Completed' && m.epa?.post);
    const currentEPA = playedMatches.length > 0 ? playedMatches[playedMatches.length - 1].epa.post : 0;

    await db.teams.put({
        teamNumber: teamNumber,
        teamName: teamName,
        eventKey: eventKey,
        matchCount: apiMatchCount,
        currentEPA: currentEPA,
        autoEPA: autoEPA,       // Saved!
        teleopEPA: teleopEPA,   // Saved!
        endgameEPA: endgameEPA, // Saved!
        rawStatboticsData: fullMatchData,
        analysis: cachedTeam?.analysis || null,
        lastUpdated: Date.now()
    });

    return null;
}


window.syncProjections = async function () {
    const input = document.getElementById('eventKeyInput');
    const eventKey = input ? input.value.trim().toLowerCase() : "";

    if (!eventKey) {
        alert("Please enter a valid Event Key first!");
        return;
    }

    localStorage.setItem('lastEventKey', eventKey);

    const statusDiv = document.getElementById('status');
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');

    statusDiv.innerText = `Fetching team list for ${eventKey}...`;

    // 1. Get the list of teams at the event
    const eventResp = await fetch(`https://api.statbotics.io/v3/events/${eventKey}`);
    const eventData = await eventResp.json();

    // Statbotics v3 might return the teams array differently, adjust if needed
    // Usually it requires fetching /teams?event={eventKey} but assuming you have this part working:
    const teamsResp = await fetch(`https://api.statbotics.io/v3/team_events?event=${eventKey}`);
    const teamsData = await teamsResp.json();
    const teamsList = teamsData.data || teamsData.results || teamsData;

    if (!teamsList || teamsList.length === 0) {
        statusDiv.innerText = "❌ No teams found for this event.";
        return;
    }

    const totalTeams = teamsList.length;

    // 2. Show the progress bar
    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';

    // 3. The Sync Loop
    for (let i = 0; i < totalTeams; i++) {
        const teamNumber = teamsList[i].team;

        // Update text
        statusDiv.innerText = `Syncing Team ${teamNumber} (${i + 1}/${totalTeams})...`;

        // Process the team
        await processTeamPerformance(teamNumber, eventKey);

        // Update the bar width
        const percentComplete = ((i + 1) / totalTeams) * 100;
        progressBar.style.width = `${percentComplete}%`;

        displayTeams();
    }

    // 4. Wrap it up
    statusDiv.innerText = `✅ Sync Complete! Loaded ${totalTeams} teams.`;

    // Optional: Hide the bar after a second, or turn it green
    progressBar.style.background = '#10b981'; // Turn it green
    setTimeout(() => {
        progressContainer.style.display = 'none';
        progressBar.style.background = '#3b82f6'; // Reset color for next time
    }, 2000);

    // Finally, redraw the table
    displayTeams();
}

window.syncSchedule = async function () {
    const eventKey = document.getElementById('eventKeyInput').value.trim().toLowerCase();
    if (!eventKey) return alert("Please enter an Event Key.");

    const statusDiv = document.getElementById('status');
    statusDiv.innerText = "Fetching Schedule from TBA...";

    try {
        // TBA_API_KEY should be defined at the top of your file
        const response = await fetch(`https://www.thebluealliance.com/api/v3/event/${eventKey}/matches/simple`, {
            headers: { 'X-TBA-Auth-Key': TBA_KEY }
        });

        if (!response.ok) throw new Error("TBA Key invalid or Event not found.");

        const matches = await response.json();
        const qualMatches = matches
            .filter(m => m.comp_level === 'qm')
            .sort((a, b) => a.match_number - b.match_number);

        await db.matches.bulkPut(qualMatches.map(m => ({
            key: m.key,
            eventKey: eventKey,
            matchNumber: m.match_number,
            red: m.alliances.red.team_keys.map(t => t.replace('frc', '')),
            blue: m.alliances.blue.team_keys.map(t => t.replace('frc', '')),
            redScore: m.alliances.red.score,
            blueScore: m.alliances.blue.score
        })));

        statusDiv.innerText = "✅ Schedule Sync Complete!";
        displaySchedule();
    } catch (err) {
        console.error(err);
        statusDiv.innerText = "❌ TBA Schedule Sync Failed.";
    }

    localStorage.setItem('lastEventKey', eventKey);
};

window.syncAll = async function () {
    const eventKey = document.getElementById('eventKeyInput').value.trim();
    if (!eventKey) return alert("Please enter an Event Key.");

    const statusDiv = document.getElementById('status');

    // Run them sequentially so the status messages don't fight
    statusDiv.innerText = "🚀 Starting Master Sync...";

    await window.syncProjections();
    await window.syncSchedule();

    statusDiv.innerText = "🎉 All systems up to date!";
};






window.clearCache = async function () {
    if (!confirm("Are you sure you want to clear all cached team data? This cannot be undone.")) {
        return;
    }

    try {
        // Clear the teams table in Dexie
        await db.teams.clear();

        // Clear any UI elements
        const statusDiv = document.getElementById('status');
        if (statusDiv) statusDiv.innerText = "Cache cleared successfully.";

        // Refresh the table display (which will now be empty)
        if (typeof displayTeams === 'function') {
            displayTeams();
        }

        console.log("Database cache cleared.");
    } catch (err) {
        console.error("Error clearing cache:", err);
        alert("Failed to clear cache. Check console for details.");
    }
};





window.runManualAnalysis = async function () {
    if (!activeTeamNumber) {
        console.error("No active team selected.");
        return;
    }

    // --- FIX: The Bulletproof Fetch ---
    // Try it exactly as stored first, then fallback to Integer just in case
    let team = await db.teams.get(activeTeamNumber);
    if (!team) {
        team = await db.teams.get(parseInt(activeTeamNumber));
    }

    if (!team) {
        alert("Error: Could not load team data from database.");
        return;
    }

    const startInput = parseInt(document.getElementById('mathStart').value);
    const endInput = parseInt(document.getElementById('mathEnd').value);

    // Get only the completed matches with EPA
    const playedMatches = team.rawStatboticsData.filter(m => m.epa?.post);

    // Slice based on match index (1-based for user friendliness)
    const selection = playedMatches.slice(startInput - 1, endInput);
    const epaTimeline = selection.map(m => m.epa.post);

    if (epaTimeline.length < 5) {
        document.getElementById('analysisFeedback').innerText = "❌ Need at least 5 matches in range.";
        return;
    }

    document.getElementById('analysisFeedback').innerText = "Calculating...";

    // Run the Math
    const fitParams = fitExponentialGrowth(epaTimeline);
    const analysis = getBootstrappedCeiling(epaTimeline);

    // Temporarily store it on the object so the chart can see it
    team.analysis = analysis;
    team.analysis.rawParams = fitParams;
    team.analysis.startIndex = startInput - 1; // Used for chart alignment

    // Update UI Stats
    document.getElementById('detailStats').innerHTML = `
        <div style="background:#333; padding:15px; border-radius:8px;">
            <label style="color:#888; font-size:0.8em;">RANGE CURRENT</label>
            <div style="font-size:1.5em; font-weight:bold;">${epaTimeline[epaTimeline.length - 1]}</div>
        </div>
        <div style="background:#333; padding:15px; border-radius:8px;">
            <label style="color:#888; font-size:0.8em;">PROJECTED CEILING</label>
            <div style="font-size:1.5em; font-weight:bold; color:#4ade80;">${analysis.ceiling}</div>
        </div>
        <div style="background:#333; padding:15px; border-radius:8px;">
            <label style="color:#888; font-size:0.8em;">CONFIDENCE</label>
            <div>${analysis.lowerBound} - ${analysis.upperBound}</div>
        </div>
    `;

    // SAVE THE ANALYSIS: This makes the result show up in the main table permanently
    await db.teams.update(team.teamNumber, {
        analysis: team.analysis
    });

    // Refresh the main table in the background
    displayTeams();

    document.getElementById('analysisFeedback').innerText = `✅ Analysis complete for matches ${startInput} to ${Math.min(endInput, playedMatches.length)}.`;

    // Re-draw the chart with the new trendline
    renderChart(team);
};




// 7. UI HOOKS
const eventInput = document.getElementById('eventKeyInput');


function fitExponentialGrowth(timeline) {
    const n = timeline.length;
    const maxObserved = Math.max(...timeline);

    let bestA = 0, bestB = 0, bestK = 0;
    let lowestError = Infinity;

    // We know the true ceiling (A) must be higher than their current highest score.
    // We will test every possible ceiling from just above their max, up to 3x their max.
    const startA = maxObserved + 0.1;
    const endA = maxObserved * 3.0;
    const stepA = 0.5;

    for (let A = startA; A <= endA; A += stepA) {

        // --- LOG-LINEARIZATION ---
        // By looking at ln(A - y), we turn the exponential curve into a straight line.
        // This allows us to use Exact Algebraic Least Squares to find the perfect slope.
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        let validPoints = 0;

        for (let i = 0; i < n; i++) {
            const x = i + 1;
            const y = timeline[i];

            // Calculate the linearized Y value
            const Y = Math.log(A - y);

            sumX += x;
            sumY += Y;
            sumXY += x * Y;
            sumXX += x * x;
            validPoints++;
        }

        // Closed-form linear regression formulas (No learning rates, perfect accuracy)
        const denominator = (validPoints * sumXX) - (sumX * sumX);
        if (denominator === 0) continue;

        const m = ((validPoints * sumXY) - (sumX * sumY)) / denominator;
        const C = (sumY - m * sumX) / validPoints;

        // Convert the linear line back into our exponential variables
        const k = -m;
        const B = Math.exp(C);

        // We only care about positive growth. If the math suggests they are getting worse, ignore it.
        if (k <= 0) continue;

        // --- NON-LINEAR ERROR CHECK ---
        // Check how well these exact parameters fit the actual raw dots on the chart
        let totalSquaredError = 0;
        for (let i = 0; i < n; i++) {
            const x = i + 1;
            const prediction = A - B * Math.exp(-k * x);
            const error = prediction - timeline[i];
            totalSquaredError += error * error; // True Least Squares calculation
        }

        // If this ceiling produced the lowest overall error, save it as the winner
        if (totalSquaredError < lowestError) {
            lowestError = totalSquaredError;
            bestA = A;
            bestB = B;
            bestK = k;
        }
    }

    // Fallback if the data is entirely flat
    if (lowestError === Infinity) {
        return { A: maxObserved, B: 0, k: 0.1, n };
    }

    return { A: bestA, B: bestB, k: bestK, n };
}

function getBootstrappedCeiling(timeline) {
    if (timeline.length < 5) return { ceiling: "N/A" };

    const originalFit = fitExponentialGrowth(timeline);

    const residuals = timeline.map((y, i) => {
        const x = i + 1;
        return y - (originalFit.A - originalFit.B * Math.exp(-originalFit.k * x));
    });

    const bootstrapResults = [];
    for (let b = 0; b < 100; b++) {
        const syntheticTimeline = timeline.map((y, i) => {
            const x = i + 1;
            const randomResid = residuals[Math.floor(Math.random() * residuals.length)];
            const val = (originalFit.A - originalFit.B * Math.exp(-originalFit.k * x)) + randomResid;
            return val;
        });

        const fit = fitExponentialGrowth(syntheticTimeline);
        bootstrapResults.push(fit.A);
    }

    bootstrapResults.sort((a, b) => a - b);

    return {
        ceiling: originalFit.A.toFixed(1),
        lowerBound: bootstrapResults[Math.floor(bootstrapResults.length * 0.05)].toFixed(1),
        upperBound: bootstrapResults[Math.floor(bootstrapResults.length * 0.95)].toFixed(1),
        rawParams: originalFit
    };
}

let currentSortKey = 'ceiling'; // Default sort
let currentSortOrder = 1; // 1 for descending, -1 for ascending
let currentSortColumn = 'ceiling'; // Add this line

window.sortBy = function (column) {
    if (currentSortColumn === column) {
        // If clicking the same column, flip the direction
        currentSortOrder *= -1;
    } else {
        // If clicking a new column, set it as active and default to Highest First
        currentSortColumn = column;
        currentSortOrder = 1;

        // Exception: Team Numbers usually make more sense sorted Lowest First
        if (column === 'teamNumber') currentSortOrder = -1;
    }
    displayTeams(); // Redraw the table with the new sorting rules
};




let teamChartInstance = null;

function renderTeamChart(sortedTeams) {
    const ctx = document.getElementById('teamComparisonChart').getContext('2d');
    if (teamChartInstance) teamChartInstance.destroy();

    // Prepare labels (Team Numbers)
    const labels = sortedTeams.map(t => t.teamNumber.toString());

    teamChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Auto',
                    data: sortedTeams.map(t => t.autoEPA || 0),
                    backgroundColor: '#fbbf24', // Amber
                    stack: 'EPA'
                },
                {
                    label: 'Teleop',
                    data: sortedTeams.map(t => t.teleopEPA || 0),
                    backgroundColor: '#3b82f6', // Blue
                    stack: 'EPA'
                },
                {
                    label: 'Endgame',
                    data: sortedTeams.map(t => t.endgameEPA || 0),
                    backgroundColor: '#10b981', // Green
                    stack: 'EPA'
                },
                {
                    type: 'scatter',
                    label: 'Ceiling',
                    data: sortedTeams.map(t => t.analysis?.ceiling || t.currentEPA || 0),
                    backgroundColor: '#f43f5e', // Rose/Pink
                    pointStyle: 'circle',
                    pointRadius: 6,
                    pointHoverRadius: 8,
                    z: 10 // Ensure dots are on top
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    stacked: true,
                    grid: { display: false },
                    ticks: { color: '#94a3b8', font: { size: 10 } }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: '#334155' },
                    ticks: { color: '#94a3b8' },
                    title: { display: true, text: 'Expected Points Added (EPA)', color: '#94a3b8' }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: '#f8fafc', usePointStyle: true }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false
                }
            }
        }
    });
}




window.displayTeams = async function () {
    const allTeams = await db.teams.toArray();
    const tableBody = document.getElementById('teamBody');
    //const searchVal = document.getElementById('teamSearch')?.value || '';
    const table = document.getElementById('teamTable');

    if (allTeams.length === 0) {
        table.style.display = 'none';
        return;
    }
    table.style.display = 'table';

    // 1. Determine the range using Current EPA (Our constant baseline)
    const epaValues = allTeams.map(t => t.currentEPA || 0);
    const minEPA = Math.min(...epaValues);
    const maxEPA = Math.max(...epaValues);

    // 2. Sort logic (Maintains your preferred order)
    allTeams.sort((a, b) => {
        let valA, valB;

        switch (currentSortColumn) {
            case 'teamNumber':
                valA = a.teamNumber;
                valB = b.teamNumber;
                break;
            case 'autoEPA':
                valA = a.autoEPA || 0;
                valB = b.autoEPA || 0;
                break;
            case 'teleopEPA':
                valA = a.teleopEPA || 0;
                valB = b.teleopEPA || 0;
                break;
            case 'endgameEPA':
                valA = a.endgameEPA || 0;
                valB = b.endgameEPA || 0;
                break;
            case 'currentEPA':
                valA = a.currentEPA || 0;
                valB = b.currentEPA || 0;
                break;
            case 'ceiling':
            default:
                valA = a.analysis?.ceiling || a.currentEPA || 0;
                valB = b.analysis?.ceiling || b.currentEPA || 0;
                break;
        }

        // parseFloat ensures we are doing math on numbers, not strings
        return (parseFloat(valB) - parseFloat(valA)) * currentSortOrder;
    });

    // 2. Render the Chart with the current list
    renderTeamChart(allTeams);

    tableBody.innerHTML = '';

    allTeams.forEach(team => {
        const analysis = team.analysis || { ceiling: "—", lowerBound: "—", upperBound: "—" };
        const { ceiling, lowerBound, upperBound } = analysis;

        let percent;
        if (minEPA === maxEPA) {
            percent = 0.5;
        } else {
            percent = (team.currentEPA - minEPA) / (maxEPA - minEPA || 1);
        }

        const rowColor = getRowColor(percent);
        const rowBackground = `${rowColor.replace('rgb', 'rgba').replace(')', ', 0.15)')}`;

        const row = document.createElement('tr');
        row.style.backgroundColor = rowBackground;
        row.style.borderLeft = `6px solid ${rowColor}`;

        // --- THE FIX ---
        // 1. Change the mouse to a pointer so it feels like a button
        row.style.cursor = 'pointer';

        // 2. Attach the click event to the entire row safely
        row.onclick = () => viewTeamDetail(team.teamNumber);

        // Notice we removed the onclick="" from the <td> string
        row.innerHTML = `
            <td><strong>${team.teamNumber}</strong></td>
            <td>${team.currentEPA ? team.currentEPA.toFixed(1) : 'N/A'}</td>
            <td class="ceiling-cell"><strong>${ceiling}</strong></td>
            <td class="confidence">[${lowerBound} - ${upperBound}]</td>
            <td style="color:#aaa;">${team.autoEPA ? team.autoEPA.toFixed(1) : '-'}</td>
            <td style="color:#aaa;">${team.teleopEPA ? team.teleopEPA.toFixed(1) : '-'}</td>
            <td style="color:#aaa;">${team.endgameEPA ? team.endgameEPA.toFixed(1) : '-'}</td>
        `;

        tableBody.appendChild(row);
    });
}

// Helper to calculate hex codes for Red -> Grey -> Green
function getRowColor(percent) {
    if (percent > 0.5) {
        // Grey to Green
        const p = (percent - 0.5) * 2;
        const r = Math.floor(128 * (1 - p));
        const g = Math.floor(128 + (127 * p));
        return `rgb(${r}, ${g}, ${r})`;
    } else {
        // Red to Grey
        const p = percent * 2;
        const r = Math.floor(220 * (1 - p) + 128 * p);
        const g = Math.floor(128 * p);
        return `rgb(${r}, ${g}, ${g})`;
    }
}

// And add this at the very bottom of main.js to load on startup
displayTeams();




window.setSort = function (key) {
    if (currentSortKey === key) {
        currentSortOrder *= -1; // Flip order if clicking same header
    } else {
        currentSortKey = key;
        currentSortOrder = -1; // Default to highest first for new key
    }
    displayTeams();
};


window.viewTeamDetail = async function (teamNumber) {
    activeTeamNumber = teamNumber; // <--- ADD THIS LINE
    const team = await db.teams.get(teamNumber);
    if (!team) return;

    const view = document.getElementById('teamDetailView');
    const label = document.getElementById('detailTeamLabel');
    const stats = document.getElementById('detailStats');

    // --- THE FIX: Grab the link element ---
    const statLink = document.getElementById('statboticsLink');

    if (!view || !label || !stats) {
        console.error("Missing Detail View elements in HTML.");
        return;
    }

    view.style.display = 'block';
    label.innerText = `Team ${teamNumber}: ${team.teamName || ''}`;

    if (statLink) {
        statLink.href = `https://www.statbotics.io/team/${teamNumber}/2026`;
    }

    // --- FIX: The Safe Check ---
    // If analysis is null, provide default "blank" values
    const analysis = team.analysis || { ceiling: "—", lowerBound: "—", upperBound: "—" };

    stats.innerHTML = `
        <div style="background:#333; padding:15px; border-radius:8px;">
            <label style="color:#888; font-size:0.8em;">CURRENT EPA</label>
            <div style="font-size:1.5em; font-weight:bold;">${team.currentEPA ? team.currentEPA.toFixed(1) : '0'}</div>
        </div>
        <div style="background:#333; padding:15px; border-radius:8px;">
            <label style="color:#888; font-size:0.8em;">PROJECTED CEILING</label>
            <div style="font-size:1.5em; font-weight:bold; color:#4ade80;">${analysis.ceiling}</div>
        </div>
        <div style="background:#333; padding:15px; border-radius:8px;">
            <label style="color:#888; font-size:0.8em;">90% CONFIDENCE</label>
            <div>${analysis.lowerBound} - ${analysis.upperBound}</div>
        </div>
    `;

    renderChart(team);

    window.switchView('teamDetailView');
};

window.closeDetail = function () {
    document.getElementById('teamDetailView').style.display = 'none';
};


// At the top of main.js
window.currentView = 'scheduleView';
window.previousView = 'scheduleView';

window.switchView = function (viewId) {
    // 1. Hide the current view
    const current = document.getElementById(window.currentView);
    if (current) current.style.display = 'none';

    // 2. Store the current view as 'previous' before we swap
    // (Only if we aren't switching TO the same view)
    if (window.currentView !== viewId) {
        window.previousView = window.currentView;
    }

    // 3. Show the new view
    const next = document.getElementById(viewId);
    if (next) {
        next.style.display = 'block';
        window.currentView = viewId;
    }

    // 4. Update the Back button label on the Team Detail page
    updateDetailBackButton();
};

window.updateDetailBackButton = function () {
    const btn = document.getElementById('detailBackBtn');
    if (!btn) return;

    // Change the label based on where the user was previously
    if (window.previousView === 'matchPrepView') {
        btn.innerText = '← Back to Match Prep';
    } else if (window.previousView === 'teamView') {
        btn.innerText = '← Back to Statbotics';
    } else {
        btn.innerText = '← Back';
    }
};

window.goBack = function () {
    // Navigate to the stored previous view
    window.switchView(window.previousView);
};





let performanceChart = null;
// Add this near your other global variables like performanceChart
let activeTeamNumber = null;

function renderChart(team) {
    const ctx = document.getElementById('performanceChart').getContext('2d');
    if (performanceChart) performanceChart.destroy();

    const playedMatches = team.rawStatboticsData.filter(m => m.epa?.post);
    const epaData = playedMatches.map(m => m.epa.post);
    const eventLabels = playedMatches.map(m => m.event);

    const datasets = [{
        label: 'Match EPA',
        data: epaData,
        showLine: false,
        pointRadius: 5,
        pointBackgroundColor: eventLabels.map(ev => getEventColor(ev)), // Your color helper
        pointBorderColor: eventLabels.map(ev => getEventColor(ev))
    }];

    if (team.analysis && team.analysis.rawParams) {
        const trendData = new Array(epaData.length).fill(null);
        const { A, B, k } = team.analysis.rawParams;
        const startIndex = team.analysis.startIndex;

        // How many matches are in our specific selection?
        const selectionLength = team.analysis.rawParams.n;

        // We use x = i + 1 to match the new "Preferred" math engine
        for (let i = 0; i < selectionLength; i++) {
            const x = i + 1;
            const y = A - B * Math.exp(-k * x);
            trendData[startIndex + i] = y;
        }

        datasets.push({
            label: 'Projected Ceiling (Range)',
            data: trendData,
            borderColor: '#4ade80',
            borderDash: [5, 5],
            pointRadius: 0,
            fill: false,
            spanGaps: false // Keeps the line strictly within the range
        });
    }

    performanceChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: epaData.map((_, i) => `M${i + 1}`),
            datasets: datasets
        },
        options: {
            plugins: {
                legend: {
                    labels: {
                        // Custom legend to show event colors
                        generateLabels: (chart) => {
                            const playedMatches = team.rawStatboticsData.filter(m => m.epa?.post);
                            const uniqueEvents = [...new Set(playedMatches.map(m => m.event))];

                            return uniqueEvents.map(ev => ({
                                text: ev.toUpperCase(),
                                fillStyle: getEventColor(ev),
                                strokeStyle: getEventColor(ev),
                                lineWidth: 0,
                                // Some versions of Chart.js require explicit fontColor here
                                fontColor: '#f8fafc'
                            }));
                        }
                    }
                }
            },
            scales: {
                y: { grid: { color: '#333' }, ticks: { color: '#aaa' } },
                x: { grid: { display: false }, ticks: { color: '#aaa' } }
            }
        }
    });
}

// Helper to generate the trendline points
function calculateTrendLine(params, length) {
    if (!params) return [];
    const { A, B, k } = params;
    return Array.from({ length }, (_, i) => {
        const xScaled = i / (length - 1);
        return A - B * Math.exp(-k * xScaled);
    });
}


// Global color map to keep event colors consistent across the app
const eventColorCache = {};
const palette = ['#3b82f6', '#f59e0b', '#ef4444', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4'];

function getEventColor(eventKey) {
    if (!eventColorCache[eventKey]) {
        // If we haven't seen this event yet, pick the next color from the palette
        const index = Object.keys(eventColorCache).length % palette.length;
        eventColorCache[eventKey] = palette[index];
    }
    return eventColorCache[eventKey];
}


// Bottom of main.js - The App Bootloader
const bootApp = async () => {

    // At the top of bootApp
    const savedKey = localStorage.getItem('lastEventKey');
    if (savedKey) {
        document.getElementById('eventKeyInput').value = savedKey;
    }

    // 1. Set the initial view (Home)
    const homeBtn = document.querySelector('.nav-btn');
    if (homeBtn) window.switchView('homeView', homeBtn);

    // 2. Load the cached data into the tables immediately
    // This ensures that when you click 'Statbotics' or 'Schedule', 
    // the data is already waiting for you.
    try {
        await displayTeams();    // Loads Statbotics cache
        await displaySchedule(); // Loads TBA Schedule cache
        console.log("Local cache successfully loaded into UI.");
    } catch (err) {
        console.warn("No cached data found to load yet.");
    }
};

bootApp();

// Automatically set the view to 'homeView' when the script finishes loading
document.addEventListener('DOMContentLoaded', () => {
    const homeBtn = document.querySelector('.nav-btn'); // Grabs the first button (Home)
    switchView('homeView', homeBtn);
});

// Initialize the view once the script is ready
const homeBtn = document.querySelector('.nav-btn');
window.switchView('homeView', homeBtn);

document.getElementById('eventKeyInput').value = localStorage.getItem('lastEventKey') || '';






