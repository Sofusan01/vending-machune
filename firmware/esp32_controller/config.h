#pragma once

// Example wiring only: confirm against your exact board and motor driver.
// One GPIO per motor requires a driver with a single enable/control input.
struct Motor {const char* slot; uint8_t pin;};
constexpr Motor motors[]={{"A1",4},{"A2",5},{"A3",6},{"A4",7},{"A5",8},{"B1",9},{"B2",10},{"B3",11},{"B4",12},{"B5",13}};
constexpr uint8_t DROP_PIN=14, MOTOR_ON=HIGH, MOTOR_OFF=LOW;
constexpr bool HARDWARE_ENABLED=false;
constexpr bool SIMULATE_SENSOR=false;
static_assert(!(HARDWARE_ENABLED && SIMULATE_SENSOR), "Do not enable motors with a simulated drop sensor");
constexpr unsigned long MOTOR_MAX_MS=3500, DEBOUNCE_MS=25, CLEAR_MAX_MS=1200, BETWEEN_MS=400;
