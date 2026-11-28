# Публикация на GitHub

Пошаговая инструкция для первого релиза ZedArduino IDE 1.0.0. Сборка описана в [BUILDING](BUILDING.md), лицензии — в [THIRD-PARTY-NOTICES](../THIRD-PARTY-NOTICES.md), безопасность — в [SECURITY](../SECURITY.md).

## 1. Логин и имя репозитория

В этой копии уже подставлены `Virdly` и `zeduino-ide`: ссылки в `package.json`, `README`, `SECURITY.md`
и `.github/ISSUE_TEMPLATE/config.yml` указывают на `https://github.com/Virdly/zeduino-ide`.
Если вы форкнете проект, переименуете репозиторий или используете другой аккаунт — замените оба значения:

| Файл | Что заменить |
| --- | --- |
| `package.json` | `author.url`, `repository.url`, `homepage`, `bugs.url` |
| `README.md` | бейдж Build и команду `git clone` |
| `README.en.md` | бейдж Build и команду `git clone` |
| `SECURITY.md` | ссылка на Security Advisories |
| `.github/ISSUE_TEMPLATE/config.yml` | ссылки на docs, discussions и Security Advisories |

Проверка (PowerShell, из корня проекта):

```powershell
Get-ChildItem -Recurse -File |
  Where-Object { $_.FullName -notmatch '\\(node_modules|dist|release|artifacts)\\' } |
  Select-String -SimpleMatch 'Virdly'
```

В `package.json` поля `author`, `repository`, `homepage`, `bugs` должны вести на ваш репозиторий,
а бейдж — на `https://github.com/Virdly/zeduino-ide/actions/workflows/build.yml`.

## 2. Создайте репозиторий

На GitHub: **New repository**:

- имя: `zeduino-ide` (или своё);
- видимость: Public;
- **не** добавляйте README, `.gitignore` и лицензию — они уже есть в проекте;
- создайте пустой репозиторий.

Ветка по умолчанию — `main`.

## 3. Инициализируйте git и отправьте код

Из корня проекта:

```powershell
git init -b main
git add -A
git status --short
```

Перед коммитом убедитесь, что в списке **нет** `node_modules/`, `dist/`, `release/`, `artifacts/`, `settings.json`, логов и личных файлов. Затем:

```powershell
git commit -m "Initial commit: ZedArduino IDE 1.0.0"
git remote add origin https://github.com/Virdly/zeduino-ide.git
git push -u origin main
```

Если git ещё не настроен:

```powershell
git config --global user.name "Ваше имя"
git config --global user.email "<GitHub noreply-адрес>"
```

(это локальная настройка git; в репозиторий email не попадает, но он будет виден в истории коммитов — используйте тот, который готовы публиковать, или GitHub noreply-адрес).

### Проверка исключений

`.gitignore` уже исключает:

```text
node_modules/
dist/
release/
artifacts/
*.log
*.tsbuildinfo
.DS_Store
Thumbs.db
.vscode/*
```

Полезные проверки:

```powershell
git status --ignored --short
git ls-files | Select-String -Pattern 'settings\.json|\.zip$|ZedArduinoIDE\.exe|node_modules'
```

Последняя команда не должна ничего находить. `artifacts/` — это подготовленная сборка, она принципиально не коммитится (см. раздел 5).

## 4. Настройки репозитория

**About** (справа на главной странице):

- Description: `Zed-style editor with Arduino IDE tooling for Windows`
- Website: оставьте пустым или укажите страницу релизов;
- Topics: `arduino`, `arduino-ide`, `electron`, `typescript`, `codemirror`, `serial-monitor`, `ai`, `windows`.

**Settings → General:**

- Issues — включить;
- Discussions — включить (шаблон `config.yml` уже ссылается на обсуждения);
- Wiki — можно выключить;
- Allow merge commits / squash — на ваше усмотрение; для PR удобен squash.

**Actions → General:**

- Actions permissions: разрешить GitHub Actions;
- Workflow permissions: для `build.yml` достаточно `contents: read`; для `release.yml` нужен `contents: write` (уже указано в самом workflow);
- Не выдавайте лишних прав.

**Security:**

- включите Private vulnerability reporting (GitHub Security Advisories) — на него ссылается [SECURITY](../SECURITY.md);
- включите Dependabot alerts; файл `.github/dependabot.yml` уже есть;
- при возможности включите secret scanning / push protection.

## 5. Почему `.exe` и `.zip` не коммитятся

Портативная сборка — это не исходники, а бинарный артефакт:

| Файл | Размер | Коммитить? |
| --- | --- | --- |
| `ZedArduinoIDE.exe` | 188 784 128 байт (≈180 МиБ / ≈188,8 МБ) | **Нет** |
| `artifacts/ZedArduinoIDE-1.0.0-win64.zip` | 116 445 346 байт (≈111,1 МиБ) | **Нет** |
| `release/ZedArduinoIDE-1.0.0-win64.zip` (после `npm run zip`) | тот же порядок | **Нет** |

Причины:

