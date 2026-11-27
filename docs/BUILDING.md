# Сборка и запуск

Инструкция для Windows 10/11 x64. Проект не использует `electron-builder`: портативная сборка собирается вручную скриптами из `scripts/`. Архитектура — в [ARCHITECTURE](ARCHITECTURE.md), публикация — в [PUBLISHING](PUBLISHING.md).

## 1. Требования

| Компонент | Версия / примечание |
| --- | --- |
| ОС | Windows 10/11 x64 (Windows 10 1803+ желательно: нужен системный `tar`) |
| Node.js | 20 LTS или новее (`engines.node: ">=20"`); npm идёт в комплекте |
| npm | 10+ (lockfileVersion 3) |
| Свободное место | ~1–1,5 ГБ: `node_modules`, Electron runtime, `dist`, `release` |
| Сеть | `npm install`, загрузка Electron; `arduino-cli` — для установки ядер/библиотек |
| Python 3 + Pillow | только для перегенерации иконок (`pip install pillow`) |
| Git | не обязателен для сборки, нужен для публикации |

Административные права не требуются. Путь проекта может содержать пробелы и кириллицу; при экзотических ошибках инструментов проверьте длину пути и попробуйте короткий ASCII-путь.

## 2. Установка зависимостей

```powershell
cd "C:\Users\<user>\...\релиз"
npm install
```

Ставится Electron 33.4.11 (зафиксирован в `package-lock.json`), `esbuild`, Vite, TypeScript, React, CodeMirror 6, Zustand, `lucide-react` и runtime-зависимость `serialport` 13.

Для воспроизводимой установки в CI используется `npm ci`. Локально `npm install` удобнее, если вы меняете зависимости.

## 3. Запуск в режиме разработки

```powershell
npm run dev
```

Что происходит:

1. `scripts/dev.mjs` запускает esbuild в watch-режиме (`scripts/build-main.mjs --watch`) — пересборка `dist/main` и `dist/preload`.
2. Запускается Vite на `http://127.0.0.1:5178` (`strictPort: true`; порт занят — ошибка).
3. Скрипт ждёт ответа сервера (HEAD-запросы до 60 с) и стартует Electron с переменными `VITE_DEV_SERVER_URL` и `ZEDUINO_DEV=1`.
4. Renderer загружается с Vite (HMR). Изменения main/preload автоматически **не** перезапускают Electron: после правок в `src/main` или `src/preload` закройте окно и запустите `npm run dev` снова.

Проверка типов без сборки:

```powershell
npm run typecheck
```

## 4. Сборка

```powershell
npm run build
```

| Шаг | Команда | Результат |
| --- | --- | --- |
| main + preload | `node scripts/build-main.mjs` | `dist/main/index.js`, `dist/preload/index.js` (+ `.map`), CJS, target `node20` |
| renderer | `vite build` | `dist/renderer/index.html`, `dist/renderer/assets/*`, иконки |

`npm run build:main` и `npm run build:renderer` запускают шаги по отдельности. Renderer собирается с `base: './'`, поэтому `index.html` работает из `file://` внутри Electron.

Запуск собранного приложения без упаковки:

```powershell
npm run start
```

(нужен уже выполненный `npm run build`; Electron читает `main` из `package.json` → `dist/main/index.js`.)

## 5. Портативная сборка

```powershell
npm run package
```

