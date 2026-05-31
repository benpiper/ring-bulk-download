import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import dotenv from 'dotenv';

puppeteer.use(StealthPlugin());
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Global state variables
let browserInstance = null;
let pageInstance = null;
let abortController = null;

const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const PROFILE_DIR = path.join(__dirname, 'ring-browser-profile');

// Ensure directories exist
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
if (!fs.existsSync(PROFILE_DIR)) fs.mkdirSync(PROFILE_DIR, { recursive: true });

const downloadState = {
  active: false,
  status: 'idle', // 'idle', 'scanning', 'downloading', 'completed', 'cancelled', 'failed'
  totalEvents: 0,
  processedEvents: 0,
  successfulEvents: 0,
  failedEvents: 0,
  currentEvent: null,
  queue: [] // { dingId, cameraName, createdAt, kind, status, error }
};

let sseClients = [];

// Helper to sanitize filename
function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9_-]/gi, '_').replace(/_+/g, '_');
}

// Broadcast download state to SSE clients
function broadcastState() {
  const data = JSON.stringify({ type: 'state', state: downloadState });
  sseClients.forEach(client => {
    client.write(`data: ${data}\n\n`);
  });
}

// Check if browser is logged in
async function checkLoginStatus() {
  if (!pageInstance) return false;
  
  try {
    const url = pageInstance.url();
    if (!url.includes('/activity-history')) return false;
    
    // Look for dashboard indicators
    const hasDashboard = await pageInstance.evaluate(() => {
      return !!(document.querySelector('button[data-testid="manage-events__select-multiple"]') || 
                document.querySelector('button[data-testid="history-header__manage-button"]') || 
                document.querySelector('[role="checkbox"]'));
    });
    
    return hasDashboard;
  } catch (err) {
    console.error('Error checking login status:', err);
    return false;
  }
}

// ==========================================
// Browser Control Endpoints
// ==========================================

app.get('/api/status', async (req, res) => {
  const browserOpen = !!browserInstance;
  const loggedIn = await checkLoginStatus();
  
  return res.json({
    browserOpen,
    authenticated: loggedIn,
    status: downloadState.status,
    active: downloadState.active
  });
});

app.post('/api/browser/launch', async (req, res) => {
  if (browserInstance) {
    return res.json({ status: 'already_running', authenticated: await checkLoginStatus() });
  }

  try {
    console.log('Launching browser with profile:', PROFILE_DIR);
    
    // Automatically run headfully if display is available, or headlessly if headless is forced
    const hasDisplay = !!process.env.DISPLAY;
    
    browserInstance = await puppeteer.launch({
      headless: !hasDisplay ? 'new' : false,
      defaultViewport: { width: 1280, height: 800 },
      userDataDir: PROFILE_DIR,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--window-size=1280,800',
        '--disable-web-security'
      ]
    });

    const pages = await browserInstance.pages();
    pageInstance = pages[0] || (await browserInstance.newPage());

    // Configure Chrome Dev Protocol session to allow direct downloading
    const client = await pageInstance.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: DOWNLOADS_DIR
    });

    console.log('Navigating to Ring Activity History...');
    await pageInstance.goto('https://account.ring.com/account/activity-history', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Check if we logged in instantly due to persistent cookies
    const loggedIn = await checkLoginStatus();

    return res.json({ 
      status: 'launched', 
      authenticated: loggedIn,
      displayUsed: hasDisplay
    });
  } catch (err) {
    console.error('Failed to launch browser:', err);
    if (browserInstance) {
      await browserInstance.close().catch(() => {});
      browserInstance = null;
      pageInstance = null;
    }
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/browser/close', async (req, res) => {
  if (!browserInstance) {
    return res.json({ success: true });
  }

  try {
    await browserInstance.close();
    browserInstance = null;
    pageInstance = null;
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// Device / Camera Discovery
// ==========================================

app.get('/api/cameras', async (req, res) => {
  if (!pageInstance) {
    return res.status(400).json({ error: 'Browser session is not active' });
  }

  try {
    const loggedIn = await checkLoginStatus();
    if (!loggedIn) {
      return res.status(401).json({ error: 'Not logged in' });
    }

    console.log('Discovering active cameras from activity history DOM...');
    
    // Extract camera names from the first few loaded events
    const cameraNames = await pageInstance.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[role=checkbox]'));
      const names = new Set();
      for (const card of cards) {
        const text = card.innerText || '';
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines[0]) {
          names.add(lines[0]);
        }
      }
      return Array.from(names);
    });

    const cameras = cameraNames.map((name, index) => ({
      id: index.toString(),
      name: name,
      model: 'Ring Camera',
      isOffline: false,
      hasBattery: false,
      batteryLevel: null
    }));

    return res.json({ cameras });
  } catch (err) {
    console.error('Failed to parse cameras:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// Bulk Video Downloader Endpoints
// ==========================================

app.get('/api/download/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  res.write(`data: ${JSON.stringify({ type: 'state', state: downloadState })}\n\n`);

  sseClients.push(res);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c !== res);
  });
});

