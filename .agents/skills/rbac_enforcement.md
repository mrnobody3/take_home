# Skill: Multi-tenant RBAC Enforcement
Коли ти створюєш роути або сервіси для FastAPI, ти ПОВИНЕН дотримуватися цієї логіки:

1. Усі роути захищені через залежність `get_current_user`.
2. Якщо `user.role == 'PLATFORM_STAFF'`, дозволити доступ до всіх `Vehicle` та `Trip`.
3. Якщо `user.role == 'DISPATCHER'`, перевірити:
   `if target_entity.carrier_id != user.carrier_id: raise HTTPException(status_code=403, detail="Forbidden")`
4. Фільтрація списків:
   Якщо DISPATCHER запитує `GET /vehicles`, додай до запиту `where(Vehicle.carrier_id == user.carrier_id)`.
5. НІКОЛИ не повертай порожній масив замість 403 помилки, якщо користувач намагається отримати доступ до чужого конкретного ID.