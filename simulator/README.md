# Masakari FSM Simulator

Автономный браузерный симулятор Masakari host failure recovery для OpenStack Epoxy 2025.1.

## Запуск

Запустите статический сервер из каталога `simulator`:

```bash
npm run serve
```

Затем откройте:

```text
http://localhost:8765/
```

Backend не нужен. npm-зависимости не нужны. Сервер только раздает статические файлы, чтобы браузер корректно загрузил ES modules.

## Как задавать условия

1. Выберите сценарий в блоке `Сценарии`.
2. В блоке `Топология` переключите интерфейсы исходного compute-хоста между `up` и `down`. Интерфейсы destination-host показаны read-only.
3. Если нужно проверить debounce/stability, измените `monitoring_samples`.
4. В блоке `Fencing` включите или выключите Redfish fencing. Для включенного fencing выберите ожидаемый результат Redfish-вызова: `success`, `failed` или `unreachable`.
5. Если нужно проверить другую policy, переключите ячейку `Matrix` между `[]` и `[recovery]`. Это меняет policy, а не состояние интерфейсов.
6. Нажимайте `Шаг`, пока нижний pipeline не пройдет Consul observe, Health vector, Matrix match, optional Redfish fencing, Masakari notification, Taskflow и Nova evacuate.
7. Используйте `Сброс`, чтобы вернуть выбранный сценарий в исходное состояние.

Обычно исходный хост — `compute-1`. На нем уже есть VM, поэтому отказы его интерфейсов показывают, будет ли запущена recovery-цепочка. Интерфейсы `compute-2` и `compute-3` сейчас не редактируются в UI: eligibility destination-host моделируется через Nova service state, maintenance, capacity и reserved flag, а не через состояние `manage/tenant/storage`.

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

Если action содержит `recovery`, hostmonitor должен запустить recovery-цепочку. При выключенном fencing симулятор сразу создает Masakari `COMPUTE_HOST STOPPED` notification и показывает warning про split-brain risk. При включенном fencing сначала выполняется Redfish fencing; notification создается только после успешного fencing. Если action пустой, recovery не запускается.

Если последние `monitoring_samples` наблюдений по интерфейсу не одинаковые, измерение считается `unstable`. Такой vector не совпадает с ячейкой matrix, пока не станет стабильным.

В UI matrix показана как нейтральный список всех health vector в порядке `sequence`. Так ни один интерфейс не выделяется как главный разрез, а при выборе другого сценария форма matrix остается одинаковой:

```text
2 x 2 x 2 = 8
```

Каждая строка показывает один health vector и action для него. Кнопка action переключается между `[]` и `[recovery]`. Переключение action меняет policy, а не состояние интерфейсов.

Над matrix UI показывает policy:

- `policy: default matrix` — текущая matrix совпадает с default policy;
- `policy: custom matrix` — хотя бы одна ячейка отличается от default policy.

Измененные от default policy ячейки подсвечиваются янтарной отметкой.

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

Запустить восстановление. Если fencing выключен, hostmonitor сразу создает `COMPUTE_HOST STOPPED` notification, после этого Masakari запускает host failure taskflow: отключение nova service, выбор VM и evacuation. Если fencing включен, Redfish fencing должен успешно завершиться до создания notification.

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

## Fencing через Redfish

Fencing в симуляторе опционален, чтобы можно было сравнить оба режима:

- `enabled = false`: Masakari recovery продолжается без fencing, но UI показывает предупреждение про split-brain risk.
- `enabled = true`, `expected result = success`: симулятор выполняет Redfish fencing, затем создает Masakari notification и продолжает evacuation.
- `enabled = true`, `expected result = failed`: Redfish fencing не завершился, Masakari notification не создается, evacuation блокируется.
- `enabled = true`, `expected result = unreachable`: BMC/Redfish endpoint недоступен, recovery также блокируется до ручного вмешательства.

С точки зрения best practice fencing должен происходить после того, как `matrix` выбрала `action: [recovery]`, но до Masakari notification, taskflow и evacuation. Это защищает от ситуации, когда исходный compute-host еще жив или частично жив, а VM уже пытаются поднять на другом host.

## Сети и интерфейсы

- `manage`: сеть управления. Через нее моделируются Consul, управление Nova service и путь Masakari monitor/API.
- `tenant`: сеть пользовательского трафика VM. Ее отказ показывает деградацию tenant/data path.
- `storage`: сеть доступа к хранилищу. В matrix по умолчанию отказ storage запускает recovery, потому что VM может потерять доступ к shared или block storage.

## Чем отличаются сценарии

Сценарии отличаются начальными условиями: какие интерфейсы уже находятся в `down`, какая matrix policy включена, включен ли Redfish fencing, есть ли подходящий destination host, используется ли reserved host и есть ли конфликтующий контекст Watcher.

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
| `Redfish fencing успешен` | `storage = down`, fencing включен, Redfish возвращает `success` | notification и evacuation начинаются только после fencing |
| `Redfish fencing failed` | `storage = down`, fencing включен, Redfish возвращает `failed` | notification не создается, evacuation блокируется |

Главная разница между сценариями видна через цепочку:

```text
interfaces -> health vector -> matrix action -> optional Redfish fencing -> Masakari notification -> evacuation
```

## Нижний pipeline

Нижняя строка UI показывает не значения state, а последовательность вызовов и шагов:

```text
Consul observe -> Health vector -> Matrix match -> Redfish fencing -> Masakari notification -> Taskflow -> Nova evacuate
```

