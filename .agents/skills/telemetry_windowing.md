# Skill: Time-Window Telemetry Fetching
Коли тебе просять створити ендпоінт для телеметрії поїздки, використовуй цей патерн:

1. НЕ ВИКОРИСТОВУЙ класичну сторінкову пагінацію (limit/offset).
2. Запит має базуватися виключно на часових межах `from_t` та `to_t`.
3. Використовуй SQLAlchemy 2.0 async session.

**Шаблон SQLAlchemy запиту:**
```python
query = select(TelemetrySample).where(
    TelemetrySample.trip_id == trip_id,
    TelemetrySample.t >= from_t,
    TelemetrySample.t <= to_t
).order_by(TelemetrySample.t.asc())