# Прототип FiberTrack (один HTML-файл)

Кликабельный прототип всех экранов на реальных данных заказчика. Не заменяет рабочую версию
(Next.js + FastAPI + PostgreSQL): права здесь демонстрационные, ввод хранится в браузере.

Сборка (данные заказчика в git не попадают):

    python3 -I prototype/build.py путь/прибыль_по_машинам.xlsx путь/парк.xlsx prototype/dist/FiberTrack.html

Открыть `prototype/dist/FiberTrack.html` в браузере. Параметры адреса: `?role=admin|viewer|input`, `?theme=dark`.

- `build_data.py` — разбор xlsx: график (2023–2026), прибыль, «АВТО», заправки, «Анализ простоев»; всё несопоставленное — в список «Проверить».
- `app.js`, `app.css`, `shell.html` — интерфейс; ECharts берётся из `mockup/vendor`.
