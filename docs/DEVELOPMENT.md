# Разработка

Соглашения, карта исходников и рецепты типовых изменений. Перед началом — [ARCHITECTURE](ARCHITECTURE.md), [BUILDING](BUILDING.md) и [CONTRIBUTING](../CONTRIBUTING.md).

## 1. Стек и принципы

- TypeScript strict (`tsconfig.json`), React 18, Zustand, CodeMirror 6, Electron 33.
- Main-процесс — Node.js: файловая система, `child_process`, `fetch`, `serialport`. Renderer не имеет доступа к Node (`nodeIntegration: false`), только `window.api`.
- `src/shared/` — чистые типы и константы без Electron/Node; их можно импортировать везде.
- Никаких новых зависимостей без необходимости. Новая библиотека = обоснование в PR, обновление `package-lock.json`, запись в [THIRD-PARTY-NOTICES](../THIRD-PARTY-NOTICES.md), проверка лицензии.
- Все файловые операции проекта идут через `WorkspaceService` (проверка пути внутри корня), а не напрямую из renderer.
- UI-строки — только через `useT()` и словари; цвета — только через CSS-переменные.
- Стиль кода: 2 пробела, одинарные кавычки, без точек с запятой, trailing comma в многострочных литералах. ESLint/Prettier пока не настроены — придерживайтесь существующего стиля.

## 2. Карта файлов

```text
src/
  main/
    index.ts       точка входа, окно, меню, все ipcMain.handle
    arduino.ts     поиск/установка arduino-cli, платы, ядра, библиотеки, compile/upload
    workspace.ts   проект, дерево, файловые операции, поиск, индекс, fs.watch
    serial.ts      SerialMonitorService: native serialport / CLI fallback
    ai.ts          OpenAI-compatible SSE, tool calls, выполнение инструментов
    settings.ts    SettingsStore (settings.json, deep merge)
    util.ts        runCommand, spawnStream, downloadFile, extractZip, slugify, stripAnsi
  preload/
    index.ts       contextBridge → window.api, invoke + подписки
  renderer/
    main.tsx       монтирование React
    App.tsx        каркас, вкладки, горячие клавиши, оверлеи
    state/store.ts единый Zustand-store и все действия
    editor/        CodeEditor, setup (compartments), completions, indexer, arduino-api
    ai/            AIChatPanel, useAiChat (отдельный store), Markdown
    components/    Toolbar, ActivityBar, Sidebar, FileTree, TabBar, BottomPanel, StatusBar, ...
    dialogs/       SettingsDialog, BoardManagerDialog, LibraryManagerDialog, ThemeEditorDialog
    i18n/          common, shell, dialogs, ai, editor, index, useT
    styles/        theme.css, app.css, editor.css
  shared/
    types.ts       доменные типы и AppEventMap
    api.ts         ZedArduinoApi, IPC, EVENT_CHANNELS
    defaults.ts    DEFAULT_SETTINGS
    theme.ts       DARK_COLORS / LIGHT_COLORS, цветовые утилиты
scripts/           dev, build-main, package, make-zip, make-icon
examples/          Blink, ZedArduinoDemo
docs/              эта документация и скриншоты
```

Правила импорта:

- `main` может импортировать `shared`; `preload` — `shared`; `renderer` — `shared` и свои модули.
- `main` не импортирует renderer и наоборот.
- В renderer используйте относительные пути (`../state/store`); алиас `@shared` настроен в tsconfig, но в коде в основном относительные импорты — не смешивайте без причины.

## 3. Как добавить IPC-метод

Пример: новая операция `foo:run`.

### Шаг 1. Типы (`src/shared/types.ts`)

```ts
export interface FooRequest {
  value: string
}

export interface FooResult {
  ok: boolean
  message: string
}
```

Если метод генерирует событие — добавьте его в `AppEventMap`:

```ts
export interface AppEventMap {
  // ...
  'foo:progress': { percent: number }
}
```

### Шаг 2. Контракт (`src/shared/api.ts`)

Добавьте метод в `ZedArduinoApi` и константу канала в `IPC`:

```ts
export interface ZedArduinoApi {
  // ...
  foo: {
    run(req: FooRequest): Promise<FooResult>
    onProgress(cb: (p: { percent: number }) => void): () => void
  }
}

export const IPC = {
  // ...
  fooRun: 'foo:run',
} as const
```

