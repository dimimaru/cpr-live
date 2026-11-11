// CPR Live v0.6 — ephemeral Supabase Broadcast demonstration.
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
const fmt = n => String(n).padStart(2,"0");
const roomClean = v => String(v || "").toUpperCase().replace(/[^A-Z0-9_-]/g,"").slice(0,40) || "ER-DEMO-01";
let room = roomClean(params.get("room") || cfg.defaultRoom);
let supabase = null;
let channel = null;
let connected = false;
let messages = new Map();
let sequence = 0;
let switchingRoom = false;

// Audio is deliberately TV-only. Browsers require a gesture on each TV page
// before sound and Web Speech are reliably permitted.
let audioReady = tvMode; // Attempt speech automatically; WebAudio may still be blocked.
let audioContext = null;
let nearAlarmKey = "";
let cycleEndKey = "";
let epiAlarmKey = "";
// Metronome is shared session state (the TV follows the Controller).
let nextMetronomeBeat=null;
let currentMetronomeEpisode=null;
const METRONOME_BPM=105;
const METRONOME_INTERVAL=60/METRONOME_BPM;

document.body.classList.toggle("tv-mode",tvMode);
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
    frozenCycleMs:0,
    epiAnchor:null,        // Time since CPR start or latest documented epinephrine.
    shock:0,epi:0,amioDoses:[],rhythm:"—",peaWidth:null,etco2:null,advancedAirway:false,ventAnchor:null,metronomeOn:true,timeline:[]
  };
}
function chronological() {
  return [...messages.values()].sort((a,b) =>
    (a.ts-b.ts) || (a.seq-b.seq) || a.id.localeCompare(b.id));
}
function line(state,e,label) {
  state.timeline.push({id:e.id,ts:e.ts,label});
}
function computeState() {
  const s = blankState();
  for (const e of chronological()) {
    const t = e.ts;
    if (e.type === "reset") {
      Object.assign(s,blankState());
    } else if (e.type === "start" && (s.phase === "standby" || s.phase === "rosc")) {
      const recurrent = s.phase === "rosc";
      if (!recurrent) {
        s.sessionId=e.id;
        s.firstStartAt=t;
        s.shock=0;s.epi=0;s.amioDoses=[];s.etco2=null;s.advancedAirway=false;s.ventAnchor=null;s.timeline=[];
      }
      s.episode++;
      s.phase="running";
      s.cycleAnchor=t;
      s.frozenCycleMs=0;
      s.pausedAt=null;
      s.rhythm="—";
      s.peaWidth=null;
      if(s.advancedAirway)s.ventAnchor=t; // Re-arrest: start a new 6-second breath cycle.
      // When no epinephrine has been recorded, the first/next arrest starts the
      // 4-minute demo timer. After a dose it tracks elapsed wall time since it.
      if (!s.epi) s.epiAnchor=t;
      line(s,e,recurrent?"RE-ARREST — START CPR #"+s.episode:"START CPR");
    } else if (e.type === "pause" && s.phase === "running") {
      s.frozenCycleMs=Math.max(0,t-s.cycleAnchor);
      s.pausedAt=t;
      s.phase="paused";
      line(s,e,"PAUSE CPR TIMER");
    } else if (e.type === "resume" && s.phase === "paused") {
      const gap=Math.max(0,t-s.pausedAt);
      s.cycleAnchor+=gap;
      if (s.epiAnchor!==null) s.epiAnchor+=Math.max(0,t-Math.max(s.pausedAt,s.epiAnchor));
      if (s.ventAnchor!==null)s.ventAnchor+=Math.max(0,t-Math.max(s.pausedAt,s.ventAnchor));
      s.pausedAt=null;
      s.phase="running";
      line(s,e,"RESUME CPR TIMER");
    } else if (e.type === "rosc" && ["running","paused"].includes(s.phase)) {
      if (s.phase==="running")s.frozenCycleMs=Math.max(0,t-s.cycleAnchor);
      s.pausedAt=null;
      s.phase="rosc";
      line(s,e,"ROSC — CPR STOPPED");
    } else if (["running","paused"].includes(s.phase) && e.type === "shock") {
      s.shock++;
      line(s,e,"SHOCK #"+s.shock);
    } else if (["running","paused"].includes(s.phase) && e.type === "epi") {
      s.epi++;
      s.epiAnchor=t;
      line(s,e,"EPINEPHRINE #"+s.epi);
    } else if (["running","paused"].includes(s.phase) && e.type === "amio" &&
      (e.value===300||e.value===150) &&
      s.amioDoses.length<2 && e.value===(s.amioDoses.length===0?300:150)) {
      s.amioDoses.push(e.value);
      line(s,e,"AMIODARONE "+e.value+" mg");
    } else if (["running","paused"].includes(s.phase) && e.type === "rhythm" &&
      ["VF","VT","PEA","Asystole"].includes(e.value)) {
      s.rhythm=e.value;
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
  const cycleMs=s.cycleAnchor===null?0:
    s.phase==="running"?Math.max(0,now-s.cycleAnchor):s.frozenCycleMs;
  const epiMs=s.epiAnchor===null?0:
    s.phase==="paused"?Math.max(0,s.pausedAt-s.epiAnchor):
    Math.max(0,now-s.epiAnchor);
  const ventMs=s.ventAnchor===null?0:
    s.phase==="running"?Math.max(0,now-s.ventAnchor):
    s.phase==="paused"?Math.max(0,s.pausedAt-s.ventAnchor):0;
  return {totalMs,cycleMs,epiMs,ventMs};
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
    pause:"ยืนยันพักตัวจับเวลา ซีพีอาร์",
    resume:"ยืนยันเริ่มนับเวลา ซีพีอาร์ ต่อ",
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
function medicationCue(s){
  const shockable=["VF","VT"].includes(s.rhythm);
  const epiReady=["PEA","Asystole"].includes(s.rhythm) ||
    (shockable && s.shock>=2);
  const amioCount=s.amioDoses.length;
  let cue="";
  if(s.phase==="standby")cue="รอ START CPR — เริ่มแล้วบันทึก Rhythm โดยเร็ว";
  else if(s.phase==="rosc")cue="ROSC — เฝ้าติดตามอาการ หาก Re-arrest สามารถกด START CPR ใหม่";
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
  const ongoing=connected && s.phase==="running" && s.sessionId;
  const cycle=clock.cycleMs;
  const cycleIndex=Math.floor(cycle/TWO_MIN);
  const inLastTen=ongoing && cycle%TWO_MIN>=TWO_MIN-10000 && cycle%TWO_MIN<TWO_MIN;
  overlay.classList.toggle("alarm-on",!!inLastTen);
  const announcements=[];
  if (inLastTen) {
    document.getElementById("alarmSeconds").textContent=
      String(Math.ceil((TWO_MIN-cycle%TWO_MIN)/1000));
    const key=room+"|"+s.sessionId+"|"+s.episode+"|"+cycleIndex;
    if (audioReady && tvMode && nearAlarmKey!==key) {
      nearAlarmKey=key;
      announcements.push("อีกสิบวินาที ครบรอบซีพีอาร์สองนาที");
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
  const due=ongoing && clock.epiMs>=FOUR_MIN && s.epiAnchor!==null;
  const epiCard=document.getElementById("epiStat");
  epiCard.classList.toggle("due",!!due);
  if (due && audioReady && tvMode) {
    const key=room+"|"+s.sessionId+"|"+s.epiAnchor;
    if (epiAlarmKey!==key) {
      epiAlarmKey=key;
      announcements.push("ครบสี่นาที นับจากการเริ่มหรือการบันทึกอิพิเนฟรินล่าสุด โปรดตรวจสอบการให้ยา");
    }
  }
  // At 04:00, CPR and epinephrine alerts occur together: speak both, not
  // two interrupted speech utterances.
  if (announcements.length) soundNotice(announcements.join(" และ "),true);
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
  const cue=medicationCue(s);
  const values={
    phase:s.phase==="running"?"CPR ACTIVE":s.phase==="paused"?"CPR PAUSED":
      s.phase==="rosc"?"ROSC — MONITORING":"STANDBY",
    cycle:timeText(currentCycle),
    elapsed:timeText(clock.totalMs),
    epiTime:s.epiAnchor===null?"00:00":timeText(clock.epiMs),
    epiReminder:s.epiAnchor===null?"รอเริ่ม CPR":
      s.phase==="rosc"?"ROSC • ไม่แจ้งเตือนยา":
      s.phase==="paused"?"PAUSED":clock.epiMs>=FOUR_MIN?"ครบ 4 นาที — ตรวจสอบ Protocol":
      "เป้าหมายแจ้งเตือนที่ 04:00",
    shock:s.shock,epi:s.epi,rhythm:s.rhythm==="PEA"&&s.peaWidth?"PEA / "+s.peaWidth.toUpperCase():s.rhythm,etco2:s.etco2===null?"—":s.etco2,
    episode:s.episode,room
  };
  for (const [key,val] of Object.entries(values)) {
    document.querySelectorAll('[data-bind="'+key+'"]').forEach(n=>{
      if (n.textContent!==String(val)) n.textContent=val;
    });
  }
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
      (action==="etTube" && (!active || s.advancedAirway));
  }
  const pauseResume=document.getElementById("pauseResumeBtn");
  const resume=s.phase==="paused";
  pauseResume.dataset.action=resume?"resume":"pause";
  pauseResume.textContent=resume?"▶ RESUME":"Ⅱ PAUSE";
  const metro=document.getElementById("toggleMetronome");
  metro.classList.toggle("active",s.metronomeOn);
  metro.setAttribute("aria-pressed",String(s.metronomeOn));
  metro.textContent="🎵 105 BPM "+(s.metronomeOn?"ON":"OFF");
  const epiButton=document.getElementById("epiButton");
  epiButton.classList.toggle("epi-highlight",cue.epiReady);
  epiButton.classList.toggle("epi-muted",!cue.epiReady);
  const amioButton=document.getElementById("amioButton");
  const amio300=cue.amioCount===0;
  amioButton.textContent=amio300?"💊 AMIODARONE 300 mg":"💊 AMIODARONE 150 mg";
  const amioReady=cue.shockable && s.shock >= (amio300?3:5);
  const amioPrep=cue.shockable && ((amio300 && s.shock===2) ||
    (!amio300 && s.shock>=4 && s.shock<5));
  if(!amio300 && amioPrep)amioButton.textContent="💊 AMIODARONE 150 mg · เตรียม";
  amioButton.classList.toggle("amio-highlight",amioReady);
  amioButton.classList.toggle("amio-prepare",amioPrep);
  amioButton.classList.toggle("amio-muted",!amioReady && !amioPrep);
  amioButton.disabled=!connected || !["running","paused"].includes(s.phase) ||
    !cue.shockable || cue.amioCount>=2 || s.shock < (amio300?3:4);
  document.getElementById("clinicalCue").textContent=cue.cue;
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
    s.phase==="paused"?"ONLINE — CPR TIMER PAUSED":"ONLINE — REALTIME CPR SESSION";
  renderAirwayAndRhythm(s);
  renderVentilation(s,clock);
  checkAlarms(s,clock);
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
document.getElementById("joinRoomBtn").addEventListener("click",()=>enterRoom(document.getElementById("roomInput").value));
document.getElementById("roomInput").addEventListener("keydown",e=>{
  if (e.key==="Enter")enterRoom(e.currentTarget.value);
});
document.getElementById("copyTvLink").addEventListener("click",()=>copyLink("tv"));
document.getElementById("copyControlLink").addEventListener("click",()=>copyLink("controller"));
document.querySelectorAll("[data-action]").forEach(btn=>
  btn.addEventListener("click",()=>{
    const action=btn.dataset.action;
    if(action==="reset" && !confirm("ยืนยัน RESET? จะลบเวลา CPR, จำนวนยา และเหตุการณ์ทั้งหมดในห้องปัจจุบัน"))return;
    if(action==="pause" && !confirm("ยืนยัน PAUSE CPR TIMER?"))return;
    if(action==="resume" && !confirm("ยืนยัน RESUME CPR TIMER?"))return;
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