`scripts/package.mjs` собирает `release\ZedArduinoIDE\`:

1. Проверяет наличие `node_modules/electron/dist/electron.exe` и `dist/renderer/index.html`; без них завершается с ошибкой.
2. Копирует runtime Electron (все файлы и папки, кроме `resources` и `electron.exe`).
3. Копирует `electron.exe` как `ZedArduinoIDE.exe` — это и есть исполняемый файл приложения.
4. Копирует `dist/` в `resources/app/dist`.
5. Пишет минимальный `resources/app/package.json`: `name`, `productName`, `version` из корневого `package.json`, `main: dist/main/index.js`, `dependencies: { serialport: <установленная версия> }`.
6. Копирует `README.md`, `HOW-TO-RUN.txt`, `install.ps1`, `uninstall.ps1`, `examples/`.
7. Копирует runtime-модули, которые вернёт `npm ls --omit=dev --parseable --all` (в первую очередь `serialport` и его дерево `@serialport/*`, `debug`, `node-gyp-build`, `node-addon-api` и т. д.), сохраняя структуру `node_modules`.
8. Кладёт `icon.ico` и создаёт ярлык `ZedArduino IDE.lnk` через `WScript.Shell` (не критично, ошибка ярлыка только предупреждает).

Итоговая папка портативная: `release\ZedArduinoIDE\ZedArduinoIDE.exe` запускается без установки. Установщика (NSIS/MSI) нет.

Архив для релиза:

```powershell
npm run zip
```

Создаёт `release\ZedArduinoIDE-1.0.0-win64.zip` через системный `tar -a` (Windows 10 1803+). Скрипт печатает размер; для версии 1.0.0 это ≈111 МиБ (116 445 346 байт), сам `ZedArduinoIDE.exe` — 188 784 128 байт (≈188,8 МБ в десятичных единицах).

Комбинированные команды:

| Команда | Действие |
| --- | --- |
| `npm run build` | main + preload + renderer |
| `npm run package` | упаковка (требует `build`) |
| `npm run zip` | архив (требует `package`) |
| `npm run dist` | `build` + `package` |
| `npm run release` | `build` + `package` + `zip` |
| `npm run check` | `typecheck` + `build` |

### Готовая сборка в `artifacts/`

В репозитории может лежать уже подготовленная папка `artifacts\ZedArduinoIDE\` и архив `artifacts\ZedArduinoIDE-1.0.0-win64.zip`. Скрипты её **не создают** и не обновляют — это снимок готового релиза. `artifacts/`, `dist/`, `release/` и `node_modules/` исключены в `.gitignore` и не коммитятся. Архив прикладывается к GitHub Release, а не к исходникам (см. [PUBLISHING](PUBLISHING.md)).

## 6. Electron без доступа к GitHub

При `npm install` пакет `electron` скачивает бинарник с GitHub. Если загрузка заблокирована:

### Вариант A: зеркало

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
npm install
```

`ELECTRON_MIRROR` должен указывать на каталог с релизами Electron; версия берётся из `node_modules/electron/package.json` / lock-файла.

### Вариант B: уже скачанный `node_modules/electron/dist`

Если Electron 33.x уже установлен в другом проекте или распакован вручную:

1. Скопируйте содержимое `dist` в `node_modules\electron\dist` этого проекта.
2. Убедитесь, что существует `node_modules\electron\dist\electron.exe`.
3. Проверьте `node_modules\electron\path.txt` (файл создаётся postinstall Electron и содержит имя бинарника, обычно `electron.exe`). Если его нет, создайте с содержимым `electron.exe`.
4. `npm run package` использует только `node_modules/electron/dist` и не обращается к сети.

Проверка: `npx electron --version` должен вывести версию Electron.

### Вариант C: proxy

Настройте `npm config set proxy`/`https-proxy` и переменные `HTTP_PROXY`/`HTTPS_PROXY`; для загрузки Electron может понадобиться `ELECTRON_GET_USE_PROXY=1` (поведение зависит от версии `@electron/get`).

## 7. Иконки

Иконка генерируется скриптом (Pillow):

```powershell
pip install pillow
python scripts/make-icon.py
```

Скрипт создаёт:

- `resources/icon.ico` — иконка приложения и ярлыка (размеры 16–256);
- `src/renderer/public/icon.ico` — иконка окна в dev/сборке;
- `src/renderer/public/icon.png` — PNG 512×512.

После перегенерации пересоберите renderer и упакуйте заново (`npm run build && npm run package`).

## 8. Где хранятся данные

| Что | Путь |
| --- | --- |
| Настройки (включая API-ключ ИИ) | `%APPDATA%\ZedArduino IDE\settings.json` |
| Сборка скетчей | `%APPDATA%\ZedArduino IDE\build\<slug-хеш>` |
| Скачанный `arduino-cli.exe` | `%APPDATA%\ZedArduino IDE\tools\arduino-cli.exe` |
| Данные Arduino: ядра, индексы, инструменты | `%LOCALAPPDATA%\Arduino15` |
| Скетчбук и библиотеки Arduino | `Документы\Arduino` (может быть `OneDrive\Documents\Arduino` или `OneDrive\Документы\Arduino`; выбирается эвристикой, см. [ARCHITECTURE](ARCHITECTURE.md#64-sketchbook)) |
| Дополнительные папки библиотек | задаются в настройках, используются при компиляции |
| Портативная сборка | `release\ZedArduinoIDE\` |
| Архив релиза | `release\ZedArduinoIDE-1.0.0-win64.zip` |

`settings.json` содержит ключ API в открытом виде — не копируйте его в репозиторий, скриншоты и issue.

## 9. Диагностика

### `npm install` не проходит: реестр из package-lock

`package-lock.json` (lockfileVersion 3) содержит `resolved`-URL на `https://registry.npmjs.org/`. В сети, где npmjs недоступен:

```powershell
npm config set registry https://registry.npmmirror.com
npm config get registry
npm install
```

Если `npm ci` продолжает обращаться к npmjs, временно пересоздайте lock-файл под зеркало:

```powershell
Remove-Item package-lock.json
npm install
```

Учтите: `resolved` в новом `package-lock.json` будут указывать на зеркало. Не коммитьте такой lock-файл в upstream без обсуждения; для локальной сборки это допустимо. Альтернатива — корпоративный proxy/offline-кэш npm.

### Electron не скачивается

См. раздел 6. Типичная ошибка упаковки:

```text
Electron runtime not found. Expected node_modules/electron/dist/electron.exe
```

означает, что `npm install` не завершил postinstall Electron или `dist` отсутствует.

### `arduino-cli не установлен` / платы и порты пусты

1. Откройте «Настройки → Ардуино»: там виден статус, версия и путь CLI.
2. Нажмите «Установить» — IDE скачает последний релиз с GitHub, при недоступности API попробует версии 1.2.2 / 1.1.1 / 1.0.4.
3. Если CLI уже есть, нажмите «Указать путь» и выберите `arduino-cli.exe`.
4. Нажмите «Обновить индекс»; без индекса `core search`, `lib search` и установка могут не работать.
5. Проверьте, что `%LOCALAPPDATA%\Arduino15` доступен на запись, а антивирус не блокирует `arduino-cli.exe`.
6. Для плат сторонних производителей добавьте URL менеджера плат в настройках и обновите индекс.

### Порт занят (`Access denied` / `Port busy`)

- Остановите монитор порта (`Ctrl+M` или кнопка в панели).
- Закройте монитор порта в Arduino IDE и другие терминалы (PuTTY, PlatformIO и т. п.).
- Не запускайте загрузку одновременно с монитором: IDE сама останавливает монитор перед compile/upload, но внешние программы она не закрывает.
- Если порт «завис» после сбоя загрузки — отключите и подключите плату, обновите список портов (он обновляется каждые 7 секунд).
- Проверьте драйвер USB-UART в диспетчере устройств; для клонов может понадобиться CH340/CP210x.

### `npm run package` падает

| Сообщение | Причина |
| --- | --- |
| `Renderer build missing` | нет `dist/renderer/index.html` → `npm run build` |
| `Electron runtime not found` | нет `node_modules/electron/dist/electron.exe` → `npm install` / раздел 6 |
| `npm ls` завершается ошибкой | повреждён `node_modules` → удалите его и повторите `npm install` |
| не создаётся ярлык | нет доступа к `WScript.Shell`/политика PowerShell; сама сборка остаётся рабочей |

### `npm run zip` падает

Нужен системный `tar` (bsdtar). В Windows 10 1803+ он есть в `C:\Windows\System32\tar.exe`. Проверка: `tar --version`. Старые сборки Windows — обновите ОС или создайте zip вручную из папки `release\ZedArduinoIDE`.

### Нет отправки в монитор порта

Если нативный `serialport` не загрузился (например, не скопирован runtime-модуль), IDE переключается на `arduino-cli monitor`: данные читаются, но отправка недоступна. Проверьте, что `serialport` установлен как production-зависимость и попал в `resources/app/node_modules` (см. список модулей при упаковке).

### SmartScreen предупреждает

Сборка не подписана. Это ожидаемо; для распространения нужна подпись кода (см. [PUBLISHING](PUBLISHING.md#9-подпись-кода-и-smartscreen)).

## 10. CI

| Workflow | Когда | Что делает |
| --- | --- | --- |
| `.github/workflows/build.yml` | push в `main`, pull request, ручной запуск | Node 20, `npm ci`, `typecheck`, `build`, `package`, `zip`, artifact `ZedArduinoIDE-win64` (14 дней) |
| `.github/workflows/release.yml` | push тега `v*`, ручной запуск | Node 20, `npm ci`, `npm run release`, публикация `release/*.zip` в GitHub Release |

Локально те же шаги: `npm run check && npm run package && npm run zip`.