Для события — `EVENT_CHANNELS.fooProgress: 'foo:progress'`.

### Шаг 3. Preload (`src/preload/index.ts`)

```ts
foo: {
  run: (req) => invoke(IPC.fooRun, req),
  onProgress: (cb) => on<{ percent: number }>(EVENT_CHANNELS.fooProgress, cb),
},
```

`invoke` уже нормализует ошибки; не добавляйте свою обработку без причины.

### Шаг 4. Main (`src/main/index.ts`)

```ts
handle(IPC.fooRun, async (req: FooRequest): Promise<FooResult> => {
  const result = await fooService.run(req)
  return result
})
```

Правила:

- используйте обёртку `handle`, чтобы исключения дошли до renderer читаемым текстом;
- бизнес-логику держите в сервисе (`src/main/*.ts`), а не в `index.ts`;
- если метод меняет состояние приложения — отправляйте событие через `emit`;
- не возвращайте `undefined` там, где контракт обещает объект.

### Шаг 5. Renderer

Действие в `src/renderer/state/store.ts`:

```ts
runFoo: async (value) => {
  try {
    const result = await window.api.foo.run({ value })
    set({ statusText: result.message })
    return result
  } catch (err) {
    get().showToast('error', (err as Error).message)
    return null
  }
},
```

Не забудьте объявить метод в интерфейсе `AppStore`. Для событий подписка добавляется в `init()`:

```ts
window.api.foo.onProgress((p) => set({ progress: { task: 'foo', percent: p.percent } }))
```

### Чек-лист

- [ ] типы в `shared/types.ts`, контракт в `shared/api.ts`;
- [ ] канал добавлен ровно один раз;
- [ ] preload и main используют константу, а не строку;
- [ ] ошибки показываются пользователю (toast/панель), нет «молчаливого» catch;
- [ ] `npm run typecheck` проходит;
- [ ] при необходимости — запись в ARCHITECTURE (таблица каналов).

## 4. Как добавить цвет темы

Сейчас в теме 20 цветов (`ThemeColors`). Порядок:

1. `src/shared/types.ts` — добавьте поле в `ThemeColors`.
2. `src/shared/theme.ts` — значение в `DARK_COLORS` и `LIGHT_COLORS`.
3. `src/renderer/state/store.ts` — в `applyTheme()` добавьте CSS-переменную, если цвет нужен в CSS:

   ```ts
   '--my-color': colors.myColor,
   ```

4. Используйте переменную в CSS (`var(--my-color)`) или в теме CodeMirror (`--editor-*`), не хардкодьте hex.
5. Если цвет относится к подсветке синтаксиса — добавьте переменную в `editor.css` для `[data-theme='dark']` и `[data-theme='light']` и используйте её в `editorHighlightStyle` (`src/renderer/editor/setup.ts`).
6. `src/renderer/dialogs/ThemeEditorDialog.tsx` — добавьте ключ в `COLOR_KEYS` (порядок отображения).
7. `src/renderer/i18n/dialogs.ts` — подписи `dialog.themeEditor.color.<key>` для `ru` и `en`.
8. Проверьте светлую/тёмную/кастомную тему и редактор темы; для custom-режима базовые цвета выбираются по светлоте `bg`.

Не добавляйте цвета, которые не используются: редактор темы показывает весь список.

## 5. Как добавить автодополнение

### Arduino API (`src/renderer/editor/arduino-api.ts`)

Записи массива `arduinoCompletions` создаются helper-функциями:

```ts
f('myFunction', 'myFunction(int value) → void', 'advanced', 'myFunction(${1:0});', 5)
v('MY_CONSTANT', '#define MY_CONSTANT 42')
t('MyType', 'class MyType')
k('myKeyword')
s('mysnippet', 'Краткое описание', 'do {\n\t${}\n} while (${1:false});')
```

- `detail` — сигнатура/краткое описание в попапе;
- `apply` — сниппет CodeMirror: `${1:default}` — поле, `${}` — финальный курсор;
- `boost` — приоритет (-99…99), выше — раньше в списке;
- `section` — группа; для новой группы добавьте её в `ArduinoSection`, в `SECTION_KEYS` (`completions.ts`) и ключи `editor.section.<name>` в `src/renderer/i18n/editor.ts` (ru/en).

