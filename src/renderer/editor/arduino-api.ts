/**
 * Built-in Arduino API completion data.
 *
 * The data is intentionally plain (no CodeMirror imports) so that it can be
 * reused, filtered or rendered elsewhere. `apply` values are CodeMirror
 * snippet templates: `${1:default}` is a numbered field and `${}` is the final
 * cursor position.
 */

export type ArduinoCompletionType = 'function' | 'variable' | 'class' | 'keyword'

export type ArduinoSection =
  | 'digital'
  | 'analog'
  | 'advanced'
  | 'time'
  | 'math'
  | 'trig'
  | 'random'
  | 'bits'
  | 'interrupts'
  | 'serial'
  | 'string'
  | 'constants'
  | 'types'
  | 'keywords'
  | 'snippets'

export interface ArduinoEntry {
  /** Text shown in the completion list and matched against the typed prefix. */
  label: string
  /** CodeMirror completion type (picks the icon). */
  type: ArduinoCompletionType
  /** Short signature or expansion shown next to the label. */
  detail: string
  /** Grouping inside the completion list. */
  section: ArduinoSection
  /** Optional snippet template used instead of inserting the bare label. */
  apply?: string
  /** Ranking adjustment in the range -99..99. */
  boost?: number
}

const f = (
  label: string,
  detail: string,
  section: ArduinoSection,
  apply?: string,
  boost = 0,
): ArduinoEntry => ({ label, type: 'function', detail, section, apply, boost })

const v = (label: string, detail: string, section: ArduinoSection = 'constants'): ArduinoEntry => ({
  label,
  type: 'variable',
  detail,
  section,
})

const t = (label: string, detail: string, section: ArduinoSection = 'types'): ArduinoEntry => ({
  label,
  type: 'class',
  detail,
  section,
})

const k = (label: string, detail: string): ArduinoEntry => ({
  label,
  type: 'keyword',
  detail,
  section: 'keywords',
})

const s = (label: string, detail: string, apply: string): ArduinoEntry => ({
  label,
  type: 'keyword',
  detail,
  section: 'snippets',
  apply,
})

