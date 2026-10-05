# YouTube Subscriptions Transfer

A lightweight browser extension for Google Chrome and Microsoft Edge to export your YouTube subscriptions to CSV and transfer or batch-subscribe to them from another account.

## Overview

YouTube does not provide an option to export or share subscribed channels between accounts. This extension provides a simple two-step workflow:

1. **Export:** Scrapes your subscriptions from `youtube.com/feed/channels` and downloads a structured CSV file containing channel names, URLs, handles, and channel IDs.
2. **Import & Subscribe:** Allows another account to upload that CSV file, automatically identifies existing mutual subscriptions, and allows one-click or batch subscription to the remaining channels without opening separate tabs.

## Features

- **Full Export to CSV:** Automatically scrolls through your subscriptions page and exports all channels to a UTF-8 CSV file with BOM support (compatible with Excel and Google Sheets).
- **Active Account Detection:** Identifies the active account in your open YouTube tab to ensure accurate matching.
- **Mutual Subscription Filtering:** Compares the uploaded file against your current subscriptions in real time, separating channels you already follow from new ones.
- **Sequential Batch Subscription:** Subscribes to all remaining channels automatically in the background with a delay between requests to maintain session stability.
- **Individual Subscription Control:** Review channels in a clean list and subscribe or skip individually.
- **Diagnostics & Activity Log:** Built-in live log showing session indices, HTTP response codes, and subscription status, with a one-click copy button for troubleshooting.
- **Privacy-Focused:** Runs 100% locally in your browser. No third-party servers, tracking, or data collection.

## Installation

1. Clone or download this repository:
   ```bash
   git clone https://github.com/<username>/youtube-subscriptions-transfer.git
   ```
2. Open your browser's extensions management page:
   - **Chrome:** `chrome://extensions`
   - **Edge:** `edge://extensions`
3. Enable **Developer mode** using the toggle in the upper corner.
4. Click **Load unpacked** and select the project folder.

## Usage

### Step 1: Export Subscriptions

1. Open YouTube and navigate to: `https://www.youtube.com/feed/channels`
2. Click the extension icon and select the **Export** tab.
3. Click **Start Export**. The extension will scroll to load all channels and trigger a CSV download once finished.

### Step 2: Import & Subscribe

1. In your browser, ensure you are logged into the target YouTube account.
2. Click the extension icon and select the **Import** tab.
3. Drag and drop the exported CSV file into the designated area.
4. The extension will check your current subscriptions and display:
   - Total channels in the file
   - Already subscribed channels
   - Remaining channels to subscribe
5. Click **Auto-Subscribe Remaining** to subscribe to all new channels in sequence, or use the **Subscribe** button next to specific channels.

## Technical Notes

- **Manifest Version:** V3
- **Authentication:** Uses the browser session's existing credentials (`SAPISIDHASH` and active `SESSION_INDEX`) to authenticate directly against YouTube's internal API endpoints.
- **Permissions:**
  - `storage`: Saves local application state and log entries.
  - `activeTab` / `host_permissions`: Accesses YouTube tabs to read subscriptions and dispatch subscription requests.
  - `scripting`: Executes session queries in the page context.

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.
