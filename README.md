# Masakari FSM Simulator

Браузерный симулятор Masakari host failure recovery для OpenStack Epoxy 2025.1.

Симулятор показывает, как отказ сетевых интерфейсов compute-хоста проходит через Consul health vector, `matrix.yaml`, Masakari notification, taskflow и Nova evacuation.

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
4. В `Health vector` смотрите текущий порядок `sequence: [manage, tenant, storage]`.
5. Если нужно проверить другую policy, переключите ячейку `Matrix` между `[]` и `[recovery]`. Это меняет policy, а не состояние интерфейсов.
6. Нажимайте `Шаг`, чтобы пройти цепочку до Masakari notification и evacuation.
7. Нажмите `Сброс`, чтобы вернуть сценарий в исходное состояние.

## Проверка

```bash
cd simulator
npm test
npm run smoke
npm run verify
```

Подробная документация находится в [simulator/README.md](simulator/README.md).
