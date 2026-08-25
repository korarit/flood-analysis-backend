### API สำหรับน้ำฝน
[GET] https://twa-api-public.thaiwater.net/data/platform/v1/public/rainfall_c60/graph?timezone=7&stationId=133528&limit=-1&sort=measureAt&interval=hourly&startDate=2026-08-22%2003%3A00&endDate=2026-08-23%2003%3A00


ได้รายการฝนต่อชั่วโมง หน่วยเป็น มิลลิเมตร ต่อชั่วโมง ซึ่ง ถ้าเป็น null คือยังไม่มีข้อมูล


### API สำหรับดึงข้อมูลระดับน้ำ
[GET] https://twa-api-public.thaiwater.net/data/platform/v1/public/tele_waterlevel/graph?stationId=8892&startDate=2026-08-16%2000%3A00&endDate=2026-08-23%2023%3A59&limit=-1

ได้รายการระดับน้ำต่อชั่วโมง เป็นเมตรเทียบกับระดับน้ำทะเล คือ value
ส่วน discharge คือ ปริมาณน้ำที่ไหลผ่านต่อวินาที เป็น ลบ.ม/วิ แต่ไม่ได้มีทุกสถานีวัด


