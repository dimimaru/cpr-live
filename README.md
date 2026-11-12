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


## V1.0 — Remote input safeguards, rhythm confirmation and TV updates

- PAUSE CPR no longer requires a confirmation dialog; RESUME and RESET still ask for confirmation. The 10-second interruption timer is unchanged.
- EPINEPHRINE button: the first documented dose remains available. Subsequent dose logs are locked for 3 minutes (180 seconds) after the most recent accepted dose, with a live countdown. This is a duplicate-log prevention feature ONLY.
- Epi reminder for VF/pVT: the demo TV now speaks at 4:50 (10-second warning) and at 5:00 after the timing anchor. In PEA/Asystole the previous 4:00 reminder remains. The 2025 AHA guideline recommends epinephrine dosing every 3–5 minutes and early use for nonshockable arrest.
- Other input buttons (Rhythm, Amiodarone, EtCO2, ET-tube, metronome, Start, Pause, Resume, ROSC) have an independent 5-second cooldown between logs of the SAME action, with a synchronous in-flight guard. PAUSE and RESUME are distinct actions so a rapid RESUME is possible to minimize interrupted compressions.
- Shock logging still has its 110-second duplicate guard. **Before EVERY new Shock log**, the controller must record a new VF or pVT rhythm event after the previously accepted Shock. PEA/Asystole and missing/stale rhythm cannot enable Shock.
- If the prior recorded rhythm is VF/pVT, the last 10 seconds of the 2-minute cycle shows and speaks a reminder to prepare the defibrillator/charge according to local protocol, while confirming shockability on the NEW rhythm check before any Shock log.
- TV: example ECG now appears INSIDE the LAST RHYTHM box (not beneath the CPR timer). The medication summary is split vertically: Epinephrine count above, and static Amiodarone 300 mg / 150 mg dose indicators below. Administered doses are highlighted; no amiodarone count is displayed.
- Controller: rhythm button now reads pVT; EPINEPHRINE uses a heart symbol, AMIODARONE uses an injection symbol, and EPINEPHRINE no longer has the +1 suffix.
- Post-ROSC checklist appears on both Controller and TV: 12-lead ECG, CXR as clinically indicated, BP/HR/RR/SpO2/temperature, GCS, and review airway, oxygenation and perfusion.

Important: These UI cooldowns DO NOT govern actual medication or defibrillation and can prevent recording a genuine intervention if it occurs inside the demo lockout window. Public Supabase Broadcast can lose or reorder events and does not provide an authoritative clock or atomic lock. The web app remains SIMULATION-ONLY, never a reliable treatment or medical record system.

Guidelines:
- https://cpr.heart.org/en/resuscitation-science/cpr-and-ecc-guidelines/adult-advanced-life-support
- https://cpr.heart.org/en/resuscitation-science/cpr-and-ecc-guidelines/post-cardiac-arrest-care

## V1.0.2 — Short feedback, medication colors and mask 30:2 coaching

- SHOCK duplicate-log cooldown is 100 seconds (01:40). The button shows only the remaining time and still requires a new shockable rhythm event before the next Shock.
- RESUME CPR has no spoken confirmation. During manual Pause, the RESUME button pulses on the Controller. Pause and Resume require no confirmation; Reset still does.
- TV spoken feedback is concise. Shock preparation and drug cues remain separate from actual intervention logging.
- Epinephrine: lock 3 minutes after the last documented dose; then enabled but neutral until 4:00, green from 4:00 to 4:39, red from 4:40 onward on Controller and TV. A new dose resets the timer and colors. Before the first documented dose, retain rhythm/shock-based emphasis; repeat-dose alerts are based on a real recorded dose only.
- TV Epi speech: nonshockable 4:00, all rhythms 4:40 and 5:00. VF/pVT does not speak the 4:00 cue.
- Before ET-tube: visual 30:2 coach with mask illustration, 30 compression beats at 105/min, followed by two one-second breath cues with a half-second release interval. Compression metronome is silent during breath phase. Manual Pause stops the coach; Resume starts a fresh 30-compression cycle.
- After ET-tube: continuous compression metronome (when enabled) and independent silent bag cue every 6 seconds as before.
- The 2-minute CPR clock continues independently. The mask coach is not a compression detector; CCF remains a manual Pause/Resume estimate and does not automatically measure or subtract actual mask ventilation interruptions.

Simulation only. A browser cannot guarantee audio timing, reliable event delivery, or a clinically safe medication/defibrillation lock. Never use these UI locks to delay real care.

