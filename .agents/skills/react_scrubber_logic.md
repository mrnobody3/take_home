# Skill: React TanStack Query Windowing
Коли розробляєш `useTripReplay` або логіку повзунка (timeline), використовуй цей підхід:

1. Загальна тривалість: `duration = 86400`.
2. Поточний час зберігається в стані: `const [currentTime, setCurrentTime] = useState(0)`.
3. Розмір чанка: `CHUNK_SIZE = 600`.
4. Обчислення поточного вікна:
   `const chunkIndex = Math.floor(currentTime / CHUNK_SIZE);`
   `const fromT = chunkIndex * CHUNK_SIZE;`
   `const toT = fromT + CHUNK_SIZE;`
5. Запит через TanStack Query v5:
   ```typescript
   useQuery({
     queryKey: ['telemetry', tripId, chunkIndex],
     queryFn: () => fetchTelemetry(tripId, fromT, toT),
     staleTime: Infinity, // Критично важливо! Дані ніколи не протухають
   })