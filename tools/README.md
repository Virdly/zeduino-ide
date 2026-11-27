# tools/ — необязательный arduino-cli

ZedArduino IDE сам находит `arduino-cli`:

1. в `PATH`;
2. в установленной Arduino IDE;
3. в этой папке — `tools\arduino-cli.exe` рядом с `ZedArduinoIDE.exe` (портативный/офлайн-вариант);
4. в `%APPDATA%\ZedArduino IDE\tools\arduino-cli.exe` (скачивается кнопкой «Установить»).

Чтобы работать без интернета и без установленной Arduino IDE, положите сюда `arduino-cli.exe`
с [официальной страницы релизов](https://github.com/arduino/arduino-cli/releases) (Windows 64-bit).

`arduino-cli` распространяется под лицензией GPL-3.0; этот проект его не включает,
а только запускает, если файл присутствует.
