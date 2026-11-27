#include "sensor.h"

const int ledPin = LED_BUILTIN;
int counter = 0;
unsigned long lastBlink = 0;

void setup() {
  Serial.begin(115200);
  pinMode(ledPin, OUTPUT);
  Serial.println("ZedArduino demo started");
}

void loop() {
  if (millis() - lastBlink > 500) {
    lastBlink = millis();
    digitalWrite(ledPin, !digitalRead(ledPin));
    counter++;
    Serial.print("tick ");
    Serial.println(counter);
    Serial.print("A0 = ");
    Serial.println(readSensor(A0));
  }
}