## V1.0.3 — Two Home Screen apps and updated 30:2 mask timing

Two distinct launch URLs and manifests now exist, each with its own installed app
identifier, iOS apple-touch-icon and PNG icons (180, 192, 512 px).

- **CPR Remote**: https://dimimaru.github.io/cpr-live/?room=ER-DEMO-01
  Uses the dark-navy stopwatch/heart/report/algorithm icon and opens the controller.
- **CPR Monitor**: https://dimimaru.github.io/cpr-live/tv.html?room=ER-DEMO-01
  Uses the cyan ECG display/CPR monitor icon and opens directly in TV mode.
- Legacy ?view=tv links continue to display TV mode, but for installing the
  Monitor icon on iOS, open the dedicated **tv.html** URL instead.
- PNG icons are built by .github/workflows/pwa-icons.yml from SVG design assets
  and stored in assets/. They are a vector adaptation of the selected artwork.
- iPhone/iPad: open each link in Safari, Share → Add to Home Screen, enable
  Open as Web App. If an older Home Screen icon is cached, delete it and re-add.
- Before ET-tube the **30:2** coach is explicit on the TV. It has 30 compression
  beats at 105/min, then **1.5 seconds per mask breath**, with a 0.5-second
  release between the two breaths, for a 3.5-second ventilation segment.
- After ET-tube, the independent six-second ventilation coach is retained.

Still simulation only; browser audio and real-time synchronization are not
guaranteed and no patient information should be stored.


## V1.1 — Staged mobile Remote and conditional medication controls

- On first opening of a standby room, the Controller shows exactly one large **START CPR** button (the TV remains the full monitor). The configured room is shown as non-interactive text.
- START CPR **starts the case and CPR clock immediately**, then opens four large initial Rhythm buttons: VF, pVT, PEA, Asystole. The ordinary controller (timeline, controls, PEA narrow/wide selector) appears after choosing a Rhythm.
- Once a Rhythm is recorded, the old START position becomes **ROSC**. The separate ROSC button has been removed. After ROSC this same button reads **Re-CPR**; tapping starts a new arrest episode and displays the four large Rhythm choices again.
- Epinephrine control remains hidden until **Shock #2** in the shockable pathway, or immediately after the first PEA/Asystole Rhythm in a nonshockable pathway. If the episode previously passed through PEA/Asystole and later changes to VF/pVT, the Epinephrine control remains visible.
- For an episode that starts VF/pVT: **Shock #2** reveals an informational, disabled **'Prepare Amiodarone 300 mg'** button; after Shock #3 it can document 300 mg.
- For an episode that passed through PEA/Asystole before VF/pVT: **Shock #2** enables recording **Amiodarone 300 mg** by explicit project choice B. This same threshold is enforced in the event reducer; the button cannot just be bypassed by an incoming event. No amiodarone control appears while currently PEA/Asystole.
- Previously supported 150 mg administration/preparation logic, shock cooldown, medication lockout, TV monitor, broadcast sync, ventilation coach and timeline report are otherwise retained.
- `fromNonShockable` tracks rhythms only within the *current* arrest episode and resets on Re-CPR, whereas overall event timeline and dose/shock totals persist for the session.

**Clinical caveat:** The branch-specific Amiodarone 300 mg after the second shock is an explicitly requested custom simulation rule, not a blanket ACLS recommendation. Do not use this prototype to determine a patient's medication timing, and do not enter identifiable patient data. Event delivery and countdowns cannot be guaranteed on the public realtime channel.


## V1.2 — Automatic 2-minute rhythm check, TV CO2/Adrenaline states