У каждого шага есть статус:

- `pending`: до шага еще не дошли;
- `active`: текущий шаг;
- `done`: шаг выполнен;
- `skipped`: шаг не нужен для выбранного health/policy, например fencing выключен или matrix вернула `action: []`;
- `blocked`: шаг заблокировал дальнейшую recovery-цепочку, например Redfish fencing вернул `failed` или `unreachable`.

## Какие параметры влияют на моделирование

Не все параметры, показанные в UI, сейчас меняют результат симуляции. Часть параметров моделируется, часть оставлена как справочный контекст Masakari config.

| Блок UI | Параметр | Влияет на результат? | Как именно |
| --- | --- | --- | --- |
| `Masakari monitor` | `monitoring_samples` | да | Задает размер окна стабильности health vector. Если последние N наблюдений по интерфейсу не совпали, vector остается `unstable`, matrix matching и recovery откладываются. |
| `Masakari monitor` | `api_retry_max` | нет | Сейчас только отображается и может меняться в state. Retry вызовов Masakari API не моделируется. |
| `Masakari monitor` | `api_retry_interval` | нет | Сейчас только отображается и может меняться в state. Задержка между retry не моделируется. |
| `Masakari monitor` | `monitoring_driver`, `agent_manage`, `agent_tenant`, `agent_storage` | нет | Это справочные значения, показывающие, что модель основана на Consul layers. |
| `Fencing` | `enabled` | да | Если включен, recovery останавливается на Redfish fencing до создания Masakari notification. |
| `Fencing` | `expected result` | да | `success` пропускает recovery дальше, `failed` и `unreachable` блокируют notification и evacuation. |
| `Fencing` | `driver`, `verify_power_off`, `endpoint`, `timeout` | частично | `driver` и `verify_power_off` отображаются в UI, `endpoint` попадает в event log при success. Реальный HTTP-вызов Redfish, timeout и проверка power state не моделируются. |
| `Masakari recovery` | `duplicate_notification_detection_interval` | да | Используется для подавления повторного `COMPUTE_HOST STOPPED` notification в заданном окне. |
| `Masakari recovery` | `evacuate_all_instances` | да, но не редактируется из UI | В коде влияет на выбор VM для evacuation: все VM или только HA-enabled. Сейчас в UI отображается как read-only. |
| `Masakari recovery` | `ignore_instances_in_error_state` | да, но не показан в UI | В коде может исключать VM в `error` из evacuation selection. |
| `Masakari recovery` | `service_disable_reason` | частично | Записывается в причину disable nova-compute, но не меняет исход recovery. |
| `Masakari recovery` | `wait_period_after_service_update`, `wait_period_after_evacuation`, `wait_period_after_power_off`, `host_failure_recovery_threads` | нет | Сейчас задержки, power-off wait и параллелизм taskflow не моделируются. |

Коротко: из редактируемых параметров UI на итоговый ход симуляции сейчас реально влияют `monitoring_samples`, `Fencing enabled`, `Fencing expected result` и matrix policy. Остальные параметры либо справочные, либо участвуют в кодовой модели, но пока не вынесены как интерактивные настройки.

## Примеры экспериментов

### Storage down

1. Выберите сценарий `Изоляция storage`.
2. Нажимайте `Шаг`.
3. Stable vector станет `health: [up, up, down]`.
4. Matrix по умолчанию вернет `action: [recovery]`.
5. Если fencing выключен, Masakari создаст notification и начнет evacuation HA-enabled VM с warning про split-brain risk.

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
2. В matrix найдите строку `health: [up, down, up]`.
3. Переключите action в `[recovery]`, если он еще не включен.
4. Нажимайте `Шаг`.
5. Tenant-only отказ начнет запускать recovery, потому что policy изменена.

### Redfish fencing success

1. Выберите сценарий `Redfish fencing успешен`.
2. Нажимайте `Шаг`.
3. Stable vector станет `health: [up, up, down]`.
4. Matrix по умолчанию вернет `action: [recovery]`.
5. Redfish fencing завершится со статусом `succeeded`.
6. После этого Masakari создаст notification и продолжит evacuation.

### Redfish fencing failed

1. Выберите сценарий `Redfish fencing failed`.
2. Нажимайте `Шаг`.
3. Stable vector станет `health: [up, up, down]`.
4. Matrix по умолчанию вернет `action: [recovery]`.
5. Redfish fencing завершится со статусом `failed`.
6. Masakari notification не создастся, evacuation не начнется.

## Что моделируется точно

- Consul layers `manage`, `tenant`, `storage`;
- `monitoring_samples` и стабильный health vector;
- `matrix.yaml` с action `recovery`;
- опциональный Redfish fencing перед notification;
- `COMPUTE_HOST STOPPED` notification;
- Masakari host failure taskflow;
- Nova evacuation как rebuild на другом compute host;
- `vmove` статусы `pending`, `ongoing`, `succeeded`, `failed`.

## Что упрощено

- Nova scheduler filters/weighers;
- дерево resource provider в Placement;
- libvirt, Neutron, Cinder детали rebuild;
- реальные BMC/Redfish HTTP-вызовы и проверка power state;
- внутренний автомат Watcher.

## Watcher

Watcher показан как наблюдаемый контекст и возможный конфликтующий актор. Он не является trigger для Masakari recovery, но может создавать предупреждения: активный audit, pending action plan, миграция VM и давление на Placement.

## Проверка

```bash
npm test
npm run smoke
npm run verify
```