1. GitHub отклоняет отдельные файлы больше **100 МиБ** (жёсткий лимит). `.exe` не пройдёт; zip формально тоже больше 100 МиБ.
2. Даже если файл проходит по лимиту, бинарники раздувают историю git: каждое обновление — новая копия навсегда. Репозиторий станет медленным и тяжёлым для клонирования.
3. Артефакт должен быть привязан к версии, а не к коммиту: GitHub Releases дают ссылку, счётчик загрузок и нормальное распространение.

Поэтому `.gitignore` исключает `artifacts/`, `release/`, `dist/`, `node_modules/`. Готовый zip прикладывается к GitHub Release (раздел 6).

## 6. Создайте релиз `v1.0.0`

### Вариант A: вручную (самый простой)

1. Соберите артефакт: `npm run release` (или возьмите готовый `artifacts/ZedArduinoIDE-1.0.0-win64.zip`).
2. GitHub → **Releases → Draft a new release**.
3. **Choose a tag**: введите `v1.0.0` → «Create new tag on publish», target — `main`.
4. Title: `ZedArduino IDE 1.0.0`.
5. Описание: краткий список возможностей и известных ограничений; кнопка «Generate release notes» добавит changelog по коммитам.
6. Прикрепите файл `ZedArduinoIDE-1.0.0-win64.zip` в **Attach binaries**.
7. Снимите галочку «This is a pre-release», если релиз стабильный, и опубликуйте.

Проверка: ссылка `https://github.com/Virdly/zeduino-ide/releases/tag/v1.0.0` открывается, zip скачивается и распаковывается, внутри есть `ZedArduinoIDE.exe`, `resources/app`, `LICENSES.chromium.html`.

### Вариант B: автоматически через workflow

В репозитории есть `.github/workflows/release.yml`. Он запускается по push тега `v*`:

```powershell
git tag -a v1.0.0 -m "ZedArduino IDE 1.0.0"
git push origin v1.0.0
```

Что делает workflow:

1. `windows-latest`, Node.js 20, `npm ci`.
2. `npm run release` → build + package + zip.
3. `softprops/action-gh-release` публикует `release/*.zip`, генерирует release notes, падает, если файл не найден.

Проверьте вкладку **Actions → Release**: сборка занимает несколько минут; в релизе должен появиться `ZedArduinoIDE-1.0.0-win64.zip`. Тег должен соответствовать версии в `package.json` (1.0.0) — от версии зависит имя zip.

