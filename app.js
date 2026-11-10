// CPR Live v0.3 — ephemeral Supabase Broadcast demonstration.
// No user authentication, server authority, or durable database.
// NOT for clinical treatment, medication decision support, or patient data.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.0?bundle";

const cfg = window.CPR_CONFIG || {};
const params = new URLSearchParams(location.search);
const tvMode = params.get("view") === "tv";
const DEVICE_ID = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random();
const ACTIONS = new Set(["start","pause","resume","reset","shock","epi","rhythm","rosc","etco2"]);
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
let audioReady = false;
let audioContext = null;
let nearAlarmKey = "";
let cycleEndKey = "";
let epiAlarmKey = "";

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
    shock:0,epi:0,rhythm:"—",etco2:null,timeline:[]
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
        s.shock=0;s.epi=0;s.etco2=null;s.timeline=[];
      }
      s.episode++;
      s.phase="running";
      s.cycleAnchor=t;
      s.frozenCycleMs=0;
      s.pausedAt=null;
      s.rhythm="—";
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
    } else if (["running","paused"].includes(s.phase) && e.type === "rhythm" &&
      ["VF/pVT","PEA/Asystole"].includes(e.value)) {
      s.rhythm=e.value;
      line(s,e,"RHYTHM: "+s.rhythm);
    } else if (["running","paused","rosc"].includes(s.phase) && e.type === "etco2" &&
      Number.isInteger(e.value) && e.value>=0 && e.value<=150) {
      s.etco2=e.value;
      line(s,e,"EtCO₂: "+s.etco2+" mmHg");
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
  return {totalMs,cycleMs,epiMs};
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
function announceEvent(e,s) {
  if (!audioReady || !tvMode) return;
  const spoken={
    start:s.episode>1?"เริ่มซีพีอาร์อีกครั้ง ครั้งที่ "+s.episode:"เริ่มซีพีอาร์",
    pause:"พักตัวจับเวลา ซีพีอาร์",
    resume:"เริ่มนับเวลา ซีพีอาร์ ต่อ",
    reset:"รีเซ็ต กลับสู่หน้ารอ",
    shock:"ช็อก ครั้งที่ "+s.shock,
    epi:"บันทึกให้ยา อิพิเนฟริน ครั้งที่ "+s.epi+" เริ่มนับเวลายาใหม่",
    rhythm:e.value==="VF/pVT"?"บันทึกจังหวะ วีเอฟ หรือ พีวีที":"บันทึกจังหวะ พีอีเอ หรือ แอสซิสโตลี",
    rosc:"บันทึก อาร์ โอ เอส ซี ได้ชีพจรกลับมา หยุดรอบซีพีอาร์",
    etco2:"บันทึก อีทีซีโอทู "+e.value+" มิลลิเมตรปรอท"
  };
  soundNotice(spoken[e.type]||e.type,e.type==="rosc"||e.type==="start");
}
async function enableSound() {
  if (!tvMode) return;
  audioReady=true;
  const Ctx=window.AudioContext||window.webkitAudioContext;
  let resumePromise=null;
  try {
    if (Ctx) {
      if (!audioContext) audioContext=new Ctx();
      // Resume inside click activation, not in a later timer or network callback.
      resumePromise=audioContext.resume();
    }
  } catch(err){console.warn("Audio unlock",err);}
  const btn=document.getElementById("enableSound");
  btn.classList.add("enabled");
  btn.textContent="🔊 เสียง TV เปิดแล้ว · ทดสอบอีกครั้ง";
  const supported=("speechSynthesis" in window)&&("SpeechSynthesisUtterance" in window);
  document.getElementById("audioStatus").textContent=
    supported?"เปิดเสียงแล้ว — ทดสอบว่ามีเสียงพูดและเสียงบี๊บ":"เปิดเสียงบี๊บแล้ว — Browser นี้อาจไม่รองรับเสียงพูด";
  // Make the first speech call synchronously from the user's click.
  speak("เปิดระบบเสียง ซีพีอาร์ ไลฟ์ พร้อมทดสอบ");
  try { if (resumePromise) await resumePromise; } catch(err){console.warn("Audio resume",err);}
  beep("notice");
  // If sound is unlocked mid-alarm, allow the active reminder to speak now.
  nearAlarmKey=cycleEndKey=epiAlarmKey="";
  render();
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
function render() {
  const s=computeState();
  const clock=elapsedFor(s,Date.now());
  const currentCycle=s.phase==="standby"?0:clock.cycleMs%TWO_MIN;
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
    shock:s.shock,epi:s.epi,rhythm:s.rhythm,etco2:s.etco2===null?"—":s.etco2,
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
      (["shock","epi","rhythm"].includes(action) && !active);
  }
  const entry=document.getElementById("etco2Input");
  const submit=document.getElementById("etco2Submit");
  entry.disabled=!connected || s.phase==="standby";
  submit.disabled=entry.disabled;
  const startButton=document.getElementById("startButton");
  startButton.textContent=s.phase==="rosc"?"▶ RE-ARREST / START CPR":"▶ START CPR";
  const hint=document.getElementById("connectionHint");
  hint.textContent=!connected?"OFFLINE — ข้อมูล/เสียงเตือนอาจไม่ล่าสุด":
    s.phase==="standby"?"ONLINE — รอ Start CPR จาก Controller":
    s.phase==="rosc"?"ONLINE — ROSC • TOTAL CASE TIME STILL RUNNING":
    s.phase==="paused"?"ONLINE — CPR TIMER PAUSED":"ONLINE — REALTIME CPR SESSION";
  checkAlarms(s,clock);
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
  if (obj.type==="rhythm" && !["VF/pVT","PEA/Asystole"].includes(obj.value)) return false;
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
  if (["shock","epi","rhythm"].includes(type) && !["running","paused"].includes(s.phase))return;
  if (type==="etco2" && s.phase==="standby")return;
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
document.getElementById("enableSound").addEventListener("click",enableSound);
document.getElementById("joinRoomBtn").addEventListener("click",()=>enterRoom(document.getElementById("roomInput").value));
document.getElementById("roomInput").addEventListener("keydown",e=>{
  if (e.key==="Enter")enterRoom(e.currentTarget.value);
});
document.getElementById("copyTvLink").addEventListener("click",()=>copyLink("tv"));
document.getElementById("copyControlLink").addEventListener("click",()=>copyLink("controller"));
document.querySelectorAll("[data-action]").forEach(btn=>
  btn.addEventListener("click",()=>handleAction(btn.dataset.action,btn.dataset.value))
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
  if (supabase && connected)requestSync();
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
