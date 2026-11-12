// CPR Live v1.5 — ephemeral Supabase Broadcast demonstration.
// No user authentication, server authority, or durable database.
// NOT for clinical treatment, medication decision support, or patient data.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.0?bundle";

const cfg = window.CPR_CONFIG || {};
const params = new URLSearchParams(location.search);
const tvMode = params.get("view") === "tv" || window.CPR_FORCE_TV_MODE === true;
// Canonicalize ALL TV links to a dedicated TV document. This prevents the
// browser share sheet or Home Screen launch from copying the Remote URL.
if(tvMode){
  const canonical=new URL("tv.html",new URL("./",location.href));
  canonical.searchParams.set("room",params.get("room")||"ER-DEMO-01");
  canonical.searchParams.set("view","tv");
  const actual=new URL(location.href);
  if(actual.pathname!==canonical.pathname ||
     actual.searchParams.get("view")!=="tv" ||
     actual.searchParams.get("room")!==canonical.searchParams.get("room")){
    history.replaceState({}, "", canonical.toString());
  }
}
// Legacy ?view=tv still displays the monitor; dedicated tv.html has a stable
// manifest, app ID and Apple touch icon for Home Screen installation.
if(tvMode){
  const manifest=document.querySelector('link[rel="manifest"]');
  const appleIcon=document.querySelector('link[rel="apple-touch-icon"]');
  if(manifest)manifest.setAttribute("href","./manifest-monitor.webmanifest");
  if(appleIcon)appleIcon.setAttribute("href","./assets/cpr-monitor-180.png");
  document.title="CPR Live Monitor";
}
const DEVICE_ID = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random();
const ACTIONS = new Set(["start","pause","resume","reset","shock","epi","amio","rhythm","peaWidth","etTube","metro","rosc","etco2","charge","clear","adjunct","finding","procedure"]);
const TWO_MIN = 120000;
const FOUR_MIN = 240000;
const SHOCK_COOLDOWN_MS = 100000; // 1 min 40 seconds for duplicate SHOCK logs
const EPI_COOLDOWN_MS = 180000; // 3 minutes between documented Epi doses
const ACTION_COOLDOWN_MS = 5000; // per-button anti-double-tap for other actions
const FIVE_MIN = 300000;
const EPI_PREWARN_MS = 20000;
const SHOCKABLE_RHYTHMS = new Set(["VF","VT"]);
const ADJUNCT_NAMES={
  nahco3:"7.5% NaHCO₃", // legacy events
  nahco3_1:"7.5% NaHCO₃ · 1 amp",nahco3_2:"7.5% NaHCO₃ · 2 amp",
  calcium:"10% Calcium",glucose:"50% Glucose",lidocaine:"Lidocaine",
  prc:"PRC · 1 unit"
};
const FINDING_LABELS={
  "pea:pseudo":"Cardiac motion — possible pseudo-PEA",
  "pea:true":"No visible cardiac motion — possible true PEA",
  "us:tamponade":"POCUS: Pericardial effusion / suspected tamponade",
  "us:hypovolemia":"POCUS: Hypovolemia pattern (context dependent)",
  "us:ptx_lt":"Lung US: possible pneumothorax Lt",
  "us:ptx_rt":"Lung US: possible pneumothorax Rt",
  "us:rv_strain":"POCUS: RV strain (PE not diagnostic by this alone)",
  "us:free_fluid":"eFAST: free fluid / hemoperitoneum suspected",
  "lab:gas":"Lab: VBG/ABG — pH, bicarbonate, pCO₂",
  "lab:k":"Lab: Potassium (K⁺)",
  "lab:glucose":"Lab: Glucose",
  "lab:ca":"Lab: Ionized calcium (Ca²⁺)",
  "lab:mg":"Lab: Magnesium (Mg²⁺)",
  "lab:hb":"Lab: Hb/Hct",
  "lab:lactate":"Lab: Lactate",
  "lab:temp":"Check: Core temperature",
  "trauma:efast":"Trauma: eFAST performed",
  "trauma:bleeding":"Trauma: Hemorrhage considered"
};
const PROCEDURE_NAMES={icd_lt:"ICD Lt",icd_rt:"ICD Rt"};
function actionGroup(type,value){ return ["adjunct","finding","procedure"].includes(type)?type+":"+value:type; }
function actionCooldownRemaining(s,type,now,value){
  // START is gated by standby/ROSC phase, so a rapid re-arrest cannot be
  // blocked by the five-second duplicate tap guard from the previous episode.
  if(type==="start")return 0;
  if(type==="shock")return s.lastShockAt===null?0:Math.max(0,s.lastShockAt+SHOCK_COOLDOWN_MS-now);
  if(type==="epi")return s.lastEpiAt===null?0:Math.max(0,s.lastEpiAt+EPI_COOLDOWN_MS-now);
  const last=s.lastActionAt[actionGroup(type,value)];
  return last===undefined?0:Math.max(0,last+ACTION_COOLDOWN_MS-now);
}
const fmt = n => String(n).padStart(2,"0");
const roomClean = v => String(v || "").toUpperCase().replace(/[^A-Z0-9_-]/g,"").slice(0,40) || "ER-DEMO-01";
let room = roomClean(params.get("room") || cfg.defaultRoom);
let supabase = null;
let channel = null;
let connected = false;
let messages = new Map();
let sequence = 0;
let switchingRoom = false;
let pendingShock = false; // Existing SHOCK in-flight guard.
const pendingActions = new Set(); // Other actions locked before awaiting Supabase.
let dashboardOpen=false;
let causeToolsOpen=false;
let causeTab="pocus";
let bicarbPickerOpen=false;
let roscReviewOpen=false; // Local checklist review; ROSC broadcasts only on confirmation.

// Audio is deliberately TV-only. Browsers require a gesture on each TV page
// before sound and Web Speech are reliably permitted.
let audioReady = tvMode; // Attempt speech automatically; WebAudio may still be blocked.
let audioContext = null;
let nearAlarmKey = "";
let cycleEndKey = "";
let epiAlarmKey = "";
let epiPreAlertKey = "";
let interruptionAlarmKey = "";
// Metronome is shared session state (the TV follows the Controller).
let nextMetronomeBeat=null;
let currentMetronomeEpisode=null;
let lastCoachBeatKey="";
const METRONOME_BPM=105;
const METRONOME_INTERVAL=60/METRONOME_BPM;
const COMPRESSION_BEAT_MS=60000/METRONOME_BPM;
const THIRTY_BEATS_MS=30*COMPRESSION_BEAT_MS;
const BREATH_DURATION_MS=1500; // 1.5-second inspiratory visual cue
const BREATH_RELEASE_MS=500;
const TWO_BREATHS_MS=2*BREATH_DURATION_MS+BREATH_RELEASE_MS; // 3.5 s total
const MASK_CYCLE_MS=THIRTY_BEATS_MS+TWO_BREATHS_MS;

document.body.classList.toggle("tv-mode",tvMode);
document.getElementById("timelineSection").hidden=tvMode;
document.getElementById("modeBadge").textContent = tvMode ? "TV DISPLAY" : "CONTROLLER";
const initialRoomInput=document.getElementById("roomInput");
if(initialRoomInput)initialRoomInput.value=room;
const initialRoomLabel=document.getElementById("roomLabel");
if(initialRoomLabel)initialRoomLabel.textContent=room;