Проверка: откройте `.ino`, начните вводить имя; запись должна появиться с иконкой и в правильной секции. Для member-access (`Serial.`) метка должна начинаться с `Serial.` — см. `arduinoCompletions`.

### Символы проекта

Автодополнение по функциям/переменным/макросам проекта строит `src/renderer/editor/indexer.ts` (`parseSymbols`). Если нужен новый вид символа:

1. добавьте regex и вызов `add(label, type, detail)`;
2. при необходимости расширьте `IndexedSymbolType`;
3. проверьте лимиты (`MAX_SYMBOLS_PER_FILE`, `MAX_INDEX_SYMBOLS`) и что комментарии/строки не дают ложных срабатываний;
4. `parseSymbols` экспортирован — покройте его unit-тестом (см. раздел 8).

## 6. Как добавить настройку

1. `src/shared/types.ts` — поле в соответствующем интерфейсе (`EditorSettings`, `ArduinoSettings`, `AiSettings`, `ThemeSettings`).
2. `src/shared/defaults.ts` — значение по умолчанию.
3. `src/renderer/dialogs/SettingsDialog.tsx` — контрол (переключатель, слайдер, поле) и `apply({ ... })`.
4. `src/renderer/i18n/dialogs.ts` — подписи и подсказки для `ru`/`en`.
5. Если настройка влияет на CodeMirror — добавьте compartment/reconfigure в `src/renderer/editor/setup.ts` и `CodeEditor.tsx`, чтобы не пересоздавать редактор.
6. Если нужна миграция/нормализация — в `src/main/settings.ts` (`load()`/`update()`).
7. Проверьте сброс настроек: `reset()` сохраняет только `recentProjects`/`lastProject`.

Патчи настроек — частичные: `updateSettings({ editor: { tabSize: 4 } })` не затирает остальные поля `editor`.

## 7. i18n и стили

- Словари: `src/renderer/i18n/common.ts`, `shell.ts`, `dialogs.ts`, `ai.ts`, `editor.ts`; тип `Dict` требует обе локали.
- В компонентах: `const t = useT()`, затем `t('key')` или `t('key', { count })`; подстановка `{name}`.
- Не хардкодьте русский/английский текст в JSX. Исключения: нативное меню в `src/main/index.ts` (пока не локализовано) и сообщения, которые формирует `arduino-cli`.
- Для перевода tool-карточек используются ключи `ai.tool.<name>` и `ai.tool.<name>.desc`.
- Цвета: `background: var(--bg-panel)`, `color: var(--text-muted)`, `border-color: var(--border)`. Не используйте `#fff`/`#000` в компонентах, кроме прозрачности через `withAlpha`.
- CSS-файлы подключаются в `main.tsx` (`theme.css`, `app.css`) или в компоненте (`editor.css`, `dialogs.css`, `ai.css`).
- Для доступности используйте `aria-label`, `role="dialog"`, `aria-modal`, видимый фокус; Escape закрывает верхний диалог.

## 8. Отладка

### Renderer

- `npm run dev` → DevTools: меню «Вид → Инструменты разработчика» (`Ctrl+Shift+F12`) или `Ctrl+Shift+I`, если фокус в окне.
- Изменения React/CSS применяются через HMR; при ошибке смотрите консоль renderer.
- `window.api` доступен в консоли (проверка контракта): `await window.api.app.info()`.

### Main / preload

- Логи main и Vite выводятся в терминал `npm run dev`.
- Изменения `src/main` и `src/preload` требуют перезапуска Electron (watch пересобирает файлы, но процесс не перезапускает).
- Для точки останова: `npx electron --inspect=9229 .` и attach из VS Code/Chrome DevTools; при этом `dist` должен быть собран.
- Ошибки IPC: в renderer приходит сообщение без префикса Electron; исходный стек — в терминале main.

### Переменные окружения

