// Global state variables
let isConnected = false;
let camerasList = [];
let localVideosList = [];
let activeTab = 'downloader';
let eventSourceInstance = null;
let statusInterval = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    setupDefaultDates();
    startStatusPolling();
    loadLibraryVideos();
});

// Periodic polling of the backend browser and login session state
function startStatusPolling() {
    checkSessionStatus();
    statusInterval = setInterval(checkSessionStatus, 3000);
}

async function checkSessionStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();

        updateStatusBadges(data);

        if (data.authenticated) {
            if (!isConnected) {
                isConnected = true;
                showDashboard();
                loadCameras();
                setupSSE();
            }
        } else {
            if (isConnected) {
                isConnected = false;
                showOnboarding();
                if (eventSourceInstance) {
                    eventSourceInstance.close();
                    eventSourceInstance = null;
                }
            }
        }
    } catch (err) {
        console.error('Failed to poll status:', err);
    }
}

// Update status elements in HTML
function updateStatusBadges(data) {
    // Badges in onboarding page
    const browserBadge = document.getElementById('browserOpenBadge');
    const loginBadge = document.getElementById('loginStatusBadge');
    
    if (data.browserOpen) {
        browserBadge.innerText = 'OPEN';
        browserBadge.className = 'status-badge badge-downloading';
    } else {
        browserBadge.innerText = 'CLOSED';
        browserBadge.className = 'status-badge badge-idle';
    }

    if (data.authenticated) {
        loginBadge.innerText = 'CONNECTED';
        loginBadge.className = 'status-badge badge-completed';
    } else {
        loginBadge.innerText = 'NOT LOGGED IN';
        loginBadge.className = 'status-badge badge-failed';
    }

    // Header bar
    const bar = document.getElementById('connectionStatusBar');
    if (data.authenticated) {
        bar.innerHTML = `<span class="status-pill status-connected"><span class="pulse-dot"></span> Session Active</span>`;
    } else {
        bar.innerHTML = `<span class="status-pill status-disconnected">Session Disconnected</span>`;
    }
}

// Show/Hide Dashboard
function showDashboard() {
    document.getElementById('authContainer').style.display = 'none';
    document.getElementById('dashboardContainer').style.display = 'block';
}

function showOnboarding() {
    document.getElementById('dashboardContainer').style.display = 'none';
    document.getElementById('authContainer').style.display = 'block';
}

// Launch Chromium session
async function launchBrowserSession() {
    const errorEl = document.getElementById('launchError');
    const spinner = document.getElementById('launchSpinner');
    const btn = document.getElementById('launchBrowserBtn');

    errorEl.style.display = 'none';
    spinner.style.display = 'inline-block';
    btn.disabled = true;

    try {
        const res = await fetch('/api/browser/launch', { method: 'POST' });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Failed to start browser');

        checkSessionStatus();
    } catch (err) {
        errorEl.innerText = err.message;
        errorEl.style.display = 'block';
    } finally {
        spinner.style.display = 'none';
        btn.disabled = false;
    }
}

// Close Chromium session
async function closeBrowserSession() {
    if (!confirm('Are you sure you want to close the secure Chrome browser window?')) return;
    try {
        await fetch('/api/browser/close', { method: 'POST' });
        checkSessionStatus();
    } catch (err) {
        console.error('Error closing browser:', err);
    }
}

// Tab Switching
function switchDashboardTab(tab) {
    activeTab = tab;
    const tabBtns = document.querySelectorAll('.dash-tab-btn');
    tabBtns[0].classList.toggle('active', tab === 'downloader');
    tabBtns[1].classList.toggle('active', tab === 'library');

    document.getElementById('downloaderTab').style.display = tab === 'downloader' ? 'grid' : 'none';
    document.getElementById('libraryTab').style.display = tab === 'library' ? 'block' : 'none';

    if (tab === 'library') {
        loadLibraryVideos();
    }
}

// Fetch active camera list from backend
async function loadCameras() {
    const container = document.getElementById('cameraListContainer');
    try {
        const res = await fetch('/api/cameras');
        const data = await res.json();

        if (!res.ok) throw new Error(data.error);

        camerasList = data.cameras || [];

        if (camerasList.length === 0) {
            container.innerHTML = `<div class="loading-placeholder text-muted">No cameras found in dashboard. Scroll list in browser to load cards!</div>`;
            return;
        }

        container.innerHTML = camerasList.map(camera => `
            <label class="camera-card">
                <input type="checkbox" name="selectedCameras" value="${escapeHTML(camera.name)}" checked>
                <div class="camera-info">
                    <div class="camera-name">${escapeHTML(camera.name)}</div>
                    <div class="camera-meta">${escapeHTML(camera.model)}</div>
                </div>
            </label>
        `).join('');

        // Populate library filter dropdown
        const cameraFilter = document.getElementById('libraryCameraFilter');
        cameraFilter.innerHTML = '<option value="all">All Cameras</option>' +
            camerasList.map(c => `<option value="${escapeHTML(c.name)}">${escapeHTML(c.name)}</option>`).join('');

    } catch (err) {
        console.error('Failed to load cameras:', err);
        container.innerHTML = `<div class="loading-placeholder text-danger">Failed to index cameras. ${escapeHTML(err.message)}</div>`;
    }
}

