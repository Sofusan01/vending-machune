#include <Arduino.h>
#include <ArduinoJson.h> // v7
#include "config.h"
#if !defined(CONFIG_IDF_TARGET_ESP32S3)
#error "Select an ESP32-S3 board before compiling this sketch"
#endif
struct Job {int motor; int qty; int done;};
Job jobs[10];int jobCount=0,current=0;
enum State {IDLE,RUNNING,WAIT_CLEAR};State state=IDLE;
unsigned long began=0,lowSince=0,clearSince=0;
String requestId,lastId,lastResponse;
char input[2048];size_t used=0;bool overflow=false;
void off(){for(auto &m:motors)digitalWrite(m.pin,MOTOR_OFF);}
void emitError(const String& id,const char* code){JsonDocument out;out["request_id"]=id;out["status"]="error";out["error_code"]=code;out["delivered"].to<JsonArray>();serializeJson(out,Serial);Serial.println();}
void complete(const char* status,const char* error=""){
 off();JsonDocument out;out["request_id"]=requestId;out["status"]=status;if(strlen(error))out["error_code"]=error;
 JsonArray delivered=out["delivered"].to<JsonArray>();for(int i=0;i<jobCount;i++){JsonObject d=delivered.add<JsonObject>();d["slot"]=motors[jobs[i].motor].slot;d["qty"]=jobs[i].done;}
 lastId=requestId;lastResponse="";serializeJson(out,lastResponse);Serial.println(lastResponse);state=IDLE;
}
void runNext(){
 while(current<jobCount && jobs[current].done>=jobs[current].qty)current++;
 if(current>=jobCount){complete("success");return;}
 if(!SIMULATE_SENSOR && digitalRead(DROP_PIN)==LOW){complete("error","sensor_blocked");return;}
 began=millis();lowSince=0;state=RUNNING;digitalWrite(motors[jobs[current].motor].pin,MOTOR_ON);
}
void command(){
 JsonDocument doc;if(deserializeJson(doc,input)){emitError("","invalid_json");return;}
 String id=doc["request_id"]|"";
 if(id.length()<1||id.length()>64){emitError(id,"invalid_request_id");return;}
 const char* cmd=doc["cmd"]|"";
 if(!strcmp(cmd,"ping")){
  JsonDocument out;out["request_id"]=id;out["status"]="ready";out["firmware"]="vending-s3-1";
  out["hardware_enabled"]=HARDWARE_ENABLED;out["busy"]=state!=IDLE;
  out["flash_bytes"]=ESP.getFlashChipSize();out["psram_bytes"]=ESP.getPsramSize();
  serializeJson(out,Serial);Serial.println();return;
 }
 if(id==lastId){Serial.println(lastResponse);return;}
 if(state!=IDLE){if(id!=requestId)emitError(id,"busy");return;}
 if(strcmp(doc["cmd"]|"","dispense")){emitError(id,"unknown_command");return;}
 JsonArray items=doc["items"].as<JsonArray>();if(items.isNull()||items.size()<1||items.size()>10){emitError(id,"invalid_items");return;}
 Job candidate[10];int count=0,total=0;bool seen[10]={false};
 for(JsonObject item:items){const char* slot=item["slot"]|"";int motor=-1;for(int i=0;i<10;i++)if(!strcmp(slot,motors[i].slot)){motor=i;break;}
  if(motor<0||seen[motor]||!item["qty"].is<int>()){emitError(id,"invalid_item");return;}
  int qty=item["qty"].as<int>();if(qty<1||qty>10){emitError(id,"invalid_quantity");return;}
  seen[motor]=true;total+=qty;candidate[count++]={motor,qty,0};
 }
 if(total>20){emitError(id,"queue_too_large");return;}
 if(!HARDWARE_ENABLED){emitError(id,"hardware_not_configured");return;}
 // Entire command validated before any motor energizes.
 for(int i=0;i<count;i++)jobs[i]=candidate[i];jobCount=count;current=0;requestId=id;runNext();
}
void setup(){for(auto &m:motors){digitalWrite(m.pin,MOTOR_OFF);pinMode(m.pin,OUTPUT);}pinMode(DROP_PIN,INPUT_PULLUP);Serial.begin(115200);}
void loop(){
 for(int budget=0;budget<128 && Serial.available();budget++){
  char c=Serial.read();if(c=='\n'){if(!overflow){input[used]='\0';command();}else emitError("","line_too_long");used=0;overflow=false;}
  else if(c!='\r'){if(used<sizeof(input)-1&&!overflow)input[used++]=c;else overflow=true;}
 }
 unsigned long now=millis();
 if(state==RUNNING){
  bool detected=SIMULATE_SENSOR?(now-began>=700):(digitalRead(DROP_PIN)==LOW);
  if(detected){if(!lowSince)lowSince=now;if(now-lowSince>=DEBOUNCE_MS){digitalWrite(motors[jobs[current].motor].pin,MOTOR_OFF);jobs[current].done++;began=now;clearSince=0;state=WAIT_CLEAR;return;}}
  else lowSince=0;
  if(now-began>=MOTOR_MAX_MS)complete("error","motor_jam");
 }else if(state==WAIT_CLEAR){
  bool clear=SIMULATE_SENSOR||digitalRead(DROP_PIN)==HIGH;
  if(clear){if(!clearSince)clearSince=now;if(now-clearSince>=BETWEEN_MS){runNext();return;}}else clearSince=0;
  if(now-began>=CLEAR_MAX_MS)complete("error","sensor_not_clear");
 }
}
