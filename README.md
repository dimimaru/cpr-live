# CPR Live V0.5 — Realtime CPR TV + Mobile Remote (SIMULATION ONLY)

Mobile Controller and TV Display synchronize live through **GitHub Pages + Supabase Realtime Broadcast**.
No dedicated PC/Mac server, login, CPR database, or patient records.

**⚠️ DEMONSTRATION ONLY — NOT FOR REAL PATIENT CARE OR RELIABLE TIMED MEDICAL ALERTS.**
Public Realtime channels have no user authentication, durable event log, authoritative clock, audio delivery guarantee or clinical validation.

## Links

- **Controller**: https://dimimaru.github.io/cpr-live/?room=ER-DEMO-01
- **TV**: https://dimimaru.github.io/cpr-live/?view=tv&room=ER-DEMO-01

Both must show CONNECTED in the same Room. Hard refresh both pages after updating GitHub Pages.

## V0.5 changes

- **TV mode:** uses all available page viewport without controls or a "TEST SOUND" button.
  Browser chrome/OS fullscreen **cannot reliably be forced without a user gesture**;
  for true kiosk fullscreen, configure the TV/browser externally.
- **TV audio:** automatically attempts Web Audio + Thai Speech Synthesis.
  Browser autoplay policy may block sound until there is a local user gesture.
  If the TV browser requires a tap/click to unlock sound, code cannot guarantee fully
  unattended speech/metronome. Small TV AUDIO BLOCKED warning can appear.
- **Controller layout:** compact timers/status + large remote buttons.
- **Metronome:** Controller has ON/OFF for 105 BPM; state synchronized to all devices;
  TV only plays the beats if its browser allows audio.
- **Rhythms:** separate VF, pulseless VT, PEA and Asystole.
- **PEA:** Narrow or Wide QRS selection; suggests POCUS for reversible causes,
  **without interrupting CPR**.
- **Asystole:** suggests flatline checks (electrodes/cables/gain, ≥2 leads, consider fine VF);
  do not shock confirmed Asystole.
- **Start CPR:** countdown starts immediately from 02:00 even with no Rhythm selected;
  all screens ask to document rhythm. Total Case Time continues while ROSC.
- **ET-TUBE:** only after recording ET-TUBE does the CO₂ input appear.
  Starts a **silent** breathing reminder every 6 seconds: 6→5→4→3→2→1;
  the last second displays a **green bag-valve mask** and "SQUEEZE BAG — 1 SECOND".
  No breathing cue voice or beep. During pause/ROSC, the CPR ventilation coach stops.
- **CO₂ / EtCO₂:** large centered number with small mmHg unit.
  If entered CO₂ is **less than 10 mmHg**, highlight "CHECK HIGH-QUALITY CPR"
  and speak "CO₂" (not "ETCO₂"). Low ETCO₂ is a quality cue, not a standalone diagnosis;
  consider ventilation, airway, medications, and cause of arrest.
- **Pause/Resume:** one small toggle button with confirmation for both actions.
- **Reset:** a small button requiring confirmation before clearing current room state.
- **Shock/Epinephrine/Amiodarone:** prior V0.4 cues retained, all button actions and warnings
  receive spoken feedback when TV speech is supported.
- **CPR timer:** 2-minute **countdown** with red 10-second warning,
  while epinephrine timer **counts UP** and reminds at 4 minutes.
- **ROSC/Re-arrest:** CPR cycle and compression metronome stop on ROSC;
  re-arrest restarts CPR cycle, not the total case timer.

## Medical-context cautions

Use only as a simulation to discuss proposed UI. AHA 2025 Adult ALS says
experienced professionals may use POCUS to search for reversible causes only
**without interrupting resuscitative efforts**. AHA 2025 notes ETCO₂ during CPR
may be used to monitor quality, with <10 mmHg associated with poorer outcomes,
but it is not a definitive threshold and many factors influence values.
Adult ventilation with an advanced airway is commonly coached at 1 breath
every 6 seconds (10 breaths/min); avoid hyperventilation and use appropriate
airway confirmation.

Reference:
- https://cpr.heart.org/en/resuscitation-science/cpr-and-ecc-guidelines/adult-advanced-life-support
- https://cpr.heart.org/en/resuscitation-science/cpr-and-ecc-guidelines/adult-basic-life-support
- https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay
- https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen

## V0.5 test checklist

- [ ] Controller remote buttons appear above a compact summary (without a large display panel).
- [ ] TV fills page viewport; no audio-test or metronome button shown on TV.
- [ ] Controller METRONOME OFF -> TV click track stops; ON -> resumes if TV audio is permitted.
- [ ] START CPR -> 02:00 countdown begins, warns to record Rhythm without blocking timer.
- [ ] VF and pulseless VT are shockable; PEA and Asystole are nonshockable.
- [ ] PEA -> choose Narrow/Wide, see POCUS cue, TV shows QRS subtype.
- [ ] Asystole -> see flatline protocol.
- [ ] Press ET-TUBE -> Controller swaps ET-TUBE for CO₂ entry; TV ventilation 6→1 starts.
- [ ] In last second (1) -> green bag-valve mask with "SQUEEZE", with NO breath sound.
- [ ] CO₂ 8 -> red low-CO₂ warning + TV voice with CPR-quality warning.
- [ ] CO₂ 10 -> low-CO₂ warning disappears.
- [ ] PAUSE requires confirm; button becomes RESUME; RESUME requires confirm.
- [ ] RESET requires confirm.
- [ ] ROSC -> metronome and ventilation CPR coach stop; case total keeps counting.
- [ ] Re-arrest -> new CPR/ventilation cycle; prior timeline and total remain.
- [ ] Disconnect/reconnect -> current state is requested from an already-connected device (not stored in a database).

## Security and reliability

Public channel information and room code can be used by anyone who knows them.
Never transmit patient-identifiable data. If all devices disconnect simultaneously,
state can be lost. TV browser sleep, network loss, autoplay policy and delayed JS
timers make this unsuitable as a resuscitation timer/coach during clinical care.


## V0.6 — TV Landscape Update

- TV now fills the entire **web page viewport** and uses a compact header (CPR status/Connected).
- Shock and Epinephrine counts are deliberately small to give **LAST RHYTHM** more room.
- Reflowed TV metrics into a 6-column grid: Shock 1 / Epinephrine 1 / Last Rhythm 4; Epinephrine Timer 3 / CO₂ 3.
- Reduced font sizes with min-width:0, overflow protection and landscape/low-height CSS to prevent numbers and labels overlapping on common 720p/1080p TV browsers.
- Metronome ON/OFF from Controller still synchronizes silently; no spoken announcement or extra Timeline record.
- On TV page load, code attempts Fullscreen; if browser blocks it, a **tap/click on the TV page** can trigger browser Fullscreen API (when supported).
- For an extended Windows monitor/TV, **F11 on Chrome/Edge** or browser kiosk mode is still needed if browser blocks scripted fullscreen. Browser URL/address bars cannot be forcibly hidden by the site without an allowed user gesture.

**After deployment:** hard Refresh both Controller and TV. Compare on 16:9 screen; verify no cropping at lower resolutions (1366×768 and 1920×1080), including while ET-tube ventilation and high-quality CPR warnings are active.
