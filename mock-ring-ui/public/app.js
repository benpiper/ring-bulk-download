/* ═══════════════════════════════════════════════════════════ */
/* MOCK RING ACTIVITY HISTORY — CLIENT-SIDE APPLICATION        */
/* Generates realistic event data and handles interactions     */
/* that match the DOM structure server.js expects              */
/* ═══════════════════════════════════════════════════════════ */

// ── Configuration ───────────────────────────────────────────
const CAMERAS = [
  { name: 'Front Door',       model: 'Video Doorbell Pro 2', hasDoorbell: true  },
  { name: 'Backyard Camera',  model: 'Stick Up Cam Battery', hasDoorbell: false },
  { name: 'Garage',           model: 'Floodlight Cam Wired Plus', hasDoorbell: false },
  { name: 'Driveway',         model: 'Spotlight Cam Pro',    hasDoorbell: false },
  { name: 'Side Gate',        model: 'Indoor Cam (2nd Gen)', hasDoorbell: false },
];

const EVENT_TYPES = {
  motion: {
    label: 'Motion Detected',
    badge: 'Motion',
    icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`
  },
  ding: {
    label: 'Someone is at your Front Door',
    badge: 'Doorbell Ring',
    icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`
  },
  on_demand: {
    label: 'Live View',
    badge: 'Live View',
    icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none"/></svg>`
  }
};

// ── State ───────────────────────────────────────────────────
let allEvents = [];
let displayedEvents = [];
let isManageMode = false;
let selectedIndices = new Set();
let currentFilter = 'all';
let loadedBatchCount = 0;
const EVENTS_PER_BATCH = 15;
const MAX_BATCHES = 15; // Increased to allow ~225 events (8 weeks)

// ── Event Generation ────────────────────────────────────────
function generateEvents() {
  const events = [];
  const now = new Date();
  let currentTime = new Date(now);

  // Generate events going backwards in time, spanning ~8 weeks (56 days)
  for (let i = 0; i < 225; i++) {
    // Random gap between events: 15 min to 12 hours
    // Average gap = ~6 hours. 225 events * 6 hrs = 1350 hrs (~56 days = 8 weeks)
    const gapMinutes = 15 + Math.floor(Math.random() * 720);
    currentTime = new Date(currentTime.getTime() - gapMinutes * 60 * 1000);

    // Pick a random camera
    const camera = CAMERAS[Math.floor(Math.random() * CAMERAS.length)];

    // Pick event type (weighted: 60% motion, 20% ding, 20% on_demand)
    // Only doorbells get "ding" events
    let kind;
    const roll = Math.random();
    if (roll < 0.6) {
      kind = 'motion';
    } else if (roll < 0.8 && camera.hasDoorbell) {
      kind = 'ding';
    } else if (roll < 0.9) {
      kind = 'on_demand';
    } else {
      kind = 'motion';
    }

    // Generate random video duration (10-120 seconds)
    const durationSec = 10 + Math.floor(Math.random() * 110);
    const durMin = Math.floor(durationSec / 60);
    const durSec = durationSec % 60;
    const durationStr = `${durMin}:${durSec.toString().padStart(2, '0')}`;

    events.push({
      id: `event-${i}`,
      cameraName: camera.name,
      cameraModel: camera.model,
      kind: kind,
      timestamp: new Date(currentTime),
      duration: durationStr,
    });
  }

  return events;
}

// ── Time Formatting (matches Ring's format) ─────────────────
function formatEventTime(date) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const eventDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  if (eventDay.getTime() === today.getTime()) {
    return `Today at ${timeStr}`;
  } else if (eventDay.getTime() === yesterday.getTime()) {
    return `Yesterday at ${timeStr}`;
  } else {
    const monthDay = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });
    return `${monthDay} at ${timeStr}`;
  }
}

function formatDateSeparator(date) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const eventDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (eventDay.getTime() === today.getTime()) {
    return 'Today';
  } else if (eventDay.getTime() === yesterday.getTime()) {
    return 'Yesterday';
  } else {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }
}