// Date Range Presets
function setupDefaultDates() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

    document.getElementById('startDate').value = formatDateTimeLocal(todayStart);
    document.getElementById('endDate').value = formatDateTimeLocal(now);
}

function setDatePreset(preset, btn) {
    const btns = document.querySelectorAll('.preset-btn');
    btns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const customContainer = document.getElementById('customDateContainer');
    customContainer.style.display = preset === 'custom' ? 'flex' : 'none';

    if (preset === 'custom') return;

    const now = new Date();
    let start = new Date();

    if (preset === 'today') {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    } else if (preset === '7d') {
        start.setDate(now.getDate() - 7);
    } else if (preset === '30d') {
        start.setDate(now.getDate() - 30);
    }

    document.getElementById('startDate').value = formatDateTimeLocal(start);
    document.getElementById('endDate').value = formatDateTimeLocal(now);
}

// Downloader Controls
async function startBulkDownload() {
    const checkedBoxes = document.querySelectorAll('input[name="selectedCameras"]:checked');
    const cameraNames = Array.from(checkedBoxes).map(cb => cb.value);

    if (cameraNames.length === 0) {
        alert('Please select at least one camera.');
        return;
    }

    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;

    const eventKinds = [];
    if (document.getElementById('filterMotion').checked) eventKinds.push('motion');
    if (document.getElementById('filterDing').checked) eventKinds.push('ding');
    if (document.getElementById('filterOnDemand').checked) eventKinds.push('on_demand');

    if (eventKinds.length === 0) {
        alert('Please select at least one event type.');
        return;
    }

    const startBtn = document.getElementById('startDownloadBtn');
    startBtn.disabled = true;

    try {
        const res = await fetch('/api/download/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cameraNames,
                startDate,
                endDate,
                eventKinds
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

    } catch (err) {
        alert('Failed to start bulk downloader: ' + err.message);
        startBtn.disabled = false;
    }
}

async function cancelActiveDownload() {
    if (!confirm('Are you sure you want to cancel the current download job?')) return;
    try {
        const res = await fetch('/api/download/cancel', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
    } catch (err) {
        alert('Failed to cancel download: ' + err.message);
    }
}

// SSE listener updates progress in real time
function setupSSE() {
    if (eventSourceInstance) return;

    eventSourceInstance = new EventSource('/api/download/events');

    eventSourceInstance.onmessage = (event) => {
        const payload = JSON.parse(event.data);
        if (payload.type === 'state') {
            updateDownloadUI(payload.state);
        }
    };

    eventSourceInstance.onerror = (err) => {
        console.error('SSE connection lost. Re-establishing connection...');
    };
}

function updateDownloadUI(state) {
    const badge = document.getElementById('downloadStatusBadge');
    badge.innerText = state.status.toUpperCase();
    badge.className = `status-badge badge-${state.status}`;

    const startBtn = document.getElementById('startDownloadBtn');
    startBtn.disabled = state.active;

    const idleScreen = document.getElementById('progressIdleScreen');
    const activeScreen = document.getElementById('progressActiveScreen');

    if (state.status === 'idle') {
        idleScreen.style.display = 'flex';
        activeScreen.style.display = 'none';
        return;
    }

    idleScreen.style.display = 'none';
    activeScreen.style.display = 'flex';

    // Update Stats
    document.getElementById('statProcessed').innerText = `${state.processedEvents} / ${state.totalEvents}`;
    document.getElementById('statSuccess').innerText = state.successfulEvents;
    document.getElementById('statFailed').innerText = state.failedEvents;

    // Progress Bar
    const percent = state.totalEvents > 0
        ? Math.round((state.processedEvents / state.totalEvents) * 100)
        : 0;

    document.getElementById('progressBarFill').style.width = `${percent}%`;
    document.getElementById('progressPercentText').innerText = `${percent}%`;

    // Active Task details
    const activeDetails = document.getElementById('currentDownloadDetailsContainer');
    if (state.active && state.currentEvent) {
        activeDetails.style.display = 'block';
        document.getElementById('activeTaskCamera').innerText = state.currentEvent.cameraName;

        const friendlyTime = new Date(state.currentEvent.createdAt).toLocaleString();
        const friendlyKind = getFriendlyEventName(state.currentEvent.kind);
        document.getElementById('activeTaskMeta').innerText = `Downloading ${friendlyKind} - ${friendlyTime}`;
    } else {
        activeDetails.style.display = 'none';
    }

    // Log Console
    const logBox = document.getElementById('consoleLoggerBox');
    logBox.innerHTML = '';

    state.queue.forEach(item => {
        const timeStr = new Date(item.createdAt).toLocaleTimeString();
        let classStr = 'queued';
        let statusText = 'Queued';

        if (item.status === 'downloading') {
            classStr = 'info';
            statusText = 'Downloading...';
        } else if (item.status === 'success') {
            classStr = 'success';
            statusText = 'Completed';
        } else if (item.status === 'failed') {
            classStr = 'error';
            statusText = `Failed (${item.error || 'Timeout'})`;
        }

        const kindStr = getFriendlyEventName(item.kind);
        const line = document.createElement('div');
        line.className = `console-line ${classStr}`;
        line.innerText = `[${timeStr}] ${item.cameraName} - ${kindStr}: ${statusText}`;
        logBox.appendChild(line);
    });

    logBox.scrollTop = logBox.scrollHeight;
}

// Local Video Library Logic
async function loadLibraryVideos() {
    const grid = document.getElementById('libraryGridContainer');
    try {
        const res = await fetch('/api/videos');
        const data = await res.json();

        if (!res.ok) throw new Error(data.error);

        localVideosList = data.videos || [];
        filterLibrary();
    } catch (err) {
        grid.innerHTML = `<div class="empty-library text-danger">Failed to load local index. ${escapeHTML(err.message)}</div>`;
    }
}

function filterLibrary() {
    const cameraFilter = document.getElementById('libraryCameraFilter').value;
    const typeFilter = document.getElementById('libraryTypeFilter').value;
    const grid = document.getElementById('libraryGridContainer');

    const filtered = localVideosList.filter(video => {
        const matchesCamera = cameraFilter === 'all' || video.cameraDir === sanitizeFilename(cameraFilter);
        const matchesType = typeFilter === 'all' || video.eventKind === typeFilter;
        return matchesCamera && matchesType;
    });

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="empty-library">
                <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5">
                    <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/>
                </svg>
                <h3>No video recordings found</h3>
                <p>Run a downloader task to retrieve clips from the dashboard.</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = filtered.map(video => {
        const cameraName = desanitizeFilename(video.cameraDir);
        const friendlyKind = getFriendlyEventName(video.eventKind);
        const playUrl = `/api/videos/play/${encodeURIComponent(video.cameraDir)}/${encodeURIComponent(video.filename)}`;

        return `
            <div class="video-card" onclick="openVideoPlayer('${playUrl}', '${escapeHTML(cameraName)}', '${escapeHTML(video.timestamp)}', '${friendlyKind}')">
                <div class="video-thumbnail-placeholder">
                    <span class="event-badge badge-${video.eventKind}">${video.eventKind}</span>
                    <div class="play-overlay-btn">
                        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </div>
                </div>
                <div class="video-card-body">
                    <div>
                        <div class="video-card-title">${escapeHTML(cameraName)}</div>
                        <div class="video-card-time">${escapeHTML(video.timestamp)}</div>
                    </div>
                    <div class="video-card-footer">
                        <span class="video-card-size">${escapeHTML(video.sizeFormatted)}</span>
                        <span class="video-card-action">Play Clip</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Play clip in video modal
function openVideoPlayer(playUrl, cameraName, timestamp, eventKind) {
    const modal = document.getElementById('videoModal');
    const player = document.getElementById('modalVideoPlayer');
    const title = document.getElementById('videoModalTitle');
    const subtitle = document.getElementById('videoModalSubtitle');
    const dlBtn = document.getElementById('modalDownloadBtn');

    title.innerText = `${cameraName} - ${eventKind}`;
    subtitle.innerText = timestamp;

    player.src = playUrl;
    dlBtn.href = playUrl;
    dlBtn.download = playUrl.split('/').pop();

    modal.classList.add('active');
}

function closeVideoPlayer() {
    const modal = document.getElementById('videoModal');
    const player = document.getElementById('modalVideoPlayer');

    modal.classList.remove('active');
    player.pause();
    player.src = '';
}

// Utility functions
function getFriendlyEventName(kind) {
    if (kind === 'motion') return 'Motion Alert';
    if (kind === 'ding') return 'Doorbell Ring';
    if (kind === 'on_demand') return 'Live View';
    return kind;
}

function escapeHTML(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function sanitizeFilename(name) {
    return name.replace(/[^a-z0-9_-]/gi, '_').replace(/_+/g, '_');
}

function desanitizeFilename(dir) {
    return dir.replace(/_/g, ' ');
}

function formatDateTimeLocal(date) {
    const pad = (num) => String(num).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
