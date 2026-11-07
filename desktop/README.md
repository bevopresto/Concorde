# Concorde for Windows: getting the installer built

You do this once. After that, every new version is two clicks.

## One-time setup

1. **Make a free GitHub account** at github.com (skip if you have one).
2. **Install GitHub Desktop** (desktop.github.com) and sign in with that account.
3. **Unzip the Concorde zip** somewhere you will keep it, e.g. `Documents\Concorde`.
   The folder should contain `index.html`, `js`, `css`, `desktop`, and a hidden `.github` folder.
4. In GitHub Desktop: **File → Add local repository…** and pick that folder.
   It will say "this isn't a Git repository". Click **create a repository**, then **Create repository**.
5. Click **Commit to main** (bottom left), then **Publish repository**.
   - Name: `concorde`
   - **Untick "Keep this code private".** It needs to be public so the app can find its own updates for free.
     Nothing secret is in the project (the Supabase key in it is designed to be public).
6. On github.com open your new `concorde` page → **Settings → Actions → General** → at the bottom
   **Workflow permissions** → choose **Read and write permissions** → **Save**.
7. Open the **Actions** tab. The first build has started by itself ("Build Windows app").
   If it hasn't, click it → **Run workflow**. It takes about 5 to 8 minutes. A green tick means it worked.
8. On the repo's main page, on the right under **Releases**, click the newest one and download
   `Concorde-Setup-….exe`. That's the installer.

## Giving it to the boys

Send them this link (swap in your own GitHub name):

`https://github.com/YOUR-NAME/concorde/releases/latest`

Also paste that same link into the Supabase secret called **APP_URL**, and invite emails will include it.

Windows will show a blue **"Windows protected your PC"** box the first time, because the installer isn't
paid-for-and-signed. Click **More info → Run anyway**. It only happens on install.

## Updating later

1. Replace the changed files in your Concorde folder with the new ones I send (the version number lives in `js/version.js`).
2. In GitHub Desktop write a short note and click **Commit to main**, then **Push origin**.
3. GitHub builds the new installer by itself. Anyone with Concorde installed gets the update quietly in
   the background; the plane next to the app name turns green, and **Update now** restarts it.

## What the installed app does that the browser can't

- Real window with minimise, maximise and close. Close tucks Concorde into the system tray; Quit is in the tray menu.
- Tray icon with status, mute, **Start with Windows**, and a dot for unread or @mentions. Taskbar shows the same dot.
- Windows alerts for messages and incoming calls when Concorde isn't the window in front.
- Real screen and window picker for screen share, with the sound of the shared window.
- Real device names in Voice & Video.
- Updates itself.

## For trying it on your own PC without GitHub (optional)

Needs Node.js. In the `desktop` folder run `npm install`, then `npm start`.