function blankState() {
  return {
    phase:"standby",
    sessionId:null,
    firstStartAt:null,     // Wall-clock total keeps running through ROSC/re-arrest.
    episode:0,
    cycleAnchor:null,      // Per-episode CPR cycle elapsed, adjusted for pauses.
    pausedAt:null,
    pauseId:null,
    pauseReason:null,
    pauseRhythmRecorded:false,
    pauseAccruedMs:0,
    arrestAccruedMs:0,
    episodeStartAt:null,
    frozenCycleMs:0,
    epiAnchor:null,        // Time since CPR start or latest documented epinephrine.
    shock:0,lastShockAt:null,lastEpiAt:null,epi:0,amioDoses:[],
    rhythm:"—",lastRhythmEventId:null,lastShockRhythmEventId:null,
    fromNonShockable:false,
    shockFlow:null, // decision / charging / readyShock / postShock
    clearAt:null,
    adjunctCounts:{},
    peaWidth:null,etco2:null,advancedAirway:false,ventAnchor:null,coachAnchor:null,
    findings:{},procedures:{},
    metronomeOn:true,lastActionAt:{},timeline:[]
  };
}
function chronological() {
  return [...messages.values()].sort((a,b) =>
    (a.ts-b.ts) || (a.seq-b.seq) || a.id.localeCompare(b.id));
}
function line(state,e,label) {
  state.timeline.push({id:e.id,ts:e.ts,label});
  if(e.type!=="shock" && e.type!=="epi" && e.type!=="reset"){
    state.lastActionAt[actionGroup(e.type,e.value)]=e.ts;
  }
}
function computeState() {
  const s = blankState();
  for (const e of chronological()) {
    const t = e.ts;
    if(e.type!=="shock" && e.type!=="epi" && e.type!=="reset" &&
      actionCooldownRemaining(s,e.type,t,e.value)>0)continue;
    if (e.type === "reset") {
      Object.assign(s,blankState());
    } else if (e.type === "start" && (s.phase === "standby" || s.phase === "rosc")) {
      const recurrent = s.phase === "rosc";
      if (!recurrent) {
        s.sessionId=e.id;
        s.firstStartAt=t;
        s.shock=0;s.lastShockAt=null;s.lastEpiAt=null;s.epi=0;s.amioDoses=[];s.etco2=null;s.advancedAirway=false;s.ventAnchor=null;s.timeline=[];
      }
      s.episode++;
      s.phase="running";
      s.cycleAnchor=t;
      s.episodeStartAt=t;
      s.coachAnchor=t;
      s.frozenCycleMs=0;
      s.pausedAt=null;
      s.pauseId=null;
      s.pauseReason=null;
      s.pauseRhythmRecorded=false;
      s.rhythm="—";
      s.lastRhythmEventId=null;
      s.lastShockRhythmEventId=null;
      s.fromNonShockable=false; // Re-arrest begins a new rhythm pathway.
      s.shockFlow=null;
      s.clearAt=null;
      s.peaWidth=null;
      s.findings={};s.procedures={}; // Re-arrest starts a fresh cause assessment.
      if(s.advancedAirway)s.ventAnchor=t; // Re-arrest: start a new 6-second breath cycle.
      // The epinephrine clock starts only on a documented dose.
      // Before a dose the TV displays "NO NEED".
      line(s,e,recurrent?"RE-ARREST — START CPR #"+s.episode:"START CPR");
    } else if (e.type === "pause" && s.phase === "running") {
      // Compression interruption does NOT stop the 2-min cycle or epinephrine clock.
      s.pausedAt=t;
      s.pauseId=e.id;
      s.pauseReason=e.value==="cycle"?"cycle":"manual";
      s.pauseRhythmRecorded=false;
      s.phase="paused";
      line(s,e,s.pauseReason==="cycle"?"2-MIN CYCLE — PAUSE FOR RHYTHM":"PAUSE CHEST COMPRESSIONS");
    } else if (e.type === "charge" &&
      s.shockFlow==="decision" && ["running","paused"].includes(s.phase)) {
      // Compression continues during charging. Close any earlier rhythm-check pause.
      if(s.phase==="paused" && s.pausedAt!==null){
        s.pauseAccruedMs+=Math.max(0,t-s.pausedAt);
        s.pausedAt=null;
        s.pauseId=null;
        s.pauseReason=null;
        s.pauseRhythmRecorded=false;
        s.coachAnchor=t;
      }
      s.phase="running";
      s.shockFlow="charging";
      line(s,e,"RESUME CPR — DEFIB CHARGING");
    } else if (e.type === "clear" &&
      ["decision","charging"].includes(s.shockFlow) &&
      ["running","paused"].includes(s.phase)) {
      if(s.phase==="running"){
        s.phase="paused";
        s.pausedAt=t;
        s.pauseId=e.id;
      }
      // Direct CLEAR leaves an existing rhythm-check pause intact for CCF.
      s.pauseReason="shock";
      s.pauseRhythmRecorded=true;
      s.clearAt=t; // Peri-shock countdown starts at CLEAR.
      s.shockFlow="readyShock";
      line(s,e,"CLEAR — CHARGE READY / HANDS OFF");
    } else if (e.type === "resume" && s.phase === "paused") {
      if(s.shockFlow && s.shockFlow!=="postShock")continue;
      if(s.pauseReason==="cycle" && !s.pauseRhythmRecorded)continue;
      const interruption=Math.max(0,t-s.pausedAt);
      s.pauseAccruedMs+=interruption;
      if(s.pauseReason==="cycle" || s.shockFlow==="postShock"){
        s.cycleAnchor=t; // Next two-minute cycle begins only after Resume.
      }
      s.pausedAt=null;
      s.pauseId=null;
      s.pauseReason=null;
      s.pauseRhythmRecorded=false;
      s.phase="running";
      s.coachAnchor=t;
      s.shockFlow=null;
      s.clearAt=null;
      line(s,e,"RESUME COMPRESSIONS — interruption "+timeText(interruption));
    } else if (e.type === "rosc" && ["running","paused"].includes(s.phase)) {
      if (s.pausedAt!==null) s.pauseAccruedMs+=Math.max(0,t-s.pausedAt);
      s.arrestAccruedMs+=Math.max(0,t-s.episodeStartAt);
      s.episodeStartAt=null;
      s.frozenCycleMs=Math.max(0,t-s.cycleAnchor);
      s.pausedAt=null;
      s.pauseId=null;
      s.pauseReason=null;
      s.pauseRhythmRecorded=false;
      s.shockFlow=null;
      s.clearAt=null;
      s.phase="rosc";
      line(s,e,"ROSC — CPR STOPPED");
    } else if (["running","paused"].includes(s.phase) && e.type === "shock") {
      // Shared event-source guard: only the earliest shock in each 100s window
      // is counted, even if several controllers broadcast duplicate clicks.
      // This is UI/logging protection, not an electrical defibrillator lockout.
      if(s.shockFlow==="readyShock" && s.phase==="paused" &&
        (s.lastShockAt===null || t-s.lastShockAt>=SHOCK_COOLDOWN_MS) &&
        SHOCKABLE_RHYTHMS.has(s.rhythm) && s.lastRhythmEventId!==null &&
        s.lastRhythmEventId!==s.lastShockRhythmEventId){
        s.shock++;
        s.lastShockAt=t;
        s.lastShockRhythmEventId=s.lastRhythmEventId;
        s.shockFlow="postShock";
        line(s,e,"SHOCK #"+s.shock);
      }
    } else if (["running","paused"].includes(s.phase) && e.type === "epi") {
      if((s.fromNonShockable || (SHOCKABLE_RHYTHMS.has(s.rhythm) && s.shock>=2)) &&
         (s.lastEpiAt===null || t-s.lastEpiAt>=EPI_COOLDOWN_MS)){
        s.epi++;
        s.epiAnchor=t;
        s.lastEpiAt=t;
        line(s,e,"EPINEPHRINE #"+s.epi);
      }
    } else if (["running","paused"].includes(s.phase) && e.type === "amio" &&
      SHOCKABLE_RHYTHMS.has(s.rhythm) &&
      (e.value===300||e.value===150) &&
      s.amioDoses.length<2 &&
      e.value===(s.amioDoses.length===0?300:150) &&
      s.shock >= amiodaroneMinimumShock(s,e.value)) {
      // Apply the same branch-dependent guard to received events as to UI clicks.
      s.amioDoses.push(e.value);
      line(s,e,"AMIODARONE "+e.value+" mg");
    } else if (["running","paused"].includes(s.phase) && e.type === "rhythm" &&
      ["VF","VT","PEA","Asystole"].includes(e.value)) {
      s.rhythm=e.value;
      if(e.value==="PEA" || e.value==="Asystole")s.fromNonShockable=true;
      s.lastRhythmEventId=e.id;
      if(s.phase==="paused" && s.pauseReason==="cycle")s.pauseRhythmRecorded=true;
      if(SHOCKABLE_RHYTHMS.has(e.value)){
        // A new rhythm is required to initiate a fresh Shock workflow.
        if(s.shockFlow===null)s.shockFlow="decision";
      }else{
        s.shockFlow=null;
        s.clearAt=null;
      }
      s.peaWidth=null;
      line(s,e,"RHYTHM: "+(s.rhythm==="VT"?"pVT":s.rhythm));
    } else if (["running","paused"].includes(s.phase) && e.type === "peaWidth" &&
      s.rhythm==="PEA" && ["Narrow","Wide"].includes(e.value)) {
      s.peaWidth=e.value;
      line(s,e,"PEA QRS: "+e.value);
    } else if (["running","paused"].includes(s.phase) && e.type === "etTube" && !s.advancedAirway) {
      s.advancedAirway=true;
      s.ventAnchor=t;
      line(s,e,"ET-TUBE (reported placed) — ventilation coach started");
    } else if (e.type==="adjunct" &&
      ["running","paused"].includes(s.phase) && ADJUNCT_NAMES[e.value]){
      s.adjunctCounts[e.value]=(s.adjunctCounts[e.value]||0)+1;
      line(s,e,ADJUNCT_NAMES[e.value]);
    } else if(e.type==="finding" && ["running","paused"].includes(s.phase) &&
      ["PEA","Asystole"].includes(s.rhythm) && FINDING_LABELS[e.value]){
      const wasSelected=!!s.findings[e.value];
      if(e.value==="pea:pseudo" || e.value==="pea:true"){
        s.findings["pea:pseudo"]=false;s.findings["pea:true"]=false;
      }
      s.findings[e.value]=!wasSelected;
      line(s,e,(wasSelected?"UNCHECKED: ":"CHECKED: ")+FINDING_LABELS[e.value]);
    } else if(e.type==="procedure" && ["running","paused"].includes(s.phase) &&
      ["PEA","Asystole"].includes(s.rhythm) &&
      PROCEDURE_NAMES[e.value] && !s.procedures[e.value]){
      s.procedures[e.value]=true;
      line(s,e,PROCEDURE_NAMES[e.value]);
    } else if (e.type==="metro" && typeof e.value==="boolean") {
      // Sync metronome setting silently: no Timeline entry or spoken feedback.
      s.metronomeOn=e.value;
      s.lastActionAt.metro=t;
    } else if (["running","paused","rosc"].includes(s.phase) && e.type === "etco2" &&
      s.advancedAirway && Number.isInteger(e.value) && e.value>=0 && e.value<=150) {
      s.etco2=e.value;
      line(s,e,"CO₂: "+s.etco2+" mmHg");
    }
  }
  return s;
}
function elapsedFor(s,now) {
  const totalMs=s.firstStartAt===null?0:Math.max(0,now-s.firstStartAt);
  const active=["running","paused"].includes(s.phase);
  const cycleMs=s.cycleAnchor===null?0:
    active?Math.max(0,now-s.cycleAnchor):s.frozenCycleMs;
  // Medication timer uses the time of the MOST RECENT documented dose,
  // regardless of interruptions. No pause/resume action may shift this anchor.
  const epiMs=s.epiAnchor===null?0:Math.max(0,now-s.epiAnchor);
  const ventMs=s.ventAnchor===null?0:
    s.phase==="running"?Math.max(0,now-s.ventAnchor):
    s.phase==="paused"?Math.max(0,s.pausedAt-s.ventAnchor):0;
  const arrestMs=s.arrestAccruedMs+
    (active && s.episodeStartAt!==null?Math.max(0,now-s.episodeStartAt):0);
  const currentPauseMs=s.phase==="paused" && s.pausedAt!==null?
    Math.max(0,now-s.pausedAt):0;
  const pauseMs=Math.min(arrestMs,s.pauseAccruedMs+currentPauseMs);
  const compressionMs=Math.max(0,arrestMs-pauseMs);
  const ccf=arrestMs>0?(compressionMs/arrestMs)*100:null;
  const pauseRemainingMs=Math.max(0,10000-currentPauseMs);
  return {totalMs,cycleMs,epiMs,ventMs,arrestMs,pauseMs,currentPauseMs,
    pauseRemainingMs,compressionMs,ccf};
}
function timeText(ms) {
  const sec=Math.floor(Math.max(0,ms)/1000);
  return fmt(Math.floor(sec/60))+":"+fmt(sec%60);
}
function beep(kind="notice") {
  if (!audioReady || !tvMode || !audioContext || audioContext.state!=="running") return;
  try {
    const isAlarm=kind!=="notice";
    const notes=isAlarm?[880,660,880]:[720];
    notes.forEach((f,i)=>{
      const oscillator=audioContext.createOscillator();
      const gain=audioContext.createGain();
      const at=audioContext.currentTime+i*(isAlarm?.22:.16);
      oscillator.type="sine";oscillator.frequency.value=f;
      gain.gain.setValueAtTime(.001,at);
      gain.gain.exponentialRampToValueAtTime(.14,at+.025);
      gain.gain.exponentialRampToValueAtTime(.001,at+.18);
      oscillator.connect(gain);gain.connect(audioContext.destination);
      oscillator.start(at);oscillator.stop(at+.19);
    });
  } catch(err){console.warn("Beep",err);}
}
function speak(text,urgent=false) {
  if (!audioReady || !tvMode) return;
  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return;
  try {
    if (urgent) speechSynthesis.cancel();
    // Bound the spoken queue if many rapid button presses are received.
    if (speechSynthesis.pending && urgent) speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(text);
    u.lang="th-TH";u.rate=.94;u.volume=1;
    const voices=speechSynthesis.getVoices();
    const thai=voices.find(v=>v.lang.toLowerCase().startsWith("th"));
    if (thai)u.voice=thai;
    u.onerror=()=>{document.getElementById("audioStatus").textContent="เสียงพูดอาจไม่รองรับภาษาไทยบน TV นี้";};
    speechSynthesis.speak(u);
  } catch(err) {
    console.warn("TTS",err);
    document.getElementById("audioStatus").textContent="TV ไม่รองรับเสียงพูด — ตรวจลำโพงและ Browser";
  }
}
function soundNotice(text,urgent=false) {
  if (!audioReady || !tvMode) return;
  beep(urgent?"alarm":"notice");
  speak(text,urgent);
}
function shockAdvice(s) {
  if(s.shock===2)return s.fromNonShockable?
    "อามิโอดาโรน สามร้อยมิลลิกรัม":"เตรียมอามิโอดาโรน สามร้อยมิลลิกรัม";
  if(s.shock===3)return "พิจารณาอามิโอดาโรน สามร้อยมิลลิกรัม";
  if(s.shock===4)return "เตรียมอามิโอดาโรน หนึ่งร้อยห้าสิบมิลลิกรัม";
  if(s.shock===5)return "พิจารณาอามิโอดาโรน หนึ่งร้อยห้าสิบมิลลิกรัม";
  return "";
}
function announceEvent(e,s) {
  if(!audioReady || !tvMode || e.type==="resume" || e.type==="metro")return;
  const spoken={
    charge:"ชาร์จ กดหน้าอกต่อ",
    clear:"เคลียร์",
    adjunct:"บันทึก "+ADJUNCT_NAMES[e.value],
    procedure:"บันทึก "+PROCEDURE_NAMES[e.value],
    start:"เริ่มซีพีอาร์ บันทึกริทึม",
    pause:e.value==="cycle"?"พักซีพีอาร์ ตรวจริทึม":"พักกดหน้าอก",
    reset:"รีเซ็ต",
    shock:"ช็อกครั้งที่ "+s.shock+" "+shockAdvice(s),
    epi:"อิพิเนฟริน ครั้งที่ "+s.epi,
    amio:"อามิโอดาโรน "+e.value+" มิลลิกรัม",
    rhythm:e.value==="VF"?"วีเอฟ":e.value==="VT"?"พีวีที":
      e.value==="PEA"?"พีอีเอ เลือกคิวอาร์เอส ทำพีโอคัส":"แอสซิสโตลี แฟลตไลน์โปรโตคอล",
    peaWidth:e.value==="Wide"?"ไวด์คิวอาร์เอส":"แนโรคิวอาร์เอส",
    etTube:"ใส่ท่อแล้ว ติด ซีโอทู มอนิเตอร์",
    rosc:"อาร์โอเอสซี ตรวจอีเคจี เอกซเรย์ปอด วัดไวทัลไซน์ ประเมินจีซีเอส",
    etco2:"ซีโอทู "+e.value+(e.value<10?" ตรวจคุณภาพซีพีอาร์":"")
  };
  if(spoken[e.type])soundNotice(spoken[e.type],e.type==="rosc"||e.type==="start"||(e.type==="etco2"&&e.value<10));
}
// 30:2 is a visual/audio timing coach, not a compression detector.
function maskCoach(s,now){
  const elapsed=Math.max(0,now-(s.coachAnchor??s.episodeStartAt??now));
  const round=Math.floor(elapsed/MASK_CYCLE_MS);
  const position=elapsed-round*MASK_CYCLE_MS;
  if(position<THIRTY_BEATS_MS){
    return {round,position,breath:0,count:Math.min(30,Math.floor(position/COMPRESSION_BEAT_MS)+1),squeeze:false};
  }
  const b=position-THIRTY_BEATS_MS;
  return {round,position,breath:b<BREATH_DURATION_MS+BREATH_RELEASE_MS?1:2,
    count:30,squeeze:b<BREATH_DURATION_MS||b>=BREATH_DURATION_MS+BREATH_RELEASE_MS};
}
function epiColor(s,clock){
  if(!["running","paused"].includes(s.phase))return "neutral";
  if(s.lastEpiAt===null)return "neutral";
  if(clock.epiMs>=FIVE_MIN-EPI_PREWARN_MS)return "red";
  return clock.epiMs>=FOUR_MIN?"green":"neutral";
}
function playMetronomeBeat(when) {
  if (!audioContext || audioContext.state!=="running")return;
  try {
    const osc=audioContext.createOscillator();
    const gain=audioContext.createGain();
    osc.type="triangle";
    osc.frequency.setValueAtTime(1000,when);
    osc.frequency.exponentialRampToValueAtTime(680,when+.045);
    gain.gain.setValueAtTime(.001,when);
    gain.gain.exponentialRampToValueAtTime(.045,when+.008);
    gain.gain.exponentialRampToValueAtTime(.001,when+.075);
    osc.connect(gain);gain.connect(audioContext.destination);
    osc.start(when);osc.stop(when+.08);
  } catch(err){console.warn("Metronome audio",err);}
}
function updateMetronome(s) {
  const active=audioReady && tvMode && s.metronomeOn && connected &&
    s.phase==="running" && audioContext && audioContext.state==="running";
  if(!active){nextMetronomeBeat=null;currentMetronomeEpisode=null;lastCoachBeatKey="";return;}
  const id=room+"|"+s.sessionId+"|"+s.episode+"|"+s.coachAnchor+"|"+s.advancedAirway;
  if(!s.advancedAirway){
    // Schedule only the 30 compression beats, aligned to the shared coach clock.
    // Never play compression clicks during the two mask breaths.
    const wall=Date.now();
    const anchor=s.coachAnchor??s.episodeStartAt??wall;
    const base=Math.max(0,Math.floor((wall-anchor)/MASK_CYCLE_MS));
    for(let round=base;round<=base+1;round++){
      for(let beat=0;beat<30;beat++){
        const target=anchor+round*MASK_CYCLE_MS+beat*COMPRESSION_BEAT_MS;
        const delay=target-wall;
        if(delay>=-30 && delay<=360){
          const key=id+"|"+round+"|"+beat;
          if(lastCoachBeatKey!==key){
            playMetronomeBeat(audioContext.currentTime+Math.max(.005,delay/1000));
            lastCoachBeatKey=key;
          }
        }
      }
    }
    return;
  }
  if(currentMetronomeEpisode!==id){
    currentMetronomeEpisode=id;nextMetronomeBeat=null;
  }
  const now=audioContext.currentTime;
  if(nextMetronomeBeat===null || nextMetronomeBeat<now-.2)nextMetronomeBeat=now+.04;
  // Schedule ahead on AudioContext clock to avoid timer jitter.
  let count=0;
  while(nextMetronomeBeat<now+.36 && count<3){
    playMetronomeBeat(nextMetronomeBeat);
    nextMetronomeBeat+=METRONOME_INTERVAL;
    count++;
  }
}
function amiodaroneMinimumShock(s,dose){
  return dose===300?(s.fromNonShockable?2:3):4;
}
function amiodaroneStatus(s){
  const dose=s.amioDoses.length===0?300:150;
  const shockable=SHOCKABLE_RHYTHMS.has(s.rhythm);
  const alreadyComplete=s.amioDoses.length>=2;
  const visible=shockable && !alreadyComplete && s.shock>=2;
  const min=amiodaroneMinimumShock(s,dose);
  const available=visible && s.shock>=min;
  const prepare=visible && !available;
  const recommended=available; // Both 300 mg and 150 mg enabled buttons use the highlighted style.
  return {dose,visible,available,prepare,recommended};
}
function medicationCue(s,clock){
  const shockable=["VF","VT"].includes(s.rhythm);
  const epiReady=s.fromNonShockable || (shockable && s.shock>=2);
  const amioCount=s.amioDoses.length;
  let cue="";
  if(s.phase==="standby")cue="รอ START CPR — เริ่มแล้วบันทึก Rhythm โดยเร็ว";
  else if(s.phase==="rosc")cue="ROSC — 12-lead ECG, CXR, วัด V/S (BP HR RR SpO₂ Temp), ประเมิน GCS, Airway/Oxygenation/Perfusion; Re-arrest กด START CPR ใหม่";
  else if(s.rhythm==="—")cue="⚠️ กรุณาบันทึก Rhythm ตอนนี้ — CPR Timer นับต่อได้";
  else if(s.rhythm==="PEA"){
    const width=s.peaWidth?" ("+s.peaWidth+" QRS)":" — เลือก Narrow / Wide QRS";
    cue="PEA"+width+" — พิจารณา POCUS เพื่อค้นหา reversible causes โดยไม่ขัดจังหวะ CPR; พิจารณา Epinephrine โดยเร็ว";
  } else if(s.rhythm==="Asystole"){
    cue="ASYSTOLE — FLAT-LINE PROTOCOL: ตรวจสาย/ขั้วไฟฟ้า, gain, ยืนยัน 2 leads และประเมิน fine VF; CPR ต่อเนื่อง, ไม่ช็อกเมื่อยืนยันแล้ว";
  } else if(s.shock<2)cue=s.rhythm+" · Shock #"+s.shock+" — เน้น Defibrillation ก่อน; Epinephrine ยังไม่เน้น";
  else if(s.shock===2)cue=s.fromNonShockable?
    "Shock #2 หลัง Nonshockable — สามารถบันทึก Amiodarone 300 mg ตาม Protocol ที่ทีมเลือก":
    "Shock #2 — Epinephrine / เตรียม Amiodarone 300 mg";
  else if(amioCount===0)cue="Shock #"+s.shock+" — พิจารณา Amiodarone 300 mg หากยัง VF/pVT";
  else if(amioCount===1 && s.shock===4)cue="Shock #4 — เตรียม Amiodarone 150 mg; ERC 2025 ระบุพิจารณาหลัง Shock #5";
  else if(amioCount===1 && s.shock>=5)cue="Shock #"+s.shock+" — พิจารณา Amiodarone 150 mg (ขนาดที่สอง) ตาม protocol";
  else if(amioCount>=2)cue="บันทึก Amiodarone สองขนาด (300 + 150 mg) แล้ว";
  else cue="VF/pVT — ให้ CPR ต่อเนื่อง ประเมิน Rhythm และยา ตาม ACLS";
  if(shockable && s.phase==="running" && clock &&
    clock.cycleMs%TWO_MIN>=TWO_MIN-10000){
    cue+=" • ⚡ เตรียม Defibrillator / Charge ตาม Protocol ก่อนครบ 2 นาที; ตรวจ Rhythm ใหม่และยืนยัน VF/pVT ก่อน Shock";
  }
  return {epiReady,cue,shockable,amioCount};
}
function updateAudioStatus(message,blocked=false) {
  const el=document.getElementById("audioStatus");
  el.textContent=message;
  el.classList.toggle("blocked",blocked);
}
function initTVAudio() {
  if(!tvMode)return;
  const Ctx=window.AudioContext||window.webkitAudioContext;
  if(!Ctx){
    updateAudioStatus("TV AUDIO: Web Audio unavailable • speech depends on browser",true);
    return;
  }
  try {
    if(!audioContext)audioContext=new Ctx();
    const p=audioContext.resume();
    if(p && typeof p.then==="function")p.then(()=>{
      const ready=audioContext && audioContext.state==="running";
      updateAudioStatus(ready?"TV AUDIO ENGINE READY":"TV AUDIO MAY BE BLOCKED BY BROWSER",!ready);
      render();
    }).catch(()=>updateAudioStatus("TV AUDIO BLOCKED — browser requires local user gesture",true));
    else updateAudioStatus(audioContext.state==="running"?"TV AUDIO ENGINE READY":"TV AUDIO MAY BE BLOCKED",audioContext.state!=="running");
  } catch(err){console.warn("Autoplay restrictions",err);updateAudioStatus("TV AUDIO BLOCKED / UNSUPPORTED",true);}
}
function checkAlarms(s,clock) {
  const overlay=document.getElementById("alarmOverlay");
  // There are deliberately NO CPR alarms, flashing overlays or alarm TTS on the mobile remote.
  if(!tvMode){
    overlay.classList.remove("alarm-on","message-on");
    return;
  }
  const ongoing=connected && s.phase==="running" && s.sessionId;
  const cycle=clock.cycleMs;
  const cycleIndex=Math.floor(cycle/TWO_MIN);
  const inLastTen=ongoing && cycle%TWO_MIN>=TWO_MIN-10000 && cycle%TWO_MIN<TWO_MIN;
  const inLastFive=inLastTen && cycle%TWO_MIN>=TWO_MIN-5000;
  overlay.classList.toggle("alarm-on",!!inLastTen);
  overlay.classList.toggle("message-on",!!inLastFive);
  const announcements=[];
  if (inLastTen) {
    document.getElementById("alarmSeconds").textContent=
      String(Math.ceil((TWO_MIN-cycle%TWO_MIN)/1000));
    const key=room+"|"+s.sessionId+"|"+s.episode+"|"+cycleIndex;
    if (audioReady && tvMode && nearAlarmKey!==key) {
      nearAlarmKey=key;
      announcements.push(SHOCKABLE_RHYTHMS.has(s.rhythm)?
        "อีกสิบวินาที เตรียมชาร์จเครื่องช็อก":
        "อีกสิบวินาที ตรวจริทึม");
    }
  }
  if (ongoing && cycleIndex>=1 && audioReady && tvMode) {
    const key=room+"|"+s.sessionId+"|"+s.episode+"|"+cycleIndex;
    if (cycleEndKey!==key) {
      cycleEndKey=key;
      // Skip stale boundary announcements if the TV was suspended and resumed.
      if (cycle%TWO_MIN<3000)announcements.push("ตรวจริทึม");
    }
  }
  const doseTimingActive=connected && ["running","paused"].includes(s.phase) && s.lastEpiAt!==null;
  const epiKey=room+"|"+s.sessionId+"|"+s.lastEpiAt;
  if(doseTimingActive && !SHOCKABLE_RHYTHMS.has(s.rhythm) && clock.epiMs>=FOUR_MIN && clock.epiMs<FIVE_MIN-EPI_PREWARN_MS &&
      audioReady && epiAlarmKey!==epiKey+"|4"){
    // One 4-minute cue; a separate key below tracks the 5-minute boundary.
    epiAlarmKey=epiKey+"|4";
    announcements.push("อิพิเนฟริน ครบสี่นาที");
  }
  if(doseTimingActive && clock.epiMs>=FIVE_MIN-EPI_PREWARN_MS && clock.epiMs<FIVE_MIN &&
      audioReady && epiPreAlertKey!==epiKey){
    epiPreAlertKey=epiKey;
    announcements.push("อิพิเนฟริน อีกยี่สิบวินาที");
  }
  if(doseTimingActive && clock.epiMs>=FIVE_MIN && audioReady && epiAlarmKey!==epiKey+"|5"){
    epiAlarmKey=epiKey+"|5";
    announcements.push("อิพิเนฟริน ครบห้านาที");
  }
  // At 04:00, CPR and epinephrine alerts occur together: speak both, not
  // two interrupted speech utterances.
  if (announcements.length) soundNotice(announcements.join(" และ "),true);
}
// Purely illustrative trace sketches, never monitor data or ECG diagnostic references.
function exampleEcgPath(rhythm,width){
  const parts=["M0 52"];
  if(rhythm==="Asystole"){
    for(let x=0;x<=640;x+=8)parts.push("L"+x+" "+(52+1.5*Math.sin(x/29)+.5*Math.sin(x/7)).toFixed(1));
  }else if(rhythm==="VF"){
    for(let x=0;x<=640;x+=5){
      const y=52+(15+10*Math.sin(x*.023)**2)*Math.sin(x*.14)+12*Math.sin(x*.32)+6*Math.sin(x*.46);
      parts.push("L"+x+" "+Math.min(98,Math.max(5,y)).toFixed(1));
    }
  }else if(rhythm==="VT"){
    for(let x=0;x<640;x+=114)parts.push("L"+(x+8)+" 54","Q"+(x+24)+" 54 "+(x+32)+" 29",
      "Q"+(x+45)+" 4 "+(x+59)+" 16","Q"+(x+76)+" 28 "+(x+87)+" 81",
      "Q"+(x+99)+" 98 "+(x+110)+" 55","L"+(x+114)+" 52");
  }else if(rhythm==="PEA"&&width==="Narrow"){
    for(let x=0;x<640;x+=142)parts.push("L"+(x+12)+" 52","Q"+(x+22)+" 40 "+(x+32)+" 52",
      "L"+(x+43)+" 52","L"+(x+50)+" 57","L"+(x+56)+" 11","L"+(x+62)+" 85",
      "L"+(x+69)+" 52","L"+(x+87)+" 52","Q"+(x+102)+" 33 "+(x+119)+" 52","L"+(x+142)+" 52");
  }else if(rhythm==="PEA"&&width==="Wide"){
    for(let x=0;x<640;x+=150)parts.push("L"+(x+16)+" 52","Q"+(x+27)+" 42 "+(x+37)+" 52",
      "L"+(x+48)+" 52","C"+(x+65)+" 50 "+(x+66)+" 15 "+(x+84)+" 16",
      "C"+(x+101)+" 16 "+(x+106)+" 86 "+(x+123)+" 85",
      "Q"+(x+132)+" 78 "+(x+139)+" 52","L"+(x+150)+" 52");
  }else parts.push("H640");
  return parts.join(" ");
}
function renderECG(s){
  const panel=document.getElementById("ecgPanel");
  if(!tvMode||s.rhythm==="—"){panel.hidden=true;return;}
  panel.hidden=false;
  const name=s.rhythm==="VT"?"pVT":s.rhythm==="PEA"?
    (s.peaWidth?"PEA — "+s.peaWidth.toUpperCase()+" QRS":"PEA — SELECT QRS"):s.rhythm.toUpperCase();
  const title=document.getElementById("ecgTitle");
  if(title.textContent!==name)title.textContent=name;
  const trace=document.getElementById("ecgTrace");
  const path=exampleEcgPath(s.rhythm,s.peaWidth);
  if(trace.getAttribute("d")!==path)trace.setAttribute("d",path);
  trace.setAttribute("stroke",["VF","VT"].includes(s.rhythm)?"#ffbc72":
    s.rhythm==="Asystole"?"#86b7a1":"#52efa3");
}
function renderInterruption(s,clock){
  const paused=s.phase==="paused"&&s.pausedAt!==null;
  const mobile=document.getElementById("pauseInfo");
  mobile.hidden=!paused;
  if(paused){
    const remaining=Math.max(0,Math.ceil(clock.pauseRemainingMs/1000));
    document.getElementById("pauseCountdown").textContent=String(remaining);
    mobile.classList.toggle("pause-overrun",remaining===0);
    const text=mobile.querySelector("span:last-child");
    if(text)text.textContent=remaining===0?"OVER 10s — CONTINUE CPR":"s left before warning";
  }
  const pauseBanner=document.getElementById("rhythmPauseBanner");
  pauseBanner.hidden=!(tvMode&&paused);
  if(tvMode&&paused){
    const cyclePause=s.pauseReason==="cycle";
    document.getElementById("tvRhythmPauseMessage").textContent=
      s.shockFlow==="readyShock"?"CLEAR — SHOCK":
      s.shockFlow==="postShock"?"SHOCK RECORDED — RESUME CPR":
      cyclePause && s.pauseRhythmRecorded?"RHYTHM IDENTIFIED — RESUME CPR":
      "PAUSE CPR — IDENTIFY RHYTHM";
    document.getElementById("tvRhythmPauseElapsed").textContent=
      (clock.currentPauseMs/1000).toFixed(1)+" s HANDS-OFF";
    pauseBanner.classList.toggle("critical",clock.currentPauseMs>=3000);
  }else{
    pauseBanner.classList.remove("critical");
  }
  const overlay=document.getElementById("pauseAlarmOverlay");
  const over=tvMode&&connected&&paused&&clock.currentPauseMs>=10000;
  overlay.classList.toggle("active",over);
  if(over&&audioReady&&interruptionAlarmKey!==s.pauseId){
    interruptionAlarmKey=s.pauseId;
    soundNotice("ซีพีอาร์ ต่อ",true);
  }
  document.getElementById("ccfSummary").hidden=!(s.phase==="rosc"&&clock.ccf!==null);
}
function renderVentilation(s,clock) {
  const show=["running","paused"].includes(s.phase);
  const tv=document.getElementById("ventilator"),mobile=document.getElementById("controllerVent");
  tv.hidden=mobile.hidden=!show;
  if(!show)return;
  const paused=s.phase==="paused";
  document.getElementById("ventMode").textContent=s.advancedAirway?"ET-TUBE":"30:2";
  document.getElementById("ventRatio").hidden=s.advancedAirway;
  document.getElementById("bagIcon").hidden=!s.advancedAirway;
  document.getElementById("maskIcon").hidden=s.advancedAirway;
  let number,label,mobileLabel,squeeze=false;
  if(s.advancedAirway){
    number=Math.max(1,Math.ceil((6000-clock.ventMs%6000)/1000));
    squeeze=!paused && number===1;
    label=squeeze?"SQUEEZE BAG • 1 SECOND":"NEXT BREATH IN";
    mobileLabel=squeeze?"SQUEEZE BAG":"NEXT BREATH";
  }else{
    const coach=maskCoach(s,paused?s.pausedAt:Date.now());
    number=coach.breath?coach.breath+"/2":coach.count+"/30";
    squeeze=!paused&&coach.squeeze;
    label=coach.breath?(coach.squeeze?"MASK • BREATH "+coach.breath+"/2"+" • 1.5 s":"RELEASE MASK BAG • 0.5 s"):"COMPRESSIONS • 30:2";
    mobileLabel=coach.breath?(coach.squeeze?"BREATH "+coach.breath+"/2":"RELEASE"):"COMPRESSIONS";
  }
  if(paused){label=mobileLabel="CPR PAUSED";}
  document.querySelectorAll('[data-bind="ventTime"]').forEach(el=>{el.textContent=String(number);});
  tv.classList.toggle("squeeze",squeeze);mobile.classList.toggle("squeeze",squeeze);
  tv.classList.toggle("mask-coach",!s.advancedAirway);
  document.getElementById("ventLabel").textContent=label;
  document.getElementById("controllerVentLabel").textContent=mobileLabel;
}
function renderEtco2Prompt(s) {
  const card=document.getElementById("co2Stat");
  const heading=document.getElementById("co2Heading");
  const prompt=document.getElementById("co2StateMessage");
  const normalValue=document.getElementById("co2Value");
  const overlay=document.getElementById("co2AttachOverlay");
  const waiting=s.advancedAirway && s.etco2===null &&
    ["running","paused"].includes(s.phase);
  const noTube=!s.advancedAirway;
  card.classList.toggle("ambu-coach",noTube);
  card.classList.toggle("co2-awaiting",waiting);
  heading.textContent=noTube?"AMBU 30:2":waiting?"EtCO₂ MONITOR":"EtCO₂";
  prompt.hidden=!(noTube||waiting);
  normalValue.hidden=noTube||waiting;
  if(noTube)prompt.textContent="30 COMPRESSIONS · 2 BREATHS";
  else if(waiting)prompt.textContent="ATTACH CO₂ MONITOR";
  overlay.hidden=!(tvMode&&waiting);
}
function renderAirwayAndRhythm(s) {
  const active=["running","paused"].includes(s.phase);
  document.getElementById("etTubeBtn").hidden=s.advancedAirway;
  document.getElementById("etco2Form").hidden=!s.advancedAirway;
  document.getElementById("peaWidthPicker").hidden=!(active && s.rhythm==="PEA");
  document.getElementById("rhythmWarning").hidden=!(active && s.rhythm==="—");
  document.querySelectorAll(".rhythm-button").forEach(btn=>
    btn.classList.toggle("selected",active && btn.dataset.value===s.rhythm));
  document.querySelectorAll(".pea-width-buttons button").forEach(btn=>
    btn.classList.toggle("selected",btn.dataset.value===s.peaWidth));
  const low=s.advancedAirway && s.etco2!==null && s.etco2<10 && active;
  document.getElementById("co2Warning").hidden=!low;
  document.getElementById("co2Stat").classList.toggle("low-co2",low);
}
function nextMedication(s,clock){
  const active=["running","paused"].includes(s.phase);
  if(!active)return "none";
  const epiEligible=s.fromNonShockable || (SHOCKABLE_RHYTHMS.has(s.rhythm) && s.shock>=2);
  const epiAvailable=epiEligible &&
    (s.lastEpiAt===null || clock.epiMs>=EPI_COOLDOWN_MS);
  const amio=amiodaroneStatus(s);
  // One slot only: Epi at shock 2 (or first nonshockable), then
  // an eligible antiarrhythmic when appropriate. Later Epi reminders
  // take precedence at 5 minutes since the most recent Epi.
  const overdueEpi=epiAvailable && s.lastEpiAt!==null && clock.epiMs>=FIVE_MIN;
  if(overdueEpi)return "epi";
  if(amio.available && (s.epi>0 || !epiAvailable))return "amio";
  if(epiAvailable)return "epi";
  if(amio.available)return "amio";
  if(amio.prepare)return "prepare";
  return "none";
}
function roscSelectionAvailable(s){
  return ["running","paused"].includes(s.phase) && !s.shockFlow &&
    (s.rhythm==="—" ||
      (s.phase==="paused" && s.pauseReason==="cycle" && !s.pauseRhythmRecorded));
}
function renderCauseTools(s){
  if(tvMode)return;
  const active=["running","paused"].includes(s.phase);
  const nonshock=active && ["PEA","Asystole"].includes(s.rhythm);
  if(!active)bicarbPickerOpen=false;
  if(!nonshock){causeToolsOpen=false;causeTab="pocus";}
  const tool=document.getElementById("nonShockTools");
  tool.hidden=!nonshock;
  document.getElementById("causeToolsPanel").hidden=!nonshock||!causeToolsOpen;
  const toggle=document.getElementById("causeToolsToggle");
  toggle.disabled=!connected || !nonshock;
  toggle.setAttribute("aria-expanded",String(nonshock && causeToolsOpen));
  document.querySelectorAll("[data-cause-tab]").forEach(btn=>{
    btn.classList.toggle("selected",btn.dataset.causeTab===causeTab);
  });
  document.querySelectorAll("[data-cause-pane]").forEach(pane=>{
    pane.hidden=pane.dataset.causePane!==causeTab;
  });
  document.querySelectorAll(".cause-check").forEach(btn=>{
    btn.classList.toggle("selected",!!s.findings[btn.dataset.value]);
    btn.disabled=!connected || !nonshock ||
      (btn.dataset.value.startsWith("pea:")&&s.rhythm!=="PEA") ||
      actionCooldownRemaining(s,"finding",Date.now(),btn.dataset.value)>0 ||
      pendingActions.has("finding");
    btn.setAttribute("aria-pressed",String(!!s.findings[btn.dataset.value]));
  });
  document.querySelectorAll(".trauma-procedure-grid button").forEach(btn=>{
    const done=!!s.procedures[btn.dataset.value];
    btn.disabled=!connected || !nonshock || done ||
      pendingActions.has("procedure");
    btn.classList.toggle("selected",done);
    btn.textContent=(PROCEDURE_NAMES[btn.dataset.value]||"ICD")+(done?" ✓":"");
  });
  const picker=document.getElementById("bicarbDosePicker");
  picker.hidden=!active||!bicarbPickerOpen;
  document.getElementById("bicarbToggle").disabled=!connected||!active;
}
function renderReportDashboard(s,clock){
  if(tvMode||s.phase!=="rosc")return;
  const set=(id,val)=>{document.getElementById(id).textContent=String(val);};
  set("dashEpisodes",s.episode);
  set("dashShock",s.shock);
  set("dashEpi",s.epi);
  set("dashAmio",s.amioDoses.length);
  set("dashCcf",clock.ccf===null?"—":clock.ccf.toFixed(1)+"%");
  set("dashCaseTime",timeText(clock.totalMs));
  set("dashCprTime",timeText(clock.arrestMs));
  set("dashPauseTime",timeText(clock.pauseMs));
  const percent=clock.ccf===null?0:Math.min(100,Math.max(0,clock.ccf));
  document.getElementById("dashCcfRing").style.background=
    "conic-gradient(#20ba94 0% "+percent+"%, #cc5369 "+percent+"% 100%)";
  const count={VF:0,VT:0,PEA:0,Asystole:0};
  for(const record of s.timeline){
    if(!record.label.startsWith("RHYTHM: "))continue;
    const rhythm=record.label.slice(8).trim();
    if(rhythm==="pVT")count.VT++;
    else if(Object.prototype.hasOwnProperty.call(count,rhythm))count[rhythm]++;
  }
  const max=Math.max(1,...Object.values(count));
  document.querySelectorAll("[data-dash-bar]").forEach(bar=>{
    const key=bar.dataset.dashBar;
    bar.style.width=(100*(count[key]||0)/max)+"%";
  });
  document.querySelectorAll("[data-dash-count]").forEach(el=>{
    el.textContent=count[el.dataset.dashCount]||0;
  });
  const records=[];
  const amps=(s.adjunctCounts.nahco3_1||0)+2*(s.adjunctCounts.nahco3_2||0)+(s.adjunctCounts.nahco3||0);
  if(amps)records.push(["7.5% NaHCO₃",amps+" amp"]);
  for(const [key,label]of [["prc","PRC"],["calcium","Calcium"],["glucose","Glucose"],["lidocaine","Lidocaine"]]){
    if(s.adjunctCounts[key])records.push([label,key==="prc"?s.adjunctCounts[key]+" unit":s.adjunctCounts[key]+" records"]);
  }
  const procedures=s.timeline.filter(e=>e.label==="ICD Lt"||e.label==="ICD Rt");
  if(procedures.length)records.push(["ICD",procedures.map(e=>e.label.replace("ICD ","")).join(", ")]);
  const pocus=s.timeline.filter(e=>e.label.startsWith("CHECKED: ")||e.label.startsWith("UNCHECKED: "));
  if(pocus.length)records.push(["POCUS / LAB / TRAUMA",pocus.length+" checklist updates"]);
  const list=document.getElementById("dashTreatmentSummary");
  list.replaceChildren();
  if(!records.length){
    const empty=document.createElement("span");empty.textContent="No additional records";list.append(empty);
  }else{
    for(const [label,value]of records){
      const entry=document.createElement("div");
      const name=document.createElement("span");name.textContent=label;
      const qty=document.createElement("strong");qty.textContent=value;
      entry.append(name,qty);list.append(entry);
    }
  }
}
function renderControllerStage(s) {
  if(tvMode)return;
  if(roscReviewOpen && !roscSelectionAvailable(s))roscReviewOpen=false;
  const cyclePaused=s.phase==="paused" && s.pauseReason==="cycle";
  const choosing=["running","paused"].includes(s.phase) && s.rhythm==="—";
  const flow=s.shockFlow;
  if(s.phase==="rosc" || s.phase==="standby")roscReviewOpen=false;
  if(s.phase!=="rosc")dashboardOpen=false;
  const stage=s.phase==="rosc"?(dashboardOpen?"dashboard":"reArrest"):
    s.phase==="standby"?"start":
    roscReviewOpen?"roscReview":
    flow==="decision"?"decision":
    flow==="charging"?"charging":
    flow==="readyShock"?"shock":
    flow==="postShock"?"resume":
    cyclePaused?(s.pauseRhythmRecorded?"resume":"rhythm"):
    choosing?"rhythm":"normal";
  for(const item of ["start","rhythm","normal","resume","decision","charging","shock","roscReview","reArrest","dashboard"]){
    document.body.classList.toggle("remote-stage-"+item,stage===item);
  }
  document.getElementById("onboardingStage").hidden=stage==="normal";
  for(const [screen,kind] of [
    ["stageStartScreen","start"],["stageRhythmScreen","rhythm"],
    ["stageShockDecisionScreen","decision"],["stageChargingScreen","charging"],
    ["stageShockScreen","shock"],["stageResumeScreen","resume"],
    ["stageRoscReviewScreen","roscReview"],["stageReArrestScreen","reArrest"],
    ["stageDashboardScreen","dashboard"]
  ])document.getElementById(screen).hidden=stage!==kind;
  document.getElementById("stageRoscPdfBtn").disabled=stage!=="reArrest";
  document.getElementById("stageDashboardBtn").disabled=stage!=="reArrest";
  document.getElementById("stageDashboardPdfBtn").disabled=stage!=="dashboard";
  document.getElementById("stageDashboardBackBtn").disabled=stage!=="dashboard";
  if(stage==="dashboard")renderReportDashboard(s,elapsedFor(s,Date.now()));
  const rhythmRosc=document.getElementById("stageRoscPromptBtn");
  rhythmRosc.disabled=!connected || stage!=="rhythm";
  document.getElementById("stageRoscConfirmBtn").disabled=
    !connected || stage!=="roscReview" || pendingActions.has("rosc") ||
    actionCooldownRemaining(s,"rosc",Date.now())>0;
  document.getElementById("stageReArrestBtn").disabled=
    !connected || stage!=="reArrest" || pendingActions.has("start") ||
    actionCooldownRemaining(s,"start",Date.now())>0;
  document.getElementById("stageRhythmHeading").textContent=cyclePaused?
    "IDENTIFY RHYTHM":"SELECT RHYTHM";
  document.getElementById("stageRhythmClock").textContent=cyclePaused?
    "CPR PAUSED • SELECT RHYTHM":"CPR TIMER IS RUNNING";
  const clearTimer=["readyShock","postShock"].includes(flow);
  const clockBase=clearTimer?s.clearAt:s.pausedAt;
  const clearMs=clearTimer&&clockBase!==null?Math.max(0,Date.now()-clockBase):0;
  const pauseMs=s.phase==="paused"&&s.pausedAt!==null?
    Math.max(0,Date.now()-s.pausedAt):0;
  const countdown=clearTimer?clearMs:pauseMs;
  const elapsedText="HANDS-OFF "+(pauseMs/1000).toFixed(1)+" s";
  document.getElementById("stageResumeCountdown").textContent=
    (Math.max(0,3000-countdown)/1000).toFixed(1)+" s";
  document.getElementById("stageResumeElapsed").textContent=elapsedText;
  document.getElementById("stageResumeTimerTitle").textContent=clearTimer?
    "PAUSE SINCE CLEAR · 3-SECOND TARGET":"RHYTHM CHECK · 3-SECOND TARGET";
  document.getElementById("stageShockCountdown").textContent=
    (Math.max(0,3000-clearMs)/1000).toFixed(1)+" s";
  document.getElementById("stageShockElapsed").textContent=elapsedText;
  const resumeButton=document.getElementById("stageResumeBtn");
  resumeButton.classList.toggle("critical",countdown>=3000);
  resumeButton.disabled=!connected || s.phase!=="paused" ||
    (flow?flow!=="postShock":!cyclePaused || !s.pauseRhythmRecorded) ||
    pendingActions.has("resume") || actionCooldownRemaining(s,"resume",Date.now())>0;
  document.getElementById("shockButton").classList.toggle("critical",clearMs>=3000);
  document.getElementById("stageStartBtn").disabled=
    !connected || pendingActions.has("start");
  document.querySelectorAll(".stage-rhythm-button").forEach(btn=>{
    btn.disabled=!connected || pendingActions.has("rhythm") ||
      actionCooldownRemaining(s,"rhythm",Date.now())>0;
  });
  document.querySelectorAll('[data-action="charge"]').forEach(btn=>{
    btn.disabled=!connected || flow!=="decision" || pendingActions.has("charge");
  });
  document.querySelectorAll('[data-action="clear"]').forEach(btn=>{
    btn.disabled=!connected || !["decision","charging"].includes(flow) ||
      pendingActions.has("clear");
  });
}
function render() {
  const s=computeState();
  const clock=elapsedFor(s,Date.now());
  const cycleProgress=s.phase==="standby"?0:clock.cycleMs%TWO_MIN;
  const currentCycle=s.phase==="standby"?TWO_MIN:cycleProgress===0?TWO_MIN:TWO_MIN-cycleProgress;
  const cue=medicationCue(s,clock);
  const values={
    phase:s.phase==="running"?"CPR ACTIVE":s.phase==="paused"?"CPR PAUSED":
      s.phase==="rosc"?"ROSC — MONITORING":"STANDBY",
    cycle:timeText(currentCycle),
    elapsed:timeText(clock.totalMs),
    epiTime:s.lastEpiAt===null?"NO NEED":timeText(clock.epiMs),
    epiReminder:s.lastEpiAt===null?"FIRST DOSE NOT RECORDED":
      clock.epiMs>=280000?"EPINEPHRINE DUE SOON / DUE":
      clock.epiMs>=240000?"4 MIN • READY":"SINCE LAST DOSE",
    shock:s.shock,epi:s.epi,rhythm:s.rhythm==="PEA"&&s.peaWidth?"PEA / "+s.peaWidth.toUpperCase():s.rhythm==="VT"?"pVT":s.rhythm,etco2:s.etco2===null?"—":s.etco2,
    episode:s.episode,ccf:clock.ccf===null?"—":clock.ccf.toFixed(1)+"%",
    pauseTotal:timeText(clock.pauseMs),room
  };
  for (const [key,val] of Object.entries(values)) {
    document.querySelectorAll('[data-bind="'+key+'"]').forEach(n=>{
      if (n.textContent!==String(val)) n.textContent=val;
    });
  }
  document.getElementById("epiReminderTitle").textContent=
    s.lastEpiAt===null?"ADRENALINE":"ADRENALINE TIMER";
  document.getElementById("amio300Badge").classList.toggle("administered",s.amioDoses.includes(300));
  document.getElementById("amio150Badge").classList.toggle("administered",s.amioDoses.includes(150));
  document.getElementById("roscChecklist").hidden=s.phase!=="rosc";
  document.getElementById("roscChecklistMobile").hidden=s.phase!=="rosc";
  document.querySelector(".live-label").className="live-label"+
    (s.phase==="running"?" active":s.phase==="paused"?" paused":"");
  const log=document.getElementById("timeline");
  const events=s.timeline.slice(-12).reverse();
  const signature=events.map(e=>e.id).join("|");
  if (log.dataset.signature!==signature) {
    log.dataset.signature=signature;
    log.replaceChildren();
    if (!events.length) {
      const li=document.createElement("li");
      li.className="empty";li.textContent="ยังไม่มีเหตุการณ์";log.append(li);
    } else {
      for (const e of events) {
        const li=document.createElement("li");
        const t=document.createElement("span");
        t.className="event-time";
        t.textContent=new Date(e.ts).toLocaleTimeString("th-TH",{hour12:false});
        const label=document.createElement("span");
        label.textContent=e.label;
        li.append(t,label);log.append(li);
      }
    }
  }
  for (const btn of document.querySelectorAll("[data-action]")) {
    const action=btn.dataset.action;
    const active=["running","paused"].includes(s.phase);
    btn.disabled=!connected ||
      (action==="start" && !["standby","rosc"].includes(s.phase)) ||
      (action==="pause" && s.phase!=="running") ||
      (action==="resume" && s.phase!=="paused") ||
      (action==="reset" && s.phase==="standby") ||
      (action==="rosc" && !active) ||
      (["shock","epi","rhythm"].includes(action) && !active) ||
      (action==="peaWidth" && (!active || s.rhythm!=="PEA")) ||
      (action==="etTube" && (!active || s.advancedAirway)) ||
      (action!=="shock" && actionCooldownRemaining(s,action,Date.now())>0) ||
      pendingActions.has(action);
  }
  const shockButton=document.getElementById("shockButton");
  const shockHint=document.getElementById("shockCooldownHint");
  const shockRemaining=s.lastShockAt===null?0:
    Math.min(SHOCK_COOLDOWN_MS,Math.max(0,s.lastShockAt+SHOCK_COOLDOWN_MS-Date.now()));
  const shockLocked=shockRemaining>0;
  const freshShockable=SHOCKABLE_RHYTHMS.has(s.rhythm) &&
    s.lastRhythmEventId!==null && s.lastRhythmEventId!==s.lastShockRhythmEventId;
  const arrestActive=["running","paused"].includes(s.phase);
  shockButton.disabled=!connected || s.phase!=="paused" ||
    s.shockFlow!=="readyShock" || shockLocked || pendingShock || !freshShockable;
  shockButton.classList.toggle("cooldown-locked",shockLocked || pendingShock);
  if(shockLocked){
    const seconds=Math.ceil(shockRemaining/1000);
    const remainingText=fmt(Math.floor(seconds/60))+":"+fmt(seconds%60);
    shockButton.textContent=remainingText;
    shockHint.hidden=true; // No duplicate cooldown message below the button.
  }else if(pendingShock){
    shockButton.textContent="⚡ SAVING SHOCK…";
    shockHint.textContent="กำลังบันทึก Shock";
    shockHint.hidden=false;
  }else if(arrestActive && !freshShockable){
    shockButton.textContent="⚡ SHOCK";
    shockHint.textContent=SHOCKABLE_RHYTHMS.has(s.rhythm)?
      "บันทึก VF / pVT อีกครั้งก่อน Shock ทุกครั้ง":
      "ต้องเลือกและยืนยัน Rhythm เป็น VF หรือ pVT ก่อน Shock";
    shockHint.hidden=false;
  }else{
    shockButton.textContent="⚡ SHOCK";
    shockHint.hidden=true;
  }
  const pauseResume=document.getElementById("pauseResumeBtn");
  const resume=s.phase==="paused";
  pauseResume.dataset.action=resume?"resume":"pause";
  pauseResume.textContent=resume?"▶ RESUME CPR":"Ⅱ PAUSE CPR";
  pauseResume.classList.toggle("resume-flash",resume);
  pauseResume.disabled=!connected || !!s.shockFlow ||
    !["running","paused"].includes(s.phase) ||
    actionCooldownRemaining(s,resume?"resume":"pause",Date.now())>0 ||
    pendingActions.has(resume?"resume":"pause");
  const metro=document.getElementById("toggleMetronome");
  metro.classList.toggle("active",s.metronomeOn);
  metro.setAttribute("aria-pressed",String(s.metronomeOn));
  metro.textContent="🎵 105 BPM "+(s.metronomeOn?"ON":"OFF");
  const medication=nextMedication(s,clock);
  const epiControl=document.getElementById("epiControl");
  epiControl.hidden=medication==="none" || !arrestActive;
  const epiButton=document.getElementById("epiButton");
  const amioButton=document.getElementById("amioButton");
  epiButton.hidden=medication!=="epi";
  amioButton.hidden=!["amio","prepare"].includes(medication);
  const epiLockMs=actionCooldownRemaining(s,"epi",Date.now());
  const epiLocked=epiLockMs>0;
  epiButton.disabled=!connected || !arrestActive || epiLocked ||
    pendingActions.has("epi") || medication!=="epi";
  const epiState=epiColor(s,clock);
  epiButton.classList.toggle("epi-highlight",epiState==="green" && !epiLocked);
  epiButton.classList.toggle("epi-muted",epiState==="neutral" || epiLocked);
  epiButton.classList.toggle("epi-urgent",epiState==="red" && !epiLocked);
  document.getElementById("epiStat").classList.toggle("due",epiState==="red");
  document.getElementById("epiStat").classList.toggle("epi-green",epiState==="green");
  document.getElementById("epiCountHalf").classList.toggle("epi-urgent",epiState==="red");
  document.getElementById("epiCountHalf").classList.toggle("epi-green",epiState==="green");
  const epiHint=document.getElementById("epiLockHint");
  epiHint.hidden=true;
  epiButton.classList.toggle("epi-locked",epiLocked);
  epiButton.textContent="❤️ EPINEPHRINE";
  const amio=amiodaroneStatus(s);
  amioButton.textContent=medication==="prepare"?
    "💉 เตรียม AMIODARONE "+amio.dose+" mg":
    "💉 AMIODARONE "+amio.dose+" mg";
  // Both doses share one highlighted style whenever documentation is enabled.
  amioButton.classList.toggle("amio-highlight",amio.recommended);
  amioButton.classList.toggle("amio-prepare",medication==="prepare");
  amioButton.classList.toggle("amio-muted",!amio.recommended && medication!=="prepare");
  amioButton.disabled=!connected || medication!=="amio" || !arrestActive ||
    actionCooldownRemaining(s,"amio",Date.now())>0 || pendingActions.has("amio");
  document.querySelectorAll('.adjunct-buttons [data-action="adjunct"]').forEach(btn=>{
    btn.disabled=!connected || !arrestActive ||
      actionCooldownRemaining(s,"adjunct",Date.now(),btn.dataset.value)>0 ||
      pendingActions.has("adjunct");
  });
  document.getElementById("clinicalCue").textContent=cue.cue+
    (s.phase==="rosc" && clock.ccf!==null?" • DOCUMENTED CCF "+clock.ccf.toFixed(1)+"%":"");
  document.getElementById("drugHint").textContent=cue.cue+
    " • ปุ่ม Amiodarone บันทึกการให้ยาจริง ไม่ได้สั่งให้ยาอัตโนมัติ";
  const entry=document.getElementById("etco2Input");
  const submit=document.getElementById("etco2Submit");
  entry.disabled=!connected || !s.advancedAirway || s.phase==="standby";
  submit.disabled=entry.disabled || actionCooldownRemaining(s,"etco2",Date.now())>0 || pendingActions.has("etco2");
  // TV HTML retains its hidden legacy controller button; the Remote has no
  // ordinary-screen START/ROSC control, only stage-specific buttons.
  const legacyStartButton=document.getElementById("startButton");
  if(legacyStartButton){
    legacyStartButton.hidden=true;
    legacyStartButton.disabled=true;
  }
  const hint=document.getElementById("connectionHint");
  hint.textContent=!connected?"OFFLINE — ข้อมูล/เสียงเตือนอาจไม่ล่าสุด":
    s.phase==="standby"?"ONLINE — รอ Start CPR จาก Controller":
    s.phase==="rosc"?"ONLINE — ROSC • TOTAL CASE TIME STILL RUNNING":
    s.phase==="paused"?"ONLINE — COMPRESSIONS INTERRUPTED • CLOCK CONTINUES":"ONLINE — REALTIME CPR SESSION";
  renderControllerStage(s);
  renderCauseTools(s);
  renderAirwayAndRhythm(s);
  renderVentilation(s,clock);
  renderECG(s);
  renderEtco2Prompt(s);
  renderInterruption(s,clock);
  checkAlarms(s,clock);
  // Only the active Controller initiates an automatic log entry at the end of
  // the 2-minute cycle. Re-check phase and network guard inside handleAction.
  if(!tvMode && connected && s.phase==="running" && s.rhythm!=="—" &&
     !s.shockFlow && clock.cycleMs>=TWO_MIN && !pendingActions.has("pause")){
    void handleAction("pause","cycle");
  }
  if(!tvMode){
    document.getElementById("exportPdfBtn").disabled=s.timeline.length===0;
  }
  updateMetronome(s);
}
function status(value) {
  connected=value==="connected";
  const el=document.getElementById("connectionStatus");
  el.className="connection "+(connected?"on":value==="connecting"?"wait":"off");
  el.textContent=connected?"● CONNECTED":value==="connecting"?"● CONNECTING":"● DISCONNECTED";
  render();
}
function validEvent(obj) {
  if (!obj || typeof obj!=="object" || typeof obj.id!=="string" ||
    obj.id.length>110 || !ACTIONS.has(obj.type) ||
    !Number.isFinite(obj.ts) || Math.abs(Date.now()-obj.ts)>86400000 ||
    !Number.isSafeInteger(obj.seq) || obj.seq<1 || messages.has(obj.id)) return false;
  if (obj.type==="rhythm" && !["VF","VT","PEA","Asystole"].includes(obj.value))return false;
  if (obj.type==="peaWidth" && !["Narrow","Wide"].includes(obj.value))return false;
  if (obj.type==="metro" && typeof obj.value!=="boolean")return false;
  if (obj.type==="amio" && obj.value!==300 && obj.value!==150)return false;
  if (obj.type==="adjunct" && !ADJUNCT_NAMES[obj.value])return false;
  if (obj.type==="finding" && !FINDING_LABELS[obj.value])return false;
  if (obj.type==="procedure" && !PROCEDURE_NAMES[obj.value])return false;
  if (obj.type==="etco2" && (!Number.isInteger(obj.value)||obj.value<0||obj.value>150)) return false;
  return true;
}
function acceptEvent(obj,live=false) {
  if (!validEvent(obj)) return false;
  if (messages.size>=1000) {
    const first=chronological()[0];
    if (first)messages.delete(first.id);
  }
  const e={id:obj.id,type:obj.type,ts:obj.ts,seq:obj.seq,value:obj.value};
  messages.set(e.id,e);
  const s=computeState();
  if (live && (e.type==="reset" || s.timeline.some(x=>x.id===e.id)))announceEvent(e,s);
  render();
  return true;
}
async function transmit(event,payload) {
  if (!connected || !channel)throw new Error("ยังไม่ได้เชื่อมต่อ Realtime");
  const result=await channel.send({type:"broadcast",event,payload});
  if (result!=="ok")throw new Error("Broadcast failed: "+result);
}
function requestSync() {
  transmit("sync-request",{from:DEVICE_ID,at:Date.now()})
    .catch(err=>console.warn("Sync request",err));
}
async function handleAction(type,value) {
  if (!connected || tvMode)return;
  const s=computeState();
  if (type==="start" && !["standby","rosc"].includes(s.phase))return;
  if (type==="pause" && s.phase!=="running")return;
  if (type==="resume" && s.phase!=="paused")return;
  if(type==="resume" && s.pauseReason==="cycle" && !s.pauseRhythmRecorded)return;
  if(type==="resume" && s.shockFlow && s.shockFlow!=="postShock")return;
  if(type==="charge" && s.shockFlow!=="decision")return;
  if(type==="clear" && !["decision","charging"].includes(s.shockFlow))return;
  if(type==="adjunct" && (!["running","paused"].includes(s.phase) || !ADJUNCT_NAMES[value]))return;
  if(type==="finding" && (!["running","paused"].includes(s.phase) ||
      !["PEA","Asystole"].includes(s.rhythm) || !FINDING_LABELS[value]))return;
  if(type==="procedure" && (!["running","paused"].includes(s.phase) ||
      !["PEA","Asystole"].includes(s.rhythm) || !PROCEDURE_NAMES[value] ||
      s.procedures[value]))return;
  if (type==="rosc" && !["running","paused"].includes(s.phase))return;
  if (type==="reset" && s.phase==="standby")return;
  if (["shock","epi","rhythm","peaWidth","etTube"].includes(type) && !["running","paused"].includes(s.phase))return;
  if(type==="shock"){
    if(pendingShock || s.phase!=="paused" || s.shockFlow!=="readyShock" ||
      !SHOCKABLE_RHYTHMS.has(s.rhythm) ||
      s.lastRhythmEventId===null ||
      s.lastRhythmEventId===s.lastShockRhythmEventId ||
      actionCooldownRemaining(s,"shock",Date.now())>0)return;
  }
  if(type!=="shock" && actionCooldownRemaining(s,type,Date.now(),value)>0)return;
  if(type==="epi" && nextMedication(s,elapsedFor(s,Date.now()))!=="epi")return;
  if(type==="amio" && nextMedication(s,elapsedFor(s,Date.now()))!=="amio")return;
  if(pendingActions.has(type))return;
  if (type==="peaWidth" && s.rhythm!=="PEA")return;
  if (type==="etTube" && s.advancedAirway)return;
  if (type==="metro")value=!s.metronomeOn;
  if (type==="etco2" && (!s.advancedAirway || s.phase==="standby"))return;
  if(type==="amio"){
    if(!["VF","VT"].includes(s.rhythm) || !["running","paused"].includes(s.phase) ||
      s.amioDoses.length>=2)return;
    const next=s.amioDoses.length===0?300:150;
    if(s.shock<amiodaroneMinimumShock(s,next))return;
    // This prototype permits logging a second 150 mg dose at Shock #4
    // by project-specific choice. The button logs a dose, not a recommendation.
    value=next;
  }
  const e={id:DEVICE_ID+"-"+(++sequence),type,ts:Date.now(),seq:sequence,value};
  pendingActions.add(type); // Lock synchronously before network await.
  if(type==="shock")pendingShock=true;
  render();
  try {
    await transmit("cpr-event",e);
    acceptEvent(e,true); // TV only speaks; controller stays silent.
  } catch(err) {
    alert("ส่งคำสั่งไม่สำเร็จ กรุณาตรวจการเชื่อมต่อ: "+err.message);
    status("offline");
  } finally {
    pendingActions.delete(type);
    if(type==="shock")pendingShock=false;
    render();
  }
}
function setupChannel() {
  if (!supabase)return;
  status("connecting");
  channel=supabase.channel("cpr-demo-"+room,{config:{private:false,broadcast:{ack:true,self:false}}});
  channel
    .on("broadcast",{event:"cpr-event"},({payload})=>acceptEvent(payload,true))
    .on("broadcast",{event:"sync-request"},({payload})=>{
      if (!payload || payload.from===DEVICE_ID || messages.size===0)return;
      transmit("sync-response",{
        to:payload.from,from:DEVICE_ID,events:chronological().slice(-800)
      }).catch(err=>console.warn("Sync response",err));
    })
    .on("broadcast",{event:"sync-response"},({payload})=>{
      if (!payload || payload.to!==DEVICE_ID || !Array.isArray(payload.events))return;
      for (const e of payload.events.slice(-800))acceptEvent(e,false);
    })
    .subscribe(s=>{
      if (s==="SUBSCRIBED") {
        status("connected");
        requestSync();
      } else if (["CHANNEL_ERROR","TIMED_OUT","CLOSED"].includes(s)) {
        status("offline");
      }
    });
}
async function enterRoom(value) {
  if (switchingRoom)return;
  switchingRoom=true;
  if (channel && supabase) {
    status("offline");
    await supabase.removeChannel(channel);
    channel=null;
  }
  room=roomClean(value);
  pendingShock=false;
  pendingActions.clear();
  roscReviewOpen=false;
  dashboardOpen=false;
  causeToolsOpen=false;
  bicarbPickerOpen=false;
  messages=new Map();
  nearAlarmKey=cycleEndKey=epiAlarmKey="";
  if ("speechSynthesis" in window)speechSynthesis.cancel();
  const newRoomInput=document.getElementById("roomInput");
  const newRoomLabel=document.getElementById("roomLabel");
  if(newRoomInput)newRoomInput.value=room;
  if(newRoomLabel)newRoomLabel.textContent=room;
  const url=new URL(location.href);
  url.searchParams.set("room",room);
  history.replaceState({},"",url.toString());
  if (supabase)setupChannel();
  render();
  switchingRoom=false;
}
function makeLink(view) {
  const base=new URL("./",location.href);
  const url=new URL(view==="tv"?"tv.html":"",base);
  url.searchParams.set("room",room);
  // Redundant mode flag makes it safe with browsers that cache earlier HTML.
  if(view==="tv")url.searchParams.set("view","tv");
  return url.toString();
}
async function copyLink(view) {
  const url=makeLink(view);
  try {
    await navigator.clipboard.writeText(url);
    alert("คัดลอกลิงก์เรียบร้อย:\n"+url);
  } catch {
    prompt("คัดลอกลิงก์นี้",url);
  }
}
async function shareTvLink(){
  const url=makeLink("tv");
  if(typeof navigator.share==="function"){
    try {
      await navigator.share({title:"CPR Live TV Display",text:"CPR Live — TV Display",url});
      return;
    }catch(e){
      if(e && e.name==="AbortError")return;
      // Share is unavailable in this browser context; fall back to copy.
    }
  }
  await copyLink("tv");
}
// Expand the TV dashboard within its page automatically. True browser fullscreen
// normally requires a direct local user interaction (browser security restriction).
function requestTvFullscreen() {
  if(!tvMode || document.fullscreenElement || document.webkitFullscreenElement)return;
  const root=document.documentElement;
  if(!root)return;
  const go=root.requestFullscreen||root.webkitRequestFullscreen||root.msRequestFullscreen;
  if(!go)return;
  try {
    const promise=go.call(root,{navigationUI:"hide"});
    if(promise && typeof promise.catch==="function")promise.catch(()=>{
      // Browser denied automatic fullscreen; use F11/kiosk mode, or touch TV once.
    });
  } catch(err){ /* TV browser may not implement fullscreen API */ }
}
if(tvMode){
  initTVAudio();
  requestTvFullscreen(); // Works only if the browser grants activation-free fullscreen.
  const firstInteraction=()=>{
    requestTvFullscreen();
    initTVAudio();
  };
  document.addEventListener("pointerdown",firstInteraction,{passive:true});
  document.addEventListener("keydown",firstInteraction);
  document.addEventListener("click",firstInteraction);
  document.addEventListener("visibilitychange",()=>{
    if(!document.hidden)initTVAudio();
  });
}