- TV **ADRENALINE** tile reads `NO NEED` without any epinephrine count-up until the **first documented Epinephrine dose**. In particular, selecting the first PEA/Asystole rhythm does not start a drug timer; recording the dose does. After a dose, the elapsed time counts up from that dose as before.
- While the active Controller is connected and a rhythm has already been recorded, at **2 minutes** from the current cycle anchor it automatically broadcasts a **PAUSE** logging event marked as a cycle rhythm check. Its mobile screen switches to four large VF/pVT/PEA/Asystole choices.
- The selected rhythm is saved while the state remains **PAUSED**. The Controller then shows a large **RESUME CPR** button. A 3-second countdown is measured from the original pause timestamp, not from rhythm selection, and changes to **red at 0**; it does not resume automatically.
- TV displays **PAUSE CPR — IDENTIFY RHYTHM** during pauses, changes to **RHYTHM IDENTIFIED — RESUME CPR** after the cycle's rhythm choice, and turns the pause banner red after 3 seconds. Existing 10-second interruption alarm is retained. Resume logs the actual hands-off interval for CCF.
- Pressing Resume from the cycle check starts the next two-minute cycle. A cycle-triggered Resume without a recorded new rhythm is ignored, even if an event arrives directly.
- TV EtCO2 metric displays **AMBU 30:2** with a ventilation description while no ET-tube is reported. After ET-tube is recorded, the TV displays **ATTACH CO2 MONITOR** in the tile and in a prominent banner until the Controller reports a numeric EtCO2 value. After the first report, the tile reverts to the normal EtCO2 reading and the banner disappears.
- The pre-intubation 30:2 mask coaching and post-intubation 6-second ventilation coaching remain visible separately.

**Simulation limitations:** This automatically logs a pause in the app, but cannot detect or control real chest compressions. The automation requires an active, connected Controller in the foreground; suspended browsers, disconnected devices, clock drift or failed broadcasts may delay/miss events. A high-priority clinical timer must never rely on this public demo.


## V1.3 — Shockable charging/clear flow, one medication slot, adjunct logs

- **ROSC** is a small button on the normal Remote and now asks for confirmation before recording.
- The normal Remote no longer shows the four Rhythm selection buttons or the ventilation strip. Rhythm choices appear in the large START/re-arrest or two-minute rhythm-check stage only; the TV ventilation coaching is unchanged.
- Selecting **VF/pVT** opens two alternatives:
  - **RESUME CPR (CHARGING)**: continue/resume compressions while the defibrillator is charging. If a cycle rhythm check had already paused compressions, that pause is closed and included in the manual CCF. Then **CLEAR (CHARGE READY)** starts a new peri-shock hands-off interval.
  - **CLEAR (CHARGE READY)** directly: enters peri-shock pause and proceeds to **SHOCK → RESUME CPR** without the charging stage. If a rhythm check had already paused compressions, that *existing* pause continues to count towards CCF.
- The large SHOCK button only becomes available *after* CLEAR, with the existing fresh VF/pVT rhythm requirement and 100-second duplicate-log cooldown. RESUME remains a separate, explicit tap after a recorded Shock, and starts the next two-minute CPR cycle.
- The big shock-stage countdown begins at the **CLEAR** event and turns red after 3 seconds. The manual CCF uses **all actual logged compression pauses**, including any pause before CLEAR. This prevents under-counting earlier rhythm-analysis interruptions. These are user-button timestamps, not real compression sensor measurements.
- **Epinephrine and Amiodarone share ONE medication slot**. Epi appears when the first nonshockable rhythm is recorded or after Shock #2 and is available once its three-minute lock permits. Amiodarone is shown for preparation or documentation when the shock count and previously selected nonshockable pathway require it. When both are eligible, the UI prioritizes the active cycle's step, favouring overdue Epi at 5 minutes. No simultaneous Epi and Amiodarone buttons are shown.
- A small **ADJUNCT • RECORD ONLY** row lets users log 7.5% NaHCO3, 10% Calcium, 50% Glucose, and Lidocaine. These are optional time-stamped entries in the Timeline and PDF; a five-second per-adjunct duplicate guard is applied. The app does **not** automatically recommend an adjunct or infer dose/indication.
- Controller/TV event reduction recognizes the new `charge`, `clear`, and `adjunct` actions, preserving event timestamps in the shared session.

**Clinical caveat:** Continue compressions during charging where appropriate and minimize both pre- and post-shock interruptions. The app uses an expressly user-configured demonstration sequence; it is not validated for clinical decision support and must never delay treatment, enforce medication timing, or store identifiable patient information.


## V1.4 — ROSC checklist confirmation, single Re-arrest action and compact Remote

