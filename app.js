// CPR Live v1.0 — ephemeral Supabase Broadcast demonstration.
// No user authentication, server authority, or durable database.
// NOT for clinical treatment, medication decision support, or patient data.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.0?bundle";

const cfg = window.CPR_CONFIG || {};
const params = new URLSearchParams(location.search);
const tvMode = params.get("view") === "tv";
const DEVICE_ID = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random();
const ACTIONS = new Set(["start","pause","resume","reset","shock","epi","amio","rhythm","peaWidth","etTube","metro","rosc","etco2"]);
const TWO_MIN = 120000;
const FOUR_MIN = 240000;
const SHOCK_COOLDOWN_MS = 110000; // 1 min 50 seconds for duplicate SHOCK logs
const EPI_COOLDOWN_MS = 180000; // 3 minutes between documented Epi doses
const ACTION_COOLDOWN_MS = 5000; // per-button anti-double-tap for other actions
const FIVE_MIN = 300000;
const EPI_PREWARN_MS = 10000;
const SHOCKABLE_RHYTHMS = new Set(["VF","VT"]);
function actionGroup(type){ return type; }
function actionCooldownRemaining(s,type,now){
  if(type==="shock")return s.lastShockAt===null?0:Math.max(0,s.lastShockAt+SHOCK_COOLDOWN_MS-now);
  if(type==="epi")return s.lastEpiAt===null?0:Math.max(0,s.lastEpiAt+EPI_COOLDOWN_MS-now);
  const last=s.lastActionAt[actionGroup(type)];
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
const METRONOME_BPM=105;
const METRONOME_INTERVAL=60/METRONOME_BPM;

document.body.classList.toggle("tv-mode",tvMode);
document.getElementById("timelineSection").hidden=tvMode;
document.getElementById("modeBadge").textContent = tvMode ? "TV DISPLAY" : "CONTROLLER";
document.getElementById("roomInput").value = room;
document.getElementById("roomLabel").textContent = room;

function blankState() {
  return {
    phase:"standby",
    sessionId:null,
    firstStartAt:null,     // Wall-clock total keeps running through ROSC/re-arrest.
    episode:0,
    cycleAnchor:null,      // Per-episode CPR cycle elapsed, adjusted for pauses.
    pausedAt:null,
    pauseId:null,
    pauseAccruedMs:0,
    arrestAccruedMs:0,
    episodeStartAt:null,
    frozenCycleMs:0,
    epiAnchor:null,        // Time since CPR start or latest documented epinephrine.
    shock:0,lastShockAt:null,lastEpiAt:null,epi:0,amioDoses:[],
    rhythm:"—",lastRhythmEventId:null,lastShockRhythmEventId:null,
    peaWidth:null,etco2:null,advancedAirway:false,ventAnchor:null,
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
    state.lastActionAt[actionGroup(e.type)]=e.ts;
  }
}
function computeState() {
  const s = blankState();
  for (const e of chronological()) {
    const t = e.ts;
    if(e.type!=="shock" && e.type!=="epi" && e.type!=="reset" &&
      actionCooldownRemaining(s,e.type,t)>0)continue;
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
      s.frozenCycleMs=0;
      s.pausedAt=null;
      s.pauseId=null;
      s.rhythm="—";
      s.lastRhythmEventId=null;
      s.lastShockRhythmEventId=null;
      s.peaWidth=null;
      if(s.advancedAirway)s.ventAnchor=t; // Re-arrest: start a new 6-second breath cycle.
      // When no epinephrine has been recorded, the first/next arrest starts the
      // 4-minute demo timer. After a dose it tracks elapsed wall time since it.
      if (!s.epi) s.epiAnchor=t;
      line(s,e,recurrent?"RE-ARREST — START CPR #"+s.episode:"START CPR");
    } else if (e.type === "pause" && s.phase === "running") {
      // Compression interruption does NOT stop the 2-min cycle or epinephrine clock.
      s.pausedAt=t;
      s.pauseId=e.id;
      s.phase="paused";
      line(s,e,"PAUSE CHEST COMPRESSIONS");
    } else if (e.type === "resume" && s.phase === "paused") {
      const interruption=Math.max(0,t-s.pausedAt);
      s.pauseAccruedMs+=interruption;
      s.pausedAt=null;
      s.pauseId=null;
      s.phase="running";
      line(s,e,"RESUME COMPRESSIONS — interruption "+timeText(interruption));
    } else if (e.type === "rosc" && ["running","paused"].includes(s.phase)) {
      if (s.pausedAt!==null) s.pauseAccruedMs+=Math.max(0,t-s.pausedAt);
      s.arrestAccruedMs+=Math.max(0,t-s.episodeStartAt);
      s.episodeStartAt=null;
      s.frozenCycleMs=Math.max(0,t-s.cycleAnchor);
      s.pausedAt=null;
      s.pauseId=null;
      s.phase="rosc";
      line(s,e,"ROSC — CPR STOPPED");
    } else if (["running","paused"].includes(s.phase) && e.type === "shock") {
      // Shared event-source guard: only the earliest shock in each 110s window
      // is counted, even if several controllers broadcast duplicate clicks.
      // This is UI/logging protection, not an electrical defibrillator lockout.
      if((s.lastShockAt===null || t-s.lastShockAt>=SHOCK_COOLDOWN_MS) &&
        SHOCKABLE_RHYTHMS.has(s.rhythm) && s.lastRhythmEventId!==null &&
        s.lastRhythmEventId!==s.lastShockRhythmEventId){
        s.shock++;
        s.lastShockAt=t;
        s.lastShockRhythmEventId=s.lastRhythmEventId;
        line(s,e,"SHOCK #"+s.shock);
      }
    } else if (["running","paused"].includes(s.phase) && e.type === "epi") {
      if(s.lastEpiAt===null || t-s.lastEpiAt>=EPI_COOLDOWN_MS){
        s.epi++;
        s.epiAnchor=t;
        s.lastEpiAt=t;
        line(s,e,"EPINEPHRINE #"+s.epi);
      }
    } else if (["running","paused"].includes(s.phase) && e.type === "amio" &&
      (e.value===300||e.value===150) &&
      s.amioDoses.length<2 && e.value===(s.amioDoses.length===0?300:150)) {
      s.amioDoses.push(e.value);
      line(s,e,"AMIODARONE "+e.value+" mg");
    } else if (["running","paused"].includes(s.phase) && e.type === "rhythm" &&
      ["VF","VT","PEA","Asystole"].includes(e.value)) {
      s.rhythm=e.value;
      s.lastRhythmEventId=e.id;
      s.peaWidth=null;
      line(s,e,"RHYTHM: "+s.rhythm);
    } else if (["running","paused"].includes(s.phase) && e.type === "peaWidth" &&
      s.rhythm==="PEA" && ["Narrow","Wide"].includes(e.value)) {
      s.peaWidth=e.value;
      line(s,e,"PEA QRS: "+e.value);
    } else if (["running","paused"].includes(s.phase) && e.type === "etTube" && !s.advancedAirway) {
      s.advancedAirway=true;
      s.ventAnchor=t;
      line(s,e,"ET-TUBE (reported placed) — ventilation coach started");
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
  if(!["VF","VT"].includes(s.rhythm))return "";
  if(s.shock===1)return "ช็อกครั้งแรก ให้ต่อซีพีอาร์ทันที";
  if(s.shock===2)return "ช็อกครั้งที่สอง เตรียมอามิโอดาโรน สามร้อยมิลลิกรัม สำหรับหลังช็อกครั้งที่สาม และประเมินการให้อิพิเนฟรินตามแนวทาง เอ เอช เอ";
  if(s.shock===3)return "ช็อกครั้งที่สาม พิจารณาอามิโอดาโรน สามร้อยมิลลิกรัม หากยังเป็น วีเอฟ หรือ พีวีที";
  if(s.shock===4)return "ช็อกครั้งที่สี่ เตรียมอามิโอดาโรนหนึ่งร้อยห้าสิบมิลลิกรัม ขนาดที่สอง โดยแนวทาง อี อาร์ ซี ระบุให้พิจารณาหลังช็อกครั้งที่ห้า";
  if(s.shock===5)return "ช็อกครั้งที่ห้า พิจารณาอามิโอดาโรนขนาดที่สอง หนึ่งร้อยห้าสิบมิลลิกรัม ตามแนวทางที่ทีมเลือกใช้";
  return "ช็อกครั้งที่ "+s.shock+" ให้ต่อซีพีอาร์และประเมินจังหวะตามขั้นตอน";
}
function announceEvent(e,s) {
  if (!audioReady || !tvMode) return;
  const spoken={
    start:s.episode>1?"เริ่มซีพีอาร์อีกครั้ง ครั้งที่ "+s.episode+" กรุณาบันทึกจังหวะหัวใจ":"เริ่มซีพีอาร์ กรุณาบันทึกจังหวะหัวใจทันที โดยไม่ต้องรอหยุดเวลา",
    pause:"บันทึกหยุดกดหน้าอก เริ่มนับเวลาหยุด ให้กลับมากดหน้าอกภายในสิบวินาที",
    resume:"กลับมากดหน้าอกต่อแล้ว",
    reset:"ยืนยันรีเซ็ต กลับสู่หน้ารอ",
    shock:"บันทึกช็อกครั้งที่ "+s.shock+" "+shockAdvice(s),
    epi:"บันทึกให้ยา อิพิเนฟริน ครั้งที่ "+s.epi+" เริ่มนับเวลายาใหม่",
    amio:"บันทึกให้ยา อามิโอดาโรน "+e.value+" มิลลิกรัม",
    rhythm:e.value==="VF"?"บันทึกจังหวะ วีเอฟ ช็อกได้":
      e.value==="VT"?"บันทึกจังหวะ พัลส์เลส วีที ช็อกได้":
      e.value==="PEA"?"บันทึกจังหวะ พีอีเอ เลือกแนโรหรือไวด์คิวอาร์เอส และพิจารณาทำอัลตราซาวด์ข้างเตียงเพื่อหาสาเหตุ ห้ามหยุดกดหน้าอกนาน":
      "บันทึก แอสซิสโตลี ตรวจสอบแฟลตไลน์โปรโตคอล เช็กสายต่อ เกน และยืนยันจากสองลีด โดยไม่ชะลอการกดหน้าอก",
    peaWidth:e.value==="Wide"?"พีอีเอ ไวด์คิวอาร์เอส พิจารณาอัลตราซาวด์ข้างเตียงเพื่อค้นหาสาเหตุที่แก้ไขได้":
      "พีอีเอ แนโรคิวอาร์เอส พิจารณาอัลตราซาวด์ข้างเตียงเพื่อค้นหาสาเหตุที่แก้ไขได้",
    etTube:"บันทึก ใส่ท่อช่วยหายใจแล้ว เริ่มตัวช่วยจังหวะช่วยหายใจทุกหกวินาที",
    rosc:"บันทึก อาร์ โอ เอส ซี ได้ชีพจรกลับมา หยุดรอบซีพีอาร์",
    etco2:"บันทึก ซีโอทู "+e.value+" มิลลิเมตรปรอท"+
      (e.value<10?" ซีโอทูต่ำกว่าสิบ ตรวจสอบคุณภาพการกดหน้าอก และปัจจัยอื่นที่มีผลต่อซีโอทู":"")
  };
  soundNotice(spoken[e.type]||e.type,e.type==="rosc"||e.type==="start"||e.type==="etco2"&&e.value<10);
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
  if(!active){nextMetronomeBeat=null;currentMetronomeEpisode=null;return;}
  const id=room+"|"+s.sessionId+"|"+s.episode;
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
function medicationCue(s,clock){
  const shockable=["VF","VT"].includes(s.rhythm);
  const epiReady=["PEA","Asystole"].includes(s.rhythm) ||
    (shockable && s.shock>=2);
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
  else if(s.shock===2)cue="Shock #2 — ประเมิน Epinephrine; เตรียม Amiodarone 300 mg สำหรับหลัง Shock #3";
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
        "อีกสิบวินาที ครบรอบซีพีอาร์สองนาที เตรียมเครื่องช็อกและชาร์จตามโปรโตคอลระหว่างกดหน้าอก ตรวจจังหวะอีกครั้งก่อนช็อก":
        "อีกสิบวินาที ครบรอบซีพีอาร์สองนาที");
    }
  }
  if (ongoing && cycleIndex>=1 && audioReady && tvMode) {
    const key=room+"|"+s.sessionId+"|"+s.episode+"|"+cycleIndex;
    if (cycleEndKey!==key) {
      cycleEndKey=key;
      // Skip stale boundary announcements if the TV was suspended and resumed.
      if (cycle%TWO_MIN<3000)announcements.push("ครบสองนาที ตรวจจังหวะตามขั้นตอน");
    }
  }
  const shockable=SHOCKABLE_RHYTHMS.has(s.rhythm);
  const epiTarget=shockable?FIVE_MIN:FOUR_MIN;
  const doseTimingActive=connected && ["running","paused"].includes(s.phase) && s.epiAnchor!==null;
  const due=doseTimingActive && clock.epiMs>=epiTarget;
  const epiCard=document.getElementById("epiStat");
  epiCard.classList.toggle("due",!!due);
  const epiKey=room+"|"+s.sessionId+"|"+s.epiAnchor+"|"+epiTarget;
  if(shockable && doseTimingActive &&
      clock.epiMs>=epiTarget-EPI_PREWARN_MS && clock.epiMs<epiTarget &&
      audioReady && epiPreAlertKey!==epiKey){
    epiPreAlertKey=epiKey;
    announcements.push("อีกสิบวินาทีจะครบห้านาทีหลังอิพิเนฟรินครั้งล่าสุด โปรดทบทวนเวลาการให้ยาตามโปรโตคอล");
  }
  if(due && audioReady && epiAlarmKey!==epiKey){
    epiAlarmKey=epiKey;
    announcements.push(shockable?
      "ครบห้านาทีหลังอิพิเนฟริน โปรดทบทวนการให้ยาซ้ำตามโปรโตคอล":
      "ครบสี่นาทีหลังอิพิเนฟริน โปรดทบทวนการให้ยาซ้ำตามโปรโตคอล");
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
  const overlay=document.getElementById("pauseAlarmOverlay");
  const over=tvMode&&connected&&paused&&clock.currentPauseMs>=10000;
  overlay.classList.toggle("active",over);
  if(over&&audioReady&&interruptionAlarmKey!==s.pauseId){
    interruptionAlarmKey=s.pauseId;
    soundNotice("หยุดกดหน้าอกเกินสิบวินาที ให้กลับมากดหน้าอกต่อทันที",true);
  }
  document.getElementById("ccfSummary").hidden=!(s.phase==="rosc"&&clock.ccf!==null);
}
function renderVentilation(s,clock) {
  const show=s.advancedAirway && ["running","paused"].includes(s.phase);
  const tv=document.getElementById("ventilator");
  const mobile=document.getElementById("controllerVent");
  tv.hidden=mobile.hidden=!show;
  if(!show)return;
  const remaining=Math.max(1,Math.ceil((6000-clock.ventMs%6000)/1000));
  const squeeze=s.phase==="running" && remaining===1;
  document.querySelectorAll('[data-bind="ventTime"]').forEach(el=>{el.textContent=String(remaining);});
  tv.classList.toggle("squeeze",squeeze);
  mobile.classList.toggle("squeeze",squeeze);
  document.getElementById("ventLabel").textContent=squeeze?"SQUEEZE BAG • 1 SECOND":s.phase==="paused"?"CPR PAUSED":"NEXT BREATH IN";
  document.getElementById("controllerVentLabel").textContent=squeeze?"🟢 SQUEEZE BAG":"NEXT BREATH";
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
    epiTime:s.epiAnchor===null?"00:00":timeText(clock.epiMs),
    epiReminder:s.epiAnchor===null?"รอเริ่ม CPR":
      s.phase==="rosc"?"ROSC • ไม่แจ้งเตือนยา":
      clock.epiMs>=(SHOCKABLE_RHYTHMS.has(s.rhythm)?FIVE_MIN:FOUR_MIN)?
        "ครบเป้าหมาย — ตรวจสอบ Protocol":"นับต่อเนื่องจาก Epinephrine ครั้งล่าสุด",
    shock:s.shock,epi:s.epi,rhythm:s.rhythm==="PEA"&&s.peaWidth?"PEA / "+s.peaWidth.toUpperCase():s.rhythm,etco2:s.etco2===null?"—":s.etco2,
    episode:s.episode,ccf:clock.ccf===null?"—":clock.ccf.toFixed(1)+"%",
    pauseTotal:timeText(clock.pauseMs),room
  };
  for (const [key,val] of Object.entries(values)) {
    document.querySelectorAll('[data-bind="'+key+'"]').forEach(n=>{
      if (n.textContent!==String(val)) n.textContent=val;
    });
  }
  document.getElementById("epiReminderTitle").textContent=
    "EPINEPHRINE TIMER • "+(SHOCKABLE_RHYTHMS.has(s.rhythm)?"5":"4")+" MIN";
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
  shockButton.disabled=!connected || !arrestActive || shockLocked || pendingShock || !freshShockable;
  shockButton.classList.toggle("cooldown-locked",shockLocked || pendingShock);
  if(shockLocked){
    const seconds=Math.ceil(shockRemaining/1000);
    const remainingText=fmt(Math.floor(seconds/60))+":"+fmt(seconds%60);
    shockButton.textContent="⚡ SHOCK · "+remainingText;
    shockHint.textContent="LOCKED · NEXT SHOCK LOG IN "+remainingText;
    shockHint.hidden=false;
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
  pauseResume.disabled=!connected ||
    !["running","paused"].includes(s.phase) ||
    actionCooldownRemaining(s,resume?"resume":"pause",Date.now())>0 ||
    pendingActions.has(resume?"resume":"pause");
  const metro=document.getElementById("toggleMetronome");
  metro.classList.toggle("active",s.metronomeOn);
  metro.setAttribute("aria-pressed",String(s.metronomeOn));
  metro.textContent="🎵 105 BPM "+(s.metronomeOn?"ON":"OFF");
  const epiButton=document.getElementById("epiButton");
  const epiLockMs=actionCooldownRemaining(s,"epi",Date.now());
  const epiLocked=epiLockMs>0;
  epiButton.disabled=!connected || !arrestActive || epiLocked || pendingActions.has("epi");
  epiButton.classList.toggle("epi-highlight",cue.epiReady && !epiLocked);
  epiButton.classList.toggle("epi-muted",!cue.epiReady || epiLocked);
  epiButton.classList.toggle("epi-locked",epiLocked);
  const epiHint=document.getElementById("epiLockHint");
  if(epiLocked){
    const seconds=Math.ceil(epiLockMs/1000);
    const txt=fmt(Math.floor(seconds/60))+":"+fmt(seconds%60);
    epiButton.textContent="❤️ EPINEPHRINE · "+txt;
    epiHint.textContent="LOCKED "+txt+" (3 MIN BETWEEN LOGS)";
    epiHint.hidden=false;
  }else{
    epiButton.textContent="❤️ EPINEPHRINE";
    epiHint.hidden=true;
  }
  const amioButton=document.getElementById("amioButton");
  const amio300=cue.amioCount===0;
  amioButton.textContent=amio300?"💉 AMIODARONE 300 mg":"💉 AMIODARONE 150 mg";
  const amioReady=cue.shockable && s.shock >= (amio300?3:5);
  const amioPrep=cue.shockable && ((amio300 && s.shock===2) ||
    (!amio300 && s.shock>=4 && s.shock<5));
  if(!amio300 && amioPrep)amioButton.textContent="💉 AMIODARONE 150 mg · เตรียม";
  amioButton.classList.toggle("amio-highlight",amioReady);
  amioButton.classList.toggle("amio-prepare",amioPrep);
  amioButton.classList.toggle("amio-muted",!amioReady && !amioPrep);
  amioButton.disabled=!connected || !["running","paused"].includes(s.phase) ||
    !cue.shockable || cue.amioCount>=2 || s.shock < (amio300?3:4) ||
    actionCooldownRemaining(s,"amio",Date.now())>0 || pendingActions.has("amio");
  document.getElementById("clinicalCue").textContent=cue.cue+
    (s.phase==="rosc" && clock.ccf!==null?" • DOCUMENTED CCF "+clock.ccf.toFixed(1)+"%":"");
  document.getElementById("drugHint").textContent=cue.cue+
    " • ปุ่ม Amiodarone บันทึกการให้ยาจริง ไม่ได้สั่งให้ยาอัตโนมัติ";
  const entry=document.getElementById("etco2Input");
  const submit=document.getElementById("etco2Submit");
  entry.disabled=!connected || !s.advancedAirway || s.phase==="standby";
  submit.disabled=entry.disabled;
  const startButton=document.getElementById("startButton");
  startButton.textContent=s.phase==="rosc"?"▶ RE-ARREST / START CPR":"▶ START CPR";
  const hint=document.getElementById("connectionHint");
  hint.textContent=!connected?"OFFLINE — ข้อมูล/เสียงเตือนอาจไม่ล่าสุด":
    s.phase==="standby"?"ONLINE — รอ Start CPR จาก Controller":
    s.phase==="rosc"?"ONLINE — ROSC • TOTAL CASE TIME STILL RUNNING":
    s.phase==="paused"?"ONLINE — COMPRESSIONS INTERRUPTED • CLOCK CONTINUES":"ONLINE — REALTIME CPR SESSION";
  renderAirwayAndRhythm(s);
  renderVentilation(s,clock);
  renderECG(s);
  renderInterruption(s,clock);
  checkAlarms(s,clock);
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
  if (type==="rosc" && !["running","paused"].includes(s.phase))return;
  if (type==="reset" && s.phase==="standby")return;
  if (["shock","epi","rhythm","peaWidth","etTube"].includes(type) && !["running","paused"].includes(s.phase))return;
  if(type==="shock"){
    if(pendingShock)return;
    if(s.lastShockAt!==null && Date.now()<s.lastShockAt+SHOCK_COOLDOWN_MS)return;
    pendingShock=true; // Lock before first await to prevent concurrent rapid taps.
    render();
  }
  if (type==="peaWidth" && s.rhythm!=="PEA")return;
  if (type==="etTube" && s.advancedAirway)return;
  if (type==="metro")value=!s.metronomeOn;
  if (type==="etco2" && (!s.advancedAirway || s.phase==="standby"))return;
  if(type==="amio"){
    if(!["VF","VT"].includes(s.rhythm) || !["running","paused"].includes(s.phase) ||
      s.amioDoses.length>=2)return;
    const next=s.amioDoses.length===0?300:150;
    if(s.shock<(next===300?3:4))return;
    // The ERC 2025 guidance places the second dose after five shocks.
    // After shock four, keep a manual override for documenting a dose
    // actually administered by the clinician; never imply it is due.
    if(next===150 && s.shock===4 &&
      !confirm("ขณะนี้ Shock #4: ERC 2025 ระบุให้พิจารณา Amiodarone 150 mg หลัง Shock #5\nยืนยันว่ากำลังบันทึกยาที่ได้ให้จริง ไม่ใช่การสั่งให้ยาอัตโนมัติ?"))return;
    value=next;
  }
  const e={id:DEVICE_ID+"-"+(++sequence),type,ts:Date.now(),seq:sequence,value};
  try {
    await transmit("cpr-event",e);
    acceptEvent(e,true); // TV only speaks; controller stays silent.
  } catch(err) {
    alert("ส่งคำสั่งไม่สำเร็จ กรุณาตรวจการเชื่อมต่อ: "+err.message);
    status("offline");
  } finally {
    if(type==="shock"){
      pendingShock=false;
      render();
    }
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
  messages=new Map();
  nearAlarmKey=cycleEndKey=epiAlarmKey="";
  if ("speechSynthesis" in window)speechSynthesis.cancel();
  document.getElementById("roomInput").value=room;
  document.getElementById("roomLabel").textContent=room;
  const url=new URL(location.href);
  url.searchParams.set("room",room);
  history.replaceState({},"",url.toString());
  if (supabase)setupChannel();
  render();
  switchingRoom=false;
}
function makeLink(view) {
  const url=new URL(location.href);
  url.searchParams.set("room",room);
  if (view==="tv")url.searchParams.set("view","tv");
  else url.searchParams.delete("view");
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
    ["LAST RHYTHM",s.rhythm==="PEA"&&s.peaWidth?"PEA ("+s.peaWidth+" QRS)":s.rhythm],
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
document.getElementById("joinRoomBtn").addEventListener("click",()=>enterRoom(document.getElementById("roomInput").value));
document.getElementById("roomInput").addEventListener("keydown",e=>{
  if (e.key==="Enter")enterRoom(e.currentTarget.value);
});
document.getElementById("copyTvLink").addEventListener("click",()=>copyLink("tv"));
document.getElementById("copyControlLink").addEventListener("click",()=>copyLink("controller"));
document.querySelectorAll("[data-action]").forEach(btn=>
  btn.addEventListener("click",()=>{
    const action=btn.dataset.action;
    if(action==="reset"){
      const state=computeState(),measurement=elapsedFor(state,Date.now());
      const fraction=measurement.ccf===null?"—":measurement.ccf.toFixed(1)+"%";
      if(!confirm("ยืนยัน RESET?\nEstimated CCF: "+fraction+
        "\nRecorded hands-off: "+timeText(measurement.pauseMs)+
        "\nกรุณา Export PDF ก่อนล้างข้อมูลทั้งหมด"))return;
    }
    if(action==="pause" && !confirm("ยืนยันเริ่มจับเวลาหยุดกดหน้าอก? เวลา CPR และยาไม่หยุดเดิน"))return;
    if(action==="resume" && !confirm("ยืนยันกลับมากดหน้าอกต่อแล้ว?"))return;
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
