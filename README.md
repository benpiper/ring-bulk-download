# Ring Camera Bulk Video Downloader 📹🚀

A premium, fully portable, and standalone web application that allows you to automatically download all video recordings from your Ring cameras without any limits. 

Designed for **both non-developers and power users**, it operates on a secure browser-automation framework (Puppeteer) that controls the official Ring dashboard directly. This ensures 100% compliance with Ring's secure environment and requires **zero credentials to be shared with our backend**.

---

## ✨ Features

- **Portability & Standalone**: Runs completely locally on your machine. No cloud database or external APIs required.
- **Secure Authentication**: Launches a secure Chrome browser window on your desktop for you to log in directly on Ring's official website. Your password is never captured or stored.
- **Persistent Session (Zero-Interaction)**: Once you log in initially, the session profile is saved securely. Future runs are completely automated with zero clicks required!
- **Dynamic Scroller**: Automatically scrolls your event list backwards in time until it spans your complete chosen date range.
- **Batch Video Interception**: Selects and downloads events in batches of 150 (Ring's maximum bulk limit) and saves them directly to your local workspace downloads directory.
- **Auto-Organization**: Automatically parses downloaded files and relocates them into camera-specific folders (e.g. `downloads/Front_Door/`).
- **Premium Web Dashboard**: A stunning, glassmorphic dark-mode console featuring real-time download logs, active task progress, and a built-in media library to browse and play your video clips instantly!

---

## 🛠️ Step-by-Step Guide for Non-Developers

### Step 1: Install Node.js
To run this application, you need to have Node.js installed on your computer.
1. Go to [https://nodejs.org/](https://nodejs.org/).
2. Download the **LTS (Long Term Support)** version recommended for most users.
3. Open the downloaded file and follow the standard installation prompts (click Next, Next, Finish).

### Step 2: Run the Downloader App
1. **Windows Users**: 
   - Double-click the `start.bat` file in the project folder.
2. **Mac/Linux Users**:
   - Double-click the `start.sh` file, OR open your terminal and run:
     ```bash
     cd /path/to/ring-bulk-download
     ./start.sh
     ```

*(The first time you run this, it will automatically download the required components and the secure browser bundle. Please be patient!)*

### Step 3: Access the Dashboard
The script will automatically open your default web browser to the dashboard. If it doesn't, open your browser and go to:
```
http://localhost:3000
```

---

## 🖥️ How to Use the Downloader

### 1. Launch Session & Secure Login
- On the landing page, click the glowing **Launch Secure Browser** button.
- A secure Chrome browser window will pop up.
- Log in to your Ring account inside that window (and enter your 2-Factor code if Ring prompts you).
- Once you reach your **Activity History** page in that Chrome window, you can minimize it! The Web Dashboard will instantly unlock.

### 2. Configure & Start Downloading
- **Select Cameras**: Choose which cameras you want to download videos from.
- **Choose Time Range**: Pick a preset (Today, Last 7 Days, Last 30 Days) or select a Custom date range.
- **Choose Event Types**: Filter by Motion Alerts, Doorbell Rings, or Live Views (On Demand).
- **Download**: Click **Start Bulk Download**!
- Watch the live **Download Console** fill up with progress bars and scrollable logs as files are securely saved to your machine.

### 3. Browse and Play Local Clips
- Click on the **Video Library** tab at the top.
- You can filter all your downloaded clips by camera or event type.
- Click any video card to open a built-in player modal and watch the recording instantly!

---

## 📂 Where are videos saved?

All videos are securely saved inside the project folder under:
`ring-bulk-download/downloads/<Camera_Name>/`

Filenames are automatically formatted chronologically for easy sorting:
`YYYY-MM-DD-HH-mm-ss_eventkind_uniqueId.mp4`

---

## 🔒 Security & Privacy

Your privacy is our absolute priority:
- **No Saved Passwords**: You never type your password or email into our console. Login occurs exclusively within the official Google Chrome frame directly communicating with `ring.com`.
- **100% Local**: No video, session cookie, or credential ever leaves your physical machine.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