app.post('/api/download/start', async (req, res) => {
  const { cameraNames, startDate, endDate, eventKinds } = req.body;

  if (downloadState.active) {
    return res.status(400).json({ error: 'A download task is already running.' });
  }

  if (!pageInstance) {
    return res.status(400).json({ error: 'Browser session is not active' });
  }

  const loggedIn = await checkLoginStatus();
  if (!loggedIn) {
    return res.status(401).json({ error: 'Browser is not authenticated' });
  }

  const start = startDate ? new Date(startDate) : new Date(0);
  const end = endDate ? new Date(endDate) : new Date();

  // Run automated crawler in background
  runBrowserScraperQueue(cameraNames || [], start, end, eventKinds || []);

  return res.json({ status: 'started' });
});

app.post('/api/download/cancel', (req, res) => {
  if (!downloadState.active) {
    return res.status(400).json({ error: 'No active download running.' });
  }

  if (abortController) {
    abortController.abort();
    console.log('Downloader task cancelled.');
    return res.json({ success: true });
  }

  return res.status(500).json({ error: 'Abort controller missing' });
});

// Primary scraper queue
async function runBrowserScraperQueue(cameraNames, startDate, endDate, eventKinds) {
  abortController = new AbortController();
  const { signal } = abortController;

  downloadState.active = true;
  downloadState.status = 'scanning';
  downloadState.totalEvents = 0;
  downloadState.processedEvents = 0;
  downloadState.successfulEvents = 0;
  downloadState.failedEvents = 0;
  downloadState.currentEvent = null;
  downloadState.queue = [];
  broadcastState();

  try {
    console.log('Activating Manage Mode on Ring activity feed...');
    
    // Ensure we are in Select Multiple / Manage mode
    await pageInstance.evaluate(() => {
      const selectBtn = document.querySelector('button[data-testid="manage-events__select-multiple"]') ||
                        document.querySelector('button[data-testid="history-header__manage-button"]');
      if (selectBtn) {
        const isManageActive = document.querySelector('button[data-testid="manage-events__download"]');
        if (!isManageActive) selectBtn.click();
      }
    });

    await new Promise(r => setTimeout(r, 1000));

    // Dynamic scroller loop: scroll down until the oldest loaded event is older than target startDate
    let reachedEnd = false;
    let scrollCount = 0;

    console.log('Initiating dynamic scroller to fetch events...');

    while (!reachedEnd && !signal.aborted) {
      const stats = await pageInstance.evaluate((startMs) => {
        // Simple DOM date parser inside page context
        const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        
        function parseCardDate(cardText) {
          const clean = cardText.replace(/\s+/g, ' ').trim();
          const now = new Date();
          
          let m = clean.match(/Today at (\d+):(\d+)\s*(AM|PM)/i);
          if (m) {
            const h = parseInt(m[1]), min = parseInt(m[2]), pm = m[3].toUpperCase() === 'PM';
            const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            d.setHours(pm ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h), min, 0);
            return d;
          }
          
          m = clean.match(/Yesterday at (\d+):(\d+)\s*(AM|PM)/i);
          if (m) {
            const h = parseInt(m[1]), min = parseInt(m[2]), pm = m[3].toUpperCase() === 'PM';
            const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
            d.setHours(pm ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h), min, 0);
            return d;
          }
          
          m = clean.match(/([a-zA-Z]+)\s+(\d+)(?:\s+at|,)\s+(\d+):(\d+)\s*(AM|PM)/i);
          if (m) {
            const mo = months.findIndex(x => m[1].toLowerCase().startsWith(x));
            if (mo !== -1) {
              const day = parseInt(m[2]), h = parseInt(m[3]), min = parseInt(m[4]), pm = m[5].toUpperCase() === 'PM';
              const d = new Date(now.getFullYear(), mo, day);
              d.setHours(pm ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h), min, 0);
              if (d > now) d.setFullYear(now.getFullYear() - 1);
              return d;
            }
          }
          
          return now;
        }

        const cards = Array.from(document.querySelectorAll('[role=checkbox]'));
        if (cards.length === 0) return { count: 0, oldestTime: Date.now() };
        
        const lastCardText = cards[cards.length - 1].innerText || '';
        const oldestDate = parseCardDate(lastCardText);
        
        return {
          count: cards.length,
          oldestTime: oldestDate.getTime()
        };
      }, startDate.getTime());

      if (stats.count === 0) {
        await new Promise(r => setTimeout(r, 1000));
        scrollCount++;
        if (scrollCount > 15) break; // Timeout if no elements load
        continue;
      }

      console.log(`Loaded ${stats.count} events. Oldest event date loaded: ${new Date(stats.oldestTime).toISOString()}`);

      if (stats.oldestTime < startDate.getTime() || scrollCount > 60) {
        reachedEnd = true;
        break;
      }

      // Scroll to trigger dynamic loading
      await pageInstance.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });

      await new Promise(r => setTimeout(r, 2000));
      scrollCount++;
    }

    if (signal.aborted) {
      downloadState.status = 'cancelled';
      return;
    }

    // Step 2: Extract all target event metadata from DOM
    console.log('Extracting match queue items from DOM elements...');
    const domEvents = await pageInstance.evaluate((cameraNames, eventKinds, startMs, endMs) => {
      const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      
      function parseCardDate(cardText) {
        const clean = cardText.replace(/\s+/g, ' ').trim();
        const now = new Date();
        
        let m = clean.match(/Today at (\d+):(\d+)\s*(AM|PM)/i);
        if (m) {
          const h = parseInt(m[1]), min = parseInt(m[2]), pm = m[3].toUpperCase() === 'PM';
          const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          d.setHours(pm ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h), min, 0);
          return d;
        }
        
        m = clean.match(/Yesterday at (\d+):(\d+)\s*(AM|PM)/i);
        if (m) {
          const h = parseInt(m[1]), min = parseInt(m[2]), pm = m[3].toUpperCase() === 'PM';
          const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
          d.setHours(pm ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h), min, 0);
          return d;
        }
        
        m = clean.match(/([a-zA-Z]+)\s+(\d+)(?:\s+at|,)\s+(\d+):(\d+)\s*(AM|PM)/i);
        if (m) {
          const mo = months.findIndex(x => m[1].toLowerCase().startsWith(x));
          if (mo !== -1) {
            const day = parseInt(m[2]), h = parseInt(m[3]), min = parseInt(m[4]), pm = m[5].toUpperCase() === 'PM';
            const d = new Date(now.getFullYear(), mo, day);
            d.setHours(pm ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h), min, 0);
            if (d > now) d.setFullYear(now.getFullYear() - 1);
            return d;
          }
        }
        
        return now;
      }

      const cards = Array.from(document.querySelectorAll('[role=checkbox]'));
      const list = [];

      cards.forEach((card, index) => {
        const text = card.innerText || '';
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        
        const cameraName = lines[0] || 'Unknown Camera';
        const typeText = lines[1] || 'Alert';
        const eventDate = parseCardDate(text);
        
        let kind = 'motion';
        if (typeText.includes('Ring') || typeText.includes('Ding') || typeText.includes('Doorbell')) kind = 'ding';
        if (typeText.includes('Live') || typeText.includes('Demand')) kind = 'on_demand';

        // Filtering
        const matchesCamera = cameraNames.length === 0 || cameraNames.includes(cameraName);
        const matchesType = eventKinds.length === 0 || eventKinds.includes(kind);
        const matchesDate = eventDate.getTime() >= startMs && eventDate.getTime() <= endMs;

        if (matchesCamera && matchesType && matchesDate) {
          list.push({
            domIndex: index,
            cameraName,
            kind,
            createdAt: eventDate.toISOString(),
            // Generate a random stable key to track downloads
            dingId: `dom-${index}-${eventDate.getTime()}`
          });
        }
      });

      return list;
    }, cameraNames, eventKinds, startDate.getTime(), endDate.getTime());

    // Sort chronologically (oldest first)
    domEvents.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    downloadState.totalEvents = domEvents.length;
    downloadState.status = domEvents.length > 0 ? 'downloading' : 'completed';
    downloadState.queue = domEvents.map(item => ({
      dingId: item.dingId,
      cameraName: item.cameraName,
      createdAt: item.createdAt,
      kind: item.kind,
      status: 'queued',
      error: null
    }));
    broadcastState();

    if (domEvents.length === 0) {
      return;
    }

    // Step 3: Run selection and download batches sequentially (150 max)
    const totalCount = domEvents.length;
    const batchSize = 150;

    for (let batchStart = 0; batchStart < totalCount; batchStart += batchSize) {
      if (signal.aborted) break;

      const batchEnd = Math.min(batchStart + batchSize, totalCount);
      const batchItems = domEvents.slice(batchStart, batchEnd);

      console.log(`Processing batch download: items ${batchStart} to ${batchEnd}`);

      // We need to click checkboxes corresponding to these batch items
      const indexesToClick = batchItems.map(item => item.domIndex);

      // Reset any existing selections first
      await pageInstance.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('[role=checkbox]'));
        cards.forEach(card => {
          const isChecked = card.getAttribute('aria-checked') === 'true' || 
                            card.querySelector('input[type="checkbox"]')?.checked;
          if (isChecked) card.click();
        });
      });

      await new Promise(r => setTimeout(r, 500));

      // Click checkboxes of target items in batch
      await pageInstance.evaluate((indices) => {
        const cards = Array.from(document.querySelectorAll('[role=checkbox]'));
        indices.forEach(idx => {
          if (cards[idx]) {
            const isChecked = cards[idx].getAttribute('aria-checked') === 'true' || 
                              cards[idx].querySelector('input[type="checkbox"]')?.checked;
            if (!isChecked) cards[idx].click();
          }
        });
      }, indexesToClick);

      await new Promise(r => setTimeout(r, 1000));

      // Update queue items to 'downloading' state
      batchItems.forEach((_, localIdx) => {
        const globalIdx = batchStart + localIdx;
        downloadState.queue[globalIdx].status = 'downloading';
      });
      broadcastState();

      // Read current MP4 files in downloads folder to detect new additions
      const initialFiles = new Set(fs.readdirSync(DOWNLOADS_DIR).filter(f => f.endsWith('.mp4')));

      // Click the official DOWNLOAD button
      console.log('Clicking the official Bulk Download button...');
      const downloadTriggered = await pageInstance.evaluate(() => {
        const btn = document.querySelector('button[data-testid="manage-events__download"]') ||
                    document.querySelector('.bulk-download-button');
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });

      if (!downloadTriggered) {
        throw new Error('Manage Download button not found on Ring dashboard');
      }

      // Monitor downloads directory for new files
      const expectedCount = batchItems.length;
      let downloadedCount = 0;
      let waitSeconds = 0;
      const timeoutLimit = 90; // 90 seconds limit

      console.log(`Waiting for ${expectedCount} files to complete downloading...`);

      while (downloadedCount < expectedCount && waitSeconds < timeoutLimit && !signal.aborted) {
        await new Promise(r => setTimeout(r, 1500));
        waitSeconds += 1.5;

        // Scan directory
        const files = fs.readdirSync(DOWNLOADS_DIR);
        const mp4Files = files.filter(f => f.endsWith('.mp4'));
        const newMp4s = mp4Files.filter(f => !initialFiles.has(f));

        downloadedCount = newMp4s.length;

        // Update progress dynamically
        batchItems.forEach((item, localIdx) => {
          const globalIdx = batchStart + localIdx;
          if (localIdx < downloadedCount) {
            downloadState.queue[globalIdx].status = 'success';
          }
        });
        
        // Formulate temporary active status
        if (downloadedCount < expectedCount) {
          const currentDownloadingItem = batchItems[Math.min(downloadedCount, expectedCount - 1)];
          const globalIdx = batchStart + Math.min(downloadedCount, expectedCount - 1);
          downloadState.currentEvent = downloadState.queue[globalIdx];
        }
        
        broadcastState();

        // Organize and relocate any completely finished new files immediately!
        for (const file of newMp4s) {
          const srcPath = path.join(DOWNLOADS_DIR, file);
          
          // Parse file components: Usually named like "Front Door - 2026-05-31T20_00_00.mp4"
          const parsed = file.replace('.mp4', '');
          const separatorIdx = parsed.lastIndexOf(' - ');
          
          let cameraName = 'General';
          let timeStampStr = parsed;

          if (separatorIdx !== -1) {
            cameraName = parsed.slice(0, separatorIdx);
            timeStampStr = parsed.slice(separatorIdx + 3);
          }

          const targetSubdir = path.join(DOWNLOADS_DIR, sanitizeFilename(cameraName));
          if (!fs.existsSync(targetSubdir)) {
            fs.mkdirSync(targetSubdir, { recursive: true });
          }

          // Formulate structured file format: <YYYY-MM-DD-HH-mm-ss>_<kind>_<dingId>.mp4
          const cleanTimeStr = timeStampStr.replace(/[:_T]/g, '-').slice(0, 19);
          // Try to lookup matches in batchItems to extract correct event kind
          const matchItem = batchItems.find(x => x.cameraName === cameraName);
          const kindStr = matchItem ? matchItem.kind : 'video';
          
          const structuredFilename = `${cleanTimeStr}_${kindStr}_${Math.random().toString(36).substring(7)}.mp4`;
          const destPath = path.join(targetSubdir, structuredFilename);

          // Relocate
          try {
            fs.renameSync(srcPath, destPath);
            // Add to initial files so we don't process it again
            initialFiles.add(file);
          } catch (e) {
            // If locked or in use, we'll try again next tick
          }
        }
      }

      // Mark any remaining items in batch
      batchItems.forEach((_, localIdx) => {
        const globalIdx = batchStart + localIdx;
        const qItem = downloadState.queue[globalIdx];
        if (qItem.status === 'downloading') {
          if (waitSeconds >= timeoutLimit) {
            qItem.status = 'failed';
            qItem.error = 'Download timed out';
            downloadState.failedEvents++;
          } else {
            qItem.status = 'success';
            downloadState.successfulEvents++;
          }
        } else if (qItem.status === 'success') {
          downloadState.successfulEvents++;
        }
        downloadState.processedEvents++;
      });

      broadcastState();
      
      // Pause slightly between batches
      await new Promise(r => setTimeout(r, 2000));
    }

    if (signal.aborted) {
      downloadState.status = 'cancelled';
    } else {
      downloadState.status = 'completed';
    }
  } catch (err) {
    console.error('Scraper task error:', err);
    downloadState.status = 'failed';
  } finally {
    downloadState.active = false;
    downloadState.currentEvent = null;
    broadcastState();
    
    // De-select select multiple to leave page clean
    if (pageInstance) {
      await pageInstance.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('[role=checkbox]'));
        cards.forEach(card => {
          const isChecked = card.getAttribute('aria-checked') === 'true' || 
                            card.querySelector('input[type="checkbox"]')?.checked;
          if (isChecked) card.click();
        });
      }).catch(() => {});
    }
  }
}

