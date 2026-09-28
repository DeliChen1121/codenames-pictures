# Codenames: Pictures · Live

Official site: [Codenames: Pictures](https://www.czechgames.com/games/codenames-pictures). Reference GitHub project: [samdemaeyer/codenames-pictures](https://github.com/samdemaeyer/codenames-pictures).

## Download and play

**[Download the offline game (ZIP)](https://github.com/DeliChen1121/codenames-pictures/releases/latest/download/codenames-pictures-offline.zip)**

[Release notes and all versions](https://github.com/DeliChen1121/codenames-pictures/releases)

1. Download the ZIP above and extract it completely.
2. Double-click **`LAUNCH_GAME.html`** to open the game in your browser.
3. Keep **`game_assets/`** beside the launcher. No installation or internet connection is needed to play.

```text
LAUNCH_GAME.html       <- Open this file
game_assets/          <- Keep this folder alongside the launcher
```

The instructions and copyright notice are inside `game_assets/`. GitHub's **Code > Download ZIP**
downloads development source, not the ready-to-play package. While the repository is private,
the release download requires a signed-in GitHub account with repository access.

> **Copyright status:** This is an unofficial fan-made adaptation. Redistribution permission
> for the bundled third-party artwork has not been verified. Attribution is not permission;
> these notices do not make the repository or ZIP cleared for public distribution.
> See [copyright, credits, and license status](COPYRIGHT.txt).

A 2-to-4-team Codenames Pictures game for in-person event hosts. The start page chooses team count and Quick, Classic, or Slow pace. The player board and captain key use the same parameters, so pictures, colors, first team, and rules stay identical.

## MVP features

- 2, 3, or 4 teams; the matching red, yellow, blue, and green teams turn on automatically
- Nine presets across Quick, Classic, and Slow, with 4 × 4, 5 × 5, and 6 × 6 picture boards
- Expand Advanced to customize a 3 × 3 to 8 × 8 grid, per-team targets, white cards, and black cards
- Choose teams and pace on the start page, click Start game to pick turn order, then click Start to show pictures
- All modes default to red, yellow, blue, then green; pick any full team order on the pre-game order page or in game settings
- Before the game starts, drag team cards with a mouse or touchscreen, or use the move buttons and arrow keys
- Separate captain key page: pictures stay visible, with a high-contrast double color border for answers
- Deterministic game codes: the code, full rules, picture batch, and layout version lock the current board
- A game code is generated at start. In the seed dialog you can enter 1–10 letters or digits; the same seed and rules always produce the same pictures and layout
- Click Seed at the top of the board to copy a full seed starting with `CNP1:`. Paste it on another computer to restore rules, team order, picture batch, and layout version. Copy again after New pictures or New layout
- The seed dialog can take another seed; press Enter or Switch board to start in place. A short game code keeps current rules; a full seed brings its own rules. A captain key window opened from this host page updates automatically; other devices still need a new link
- Switching boards in the seed dialog starts a fresh game and does not restore previous reveals; a browser refresh still restores saved progress as before
- The player page can refresh all surface pictures without changing hidden colors or reveal progress
- You can refresh only the hidden color layout while keeping pictures; a new layout resets this game’s progress
- One click copies a captain key link that matches the current pictures and colors exactly
- Near-square picture grid; after a reveal the image stays, marked with a high-contrast border and a light overlay
- A fixed-width host console on the right shows the current turn, remaining pictures, elimination, and placement; team cards follow this game’s turn order
- Click to reveal: your color continues; another team’s color helps them and ends your turn; white ends the turn; black only eliminates the guessing team
- Two-team games resolve as soon as one team finishes first or the opponent hits black
- Three- and four-team games skip finished or eliminated teams and use standard competition ranking by finishing round (for example 1st, 1st, 3rd, 3rd)
- In three- and four-team games, a team that hits black is always last; several black hits share last place
- When the game ends, all color answers are shown and a ranking overlay with a celebration animation appears
- All captains get 2 minutes of prep; each team turn starts with 30 seconds of captain thinking, then guessing
- If a captain ends thinking early, leftover seconds are added to the guessing time
- Every timer phase can be skipped: prep goes to the first team, thinking goes to guessing, guessing goes to the next team
- The gear Game settings panel adjusts opening prep, captain thinking, guessing time, and font size. Fonts are Small, Standard, Large, and Huge; Large (15px) is the default and is saved on this device
- The desktop start page uses a compact two-column layout so typical screens show the full setup and start button without scrolling
- Reveal progress is saved in the current browser

## Run locally

```bash
npm run build
npm run dev
```

Then open `http://localhost:4173/`. The player board is `/play.html?game=GAMECODE`. The copy button builds the matching `/master.html` captain key link.

## Build an offline zip

```bash
npm run build:offline
```

The file is written to `offline-dist/codenames-pictures-offline.zip`. Extract it completely and double-click `LAUNCH_GAME.html`. No install, server, or network is required to play.

The ZIP root contains only `LAUNCH_GAME.html` and `game_assets/`. All 280 pictures, program files, `README.txt`, and `COPYRIGHT.txt` live in that folder. Do not move the launcher separately or rename or delete the resource folder. Captains can click Open captain key and place that window on another screen. A link to a local file on your computer cannot automatically open on someone else's device; they need their own extracted copy and the same full seed.

Validate the built package before attaching it to a release:

```bash
npm test
npm run build:offline
npm run verify:offline
```

## Image sources

The original 280 `card-N.jpg` files are stored in `public/images/cards/`. The app loads local images only. If an image is missing, extract the complete package again.

Original project: <https://github.com/samdemaeyer/codenames-pictures>

## Copyright and license status

This is an independent fan-made adaptation, not affiliated with or endorsed by Czech Games Edition or the upstream maintainer. The original game is designed by Vlaada Chvatil and published by Czech Games Edition. The extra team modes and custom presets are house rules, not official rules.

No explicit license was found in the upstream repository during the September 27, 2026 review, and no separate redistribution permission for the artwork has been verified. No open-source license has been selected for this project's original contributions. A future code license must not be presented as licensing the third-party artwork or material that the maintainer has no right to relicense.

Attribution, private access, and non-commercial use do not by themselves grant permission. Before making this repository public, obtain the necessary permissions or replace/remove the affected material, including copies in Git history and release attachments. [GitHub explains the effect of having no license](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository).

Full attribution, rights-holder contact information, and the public-release requirements are in [COPYRIGHT.txt](COPYRIGHT.txt). This notice is included in every built offline ZIP.

## Project structure

- `index.html`: intro and start page
- `master.html`: captain key with pictures and color borders
- `play.html`: host / player board
- `game-core.js`: game codes, random layouts, and team rules
- `app.js`: UI, reveals, turns, and timers
- `styles.css`: live-screen and mobile styles
- `tests/`: core rules tests

## Later ideas

The MVP does not need a server. If you later want several devices to live-sync the host’s reveals, timers, and turn state, add a room service or realtime database without changing the game-code algorithm.
