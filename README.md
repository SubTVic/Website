# Foosball Commentator

A browser app that films a foosball (table football) match, tracks the ball and commentates live like a TV sports broadcast or a football video game.

The prototype runs on a phone on a tripod. Later the same app can run on a Raspberry Pi with a fixed webcam above the table.

## How it works

```
Camera ──► Image processing ──► Game logic ──► Commentary director ──► Voices + crowd
           (ball & stickers      (goal, shot,    (script database +      (subtitles,
            by colour, 60×/s)     save, control,  Claude Haiku)           scoreboard)
                                  km/h, story)
```

The language model never looks at the video, because the ball is far too fast for that. Image processing detects events in real time. The commentary is then built from a large script database.

### Hybrid commentary: script database + Haiku

1. **Script database** (`data/commentary.json`, about 650 lines): professionally styled lines for every situation (opener, equaliser, comeback, streak, match point, winner, big save, quiet spell …), with slots like `{team}`, `{score_line}` or `{speed}`.
2. **Instant calls** ("Gooooal!", "Saved!", "Danger here!") come straight from the database with zero delay. With ElevenLabs they are pre-generated as audio before kickoff.
3. **Claude Haiku as director**: for each moment the code picks the fitting candidates from the database, filled in with names and numbers. Haiku chooses the best ones, stitches them together and adjusts a few words so they flow, but does not invent facts. Without an API key, the code picks a line itself.
4. **Two commentators**: play-by-play and an analyst who fills the quiet spells.
5. **Stadium atmosphere**: a synthesized crowd rises on shots, goes "oooh" at saves and roars at goals. There are kickoff and full-time whistles too.
6. **Priorities**: a goal interrupts everything. Lines that would come too late are dropped.

Extending the commentary is as easy as adding lines to `data/commentary.json`. `node tests/check_commentary.mjs` checks that every slot is valid.

### Voices

| Option | Quality | Reaction time | Cost |
|---|---|---|---|
| Browser voice | rather flat | instant | free |
| ElevenLabs `eleven_v4_turbo` (default) | natural and emotional (understands `[excited]`) | very fast | subscription / characters |
| ElevenLabs `eleven_flash_v2_5` | natural, less emotional | very fast | subscription / characters |
| ElevenLabs `eleven_v4` | most expressive | slower | subscription / characters |

Generated audio is cached in the browser. Each match generates a few new instant calls, so variety grows from match to match while the cost per match stays small.

### Files

| File | Purpose |
|---|---|
| `data/commentary.json` | The script database |
| `js/script.js` | Loads the database, fills slots, picks lines without repeats |
| `js/narrative.js` | Story memory: equaliser, comeback, streaks, match point |
| `js/commentator.js` | Director: instant calls, Haiku stitching, speech queue |
| `js/tts.js` | Voices: browser or ElevenLabs |
| `js/audio.js` | Crowd, whistles, audio playback |
| `js/homography.js` | Converts camera image ↔ field (perspective from the 4 corners) |
| `js/vision.js` | Finds ball and team stickers by colour |
| `js/game.js` | Detects goals, shots, saves, ball control; keeps score and stats |
| `js/main.js` | UI, calibration, main loop |

## Getting started

The camera only works when the page is served over **https** (or `localhost`).

**Option A: GitHub Pages (for the phone)**
1. In the GitHub repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `master`, folder `/ (root)`, save.
2. After about a minute the app is live at `https://subtvic.github.io/Website/`.

**Option B: locally**
```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Using it

1. **Start camera.** Phone on a tripod, ideally from above, with the whole field in view. Or load a video file.
2. **Mark the field.** The teams are fixed: **Team Sandra** (left, red) and **Team Thomas** (right, blue). Tap the 4 corners clockwise, starting at a corner next to Team Sandra's goal and going along the side wall first. The goals are then shown in team colours. If they're the wrong way round: **Swap sides**.
3. **Tap the ball** while it lies still. The yellow circle should then follow it.
4. Optional: **team stickers.** Put coloured stickers on the figures and tap their colour.
5. **Kick off!**

Under ⚙ enter your **Claude API key** (from [console.anthropic.com](https://console.anthropic.com)). Haiku is preselected because it answers fastest. Without a key the app uses script lines only. For better voices choose **ElevenLabs**, enter the ElevenLabs key and one voice ID each for play-by-play and analyst (from the ElevenLabs Voice Library). All keys stay on your device.

Goals are detected automatically when the ball disappears at the goal line. If detection gets it wrong, fix it with **Goal Team Sandra / Goal Team Thomas / −1**.

## Tips for good detection

- **Coloured ball** (orange/yellow) instead of white. White balls are easily confused with lines and reflections.
- **Even lighting** without hard shadows or reflections.
- **High frame rate:** at 30 frames per second a hard shot travels almost half the table per frame. 60 fps is much better.
- **Show mask** displays which pixels count as ball (magenta). Fine-tune with the tolerance slider at the top right.

## Testing without a table

```bash
python3 tests/make_test_video.py test.y4m      # synthetic match with goal, shot and save
chromium --use-fake-device-for-media-stream --use-file-for-fake-video-capture=test.y4m
node tests/check_commentary.mjs                # validates the script database
```

## Next steps

- **ArUco markers** in the table corners so the app calibrates itself (important for the fixed installation)
- **AI detection (YOLO)** for ball and figures, independent of colours
- **Raspberry Pi 5** with a fixed USB webcam (60+ fps) above the table, output to a screen
- **Tournament mode**: player profiles, schedule, table, stats across matches
- **Player names** in the commentary (needs a stitching approach for names, like football games use)
