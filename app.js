// CPR Live v0.2 — Supabase Broadcast demo only.
// Ephemeral in-browser event log; NOT suitable for real patient care.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.0?bundle";

const cfg = window.CPR_CONFIG || {};
const params = new URLSearchParams(window.location.search);
const tvMode = params.get("view") === "tv";
const DEVICE_ID = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + "-" + String(Math.random());
const ACTIONS = new Set(["start","pause","resume","reset","shock","epi","rhythm"]);
const fmt = n => String(n).padStart(2, "0");
const roomClean = v => String(v || "").toUpperCase().replace(/[^A-Z0-9_-]/g,"").slice(0,40) || "ER-DEMO-01";
let room = roomClean(params.get("room") || cfg.defaultRoom);
let supabase = null;
let channel = null;
let connected = false;
let messages = new Map();
let sequence = 0;
let switchingRoom = false;

document.body.classList.toggle("tv-mode",tvMode);
document.getElementById("modeBadge").textContent = tvMode ? "TV DISPLAY" : "CONTROLLER";
document.getElementById("roomInput").value = room;
document.getElementById("roomLabel").textContent = room;

function blankState() {
  return { phase:"standby", startedAt:null, accruedMs:0, shock:0, epi:0, rhythm:"—", timeline:[] };
}
function chronological() {
  return [...messages.values()].sort((a,b) =>
    (a.ts-b.ts) || (a.seq-b.seq) || a.id.localeCompare(b.id));
}
function computeState() {
  const state = blankState();
  for (const e of chronological()) {
    const stamp = Number(e.ts) || 0;
    if (e.type === "reset") {
      Object.assign(state,blankState());
      continue;
    }
    if (e.type === "start" && state.phase === "standby") {
      state.phase = "running";
      state.startedAt = stamp;
      state.accruedMs = 0;
      state.shock = 0; state.epi = 0; state.rhythm = "—";
      state.timeline.push({ts:stamp,label:"START CPR"});
    } else if (e.type === "pause" && state.phase === "running") {
      state.accruedMs += Math.max(0,stamp - state.startedAt);
      state.startedAt = null;
      state.phase = "paused";
      state.timeline.push({ts:stamp,label:"PAUSE"});
    } else if (e.type === "resume" && state.phase === "paused") {
      state.startedAt = stamp;
      state.phase = "running";
      state.timeline.push({ts:stamp,label:"RESUME"});
    } else if ((state.phase === "running" || state.phase === "paused") && e.type === "shock") {
      state.shock++;
      state.timeline.push({ts:stamp,label:"SHOCK #" + state.shock});
    } else if ((state.phase === "running" || state.phase === "paused") && e.type === "epi") {
      state.epi++;
      state.timeline.push({ts:stamp,label:"EPINEPHRINE #" + state.epi});
    } else if ((state.phase === "running" || state.phase === "paused") && e.type === "rhythm") {
      state.rhythm = e.value === "VF/pVT" ? "VF/pVT" : "PEA/Asystole";
      state.timeline.push({ts:stamp,label:"RHYTHM: " + state.rhythm});
    }
  }
  return state;
}