- **ROSC moved to the large EKG/Rhythm selection stage** (initial rhythm selection and the automatic two-minute rhythm check). It is removed from the normal Remote control grid.
- Tapping **ROSC** first opens a dedicated seven-item **Post-arrest Checklist** on the Controller: pulse/ECG rhythm, 12-lead ECG, full V/S, neurological status/GCS, airway/oxygenation/ventilation/EtCO₂, perfusion/hemodynamics, and CXR when indicated. The operator taps **CONFIRM ROSC · END CPR EPISODE** once to record the ROSC event; this confirmation is not followed by an extra browser dialog. A Back option returns to Rhythm selection without ending CPR.
- Once confirmed, the Controller's main content becomes **one large RE-ARREST · START CPR** action (plus the separate top utility toolbar). This starts the next CPR episode with a fresh four-choice Rhythm selection. It is immediately available when needed and does not inherit the old 5-second START cooldown.
- **Epinephrine elapsed time continues through ROSC**, and drug doses/counts, adjunct logs, shock totals, and overall case time persist across episodes. Restarting CPR resets only episode-specific cycle/rhythm and shock-flow state. The CCF denominator still excludes documented ROSC intervals.
- **105 BPM ON/OFF** and **RESET** controls are moved to a compact bar at the top of the mobile Remote. The Remote's **ROOM / Session** box and onboarding room label have been removed; session selection continues through the `room` URL parameter. The obsolete Remote subtitle has also been removed.
- The remaining medication, airway and pause/resume controls are enlarged to take advantage of the freed mobile screen space. The TV layout keeps its existing room/session identity and monitor functionality.
- The demo remains a manually reported event simulation, not a clinical CPR monitor or validated treatment protocol.


## V1.5 — Dynamic reversible-cause tools, adjunct dose records and post-ROSC dashboard

- **Amiodarone 150 mg**: when its existing project-specific fourth-shock documentation threshold is met, the button is highlighted in the same way as 300 mg, and there is **no extra browser confirmation**. This is only a medication log; it does not administer or prescribe treatment. The fourth-shock threshold is a local prototype rule and does not represent universal resuscitation guidance.
- **Additional records**: added **PRC · 1 unit**. The **7.5% NaHCO₃** button now opens a two-choice amount selector (**1 amp / 2 amp**); the actual amount is recorded in the Timeline and exported PDF. Existing Calcium, Glucose and Lidocaine logs remain. Newly created labels no longer contain an **ADJUNCT:** prefix. Previously broadcast labels are preserved as historical event text; the current session is ephemeral.
- **Progressive disclosure for PEA/Asystole only**: a single **POCUS / REVERSIBLE CAUSES** menu reveals three tabs:
  - **POCUS**: possible pseudo-PEA versus no observed cardiac motion, tamponade, hypovolemia pattern, left/right lung pneumothorax concerns, RV strain, and free abdominal fluid/eFAST. These are assessment findings, not automatically diagnosed etiologies. RV dilatation alone must not diagnose PE, and absence of observed cardiac activity alone must not decide termination.
  - **LAB**: VBG/ABG (acid-base), K, glucose, ionized Ca, Mg, Hb/Hct, lactate and core temperature. Checkboxes mean *reviewed/assessed*, not normal results and not laboratory orders.
  - **TRAUMA**: eFAST and hemorrhage assessment plus separately logged **ICD Lt** and **ICD Rt** procedures. Each completed ICD entry requires confirmation, is recorded once per arrest episode, and cannot be clicked again in that episode. The buttons do not imply clinical indication.
- Each checklist selection/deselection is timestamped in the event Timeline and included in the existing PDF exporter. The POCUS and Trauma selections reset when the next Re-arrest episode starts, while the full Timeline is retained.
- **After ROSC**, the Controller now has a compact **RE-ARREST · START CPR** button and separate **REPORT PDF** and **DASHBOARD** buttons. PDF uses the existing A4 timeline report implementation. Dashboard displays live figures for episodes, shocks, Epinephrine, Amiodarone, total case time, CPR time, recorded hands-off time, and a CCF ring chart, along with a color-coded rhythm bar chart and recorded adjunct/procedure counts. Both dashboard and PDF are derived from the same session events. The dashboard provides a back button to return to the Re-arrest action.
- The TV's core CPR monitor, shock workflow and pre-/post-intubation ventilation coach remain unchanged by these optional panels.

**Clinical and technical limitations:** POCUS is for trained personnel, with no additional or prolonged CPR interruptions. Its use and interpretation require clinical context; no ultrasound or laboratory checklist entry is a validated diagnosis. The prototype has no patient identity, no durable history, and no high-availability timing/decision support guarantees. These screens are for simulation and documentation only.

Clinical reference pages:
- https://www.resus.org.uk/professional-library/2025-resuscitation-guidelines/adult-advanced-life-support-guidelines
- https://www.resus.org.uk/professional-library/2025-resuscitation-guidelines/special-circumstances-guidelines
