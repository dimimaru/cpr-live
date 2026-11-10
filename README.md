# CPR Live V0.4 — Realtime CPR screen sync (SIMULATION ONLY)

เว็บ Demo สำหรับทดสอบ Sync หน้า iPhone/iPad (Controller) กับ TV (Display) ผ่าน **GitHub Pages + Supabase Realtime Broadcast** ไม่ต้องมี PC Server และไม่สร้างตารางเก็บ CPR

> **ไม่ใช่อุปกรณ์ช่วยตัดสินใจทางการแพทย์ / ห้ามใช้กับผู้ป่วยจริง**: ไม่มี Login, การตรวจสอบสิทธิ์, ฐานข้อมูล, Audit Trail, การรับประกัน Delivery หรือเวลา Server ที่เป็นแหล่งอ้างอิงเดียว ห้ามใส่ข้อมูลผู้ป่วย การพูดและเสียงอาจไม่ทำงานเมื่อ TV Sleep/Browser Suspend

## ลิงก์

- Controller: https://dimimaru.github.io/cpr-live/?room=ER-DEMO-01
- TV Display: https://dimimaru.github.io/cpr-live/?view=tv&room=ER-DEMO-01

ให้เชื่อม ROOM เดียวกันทุกเครื่องจนแสดง CONNECTED
บน TV กด **🔊 เปิดเสียงบน TV / TEST SOUND** อย่างน้อยหนึ่งครั้งในทุกครั้งที่ Refresh เพื่อปลดล็อก Audio และ TTS ตามข้อจำกัด Browser

## V0.4 features

| Feature | Behavior |
|---|---|
| CPR CYCLE TIMER | **นับถอยหลัง** 02:00 → 00:01 → 02:00 รอบละ 2 นาที |
| Warning | ตั้งแต่เหลือ 00:10 จอแดงกระพริบเต็มจอ พร้อมเสียงพูดเตือนหนึ่งครั้ง และพูดเมื่อครบรอบ |
| TOTAL CASE TIME | **นับขึ้น** ต่อเนื่องจาก Start ครั้งแรก; ไม่หยุดขณะ ROSC |
| EPINEPHRINE TIMER | **นับขึ้น** จาก Start CPR หากยังไม่เคยบันทึกยา / Reset เมื่อกด Epinephrine; เตือนเมื่อครบ 04:00 (Demo Reminder) |
| Rhythm | VF/pVT และ PEA/Asystole; ตัวอักษร Rhythm บน TV ไม่ตัดเป็นหลายบรรทัด |
| Epinephrine emphasis | VF/pVT ก่อน Shock #2 ปุ่มไม่เด่น, หลัง Shock #2 เด่น; PEA/Asystole เด่นทันที; ยังสามารถบันทึกยาที่ให้จริงด้วยตนเอง |
| Amiodarone | ปุ่มแรก 300 mg; หลังบันทึกเปลี่ยนเป็น 150 mg; ทุกการกดเป็นการบันทึก ไม่ใช่ Auto Administer |
| Shock #2 | TV พูดให้ **เตรียม** Amiodarone 300 mg สำหรับหลัง Shock #3 |
| Shock #3 | แสดงปุ่ม 300 mg เด่น และพูดพิจารณาการให้หากยัง VF/pVT |
| Shock #4 | แสดงปุ่ม 150 mg สำหรับ **เตรียม** (สีอำพัน) ไม่สั่งให้ยาอัตโนมัติ; หากบันทึกยาที่ให้จริงก่อน Shock #5 จะมีหน้าต่างยืนยัน |
| Shock #5 | เน้นปุ่ม Amiodarone 150 mg ขนาดที่สอง (ตาม ERC 2025) |
| TV metronome | จังหวะ **105 beats/minute**, เปิดอัตโนมัติหลังปลดล็อก Audio ขณะ CPR Active; มีปุ่มเปิด/ปิดแยกจากเสียงพูด |
| Spoken feedback | TV พูด Start, Shock, Epinephrine, Amiodarone, Rhythm, EtCO₂, ROSC, Pause, Resume, Reset, CPR 2-minute alarm และยา 4-minute alert |
| ROSC | หยุด CPR cycle/metronome/alarm แต่ TOTAL CASE TIME ยังนับต่อ |
| Re-arrest | Start CPR ซ้ำแล้ว Reset รอบ CPR โดยคง TOTAL CASE TIME และ Timeline |
| EtCO₂ | บันทึกตัวเลข 0–150 mmHg และกระจายไปทุกจอ |