function timeText(ms) {
  const sec = Math.max(0,Math.floor(ms/1000));
  const minutes = Math.floor(sec/60);
  return fmt(minutes) + ":" + fmt(sec%60);
}
function render() {
  const state = computeState();
  let ms = state.accruedMs;
  if (state.phase === "running" && state.startedAt !== null) ms += Math.max(0,Date.now()-state.startedAt);
  const secondsLeft = state.phase === "standby" ? 120 : Math.ceil((120000-(ms%120000))/1000);
  const values = {
    phase:state.phase === "running" ? "CPR ACTIVE" : state.phase === "paused" ? "CPR PAUSED" : "STANDBY",
    cycle:fmt(Math.floor(secondsLeft/60)) + ":" + fmt(secondsLeft%60),
    elapsed:timeText(ms),
    shock:state.shock,epi:state.epi,rhythm:state.rhythm,room
  };
  for (const [key,val] of Object.entries(values)) {
    document.querySelectorAll('[data-bind="' + key + '"]').forEach(n => {
      if (n.textContent !== String(val)) n.textContent = val;
    });
  }
  document.querySelector(".live-label").className = "live-label" +
    (state.phase==="running"?" active":state.phase==="paused"?" paused":"");
  const log = document.getElementById("timeline");
  const events = state.timeline.slice(-12).reverse();
  const signature = events.map(e=>e.ts+e.label).join("|");
  if (log.dataset.signature !== signature) {
    log.dataset.signature=signature;
    log.replaceChildren();
    if (!events.length) {
      const empty=document.createElement("li");empty.className="empty";
      empty.textContent="ยังไม่มีเหตุการณ์";log.append(empty);
    } else {
      for (const e of events) {
        const li=document.createElement("li");
        const t=document.createElement("span");t.className="event-time";
        t.textContent=new Date(e.ts).toLocaleTimeString("th-TH",{hour12:false});
        const label=document.createElement("span");label.textContent=e.label;
        li.append(t,label);log.append(li);
      }
    }
  }
  for (const btn of document.querySelectorAll("[data-action]")) {
    const action=btn.dataset.action;
    const active=state.phase!=="standby";
    btn.disabled=!connected ||
      (action==="start" && active) ||
      (action==="pause" && state.phase!=="running") ||
      (action==="resume" && state.phase!=="paused") ||
      (action==="reset" && !active) ||
      (["shock","epi","rhythm"].includes(action) && !active);
  }
  const hint=document.getElementById("connectionHint");
  hint.textContent=!connected ? "OFFLINE — หน้าจออาจไม่ตรงกับเครื่องอื่น" :
    state.phase==="standby" ? "ONLINE — รอ Start CPR จาก Controller" :
    state.phase==="paused" ? "ONLINE — TIMER PAUSED" : "ONLINE — REALTIME CPR SESSION";
}
function status(state) {
  connected=state==="connected";
  const el=document.getElementById("connectionStatus");
  el.className="connection " + (state==="connected"?"on":state==="connecting"?"wait":"off");
  el.textContent=state==="connected"?"● CONNECTED":state==="connecting"?"● CONNECTING":"● DISCONNECTED";
  render();
}
function acceptEvent(obj) {
  if (!obj || typeof obj !== "object" || typeof obj.id!=="string" ||
      obj.id.length>110 || !ACTIONS.has(obj.type) ||
      !Number.isFinite(obj.ts) || Math.abs(Date.now()-obj.ts)>86400000 ||
      !Number.isSafeInteger(obj.seq) || messages.has(obj.id)) return false;
  if (messages.size>=500) {
    // Hard cap to avoid unbounded browser RAM in a public demo channel.
    const first=chronological()[0];
    if (first) messages.delete(first.id);
  }
  messages.set(obj.id,{id:obj.id,type:obj.type,ts:obj.ts,seq:obj.seq,value:obj.value});
  render();
  return true;
}
async function transmit(event,payload) {
  if (!connected || !channel) throw new Error("ยังไม่เชื่อมต่อ Realtime");
  const result=await channel.send({type:"broadcast",event,payload});
  if (result!=="ok") throw new Error("Broadcast failed: " + result);
}
function requestSync() {
  transmit("sync-request",{from:DEVICE_ID,at:Date.now()}).catch(err=>console.warn("Sync request",err));
}
async function handleAction(type,value) {
  if (!connected || tvMode) return;
  const state=computeState();
  if (type==="start" && state.phase!=="standby") return;
  if (type==="pause" && state.phase!=="running") return;
  if (type==="resume" && state.phase!=="paused") return;
  if (type==="reset" && state.phase==="standby") return;
  if (["shock","epi","rhythm"].includes(type) && state.phase==="standby") return;
  const e={id:DEVICE_ID+"-"+(++sequence),type,ts:Date.now(),seq:sequence,value};
  try {
    await transmit("cpr-event",e);
    acceptEvent(e);
  } catch (err) {
    alert("ส่งคำสั่งไม่สำเร็จ กรุณาตรวจการเชื่อมต่อ: "+err.message);
    status("offline");
  }
}
function setupChannel() {
  if (!supabase) return;
  status("connecting");
  channel=supabase.channel("cpr-demo-" + room,{
    config:{private:false,broadcast:{ack:true,self:false}}
  });
  channel
    .on("broadcast",{event:"cpr-event"},({payload})=>acceptEvent(payload))
    .on("broadcast",{event:"sync-request"},({payload})=>{
      if (!payload || payload.from===DEVICE_ID || messages.size===0) return;
      transmit("sync-response",{
        to:payload.from,
        from:DEVICE_ID,
        events:chronological().slice(-400)
      }).catch(err=>console.warn("Sync response",err));
    })
    .on("broadcast",{event:"sync-response"},({payload})=>{
      if (!payload || payload.to!==DEVICE_ID || !Array.isArray(payload.events)) return;
      for (const e of payload.events.slice(-400)) acceptEvent(e);
    })
    .subscribe(s=>{
      if (s==="SUBSCRIBED") {
        status("connected");
        requestSync();
      } else if (s==="CHANNEL_ERROR" || s==="TIMED_OUT" || s==="CLOSED") {
        status("offline");
      }
    });
}
async function enterRoom(v) {
  if (switchingRoom) return;
  switchingRoom=true;
  const normalized=roomClean(v);
  if (channel && supabase) {
    status("offline");
    await supabase.removeChannel(channel);
    channel=null;
  }
  room=normalized;
  messages=new Map();
  document.getElementById("roomInput").value=room;
  document.getElementById("roomLabel").textContent=room;
  const url=new URL(window.location.href);
  url.searchParams.set("room",room);
  window.history.replaceState({},"",url.toString());
  if (supabase) setupChannel();
  render();
  switchingRoom=false;
}
function makeLink(view) {
  const u=new URL(location.href);
  u.searchParams.set("room",room);
  if (view==="tv") u.searchParams.set("view","tv");
  else u.searchParams.delete("view");
  return u.toString();
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
document.getElementById("joinRoomBtn").addEventListener("click",()=>enterRoom(document.getElementById("roomInput").value));
document.getElementById("roomInput").addEventListener("keydown",e=>{
  if (e.key==="Enter") enterRoom(e.currentTarget.value);
});
document.getElementById("copyTvLink").addEventListener("click",()=>copyLink("tv"));
document.getElementById("copyControlLink").addEventListener("click",()=>copyLink("controller"));
document.querySelectorAll("[data-action]").forEach(btn=>
  btn.addEventListener("click",()=>handleAction(btn.dataset.action,btn.dataset.value))
);
window.addEventListener("online",()=>{
  if (supabase && !connected && !switchingRoom) requestSync();
});
setInterval(render,250);
render();
const url=String(cfg.supabaseUrl || "").trim();
const key=String(cfg.supabaseKey || "").trim();
if (/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url) &&
    /^(sb_publishable_|eyJ)/.test(key)) {
  supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  setupChannel();
} else {
  document.getElementById("setupNotice").hidden=false;
  status("offline");
}
