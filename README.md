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


## V0.7 — TV-only CPR alarm and controller PDF timeline

- **Alarm limited to TV Display:** when a running CPR cycle has 10 seconds remaining,
  a flashing red screen-edge border appears on the TV. A central warning message
  appears **only during the final 5 seconds**. The existing TV voice alert still
  announces at the start of the 10-second warning and the 2-minute boundary.
- **Controller has no alarm:** no full-screen red border, warning overlay, or
  countdown alert speech on the mobile remote; the regular timer display continues.
- **TV Live Timeline removed:** TV layout displays only CPR status, clocks,
  shock/medication counts, Last Rhythm, CO₂, ventilation coach and clinical cue.
- **Controller Timeline remains:** tap **REPORT PDF** to download an A4 timeline report.
- **Patient label sticker box:** the PDF includes a blank **77 × 36 mm** rectangle
  titled "PATIENT LABEL / ติดสติกเกอร์ผู้ป่วยที่นี่" for attaching a physical
  printed hospital label **after the PDF is printed**. There is **no patient name or HN
  text field in the web app**, and no patient sticker information is sent to Supabase.
- Report includes case start, elapsed time, documented events with clock times and
  time from case start, rhythm, shock, epinephrine, amiodarone and last CO₂.
- PDF is created locally in the Controller browser using a pinned html2pdf.js
  library. The external CDN delivers JavaScript only; the report content is
  rendered and saved in-browser. If PDF download is unavailable (e.g., blocked CDN),
  the app offers the browser's **Print / Save as PDF** fallback.
- Timeline and PDF are **ephemeral**: closing all connected devices or resetting
  the session may permanently remove the data. Reports are **not verified
  medical documentation** and are for simulation/testing only.

### V0.7 tests

1. Mobile and TV CONNECTED in the same room.
2. Press Start CPR. At 00:10 remaining, the **TV** shows the flashing border.
3. At 00:05 remaining, a central text box appears on **TV only**.
4. Confirm **no alarm overlay or alarm speech on the mobile Controller**.
5. TV has **no Live Timeline** section.
6. Controller still shows Timeline; tap **REPORT PDF**.
7. Verify a downloadable A4 PDF, a blank patient sticker box at top right, and all
   current session events in chronological order.
8. Check multi-page PDF with a longer Timeline and try iOS Safari separately.

**Clinical and privacy reminder:** This prototype uses public channels with no
authenticated access, durable event storage or guaranteed timers/alarms.
Never use it to document identifiable patients or replace official CPR records.


## V0.8 — Epi timer, TV example ECG, compression interruption and estimated CCF

- After pressing EPINEPHRINE +1, the medication timer resets immediately to 00:00, then counts up from the latest recorded dose. The timer continues through compression interruptions.
- TV shows non-diagnostic, *schematic ECG examples* for VF, pVT, Asystole, PEA Narrow QRS and PEA Wide QRS, updated from the controller. These are illustrative drawings, NOT actual ECG signals.
- PAUSE CPR starts a manually logged hands-off interval, but DOES NOT stop the main CPR two-minute countdown, total clock, or epinephrine clock.
- Controller shows a small 10-to-0-second interruption countdown. Once interruption reaches 10 seconds, TV only warns CONTINUE CPR NOW (audio when supported). RESUME CPR logs the interruption duration.
- Metronome pauses with compressions and resumes after RESUME CPR. Confirm dialogs are kept for Pause/Resume.
- CCF estimate (%) = (total recorded active arrest time minus logged hands-off time) / active arrest time × 100.
- The denominator excludes ROSC periods; re-arrest episodes are included after they resume. The estimate is displayed in small text after ROSC, in RESET confirmation, and in Controller PDF report along with hands-off and compression times.
- Because CCF is derived solely from button presses and device clocks, it does not measure actual physical compressions and can be inaccurate if events are missed, delayed, reordered or the browser is offline.
- The system remains a publicly accessible, unauthenticated SIMULATION; not for live medical decision support or patient-identifying data.

### Quick regression checks

1. Press Epi at 1:39: both Controller and TV should show 00:00, then count up.
2. Select VF / pVT / Asystole / PEA Narrow / PEA Wide: the illustrative waveform on TV changes.
3. Pause after 1 min of CPR: the CPR and Epi clocks keep running while the interruption indicator counts down 10 to 0.
4. At 0 seconds: TV displays an interruption alert prompting CONTINUE CPR. Resume closes the hands-off interval.
5. Run 120 seconds of arrest with 9 seconds of Pause then ROSC: estimated CCF = 92.5%.
6. Controller PDF contains Active Arrest Time, Hands-off Time, Compression Time and CCF.

2025 AHA Adult BLS guidance: rhythm/pulse check should take no more than 10 seconds, and chest-compression fraction is the portion of arrest time with compressions.
https://cpr.heart.org/en/resuscitation-science/cpr-and-ecc-guidelines/adult-basic-life-support


## V0.9 — SHOCK button anti-double-tap cooldown

- After one **successfully logged SHOCK**, the Controller's SHOCK button is disabled for **1 minute 50 seconds (110 seconds)**.
- The button shows a live remaining countdown (for example `SHOCK · 01:49`) until the logging control is available again.
- An immediate in-flight guard disables the button while waiting for Supabase acknowledgment, preventing rapid double taps from sending multiple SHOCK events.
- Event reduction also rejects repeat SHOCK logs within 110 seconds of the last accepted SHOCK; this means late/out-of-order events and multiple controllers do not increment the count or Timeline for an extra shock in that interval, once their events have synchronized.
- RESET clears the cooldown. ROSC followed by re-arrest **does not** clear a current cooldown until 110 seconds have elapsed.
- This is only an **anti-duplicate event logging UI rule**. It is **not** a physical defibrillator lockout, a verified treatment rule, or a guaranteed multi-device atomic lock. A disconnected device, clock skew or concurrent events may cause temporary disagreement before synchronization; Supabase public Broadcast is not a clinically safe source of truth.

### Quick test

1. Start CPR and tap SHOCK +1 once. Confirm the count increments by exactly one and the button shows `01:50`.
2. Rapidly tap again. Confirm no additional SHOCK or Timeline event.
3. At `00:01`, still locked. At `00:00`, the SHOCK button is available again.
4. Export timeline if needed, then RESET to clear the lock for the next demo.
