import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.MOCK_PORT || 8089;

// Serve static files from public/
app.use('/account/activity-history', express.static(path.join(__dirname, 'public')));

// Main route — Ring Activity History page
app.get('/account/activity-history', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Redirect bare root to activity-history so Puppeteer navigation works
app.get('/', (req, res) => {
  res.redirect('/account/activity-history');
});

// Download endpoint — generates a minimal valid .mp4 file with proper Ring filename format
// Ring downloads are typically named: "<CameraName> - <ISO Timestamp>.mp4"
// or delivered as a .zip archive containing those .mp4 files.
app.get('/api/mock-download', (req, res) => {
  const cameraName = req.query.camera || 'Front Door';
  const timestamp = req.query.timestamp || new Date().toISOString();
  console.log(`Mock download requested for: ${cameraName} at ${timestamp}`);

  // Sanitize the timestamp for filename use
  const safeTimestamp = timestamp.replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${cameraName} - ${safeTimestamp}.mp4`;

  // Create a minimal valid MP4 file (ftyp box + minimal moov box)
  // This is the smallest valid MP4 structure that players/tools will recognize
  const ftyp = Buffer.from([
    0x00, 0x00, 0x00, 0x18, // box size: 24 bytes
    0x66, 0x74, 0x79, 0x70, // 'ftyp'
    0x69, 0x73, 0x6F, 0x6D, // major brand: 'isom'
    0x00, 0x00, 0x02, 0x00, // minor version
    0x69, 0x73, 0x6F, 0x6D, // compatible brand: 'isom'
    0x61, 0x76, 0x63, 0x31, // compatible brand: 'avc1'
  ]);

  const moov = Buffer.from([
    0x00, 0x00, 0x00, 0x08, // box size: 8 bytes (empty moov)
    0x6D, 0x6F, 0x6F, 0x76, // 'moov'
  ]);

  const mdat = Buffer.from([
    0x00, 0x00, 0x00, 0x08, // box size: 8 bytes (empty mdat)
    0x6D, 0x64, 0x61, 0x74, // 'mdat'
  ]);

  const mp4Buffer = Buffer.concat([ftyp, moov, mdat]);

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', mp4Buffer.length);
  res.send(mp4Buffer);
});

// Batch download endpoint — generates a simple zip containing multiple .mp4 files
// For simplicity, just returns a single .mp4 for the first selected event
app.get('/api/mock-batch-download', (req, res) => {
  const events = req.query.events ? JSON.parse(req.query.events) : [];

  if (events.length === 0) {
    return res.status(400).json({ error: 'No events selected' });
  }

  // For the mock, just return the first event as a single mp4
  const first = events[0];
  const safeTimestamp = (first.timestamp || new Date().toISOString()).replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${first.camera || 'Camera'} - ${safeTimestamp}.mp4`;

  const ftyp = Buffer.from([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6F, 0x6D,
    0x00, 0x00, 0x02, 0x00,
    0x69, 0x73, 0x6F, 0x6D,
    0x61, 0x76, 0x63, 0x31,
  ]);

  const moov = Buffer.from([
    0x00, 0x00, 0x00, 0x08,
    0x6D, 0x6F, 0x6F, 0x76,
  ]);

  const mdat = Buffer.from([
    0x00, 0x00, 0x00, 0x08,
    0x6D, 0x64, 0x61, 0x74,
  ]);

  const mp4Buffer = Buffer.concat([ftyp, moov, mdat]);

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', mp4Buffer.length);
  res.send(mp4Buffer);
});

app.listen(PORT, () => {
  console.log(`\n🔵 Mock Ring Activity History running at:`);
  console.log(`   http://localhost:${PORT}/account/activity-history\n`);
  console.log(`   Point Puppeteer to this URL for testing.\n`);
});
