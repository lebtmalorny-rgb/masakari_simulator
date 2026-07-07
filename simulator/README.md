# Masakari FSM Simulator

Автономный браузерный симулятор Masakari host failure recovery для OpenStack Epoxy 2025.1.

## Запуск

Откройте `simulator/index.html` в браузере.

Backend не нужен. npm-зависимости не нужны.

## Как задавать условия

1. Выберите сценарий в блоке `Сценарии`.
2. В блоке `Топология` переключите интерфейсы нужного compute-хоста между `up` и `down`.
3. Если нужно проверить debounce/stability, измените `monitoring_samples`.
4. Если нужно проверить другую policy, переключите action в строке `Matrix` между `[]` и `[recovery]`.
5. Нажимайте `Шаг`, пока симуляция не пройдет Consul observation, health vector, matrix matching, Masakari notification, taskflow и evacuation.
6. Используйте `Сброс`, чтобы вернуть выбранный сценарий в исходное состояние.

Обычно исходный хост — `compute-1`. На нем уже есть VM, поэтому отказы его интерфейсов показывают, будет ли запущена recovery-цепочка.

## Health vector и matrix

Симулятор использует порядок:

```text
sequence: [manage, tenant, storage]
```

Health vector строится в этом же порядке. Например:

```text
health: [up, up, down]
```

Это означает:

- `manage = up`;
- `tenant = up`;
- `storage = down`.

`matrix.yaml` сопоставляет stable vector с action:

```text
health: [up, up, down] -> action: [recovery]
health: [up, down, up] -> action: []
```

Если action содержит `recovery`, hostmonitor создает Masakari `COMPUTE_HOST STOPPED` notification. Если action пустой, recovery не запускается.

Если последние `monitoring_samples` наблюдений по интерфейсу не одинаковые, измерение считается `unstable`. Такой vector не совпадает со строкой matrix, пока не станет стабильным.

## Что означает action в matrix

`health` отвечает на вопрос "что сломалось?", а `action` отвечает на вопрос "что с этим делать?".

В этой симуляции используются два значения:

```text
action: []
```

Ничего не делать. Hostmonitor увидел stable vector, но не создает Masakari notification.

```text
action: [recovery]
```

Запустить восстановление. Hostmonitor создает `COMPUTE_HOST STOPPED` notification, после этого Masakari запускает host failure taskflow: отключение nova service, выбор VM и evacuation.

Примеры:

```text
health: [up, up, down] -> action: [recovery]
```

`storage` упал, поэтому matrix по умолчанию запускает recovery.

```text
health: [up, down, up] -> action: []
```

Упал только `tenant`, поэтому matrix по умолчанию не запускает recovery.

```text
health: [up, down, down] -> action: [recovery]
```

Упали `tenant` и `storage`, поэтому recovery запускается.

## Сети и интерфейсы

- `manage`: сеть управления. Через нее моделируются Consul, управление Nova service и путь Masakari monitor/API.
- `tenant`: сеть пользовательского трафика VM. Ее отказ показывает деградацию tenant/data path.
- `storage`: сеть доступа к хранилищу. В matrix по умолчанию отказ storage запускает recovery, потому что VM может потерять доступ к shared или block storage.

## Чем отличаются сценарии

Сценарии отличаются начальными условиями: какие интерфейсы уже находятся в `down`, какая matrix policy включена, есть ли подходящий destination host, используется ли reserved host и есть ли конфликтующий контекст Watcher.

| Сценарий | Начальные условия | Что показывает |
| --- | --- | --- |
| `Здоровое базовое состояние` | все сети `up` | recovery не запускается |
| `Изоляция storage` | `storage = down` на `compute-1` | matrix по умолчанию запускает `[recovery]` |
| `Изоляция только tenant` | `tenant = down` на `compute-1` | matrix по умолчанию возвращает `action: []` |
| `Down только manage` | `manage = down` на `compute-1` | recovery по matrix по умолчанию не запускается |
| `Tenant + storage down` | `tenant = down`, `storage = down` | recovery запускается |
| `Нестабильный интерфейс` | `storage` менялся, `monitoring_samples = 3` | vector должен стабилизироваться перед matrix matching |
| `Нет подходящего destination` | recovery нужна, но нет нормального host для evacuation | notification создается, но evacuation некуда выполнить |
| `Восстановление через reserved host` | обычный destination недоступен, есть reserved host | recovery идет через reserved `compute-3` |
| `Конфликт с Watcher` | recovery плюс активные Watcher audit/action plan/migration/pressure | Masakari работает, UI показывает предупреждения |
| `Измененная политика matrix` | `tenant = down`, но matrix изменена | tenant-only отказ тоже запускает recovery |

Главная разница между сценариями видна через цепочку:

```text
interfaces -> health vector -> matrix action -> Masakari notification -> evacuation
```

## Примеры экспериментов

### Storage down

1. Выберите сценарий `Изоляция storage`.
2. Нажимайте `Шаг`.
3. Stable vector станет `health: [up, up, down]`.
4. Matrix по умолчанию вернет `action: [recovery]`.
5. Masakari создаст notification и начнет evacuation HA-enabled VM.

### Tenant down

1. Выберите сценарий `Изоляция только tenant`.
2. Нажимайте `Шаг`.
3. Stable vector станет `health: [up, down, up]`.
4. Matrix по умолчанию вернет `action: []`.
5. Recovery не запустится.

### Tenant + storage down

1. Выберите сценарий `Tenant + storage down`.
2. Нажимайте `Шаг`.
3. Stable vector станет `health: [up, down, down]`.
4. Matrix по умолчанию вернет `action: [recovery]`.
5. Masakari запустит recovery.

### Измененная matrix policy

1. Выберите сценарий `Измененная политика matrix`.
2. Найдите строку `health: [up, down, up]`.
3. Переключите action в `[recovery]`, если он еще не включен.
4. Нажимайте `Шаг`.
5. Tenant-only отказ начнет запускать recovery, потому что policy изменена.

## Что моделируется точно

- Consul layers `manage`, `tenant`, `storage`;
- `monitoring_samples` и стабильный health vector;
- `matrix.yaml` с action `recovery`;
- `COMPUTE_HOST STOPPED` notification;
- Masakari host failure taskflow;
- Nova evacuation как rebuild на другом compute host;
- `vmove` статусы `pending`, `ongoing`, `succeeded`, `failed`.

## Что упрощено

- Nova scheduler filters/weighers;
- дерево resource provider в Placement;
- libvirt, Neutron, Cinder детали rebuild;
- внутренний автомат Watcher.

## Watcher

Watcher показан как наблюдаемый контекст и возможный конфликтующий актор. Он не является trigger для Masakari recovery, но может создавать предупреждения: активный audit, pending action plan, миграция VM и давление на Placement.

## Проверка

```bash
npm test
npm run smoke
npm run verify
```
