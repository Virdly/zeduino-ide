# Сторонние компоненты и лицензии

ZedArduino IDE распространяется под лицензией GNU AGPL-3.0 (см. [LICENSE](LICENSE)). Ниже перечислены сторонние компоненты, которые используются в исходниках и/или входят в portable-сборку. Полные тексты лицензий находятся в пакетах (`node_modules/<пакет>/LICENSE`) и в файле `LICENSES.chromium.html`, который поставляется вместе с Electron.

## 1. Runtime и библиотеки

| Компонент | Версия в 1.0.0 | Лицензия | Как попадает в сборку |
| --- | --- | --- | --- |
| Electron | 33.4.11 | MIT | runtime `ZedArduinoIDE.exe` и `resources/` |
| Chromium (в составе Electron) | в составе Electron 33 | BSD-подобные и сторонние лицензии Chromium | `LICENSES.chromium.html` рядом с `ZedArduinoIDE.exe` |
| Node.js (в составе Electron) | в составе Electron 33 | MIT | внутри Electron |
| React / React DOM | 18.3.1 | MIT | `dist/renderer` |
| CodeMirror 6: `@codemirror/state`, `view`, `commands`, `language`, `autocomplete`, `search`, `lint`, `lang-cpp` | 6.x (по lock-файлу) | MIT | `dist/renderer` |
| Lezer: `@lezer/highlight` (и транзитивные `@lezer/common`, `@lezer/lr`, `@lezer/cpp`) | 1.x | MIT | `dist/renderer` |
| Zustand | 4.5.7 | MIT | `dist/renderer` |
| lucide-react | 0.462.0 | ISC | `dist/renderer` (иконки) |
| serialport | 13.0.0 | MIT | `resources/app/node_modules` |
| `@serialport/*` (bindings-cpp, parser-*, stream) | 13.x | MIT | транзитивные зависимости serialport |
| `node-gyp-build`, `node-addon-api`, `debug` | по lock-файлу | MIT | транзитивные зависимости serialport |
| esbuild | 0.24.2 | MIT | инструмент сборки (в поставку не входит) |
| Vite | 5.4.21 | MIT | инструмент сборки (в поставку не входит) |
| TypeScript | 5.9.3 | Apache-2.0 | инструмент сборки (в поставку не входит) |

Версии зафиксированы в `package-lock.json`; при обновлении зависимостей обновляйте и эту таблицу.

## 2. arduino-cli

| Компонент | Лицензия | Статус |
| --- | --- | --- |
| `arduino-cli` | **GPLv3** | **Не входит в поставку.** IDE находит установленный CLI (PATH, Arduino IDE) или скачивает его отдельно по действию пользователя в `%APPDATA%\ZedArduino IDE\tools\arduino-cli.exe` |

`arduino-cli` — отдельная программа, которая вызывается как внешний процесс. Её исходники и условия распространения: <https://github.com/arduino/arduino-cli>.

Если вы планируете включать `arduino-cli` в свой дистрибутив (а не скачивать отдельно), необходимо соблюдать GPLv3: предоставить исходный код, уведомления и предложение исходников. Текущая сборка этого не делает.

## 3. Полные тексты

- Electron: `node_modules/electron/LICENSE` (в исходниках) и `LICENSE`/`LICENSES.chromium.html` в составе runtime.
- Chromium и другие компоненты Electron: `LICENSES.chromium.html` (≈9 МБ) лежит в корне portable-сборки рядом с `ZedArduinoIDE.exe`; **не удаляйте его** при переупаковке.
- Остальные пакеты: файлы `LICENSE`/`LICENSE.md` в соответствующих каталогах `node_modules`.
- Лицензия проекта: [LICENSE](LICENSE) (GNU AGPL-3.0).

## 4. Торговые марки и отказ от связи

Arduino® и логотип Arduino — торговые марки Arduino S.r.l. (Италия). Zed и логотип Zed — торговые марки Zed Industries.

ZedArduino IDE — независимый проект. Он **не связан** с Arduino S.r.l., Arduino LLC и Zed Industries, не одобрен и не спонсируется ими. Названия «Arduino» и «Zed» используются только для описания совместимости и вдохновения дизайном; проект не является официальной сборкой Arduino IDE, Zed или Theia и не распространяет их логотипы.

## 5. Замечания по распространению

- Проект распространяется под AGPL-3.0: при распространении сборки или предоставлении доступа к ней по сети необходимо предоставить соответствующий исходный код. Сторонние компоненты сохраняют свои лицензии (в основном MIT).
- `scripts/package.mjs` копирует Electron runtime (включая `LICENSE` Electron и `LICENSES.chromium.html`), а также файлы проекта `README.md`, `HOW-TO-RUN.txt`, `install.ps1`, `uninstall.ps1`, `LICENSE` (AGPL-3.0) и `THIRD-PARTY-NOTICES.md`.
- При распространении portable-сборки сохраняйте `LICENSES.chromium.html`. Для соблюдения AGPL-3.0 приложите текст [LICENSE](LICENSE) и обеспечьте доступ к соответствующему исходному коду (репозиторий).
- Вопросы лицензирования — через Issue/Discussions проекта (без публикации секретов).