Ручной запуск (`workflow_dispatch`) тоже предусмотрен, но основной путь — push тега. Если workflow упал на `npm ci` из-за реестра, см. [BUILDING](BUILDING.md#9-диагностика).

Не создавайте тег повторно с тем же именем: для нового релиза поднимайте версию в `package.json` и ставьте новый тег (`v1.0.1` и т. д.).

## 7. Чек-лист скриншотов

В `docs/screenshots/` уже лежат 8 изображений, на которые ссылается README:

- `editor-compile.jpg` — редактор и компиляция (главный скриншот);
- `board-picker.jpg` — выбор платы;
- `library-manager.jpg` — менеджер библиотек;
- `serial-monitor.jpg` — монитор порта;
- `ai-chat.jpg` — чат с ИИ;
- `settings.jpg` — настройки;
- `theme-editor.jpg` — редактор темы;
- `light-theme.jpg` — светлая тема.

Перед публикацией проверьте:

- [ ] нет реального API-ключа (замазан или поле скрыто), токенов, email и чужих имён;
- [ ] нет личных путей: используйте `C:\Users\<user>`, `%USERPROFILE%`, `%APPDATA%`, `%LOCALAPPDATA%`;
- [ ] нет секретов в мониторе порта (данные устройств, Wi-Fi пароли и т. п.);
- [ ] интерфейс соответствует текущей версии (русский/английский, тема, масштаб);
- [ ] размер файла разумный (JPG, не PNG-скриншот на 3 МБ);
- [ ] alt-текст в README осмысленный;
- [ ] при замене скриншота обновите оба README (русский и английский), если картинка используется в обоих.

Добавлять новые изображения лучше в `docs/screenshots/` и ссылаться на них относительным путём (`docs/screenshots/name.jpg`).

## 8. Social preview

GitHub показывает превью ссылки в соцсетях и мессенджерах. Рекомендуется:

- размер 1280×640 (соотношение 2:1), PNG или JPG;
- взять `docs/screenshots/editor-compile.jpg` или собрать композицию «скриншот + название»;
- без мелкого текста и без ключей/путей;
- загрузить: **Settings → Social preview → Upload an image**.

## 9. Подпись кода и SmartScreen

Сборка 1.0.0 не подписана. Windows SmartScreen будет показывать предупреждение «Windows protected your PC» / «Неизвестный издатель» — это ожидаемо, а не признак вируса.

Если нужна подпись:

1. Приобретите код-сертификат (OV или EV; EV быстрее набирает репутацию).
2. Подпишите `ZedArduinoIDE.exe` после `npm run package`, но **до** `npm run zip`, иначе подпись не попадёт в архив:

   ```powershell
   signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 `
     /f "path\to\cert.pfx" /p "<password>" `
     "release\ZedArduinoIDE\ZedArduinoIDE.exe"
   ```

   Не храните пароль в истории PowerShell и в репозитории: используйте хранилище сертификатов Windows (`/sha1 <thumbprint>` без `/f`) или секреты CI. Для CI сертификат передаётся через GitHub Secrets (base64 PFX + пароль) и шаг подписи добавляется в `release.yml`; секреты никогда не коммитятся.

3. Проверьте: `signtool verify /pa /v "release\ZedArduinoIDE\ZedArduinoIDE.exe"`.
4. Подписывать нужно каждую новую сборку; временная метка (`/tr`) продлевает срок действия подписи.
5. После подписи выполните `npm run zip` и приложите архив к релизу.

Без подписи и репутации SmartScreen может предупреждать даже при наличии сертификата. Это ограничение распространения, а не ошибка приложения.

## 10. Автообновление (будущая работа)

Сейчас автообновления нет: приложение не проверяет новые версии и не скачивает их. Возможные пути:

- `electron-updater` + GitHub Releases как провайдер (нужны `publish`-конфигурация и подпись);
- `update-electron-app` (проще, но меньше контроля);
- собственный update-сервер.

Требования: подписанные сборки, стабильные имена артефактов, semver, механизм отката. До реализации пользователи скачивают новый zip вручную. Планы отмечены в [ROADMAP](../ROADMAP.md).

## 11. Чек-лист безопасности перед публикацией

- [ ] `settings.json` не в репозитории (он лежит в `%APPDATA%`, а не в проекте).
- [ ] Поиск секретов: `git grep -n -I -E "sk-[A-Za-z0-9]{20,}|ghp_|github_pat_|Bearer [A-Za-z0-9]"` — реальных ключей быть не должно. Заглушка `sk-REPLACE_ME` в `docs/AI.md` безопасна и ожидаема.
- [ ] В `docs/` и README нет личных путей, email, имён и внутренних адресов.
- [ ] В скриншотах нет ключей, токенов, серийных номеров и личных файлов.
- [ ] `git status --ignored` не показывает случайно добавленных бинарников; `git ls-files` не содержит `node_modules`, `dist`, `release`, `artifacts`, `*.zip`, `*.exe`.
- [ ] Включены Private vulnerability reporting и Dependabot; шаблон `config.yml` ведёт на актуальный репозиторий.
- [ ] Workflow-права минимальны: `build.yml` — `contents: read`, `release.yml` — `contents: write`.
- [ ] Зависимости проверены (`npm audit`), обновления lock-файла осознанны.
- [ ] Если ключ когда-либо попал в коммит — ключ отозван/перевыпущен; история очищена (`git filter-repo`) до публикации.
- [ ] Лицензии и `LICENSES.chromium.html` присутствуют в собранном приложении.
- [ ] При релизе можно приложить SHA-256 архива, чтобы пользователи могли проверить загрузку.

## 12. Лицензионные требования

| Компонент | Лицензия | Как распространяется |
| --- | --- | --- |
| Код ZedArduino IDE | AGPL-3.0 (`LICENSE`) | исходники + бинарник; при сетевом использовании исходники должны быть доступны |
| Electron / Chromium | MIT + BSD-подобные и сторонние лицензии Chromium | входят в portable-сборку; `LICENSES.chromium.html` лежит рядом с `ZedArduinoIDE.exe` |
| React, CodeMirror 6, Lezer, Zustand, `serialport`, esbuild, Vite | MIT | входят в сборку |
| `lucide-react` | ISC | входит в сборку |
| TypeScript | Apache-2.0 | инструмент сборки, в runtime не входит |
| `arduino-cli` | **GPLv3** | **не включён в поставку**: IDE находит установленный CLI или скачивает его отдельно по действию пользователя |

Важно:

- `arduino-cli` — отдельная программа, которая не входит в zip. IDE лишь вызывает внешний исполняемый файл; это не делает проект производным произведением GPL. Если вы решите **включить** `arduino-cli` в свой дистрибутив, придётся соблюдать GPLv3 (исходники, уведомления, предложение исходного кода) — проще этого не делать.
- `LICENSES.chromium.html` (≈9 МБ) обязателен при распространении Electron/Chromium. Не удаляйте его из `release/ZedArduinoIDE/` и из zip.
- Проектный `LICENSE` (MIT, copyright ZedArduino) и `THIRD-PARTY-NOTICES.md` **не копируются** в portable-папку скриптом `package.mjs` (он копирует только Electron runtime и README/HOW-TO-RUN/install/uninstall). Перед публикацией добавьте их в `release/ZedArduinoIDE/` вручную или расширьте скрипт упаковки, иначе в бинарном релизе не будет текста MIT-лицензии проекта.
- Уведомления о сторонних компонентах — в [THIRD-PARTY-NOTICES](../THIRD-PARTY-NOTICES.md); при добавлении зависимостей обновляйте этот файл.
- Arduino® — торговая марка Arduino S.r.l.; Zed — торговая марка Zed Industries. Проект не связан с ними; не используйте их логотипы и не позиционируйте сборку как официальную.