// Report is generated locally on the Controller. Patient sticker area stays blank:
// do NOT transmit, collect, cache or upload patient names, HN or stickers.
let pdfLibraryPromise=null;
function loadPdfLibrary(){
  if(window.html2pdf)return Promise.resolve(window.html2pdf);
  if(pdfLibraryPromise)return pdfLibraryPromise;
  pdfLibraryPromise=new Promise((resolve,reject)=>{
    const script=document.createElement("script");
    script.src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
    script.async=true;
    script.onload=()=>window.html2pdf?resolve(window.html2pdf):reject(new Error("PDF library failed to load"));
    script.onerror=()=>reject(new Error("Cannot load PDF library; offline or blocked CDN"));
    document.head.append(script);
  });
  return pdfLibraryPromise.catch(err=>{pdfLibraryPromise=null;throw err;});
}
function reportCell(textValue,styles={}){
  const el=document.createElement("td");
  el.textContent=String(textValue);
  Object.assign(el.style,styles);
  return el;
}
function reportText(tag,value,cssText){
  const node=document.createElement(tag);
  node.textContent=String(value);
  node.style.cssText=cssText||"";
  return node;
}
function buildReportElement(s){
  const root=document.createElement("div");
  root.className="report-export";
  root.setAttribute("aria-label","CPR Timeline Report");
  // The export root itself stays position:static; only its mount is offscreen.
  // html2pdf clones the root, so it must not inherit a negative left coordinate.
  root.style.cssText="position:static;width:190mm;background:#fff;color:#122137;padding:4mm;font:12px/1.45 -apple-system,BlinkMacSystemFont,'Noto Sans Thai',Tahoma,sans-serif;box-sizing:border-box;";
  const head=document.createElement("div");
  head.style.cssText="display:flex;align-items:stretch;justify-content:space-between;gap:6mm;border-bottom:2px solid #16314b;padding-bottom:4mm;margin-bottom:5mm;page-break-inside:avoid;";
  const left=document.createElement("div");
  left.style.cssText="flex:1;min-width:0;";
  left.append(reportText("h1","CPR LIVE — TIMELINE REPORT","margin:0 0 2mm;font-size:19px;line-height:1.2;color:#153b59;font-weight:800;"));
  left.append(reportText("p","Generated: "+new Date().toLocaleString("th-TH",{hour12:false}),
    "margin:2px 0;font-size:11px;"));
  left.append(reportText("p","Room: "+room+"  |  Mode: SIMULATION",
    "margin:2px 0;font-size:11px;"));
  left.append(reportText("p","No patient information is stored or transmitted by this report feature.",
    "margin:4px 0 0;font-size:9px;color:#646f7d;"));
  const sticker=document.createElement("div");
  sticker.style.cssText="flex:0 0 77mm;width:77mm;height:36mm;border:1.5px solid #536b83;border-radius:4px;display:flex;align-items:center;justify-content:center;text-align:center;padding:3mm;box-sizing:border-box;";
  sticker.append(reportText("div","PATIENT LABEL\nติดสติกเกอร์ผู้ป่วยที่นี่",
    "font-size:12px;font-weight:700;color:#9aa9b9;white-space:pre-line;line-height:1.6;"));
  head.append(left,sticker);root.append(head);
  root.append(reportText("h2","SESSION SUMMARY",
    "font-size:13px;margin:3mm 0 2mm;color:#143451;"));
  const totals=elapsedFor(s,Date.now());
  const summary=document.createElement("div");
  summary.style.cssText="display:grid;grid-template-columns:repeat(3,1fr);gap:2mm;margin-bottom:5mm;page-break-inside:avoid;";
  const items=[
    ["START",s.firstStartAt?new Date(s.firstStartAt).toLocaleString("th-TH",{hour12:false}):"—"],
    ["TOTAL CASE TIME",timeText(totals.totalMs)],
    ["ACTIVE ARREST TIME",timeText(totals.arrestMs)],
    ["CCF (MANUAL PAUSES)",totals.ccf===null?"—":totals.ccf.toFixed(1)+"%"],
    ["HANDS-OFF TIME",timeText(totals.pauseMs)],
    ["COMPRESSION TIME",timeText(totals.compressionMs)],
    ["STATUS",s.phase.toUpperCase()],
    ["ARREST EPISODES",s.episode],
    ["SHOCKS",s.shock],
    ["EPINEPHRINE",s.epi],
    ["AMIODARONE",s.amioDoses.length?s.amioDoses.join(" + ")+" mg":"—"],
    ["LAST RHYTHM",s.rhythm==="PEA"&&s.peaWidth?"PEA ("+s.peaWidth+" QRS)":s.rhythm==="VT"?"pVT":s.rhythm],
    ["LAST CO₂",s.etco2===null?"—":s.etco2+" mmHg"]
  ];
  for(const [label,value] of items){
    const item=document.createElement("div");
    item.style.cssText="border:1px solid #d7e2eb;border-radius:4px;padding:2mm;min-height:15mm;box-sizing:border-box;overflow-wrap:anywhere;";
    item.append(reportText("div",label,"font-size:9px;color:#526e83;font-weight:750;letter-spacing:.025em;"));
    item.append(reportText("div",value,"font-size:12px;font-weight:750;margin-top:1mm;"));
    summary.append(item);
  }
  root.append(summary);
  root.append(reportText("h2","CHRONOLOGICAL EVENT LOG",
    "font-size:13px;margin:4mm 0 2mm;color:#143451;"));
  const table=document.createElement("table");
  table.style.cssText="width:100%;border-collapse:collapse;table-layout:fixed;font-size:10.5px;";
  const thead=document.createElement("thead");
  const trh=document.createElement("tr");
  for(const [title,width] of [["#","9%"],["CLOCK","22%"],["FROM START","20%"],["EVENT","49%"]]){
    const th=document.createElement("th");
    th.textContent=title;
    th.style.cssText="border-bottom:2px solid #1c4f77;background:#eaf2f9;text-align:left;padding:2mm 1.5mm;word-wrap:break-word;width:"+width+";";
    trh.append(th);
  }
  thead.append(trh);table.append(thead);
  const tbody=document.createElement("tbody");
  s.timeline.forEach((entry,index)=>{
    const tr=document.createElement("tr");
    tr.style.cssText="page-break-inside:avoid;break-inside:avoid;";
    const values=[
      index+1,
      new Date(entry.ts).toLocaleTimeString("th-TH",{hour12:false}),
      s.firstStartAt===null?"—":timeText(Math.max(0,entry.ts-s.firstStartAt)),
      entry.label
    ];
    for(let i=0;i<values.length;i++){
      const td=reportCell(values[i],{
        borderBottom:"1px solid #d9e3ed",
        padding:"2mm 1.5mm",
        color:i===3?"#20364b":"#506378",
        overflowWrap:"anywhere",
        verticalAlign:"top",
        background:index%2===1?"#f7f9fb":"#ffffff"
      });
      tr.append(td);
    }
    tbody.append(tr);
  });
  table.append(tbody);root.append(table);
  root.append(reportText("p","SIMULATION / DEVELOPMENT ONLY — NOT A VERIFIED MEDICAL RECORD. Events may be lost or duplicated if devices disconnect.",
    "font-size:9px;color:#9a4350;border-top:1px solid #d5dde5;padding-top:3mm;margin-top:6mm;"));
  return root;
}
async function exportTimelinePDF(){
  if(tvMode)return;
  const s=computeState();
  if(!s.timeline.length){
    alert("ยังไม่มี Timeline ให้สร้างรายงาน กรุณาเริ่ม CPR ก่อน");
    return;
  }
  const button=document.getElementById("exportPdfBtn");
  if(button.disabled)return;
  button.disabled=true;
  const oldText=button.textContent;
  button.textContent="กำลังสร้าง PDF…";
  const root=buildReportElement(s);
  const mount=document.createElement("div");
  mount.className="report-export-mount";
  mount.style.cssText="position:fixed;left:-11000px;top:0;width:190mm;z-index:-1;";
  mount.append(root);
  document.body.append(mount);
  let fallback=false;
  try{
    await loadPdfLibrary();
    if(!window.html2pdf)throw new Error("PDF library unavailable");
    const filename="CPR_Timeline_"+new Date().toISOString().slice(0,10)+".pdf";
    await window.html2pdf().set({
      margin:[8,10,8,10],
      filename,
      image:{type:"jpeg",quality:.98},
      html2canvas:{scale:2,backgroundColor:"#ffffff",useCORS:false,scrollY:0},
      jsPDF:{unit:"mm",format:"a4",orientation:"portrait"},
      pagebreak:{mode:["css","legacy"],avoid:["tr",".report-sticker"]}
    }).from(root).save();
  }catch(err){
    console.warn("PDF direct-download unavailable; using browser Print-to-PDF fallback",err);
    fallback=true;
    mount.style.position="static";
    mount.style.left="auto";
    mount.style.top="auto";
    mount.style.zIndex="auto";
    root.style.width="190mm";
    document.body.classList.add("printing-cpr-report");
    let cleaned=false;
    const cleanup=()=>{
      if(cleaned)return;
      cleaned=true;
      document.body.classList.remove("printing-cpr-report");
      mount.remove();
      button.disabled=false;
      button.textContent=oldText;
    };
    window.addEventListener("afterprint",cleanup,{once:true});
    alert("เปิดหน้าพิมพ์เพื่อเลือก Save as PDF / บันทึกเป็น PDF (อาจต้องเลือก Print หรือ Share บน iPhone)");
    window.print();
    // Some mobile browsers never fire afterprint.
    setTimeout(cleanup,60000);
  }finally{
    if(!fallback){
      mount.remove();
      button.disabled=false;
      button.textContent=oldText;
    }
  }
}

