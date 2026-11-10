# CPR Live — Realtime Sync Prototype

ต้นแบบ CPR Realtime Sync ระหว่าง iPhone, iPad และ TV

- Static site: GitHub Pages
- Transport: Supabase Realtime Broadcast (public channel)
- ไม่ต้อง Login, ไม่ต้องมี PC/Mac server เปิดค้าง, ไม่สร้างฐานข้อมูล CPR
- ทดสอบด้วยข้อมูลจำลองเท่านั้น **ห้ามใช้บันทึกข้อมูลผู้ป่วยหรือใช้เป็นระบบช่วยตัดสินใจทางคลินิก**

## ติดตั้ง

1. สร้าง Supabase Project ที่ https://supabase.com/dashboard
2. เปิด **Realtime > Settings > Allow public access to channels** สำหรับการทดสอบเท่านั้น
3. เปิด **Project Connect** (หรือ Project Settings > API Keys) แล้วคัดลอก Project URL กับ **publishable key** (`sb_publishable_...`)
4. เปิดไฟล์ `config.js` ใน GitHub > Edit > ใส่ข้อมูล URL และ publishable key > Commit changes
5. GitHub Repo > Settings > Pages > Source: Deploy from a branch > Branch: main / (root) > Save
6. เปิดหน้า Controller ที่ `https://dimimaru.github.io/cpr-live/?room=ER-DEMO-01`
7. เปิดหน้า TV ที่ `https://dimimaru.github.io/cpr-live/?view=tv&room=ER-DEMO-01`
8. ตรวจว่าแสดง Connected ทั้งสองหน้าจอ แล้วกด Start / Shock / Epinephrine

## ข้อจำกัด

- สถานะอยู่ในหน่วยความจำของหน้าจอที่ออนไลน์ ไม่บันทึกลงฐานข้อมูล
- เมื่ออุปกรณ์ใหม่เข้ามา จะขอ Snapshot จากเครื่องที่ยังเปิดอยู่
- หากทุกเครื่องปิดหรือขาดการเชื่อมต่อพร้อมกัน สถานะจะสูญหาย
- ผู้ที่ทราบ Project URL, publishable key และ Room Code อาจส่งคำสั่งได้: **Public Channel ไม่ใช่ระบบควบคุมสิทธิ์**
- ไม่รองรับข้อมูลผู้ป่วย ไม่ปลอดภัยสำหรับการใช้ใน CPR จริง
- ต้องมีอินเทอร์เน็ต และอุปกรณ์ TV ต้องไม่ Sleep

## ไฟล์

- `index.html` หน้า Controller และ TV
- `styles.css` รูปลักษณ์ Responsive
- `app.js` Supabase Broadcast, Timeline และ CPR Timer
- `config.js` Project URL, publishable key และห้องเริ่มต้น (แก้ไขไฟล์นี้)

โค้ดชุดนี้เป็น Proof of Concept เท่านั้น
