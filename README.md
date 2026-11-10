# CPR Live V0.3 — Realtime CPR screen sync (DEMO ONLY)

ระบบตัวอย่างสำหรับทดสอบการ Sync หน้าจอ CPR ระหว่าง iPhone/iPad และ TV ผ่าน GitHub Pages + Supabase Realtime Broadcast

**⚠️ ยังไม่ใช่ซอฟต์แวร์ทางการแพทย์**: ไม่มี Login, การตรวจสอบสิทธิ์, durable storage, server-authoritative clock หรือการรับประกัน delivery. ห้ามใส่ชื่อหรือข้อมูลผู้ป่วย และห้ามใช้เป็นแหล่งข้อมูลหลักในการกู้ชีพจริง

## เปิดเว็บ

- Controller: https://dimimaru.github.io/cpr-live/?room=ER-DEMO-01
- TV Display: https://dimimaru.github.io/cpr-live/?view=tv&room=ER-DEMO-01

ใช้ Room Code เดียวกันทุกจอ ให้สถานะเป็น **CONNECTED** ก่อนเริ่มทดสอบ

## เปิดเสียงบน TV

1. เปิด URL TV Display แล้วรอ CONNECTED
2. **กดปุ่ม 🔊 เปิดเสียงบน TV / TEST SOUND บนทีวีหนึ่งครั้ง**
3. ตรวจว่ามีเสียงพูดทดสอบ + เสียงบี๊บ และ TV ไม่ได้ปิดเสียง/ลด Volume
4. เปิดหน้า Controller บน iPhone/iPad แล้วกด START CPR
5. TV จะพูดเหตุการณ์ที่บันทึกจากอุปกรณ์ควบคุม

Web Speech API ขึ้นกับ Browser/OS/แพ็กเกจเสียงภาษาไทยของ TV:
- บาง TV อาจพูดภาษาไทยไม่ได้ แม้ WebSocket จะแสดง CONNECTED
- Web Audio และ Speech Synthesis ต้องได้รับ user gesture บน TV ตามนโยบาย Autoplay
- หลัง Refresh หน้า TV อาจต้องกดเปิดเสียงใหม่
- ถ้า TV Sleep หรือ Browser ถูกพัก การเตือนอาจล่าช้าหรือไม่เล่นเสียง

## ฟังก์ชัน V0.3

| รายการ | รายละเอียด |
|---|---|
| CPR Clock | นับขึ้น 00:00 → 01:59 แล้วเริ่มรอบใหม่ทุก 2 นาที |
| 10-second alert | ช่วง 01:50–01:59 ของทุกรอบ แดงกระพริบเต็มจอพร้อมเสียงเตือน |
| At 2 min | เสียงแจ้งครบรอบ 2 นาที |
| Epinephrine Timer | นับขึ้นเริ่มจาก Start CPR (หากยังไม่บันทึกยา) และรีเซ็ตเมื่อกด Epinephrine +1 |
| 4 min reminder | เมื่อถึง 04:00 มีเสียงเตือนหนึ่งครั้งต่อรอบการจับเวลายา ระหว่าง CPR |
| EtCO₂ | กรอกเลข 0–150 mmHg แล้วกดบันทึก Sync และพูดตัวเลขบน TV |
| ROSC | หยุด CPR cycle/alarms, แสดง ROSC แต่ Total Case Time ยังเดินต่อ |
| Re-arrest | กด Start CPR ซ้ำในสถานะ ROSC เพื่อเริ่มรอบ CPR ใหม่ โดย Total Case Time และจำนวน Shock/Epinephrine เดิมยังอยู่ |
| Pause / Resume | หยุด/เดินต่อ CPR cycle และ Epinephrine timer ชั่วคราว แต่ Total Case Time ยังเดิน |
| TV Voice | TV พูดทุก event ใหม่ที่เข้ามา ไม่อ่าน Timeline เก่าซ้ำเมื่อ reconnect |

### ตรรกะเวลา

- TOTAL CASE TIME = เวลาจริงจาก Start CPR ครั้งแรก (รวมช่วง ROSC)
- CPR CYCLE = รอบ CPR ของ episode ปัจจุบัน นับขึ้นและรีเซ็ตรอบทุก 2 นาที
- EPINEPHRINE TIMER = ตั้งแต่ Start หรือการบันทึกยาล่าสุด; หยุดระหว่าง Pause; เดินต่อระหว่าง ROSC โดยไม่มี Alarm; เมื่อ Re-arrest ถ้าเคยบันทึกยาแล้วจะยังอิงยาครั้งล่าสุด
- RESET = ล้าง session จากหน้าจอที่ยังออนไลน์และกลับ Standby

**4 นาทีเป็น Reminder สำหรับ Demo ไม่ใช่คำสั่งให้ยาอัตโนมัติ** แนวทาง AHA 2025 Adult Cardiac Arrest ระบุ epinephrine ทุก 3–5 นาที และกำหนดจังหวะการรักษาตาม Rhythm
https://professional.heart.org/-/media/CPR-Files/CPR-Guidelines-Files/2025-Algorithms/Algorithm-ACLS-CA-250527.pdf

## ตั้งค่าครั้งแรก (ถ้าทำแล้วไม่ต้องทำซ้ำ)

1. Supabase Project: Realtime > Settings > Enable Realtime = ON
2. Allow public access to channels = ON (เฉพาะ Demo)
3. GitHub Pages: Branch main, Folder /(root)
4. config.js: ใส่ Project URL และ publishable key เท่านั้น
5. ห้ามใส่ service_role, secret key, database password หรือข้อมูลผู้ป่วยลง GitHub

## ทดสอบ V0.3

- [ ] TV Connected และกดเปิดเสียงบน TV แล้วมีเสียงทดสอบ
- [ ] กด Start จากมือถือ: ทุกจอเห็นการนับขึ้น และ TV พูด Start
- [ ] กด Shock, Epinephrine, Rhythm, EtCO₂: TV พูดทันที ทุกจอเปลี่ยนตาม
- [ ] CPR 01:50: ทุกจอเตือนแดง 10 วินาที และ TV พูดเตือน
- [ ] CPR 02:00: TV พูดครบรอบ, CPR cycle เริ่มนับใหม่
- [ ] Epinephrine 04:00: TV พูดเตือนหนึ่งครั้ง; กด Epinephrine แล้วกลับ 00:00
- [ ] ROSC: Total Case Time ยังนับ; CPR cycle/alert หยุด
- [ ] Re-arrest / Start CPR: CPR cycle เริ่ม 00:00 แต่ Total Case Time และเหตุการณ์เก่ายังอยู่
- [ ] Refresh TV และกดเปิดเสียงใหม่: แสดงข้อมูลตรง Controller โดยไม่อ่าน Timeline เดิมซ้ำ

## ข้อจำกัด

Supabase Public Channel ใช้ทดสอบเท่านั้น: ใครทราบ Room Code และค่า Public ของ Project อาจส่งข้อความจำลองได้; เมื่อทุกจอปิดพร้อมกันข้อมูลจะหาย. ไม่มีการรับประกัน Event Delivery, ไม่มี audit trail, ไม่มีการเทียบเวลา Server อย่างเข้มงวด และไม่เหมาะสำหรับการใช้งานกับผู้ป่วยจริง.

Files: index.html, styles.css, app.js, config.js