| Переменная | Где используется | Комментарий |
| --- | --- | --- |
| `VITE_DEV_SERVER_URL` | `src/main/index.ts` | если задана, окно грузит URL, иначе `dist/renderer/index.html` |
| `ELECTRON_RUN_AS_NODE` | `scripts/dev.mjs` | удаляется из окружения, чтобы Electron запускался как приложение |
| `ELECTRON_MIRROR` | установка Electron | зеркало загрузки, см. [BUILDING](BUILDING.md#6-electron-без-доступа-к-github) |
| `ARDUINO_DIRECTORIES_DATA` | дочерний `arduino-cli` | выставляет IDE, не задавайте вручную для запуска IDE |

Ручной запуск без `dev.mjs`:

```powershell
npm run build:main
npx vite --port 5178 --strictPort   # отдельный терминал
$env:VITE_DEV_SERVER_URL = 'http://127.0.0.1:5178'
npx electron .
```

### arduino-cli

Проверяйте команды вручную с тем же окружением, что и IDE:

```powershell
$env:ARDUINO_DIRECTORIES_DATA = "$env:LOCALAPPDATA\Arduino15"
$env:ARDUINO_DIRECTORIES_USER = "$env:USERPROFILE\Documents\Arduino"
arduino-cli core list
arduino-cli board list
arduino-cli compile --fqbn arduino:avr:uno "C:\path\to\Blink"
```

Путь CLI виден в «Настройки → Ардуино»; там же кнопка обновления индекса.

### Монитор порта

- Если данные не идут: проверьте, что порт не занят и скорость совпадает с `Serial.begin`.
- Если отправка недоступна — загрузился CLI-fallback вместо `serialport`; смотрите предупреждение `[serial] native serialport backend unavailable` в терминале.
- В упакованной сборке проверьте `resources/app/node_modules/serialport`.

## 9. Тестирование

Сейчас в проекте **нет** юнит-тестов, E2E и линтера. Фактическая проверка:

```powershell
npm run typecheck
npm run build
```

CI (`build.yml`) дополнительно собирает portable-пакет и zip, но тесты не запускает.

План (см. [ROADMAP](../ROADMAP.md)):

### Vitest — юнит-уровень

Кандидаты без Electron:

- `parseSymbols` (`indexer.ts`) — функции, методы, `#define`, классы, глобальные переменные, ложные срабатывания в комментариях/строках;
- `slugify`, `stripAnsi` (`main/util.ts`);
- `withAlpha`, `mixColors`, `isLight` (`shared/theme.ts`);
- `deepMerge`/нормализация настроек (потребуется экспортировать функцию);
- `WorkspaceService.resolveInside` — временный каталог, `..`, абсолютные пути, подкаталоги;
- парсинг SSE и `joinUrl` в `ai.ts` (вынести чистые функции).

Предлагаемая конфигурация: `vitest` + `environment: 'node'` для main/shared, `jsdom` для renderer-утилит; скрипт `test`.

### Playwright — E2E Electron

`@playwright/test` + `_electron.launch({ args: ['.'] })`:

- запуск на собранном `dist` (нужен `npm run build`);
- открытие папки `examples/Blink`, редактирование, автосохранение, переключение вкладок;
- настройки: смена языка/темы, проверка CSS-переменных;
- ИИ: локальный mock-сервер из [AI](AI.md#8-локальный-mock-сервер-без-платного-ключа), проверка стрима и одобрения инструмента;
- без реального железа: список портов может быть пустым, compile/upload проверяются с mock-CLI или помечаются как отдельный интеграционный набор.

### Линтер

Добавить ESLint (flat config) + `@typescript-eslint`, Prettier, скрипты `lint`/`format`, шаг в CI. До этого не смешивайте форматирование в PR с логическими изменениями.

## 10. Производительность и надёжность

- Автодополнение синхронное: не добавляйте в источник асинхронные запросы и тяжёлый парсинг «на каждый символ».
- Индекс проекта ограничен; при увеличении лимитов проверьте время отклика на большом проекте.
- Не блокируйте main синхронными операциями с большими файлами; для потокового вывода используйте `spawnStream`.
- Долгие операции (`compile`, `upload`, установка) должны отменяться через `arduino:cancel` и приносить `arduino:run-done`.
- Любой путь из renderer считается недоверенным: только `WorkspaceService` для проекта, только `http(s)` для `openExternal`.
- Не логируйте ключи, содержимое файлов и историю чата.