// ── Rendering ───────────────────────────────────────────────
function renderEvents() {
  const container = document.getElementById('eventList');
  container.innerHTML = '';

  const filtered = currentFilter === 'all'
    ? displayedEvents
    : displayedEvents.filter(e => e.kind === currentFilter);

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/>
          <path d="M8 12h8M8 8h8M8 16h4"/>
        </svg>
        <h3>No activity found</h3>
        <p>There are no events matching your current filter.</p>
      </div>
    `;
    return;
  }

  let lastDateStr = '';

  filtered.forEach((event, idx) => {
    const dateStr = formatDateSeparator(event.timestamp);

    // Insert date separator when the day changes
    if (dateStr !== lastDateStr) {
      const sep = document.createElement('div');
      sep.className = 'date-separator';
      sep.textContent = dateStr;
      container.appendChild(sep);
      lastDateStr = dateStr;
    }

    // Find the original index in displayedEvents (not filtered array)
    const originalIdx = displayedEvents.indexOf(event);
    const isChecked = selectedIndices.has(originalIdx);

    const card = document.createElement('div');
    card.className = 'event-card';
    card.setAttribute('role', 'checkbox');
    card.setAttribute('aria-checked', isChecked ? 'true' : 'false');
    card.setAttribute('data-event-index', originalIdx);
    card.setAttribute('data-camera', event.cameraName);
    card.setAttribute('data-kind', event.kind);

    const eventTypeInfo = EVENT_TYPES[event.kind] || EVENT_TYPES.motion;
    const timeStr = formatEventTime(event.timestamp);

    card.innerHTML = `
      <div class="card-checkbox-wrap">
        <input type="checkbox" class="card-checkbox" ${isChecked ? 'checked' : ''} tabindex="-1">
      </div>
      <div class="card-thumbnail">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="3" width="20" height="14" rx="2"/>
          <circle cx="12" cy="10" r="3"/>
          <path d="M7 21h10"/>
          <path d="M12 17v4"/>
        </svg>
        <span class="card-thumbnail-overlay">${event.duration}</span>
      </div>
      <div class="card-content">
        <div class="card-camera-name">${event.cameraName}</div>
        <div class="card-event-type">
          <span class="event-icon">${eventTypeInfo.icon}</span>
          <span>${eventTypeInfo.label}</span>
        </div>
        <div class="card-timestamp">${timeStr}</div>
      </div>
      <span class="event-badge event-badge-${event.kind}">${eventTypeInfo.badge}</span>
      <svg class="card-chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    `;

    card.addEventListener('click', () => handleCardClick(originalIdx, card));
    container.appendChild(card);
  });

  updateManageUI();
}

function handleCardClick(index, cardElement) {
  if (!isManageMode) return;

  const isCurrentlyChecked = selectedIndices.has(index);
  if (isCurrentlyChecked) {
    selectedIndices.delete(index);
  } else {
    selectedIndices.add(index);
  }

  const newState = !isCurrentlyChecked;
  cardElement.setAttribute('aria-checked', newState ? 'true' : 'false');
  const checkbox = cardElement.querySelector('input[type="checkbox"]');
  if (checkbox) checkbox.checked = newState;

  updateManageUI();
}

function updateManageUI() {
  const countEl = document.getElementById('selectedCount');
  if (countEl) {
    countEl.textContent = `${selectedIndices.size} selected`;
  }
}

// ── Manage Mode Toggle ──────────────────────────────────────
function toggleManageMode() {
  isManageMode = !isManageMode;

  const toolbarContainer = document.getElementById('manageToolbarContainer');
  const pencilBtn = document.getElementById('selectMultipleBtn');
  const pageContainer = document.querySelector('.page-container');

  if (isManageMode) {
    toolbarContainer.innerHTML = `
      <div class="manage-toolbar" id="manageToolbar">
        <div class="manage-toolbar-left">
          <span class="selected-count" id="selectedCount">0 selected</span>
        </div>
        <div class="manage-toolbar-right">
          <button
            data-testid="manage-events__download"
            class="rcl-btn rcl-btn-filled rcl-btn-primary"
            id="downloadBtn"
            onclick="downloadSelected()"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <span>Download</span>
          </button>
          <button class="rcl-btn rcl-btn-outline rcl-btn-negative" onclick="toggleManageMode()">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
            <span>Cancel</span>
          </button>
        </div>
      </div>
    `;
    pencilBtn.classList.add('active');
    pageContainer.classList.add('manage-mode');
  } else {
    toolbarContainer.innerHTML = '';
    pencilBtn.classList.remove('active');
    pageContainer.classList.remove('manage-mode');
    selectedIndices.clear();
    // Reset all checkbox states
    document.querySelectorAll('.event-card').forEach(card => {
      card.setAttribute('aria-checked', 'false');
      const cb = card.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = false;
    });
  }

  updateManageUI();
}

