# Masakari FSM Simulator

Браузерный симулятор Masakari host failure recovery для OpenStack Epoxy 2025.1.

Симулятор показывает, как отказ сетевых интерфейсов compute-хоста проходит через Consul health vector, `matrix.yaml`, опциональный Redfish fencing, Masakari notification, taskflow и Nova evacuation.

## Запуск

Запустите статический сервер:

```bash
cd simulator
npm run serve
```

Затем откройте:

```text
http://localhost:8765/
```

Backend и установка зависимостей не нужны. Сервер только раздает статические файлы, чтобы браузер корректно загрузил ES modules.

## Как пользоваться

1. Выберите сценарий в блоке `Сценарии`.
2. В `Топология` переключайте интерфейсы compute-хоста между `up` и `down`.
3. В `Matrix` смотрите default или custom policy, разложенную на две плоскости `storage = up/down`.
4. В `Fencing` включите или выключите Redfish fencing и выберите ожидаемый результат Redfish-вызова.
5. В `Health vector` смотрите текущий порядок `sequence: [manage, tenant, storage]`.
6. Если нужно проверить другую policy, переключите ячейку `Matrix` между `[]` и `[recovery]`. Это меняет policy, а не состояние интерфейсов.
7. Нажимайте `Шаг`, чтобы пройти цепочку до Masakari notification и evacuation. При включенном fencing Redfish должен успешно завершиться до notification.
8. Нажмите `Сброс`, чтобы вернуть сценарий в исходное состояние.

Не все параметры в блоках `Masakari monitor` и `Masakari recovery` сейчас влияют на результат симуляции. Подробная таблица находится в разделе `Какие параметры влияют на моделирование` в [simulator/README.md](simulator/README.md).

## Проверка

```bash
cd simulator
npm test
npm run smoke
npm run verify
```

Подробная документация находится в [simulator/README.md](simulator/README.md).
