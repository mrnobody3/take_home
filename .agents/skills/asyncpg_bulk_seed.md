# Skill: Asyncpg Fast Bulk Insert
Коли тебе просять написати `seed.py` для 690,000+ записів, ЗАБОРОНЕНО використовувати ORM (SQLAlchemy `session.add` або `bulk_save_objects`).

1. Використовуй виключно `asyncpg.connect()` та метод `copy_records_to_table`.
2. Дані формуються в пам'яті як список кортежів (tuples):
   `records = [(trip_id, t, lat, lon, speed, fuel), ...]`
3. Виклик:
   ```python
   await conn.copy_records_to_table(
       'telemetry_samples',
       records=records,
       columns=['trip_id', 't', 'lat', 'lon', 'speed_kph', 'fuel_pct']
   )