### ความแตกต่างของ Guideline ที่ควรทราบ

**แนวทางที่ใช้ใน Demo:** AHA ACLS 2025 เพื่อเน้น Epinephrine หลังการช็อกสองครั้งใน VF/pVT; ให้เร็วใน PEA/Asystole และเตือนทุก 4 นาที (ช่วงมาตรฐาน 3–5 นาที) ส่วน Amiodarone 300 mg หลัง Shock #3, ขนาดสอง 150 mg แนวทาง ERC 2025 ระบุหลัง Shock #5

AHA 2025 ให้ยา Epinephrine เมื่อการช็อกระยะแรกไม่สำเร็จ ขณะที่ ERC 2025 ระบุ Epinephrine เริ่มหลัง Shock #3 ใน shockable rhythm; โรงพยาบาลต้องเลือกและยืนยัน protocol ก่อนใช้งานจริง

- AHA 2025 Adult ALS: https://cpr.heart.org/en/resuscitation-science/cpr-and-ecc-guidelines/adult-advanced-life-support
- AHA High Quality CPR (100–120/min): https://cpr.heart.org/en/resuscitation-science/high-quality-cpr
- ERC Adult ALS 2025: https://www.resus.org.uk/cy/node/36438

## Acceptance checklist

- [ ] TV CONNECTED และเสียงทดสอบทำงานหลังคลิก Enable TV Sound
- [ ] กด Start บน iPhone, TV พูด Start และ CPR TIMER นับถอยหลัง
- [ ] 01:50 elapsed = 00:10 left: หน้าจอแดงและพูดเตือน
- [ ] เวลา Epi นับ **ขึ้น** และเตือนเมื่อผ่าน 04:00 หลังเริ่มหรือให้ยาครั้งล่าสุด
- [ ] Rhythm PEA/Asystole แสดงเต็มบรรทัดบน TV
- [ ] Shock #1: VF/pVT Epinephrine ยังไม่เด่น
- [ ] Shock #2: VF/pVT Epinephrine เด่น + TV พูดเตรียม Amiodarone 300 mg
- [ ] Shock #3: Amiodarone 300 mg เด่น; กดแล้วเปลี่ยนปุ่มเป็น 150 mg
- [ ] Shock #4: ปุ่ม 150 mg สีอำพันสำหรับเตรียม; หากกดบันทึกก่อน #5 มีคำเตือน
- [ ] Shock #5: ปุ่ม 150 mg เด่น; กดบันทึกแล้ว TV พูดขนาดยา
- [ ] Rhythm PEA/Asystole: Epinephrine เด่นทันที
- [ ] ขณะ CPR active มีจังหวะ 105 BPM บน TV (Toggle ได้)
- [ ] ROSC หยุด Metronome และ CPR Alarm แต่ TOTAL CASE TIME เดินต่อ
- [ ] Re-arrest เริ่มรอบ CPR ใหม่แต่ TOTAL CASE TIME/Timeline เดิมยังอยู่

## Known limitations

- Public Channel สามารถถูกส่งคำสั่งจำลองจากผู้ที่ทราบ URL/Room Code ได้ ไม่ปลอดภัยต่อข้อมูลจริง
- ตัวจับเวลาใช้ Date.now ของแต่ละอุปกรณ์ ไม่มี authoritative server clock หรือ event durability
- TTS ภาษาไทยขึ้นกับ TV / Browser / voice package; บาง TV ได้เสียง beep แต่ไม่มี Thai voice
- Browser อาจระงับ Timer/Audio เมื่อเปิดค้างเป็นเวลานานหรือเมื่อ Screen Sleep
- ไม่มีเสียงเตือนหรือบทพูดใดที่รับประกันการเล่นทันเวลา
- การแจ้งเตือนยาเป็นเพียงตัวช่วยทดสอบการนำเสนอ ไม่ใช่คำสั่งรักษา

ไฟล์หลัก: index.html, styles.css, app.js, config.js
