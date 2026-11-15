# Setup tester: finding the best seat, camera and screen angle

Our recorded clips showed the biggest factor in tracking accuracy is how far your eyes
**visibly move** when you look across the screen ("eye range"). It grows when you sit closer
and roughly halves behind glasses. The setup tester measures it directly, together with
distance, camera height, head angle, light and eye size, and saves each setup so the team can
work out the ideal one.

## Run it

Stop the game server first (both use port 5190), then:

```bash
npm --prefix eye-controller run dev
```

Open `http://localhost:5190/setup.html` in Chrome, **without `?mock`** (`?mock` is simulated eyes for
trying the page: it always scores 100 and saves nothing). Saves land in the `setups/` folder of
whichever machine runs the dev server: on Coder, that is the Coder workspace, not your laptop.

## One setup (about 2 minutes)

1. Type your player name and describe the setup (distance, camera, screen tilt, glasses)
   **before** testing: each test saves with it.
2. Fix the red and yellow rows on the right: they say what to change and update live.
3. **Range test (6 s):** look at the dot as it goes centre, left, right, top, bottom. Move only
   your eyes. The score and advice update, and **it saves itself** to `setups/` with the
   description you typed (fill that in first; "Save again" re-saves if you change it after).
4. Optional but the most useful: **Calibrate + test run (~95 s)**. It records a full test
   run linked to this setup, so we see how the setup actually played.

## Team session (about 15 minutes each)

Do these in order, saving each and doing a test run for each:

| # | Setup | Change only this |
|---|---|---|
| 1 | Your normal | nothing: sit how you just played |
| 2 | Closer | lean in until the Distance row is green (face about a quarter of the image) |
| 3 | Camera / screen | change one thing the Camera height or Head angle rows complain about |
| 4 | Glasses (if you wear them) | repeat your best setup with glasses off |

The player who plays best right now records their setup too: it is the reference.

## Compare

```bash
npm --prefix eye-controller run setups
```

Table 1 lists every saved setup; table 2 lists every linked test run with its setup numbers
next to how well it tracked, and once there are 4+ runs, how strongly each setup number goes
with accuracy. The thresholds in `src/setup/setup-score.js` (first set from 35 clips) get
updated from these results before any of this goes into the game's face check.

## What each row means

| Row | Measured from | Good |
|---|---|---|
| Distance | face width as a share of the camera image | 24-42% |
| Camera height | where your face sits vertically in the image | 35-70% down |
| Centred | face centre left/right | within 15% |
| Head angle | head tilt and turn | within 0.15 / 0.25 rad |
| Light on face | eye brightness | 60+ of 255 |
| Eye size | eye-corner distance in camera pixels | 50+ px |
| Glare on glasses | share of blown-out pixels in the worse eye | under 1% (bad over 3%) |
| Pupil contrast | how clearly the pupil stands out (better eye) | 18+ |
| Range test | eye movement edge to edge (eye-width units) | left-right 0.15+ (0.10+ with glasses), up-down 0.022+ |