// ==========================================
// Local Video Library Endpoints
// ==========================================

app.get('/api/videos', async (req, res) => {
  if (!fs.existsSync(DOWNLOADS_DIR)) {
    return res.json({ videos: [] });
  }

  try {
    const list = [];
    const cameras = await fs.promises.readdir(DOWNLOADS_DIR);

    for (const cameraDir of cameras) {
      const cameraPath = path.join(DOWNLOADS_DIR, cameraDir);
      const stat = await fs.promises.stat(cameraPath);
      
      if (!stat.isDirectory()) continue;

      const files = await fs.promises.readdir(cameraPath);
      for (const filename of files) {
        if (!filename.endsWith('.mp4')) continue;

        const filePath = path.join(cameraPath, filename);
        const fileStat = await fs.promises.stat(filePath);

        // Name format: <YYYY-MM-DD-HH-mm-ss>_<kind>_<uniqueId>.mp4
        const parts = filename.replace('.mp4', '').split('_');
        const timestampRaw = parts[0] || '';
        const eventKind = parts[1] || 'unknown';
        const dingId = parts[2] || '';

        let formattedTime = timestampRaw;
        if (timestampRaw.length >= 19) {
          const t = timestampRaw.split('-');
          if (t.length >= 6) {
            formattedTime = `${t[0]}-${t[1]}-${t[2]} ${t[3]}:${t[4]}:${t[5]}`;
          }
        }

        list.push({
          filename,
          cameraDir,
          sizeBytes: fileStat.size,
          sizeFormatted: (fileStat.size / (1024 * 1024)).toFixed(2) + ' MB',
          eventKind,
          dingId,
          timestamp: formattedTime,
          createdTime: fileStat.birthtimeMs
        });
      }
    }

    list.sort((a, b) => b.createdTime - a.createdTime);

    return res.json({ videos: list });
  } catch (err) {
    console.error('Failed to index videos:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/videos/play/:camera/:filename', (req, res) => {
  const { camera, filename } = req.params;
  const filePath = path.join(DOWNLOADS_DIR, sanitizeFilename(camera), filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Video file not found' });
  }

  res.sendFile(filePath);
});

import { exec } from 'child_process';

// Start express server
app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Ring Bulk Downloader running on ${url}`);
  
  // Automatically open the user's default web browser
  const startCommand = (process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open');
  exec(`${startCommand} ${url}`, (err) => {
    if (err) {
      console.log(`Please open your browser and navigate to ${url}`);
    }
  });
});