window.toggleManageMode = toggleManageMode;

// ── Filter Tabs ─────────────────────────────────────────────
function setFilter(filter, btnElement) {
  currentFilter = filter;
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  if (btnElement) btnElement.classList.add('active');
  renderEvents();
}
window.setFilter = setFilter;

// ── Download Simulation ─────────────────────────────────────
function downloadSelected() {
  if (selectedIndices.size === 0) {
    showToast('No events selected');
    return;
  }

  const selectedEvents = Array.from(selectedIndices).map(i => displayedEvents[i]).filter(Boolean);

  // Trigger download for each selected event
  selectedEvents.forEach((event, idx) => {
    setTimeout(() => {
      const ts = event.timestamp.toISOString();
      const url = `/api/mock-download?camera=${encodeURIComponent(event.cameraName)}&timestamp=${encodeURIComponent(ts)}`;

      const a = document.createElement('a');
      a.href = url;
      a.download = `${event.cameraName} - ${ts.replace(/[:.]/g, '-').slice(0, 19)}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }, idx * 300);
  });

  showToast(`Downloading ${selectedEvents.length} video${selectedEvents.length > 1 ? 's' : ''}...`);
}
window.downloadSelected = downloadSelected;

// ── Toast Notifications ─────────────────────────────────────
let toastEl = null;
let toastTimeout = null;

function showToast(message) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    document.body.appendChild(toastEl);
  }

  toastEl.textContent = message;
  toastEl.classList.add('visible');

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toastEl.classList.remove('visible');
  }, 3000);
}

// ── Infinite Scroll ─────────────────────────────────────────
function loadMoreEvents() {
  if (loadedBatchCount >= MAX_BATCHES) {
    const loader = document.getElementById('scrollLoader');
    if (loader) loader.style.display = 'none';
    return;
  }

  const start = loadedBatchCount * EVENTS_PER_BATCH;
  const end = Math.min(start + EVENTS_PER_BATCH, allEvents.length);
  const batch = allEvents.slice(start, end);

  if (batch.length === 0) {
    const loader = document.getElementById('scrollLoader');
    if (loader) loader.style.display = 'none';
    return;
  }

  displayedEvents.push(...batch);
  loadedBatchCount++;
  renderEvents();

  if (loadedBatchCount >= MAX_BATCHES || end >= allEvents.length) {
    const loader = document.getElementById('scrollLoader');
    if (loader) loader.style.display = 'none';
  }
}

// Set up scroll listener for infinite scroll
function setupInfiniteScroll() {
  let scrollTimeout = null;

  window.addEventListener('scroll', () => {
    if (scrollTimeout) return;

    scrollTimeout = setTimeout(() => {
      scrollTimeout = null;

      const scrollPos = window.innerHeight + window.scrollY;
      const docHeight = document.documentElement.scrollHeight;

      if (scrollPos >= docHeight - 300) {
        loadMoreEvents();
      }
    }, 150);
  });
}

// ── Initialization ──────────────────────────────────────────
function init() {
  allEvents = generateEvents();
  loadMoreEvents(); // Load first batch
  setupInfiniteScroll();

  console.log(`[Mock Ring UI] Generated ${allEvents.length} events across ${CAMERAS.length} cameras`);
  console.log(`[Mock Ring UI] Loaded first batch of ${displayedEvents.length} events`);
  console.log('[Mock Ring UI] Puppeteer-compatible selectors active:');
  console.log('  - button[data-testid="manage-events__select-multiple"]');
  console.log('  - button[data-testid="manage-events__download"]');
  console.log('  - [role="checkbox"]');
}

document.addEventListener('DOMContentLoaded', init);