document.getElementById("exportPdfBtn").addEventListener("click",exportTimelinePDF);
const joinRoomBtn=document.getElementById("joinRoomBtn");
const editableRoomInput=document.getElementById("roomInput");
if(joinRoomBtn && editableRoomInput){
  joinRoomBtn.addEventListener("click",()=>enterRoom(editableRoomInput.value));
  editableRoomInput.addEventListener("keydown",e=>{
    if(e.key==="Enter")enterRoom(e.currentTarget.value);
  });
}
document.getElementById("copyTvLink").addEventListener("click",shareTvLink);
document.getElementById("copyControlLink").addEventListener("click",()=>copyLink("controller"));
// Review checklist locally first; only one tap on the Confirm button
// commits ROSC. No additional browser confirmation dialog.
if(!tvMode){
  document.getElementById("stageRoscPromptBtn").addEventListener("click",()=>{
    const s=computeState();
    if(!connected || !roscSelectionAvailable(s))return;
    roscReviewOpen=true;
    render();
  });
  document.getElementById("stageRoscBackBtn").addEventListener("click",()=>{
    roscReviewOpen=false;
    render();
  });
  document.getElementById("stageRoscConfirmBtn").addEventListener("click",()=>{
    const s=computeState();
    if(!roscReviewOpen || !connected || !roscSelectionAvailable(s))return;
    void handleAction("rosc");
  });
  document.getElementById("stageRoscPdfBtn").addEventListener("click",exportTimelinePDF);
  document.getElementById("stageDashboardPdfBtn").addEventListener("click",exportTimelinePDF);
  document.getElementById("stageDashboardBtn").addEventListener("click",()=>{
    if(computeState().phase!=="rosc")return;
    dashboardOpen=true;
    render();
  });
  document.getElementById("stageDashboardBackBtn").addEventListener("click",()=>{
    dashboardOpen=false;
    render();
  });
  document.getElementById("bicarbToggle").addEventListener("click",()=>{
    const s=computeState();
    if(!connected||!["running","paused"].includes(s.phase))return;
    bicarbPickerOpen=!bicarbPickerOpen;
    render();
  });
  document.getElementById("causeToolsToggle").addEventListener("click",()=>{
    const s=computeState();
    if(!connected||!["running","paused"].includes(s.phase)||
      !["PEA","Asystole"].includes(s.rhythm))return;
    causeToolsOpen=!causeToolsOpen;
    render();
  });
  document.querySelectorAll("[data-cause-tab]").forEach(btn=>btn.addEventListener("click",()=>{
    if(!causeToolsOpen)return;
    causeTab=btn.dataset.causeTab;
    render();
  }));
}
document.querySelectorAll("[data-action]").forEach(btn=>
  btn.addEventListener("click",()=>{
    const action=btn.dataset.action;
    if(action==="procedure" &&
      !confirm("ยืนยันว่าได้ทำ "+(PROCEDURE_NAMES[btn.dataset.value]||"ICD")+" แล้ว?"))return;
    if(action==="reset"){
      const state=computeState(),measurement=elapsedFor(state,Date.now());
      const fraction=measurement.ccf===null?"—":measurement.ccf.toFixed(1)+"%";
      if(!confirm("ยืนยัน RESET?\nEstimated CCF: "+fraction+
        "\nRecorded hands-off: "+timeText(measurement.pauseMs)+
        "\nกรุณา Export PDF ก่อนล้างข้อมูลทั้งหมด"))return;
    }
    // PAUSE CPR must be immediate: confirmation would add avoidable hands-off delay.
    if(action==="adjunct" && btn.dataset.value.startsWith("nahco3_"))bicarbPickerOpen=false;
    handleAction(action,btn.dataset.value);
  })
);
document.getElementById("etco2Form").addEventListener("submit",e=>{
  e.preventDefault();
  const val=document.getElementById("etco2Input").value.trim();
  if (!/^\d{1,3}$/.test(val))return;
  const n=Number(val);
  if (n>=0 && n<=150) {
    handleAction("etco2",n);
    document.getElementById("etco2Input").blur();
  }
});
window.addEventListener("online",()=>{
  if(supabase && connected)requestSync();
  if(tvMode)initTVAudio();
});
setInterval(render,250);
render();
const url=String(cfg.supabaseUrl||"").trim();
const key=String(cfg.supabaseKey||"").trim();
if (/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url) &&
  /^(sb_publishable_|eyJ)/.test(key)) {
  supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  setupChannel();
} else {
  document.getElementById("setupNotice").hidden=false;
  status("offline");
}
