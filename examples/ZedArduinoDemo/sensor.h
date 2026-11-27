#pragma once

// Reads a raw analog value and converts it to a voltage (0..5V).
inline float readSensor(int pin) {
  int raw = analogRead(pin);
  return raw * (5.0f / 1023.0f);
}