export const arduinoCompletions: readonly ArduinoEntry[] = [
  /* --------------------------------------------------------------- digital */
  f('pinMode', 'pinMode(uint8_t pin, uint8_t mode)', 'digital', 'pinMode(${1:LED_BUILTIN}, ${2:OUTPUT});', 12),
  f('digitalWrite', 'digitalWrite(uint8_t pin, uint8_t value)', 'digital', 'digitalWrite(${1:LED_BUILTIN}, ${2:HIGH});', 12),
  f('digitalRead', 'digitalRead(uint8_t pin) → int', 'digital', 'digitalRead(${1:2})'),

  /* ---------------------------------------------------------------- analog */
  f('analogRead', 'analogRead(uint8_t pin) → int', 'analog', 'analogRead(${1:A0})', 10),
  f('analogWrite', 'analogWrite(uint8_t pin, int value)', 'analog', 'analogWrite(${1:9}, ${2:128});'),
  f('analogReference', 'analogReference(uint8_t type)', 'analog'),
  f('analogReadResolution', 'analogReadResolution(int bits)', 'analog'),
  f('analogWriteResolution', 'analogWriteResolution(int bits)', 'analog'),

  /* ------------------------------------------------------------------ time */
  f('millis', 'millis() → unsigned long', 'time', undefined, 8),
  f('micros', 'micros() → unsigned long', 'time'),
  f('delay', 'delay(unsigned long ms)', 'time', 'delay(${1:1000});', 10),
  f('delayMicroseconds', 'delayMicroseconds(unsigned int us)', 'time', 'delayMicroseconds(${1:100});'),

  /* ------------------------------------------------------------------ math */
  f('min', 'min(a, b)', 'math'),
  f('max', 'max(a, b)', 'math'),
  f('abs', 'abs(x)', 'math'),
  f('constrain', 'constrain(x, a, b)', 'math'),
  f('map', 'map(value, fromLow, fromHigh, toLow, toHigh)', 'math'),
  f('pow', 'pow(base, exponent) → double', 'math'),
  f('sqrt', 'sqrt(x) → double', 'math'),

  /* ------------------------------------------------------------------ trig */
  f('sin', 'sin(rad) → double', 'trig'),
  f('cos', 'cos(rad) → double', 'trig'),
  f('tan', 'tan(rad) → double', 'trig'),

  /* ---------------------------------------------------------------- random */
  f('random', 'random(max) / random(min, max) → long', 'random', 'random(${1:0}, ${2:100})'),
  f('randomSeed', 'randomSeed(unsigned long seed)', 'random', 'randomSeed(${1:analogRead(A0)});'),

  /* ------------------------------------------------------------ bits/bytes */
  f('lowByte', 'lowByte(x) → byte', 'bits'),
  f('highByte', 'highByte(x) → byte', 'bits'),
  f('bitRead', 'bitRead(value, bit) → int', 'bits'),
  f('bitWrite', 'bitWrite(value, bit, bitValue)', 'bits'),
  f('bitSet', 'bitSet(value, bit)', 'bits'),
  f('bitClear', 'bitClear(value, bit)', 'bits'),
  f('bit', 'bit(b) → byte', 'bits'),

  /* ------------------------------------------------------------ interrupts */
  f(
    'attachInterrupt',
    'attachInterrupt(uint8_t interrupt, void (*isr)(), int mode)',
    'interrupts',
    'attachInterrupt(digitalPinToInterrupt(${1:2}), ${2:onInterrupt}, ${3:CHANGE});',
  ),
  f('detachInterrupt', 'detachInterrupt(uint8_t interrupt)', 'interrupts', 'detachInterrupt(digitalPinToInterrupt(${1:2}));'),
  f('digitalPinToInterrupt', 'digitalPinToInterrupt(uint8_t pin) → int', 'interrupts', 'digitalPinToInterrupt(${1:2})'),
  f('interrupts', 'interrupts()', 'interrupts'),
  f('noInterrupts', 'noInterrupts()', 'interrupts'),

  /* ---------------------------------------------------------- advanced I/O */
  f('tone', 'tone(uint8_t pin, unsigned int frequency, unsigned long duration = 0)', 'advanced', 'tone(${1:8}, ${2:440});'),
  f('noTone', 'noTone(uint8_t pin)', 'advanced', 'noTone(${1:8});'),
  f(
    'shiftOut',
    'shiftOut(uint8_t dataPin, uint8_t clockPin, uint8_t bitOrder, byte value)',
    'advanced',
    'shiftOut(${1:dataPin}, ${2:clockPin}, ${3:MSBFIRST}, ${4:value});',
  ),
  f('shiftIn', 'shiftIn(uint8_t dataPin, uint8_t clockPin, uint8_t bitOrder) → byte', 'advanced'),
  f('pulseIn', 'pulseIn(uint8_t pin, uint8_t state, unsigned long timeout = 1000000) → unsigned long', 'advanced', 'pulseIn(${1:7}, ${2:HIGH})'),
  f('pulseInLong', 'pulseInLong(uint8_t pin, uint8_t state, unsigned long timeout = 1000000) → unsigned long', 'advanced'),

  /* ----------------------------------------------------------------- serial */
  v('Serial', 'HardwareSerial Serial', 'serial'),
  f('Serial.begin', 'Serial.begin(unsigned long speed, uint8_t config = SERIAL_8N1)', 'serial', 'Serial.begin(${1:9600});', 12),
  f('Serial.end', 'Serial.end()', 'serial'),
  f('Serial.available', 'Serial.available() → int', 'serial'),
  f('Serial.availableForWrite', 'Serial.availableForWrite() → int', 'serial'),
  f('Serial.read', 'Serial.read() → int', 'serial'),
  f('Serial.peek', 'Serial.peek() → int', 'serial'),
  f('Serial.flush', 'Serial.flush()', 'serial'),
  f('Serial.print', 'Serial.print(value, format = DEC)', 'serial', 'Serial.print(${1:value});', 12),
  f('Serial.println', 'Serial.println(value, format = DEC)', 'serial', 'Serial.println(${1:value});', 12),
  f('Serial.write', 'Serial.write(value)', 'serial', 'Serial.write(${1:value});'),
  f('Serial.readBytes', 'Serial.readBytes(char *buffer, size_t length) → size_t', 'serial'),
  f('Serial.readBytesUntil', 'Serial.readBytesUntil(char terminator, char *buffer, size_t length) → size_t', 'serial'),
  f('Serial.readString', 'Serial.readString() → String', 'serial'),
  f('Serial.readStringUntil', 'Serial.readStringUntil(char terminator) → String', 'serial'),
  f('Serial.parseInt', 'Serial.parseInt() → long', 'serial'),
  f('Serial.parseFloat', 'Serial.parseFloat() → float', 'serial'),
  f('Serial.setTimeout', 'Serial.setTimeout(unsigned long timeout)', 'serial'),
  f('Serial.find', 'Serial.find(char *target) → bool', 'serial'),
  f('Serial.findUntil', 'Serial.findUntil(char *target, char *terminator) → bool', 'serial'),
  f('Serial.serialEvent', 'Serial.serialEvent()', 'serial'),
  f('Serial.serialEventRun', 'Serial.serialEventRun() → bool', 'serial'),
  f('Serial.operator bool', 'Serial.operator bool() → bool', 'serial'),

  /* ----------------------------------------------------------------- string */
  t('String', 'class String', 'string'),
  f('String.length', 'String.length() → unsigned int', 'string'),
  f('String.charAt', 'String.charAt(unsigned int index) → char', 'string'),
  f('String.substring', 'String.substring(unsigned int from, unsigned int to) → String', 'string'),
  f('String.indexOf', 'String.indexOf(char/string, unsigned int from = 0) → int', 'string'),
  f('String.lastIndexOf', 'String.lastIndexOf(char/string) → int', 'string'),
  f('String.toInt', 'String.toInt() → long', 'string'),
  f('String.toFloat', 'String.toFloat() → float', 'string'),
  f('String.trim', 'String.trim()', 'string'),
  f('String.toUpperCase', 'String.toUpperCase()', 'string'),
  f('String.toLowerCase', 'String.toLowerCase()', 'string'),
  f('String.equals', 'String.equals(String other) → bool', 'string'),
  f('String.equalsIgnoreCase', 'String.equalsIgnoreCase(String other) → bool', 'string'),
  f('String.startsWith', 'String.startsWith(String prefix) → bool', 'string'),
  f('String.endsWith', 'String.endsWith(String suffix) → bool', 'string'),
  f('String.replace', 'String.replace(String find, String replace)', 'string'),
  f('String.concat', 'String.concat(value) → bool', 'string'),
  f('String.c_str', 'String.c_str() → const char *', 'string'),
  f('String.remove', 'String.remove(unsigned int index, unsigned int count = 0)', 'string'),
  f('String.reserve', 'String.reserve(unsigned int size)', 'string'),

  /* ------------------------------------------------------------------ types */
  t('byte', 'uint8_t'),
  t('int', 'int16_t'),
  t('long', 'int32_t'),
  t('short', 'int16_t'),
  t('float', 'float32'),
  t('double', 'float64 / float32'),
  t('char', 'char'),
  t('bool', 'bool'),
  t('boolean', 'bool'),
  t('word', 'uint16_t'),
  t('void', 'void'),
  t('auto', 'auto'),
  t('unsigned', 'unsigned'),
  t('unsigned int', 'unsigned int'),
  t('unsigned long', 'unsigned long'),
  t('unsigned char', 'unsigned char'),
  t('size_t', 'size_t'),
  t('uint8_t', 'uint8_t'),
  t('int8_t', 'int8_t'),
  t('uint16_t', 'uint16_t'),
  t('int16_t', 'int16_t'),
  t('uint32_t', 'uint32_t'),
  t('int32_t', 'int32_t'),
  t('uint64_t', 'uint64_t'),
  t('int64_t', 'int64_t'),

  /* -------------------------------------------------------------- constants */
  v('HIGH', '#define HIGH 0x1'),
  v('LOW', '#define LOW 0x0'),
  v('INPUT', '#define INPUT 0x0'),
  v('OUTPUT', '#define OUTPUT 0x1'),
  v('INPUT_PULLUP', '#define INPUT_PULLUP 0x2'),
  v('LED_BUILTIN', 'LED_BUILTIN'),
  v('A0', 'A0'),
  v('A1', 'A1'),
  v('A2', 'A2'),
  v('A3', 'A3'),
  v('A4', 'A4'),
  v('A5', 'A5'),
  v('A6', 'A6'),
  v('A7', 'A7'),
  v('A8', 'A8'),
  v('A9', 'A9'),
  v('A10', 'A10'),
  v('A11', 'A11'),
  v('A12', 'A12'),
  v('A13', 'A13'),
  v('A14', 'A14'),
  v('A15', 'A15'),
  v('true', 'true = 1'),
  v('false', 'false = 0'),
  v('NULL', 'NULL'),
  v('PI', 'π = 3.1415926535897932384626433832795'),
  v('HALF_PI', 'π / 2'),
  v('TWO_PI', '2π'),
  v('DEG_TO_RAD', 'π / 180'),
  v('RAD_TO_DEG', '180 / π'),
  v('EULER', 'e = 2.71828182845904523536028747135266249775724709369995'),
  v('SERIAL', '#define SERIAL 0x0'),
  v('DISPLAY', '#define DISPLAY 0x1'),
  v('DEC', '#define DEC 10'),
  v('HEX', '#define HEX 16'),
  v('OCT', '#define OCT 8'),
  v('BIN', '#define BIN 2'),
  v('CHANGE', '#define CHANGE 1'),
  v('RISING', '#define RISING 3'),
  v('FALLING', '#define FALLING 2'),
  v('DEFAULT', '#define DEFAULT 0'),
  v('EXTERNAL', '#define EXTERNAL 0'),
  v('INTERNAL', '#define INTERNAL 1'),
  v('INTERNAL1V1', '#define INTERNAL1V1 2'),
  v('INTERNAL2V56', '#define INTERNAL2V56 3'),
  v('LSBFIRST', '#define LSBFIRST 0'),
  v('MSBFIRST', '#define MSBFIRST 1'),

  /* --------------------------------------------------------------- keywords */
  k('class', 'class Name { … }'),
  k('struct', 'struct Name { … }'),
  k('enum', 'enum Name { … }'),
  k('typedef', 'typedef type Name;'),
  k('const', 'const type name'),
  k('constexpr', 'constexpr type name'),
  k('static', 'static type name'),
  k('volatile', 'volatile type name'),
  k('extern', 'extern type name'),
  k('inline', 'inline returnType name()'),
  k('virtual', 'virtual returnType name()'),
  k('friend', 'friend class / function'),
  k('namespace', 'namespace name { … }'),
  k('using', 'using name = type;'),
  k('template', 'template <typename T>'),
  k('public', 'public:'),
  k('private', 'private:'),
  k('protected', 'protected:'),
  k('operator', 'operator+ / operator= / operator bool'),
  k('return', 'return value;'),
  k('break', 'break;'),
  k('continue', 'continue;'),
  k('new', 'new Type(…)'),
  k('delete', 'delete pointer;'),
  k('this', 'this->member'),

  /* --------------------------------------------------------------- snippets */
  s('setup', 'void setup() { … }', 'void setup() {\n\t${}\n}\n'),
  s('loop', 'void loop() { … }', 'void loop() {\n\t${}\n}\n'),
  s('if', 'if (condition) { … }', 'if (${1:true}) {\n\t${}\n}'),
  s('ifelse', 'if (condition) { … } else { … }', 'if (${1:true}) {\n\t${}\n} else {\n\t${}\n}'),
  s('for', 'for (int i = 0; i < n; i++) { … }', 'for (int ${1:i} = 0; ${1} < ${2:n}; ${1}++) {\n\t${}\n}'),
  s('while', 'while (condition) { … }', 'while (${1:true}) {\n\t${}\n}'),
  s('do', 'do { … } while (condition);', 'do {\n\t${}\n} while (${1:true});'),
  s(
    'switch',
    'switch (value) { case … }',
    'switch (${1:value}) {\n\tcase ${2:0}:\n\t\t${}\n\t\tbreak;\n\tdefault:\n\t\tbreak;\n}',
  ),
]
