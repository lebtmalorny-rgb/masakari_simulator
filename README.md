# Masakari FSM Simulator

Браузерный симулятор Masakari host failure recovery для OpenStack Epoxy 2025.1.

Симулятор показывает, как отказ сетевых интерфейсов compute-хоста проходит через Consul health vector, `matrix.yaml`, Masakari notification, taskflow и Nova evacuation.

## Запуск

Откройте файл:

```text
simulator/index.html
```

Backend и установка зависимостей не нужны. Приложение работает как статическая HTML-страница.

## Как пользоваться

1. Выберите сценарий в блоке `Сценарии`.
2. В `Топология` переключайте интерфейсы compute-хоста между `up` и `down`.
3. В `Health vector` смотрите текущий порядок `sequence: [manage, tenant, storage]`.
4. В `Matrix` смотрите, какой `health` превращается в какой `action`.
5. Нажимайте `Шаг`, чтобы пройти цепочку до Masakari notification и evacuation.
6. Нажмите `Сброс`, чтобы вернуть сценарий в исходное состояние.

## Проверка

```bash
cd simulator
npm test
npm run smoke
npm run verify
```

Подробная документация находится в [simulator/README.md](simulator/README.md).

