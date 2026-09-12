import {SerialPort} from 'serialport';
export class Hardware {
 constructor({path=process.env.SERIAL_PATH,mock=process.env.HARDWARE_MODE==='mock',unitTimeout=6000}={}){
  Object.assign(this,{mock,unitTimeout,connected:mock,blocked:false,pending:null,buffer:'',logs:[],stopped:false});
  if(!mock&&path){this.port=new SerialPort({path,baudRate:115200,autoOpen:false});
   this.port.on('open',()=>{this.log('system','Connected; controller settling');this.settle=setTimeout(()=>{this.connected=!!this.port.isOpen;},2000);});
   this.port.on('data',b=>this.receive(b.toString()));this.port.on('error',e=>{this.log('error',e.message);this.fail('serial_error');});
   this.port.on('close',()=>{clearTimeout(this.settle);this.connected=false;this.buffer='';this.fail('disconnected');});
   const connect=()=>{if(!this.stopped&&!this.port.isOpen&&!this.port.opening)this.port.open(e=>{if(e)this.log('error',e.message);});};connect();this.reconnect=setInterval(connect,5000);this.reconnect.unref();
  }
 }
 log(direction,message){this.logs.push({timestamp:new Date().toISOString(),direction,message});if(this.logs.length>200)this.logs.shift();}
 state(){return{connected:this.connected,mode:this.mock?'mock':'serial',busy:!!this.pending,blocked:this.blocked};}
 receive(chunk){this.buffer+=chunk;if(this.buffer.length>8192){this.buffer='';this.fail('oversized_response');return;}let index;
  while((index=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,index).trim();this.buffer=this.buffer.slice(index+1);this.log('rx',line);let msg;try{msg=JSON.parse(line);}catch{continue;}
   if(!msg||typeof msg!=='object'||Array.isArray(msg))continue;
   const p=this.pending;if(!p||msg.request_id!==p.id)continue;
   const validReceipt=Array.isArray(msg.delivered)&&msg.delivered.every(d=>d&&typeof d==='object'&&!Array.isArray(d)&&typeof d.slot==='string'&&Number.isInteger(d.qty)&&d.qty>=0&&p.items.some(i=>i.slot===d.slot&&d.qty<=i.qty))&&new Set(msg.delivered.map(d=>d.slot)).size===msg.delivered.length;
   if(msg.status==='success'){
    const delivered=msg.delivered;
    if(!validReceipt||delivered.length!==p.items.length||!p.items.every(i=>delivered.some(d=>d.slot===i.slot&&d.qty===i.qty))){this.fail('invalid_delivery_receipt');continue;}
    this.finish({status:'success',delivered});
   }else if(msg.status==='error')this.finish({status:'uncertain',error_code:validReceipt&&typeof msg.error_code==='string'?msg.error_code:'invalid_delivery_receipt',delivered:validReceipt?msg.delivered:[]});
  }
 }
 fail(error_code){if(this.pending)this.finish({status:'uncertain',error_code,delivered:[]});}
 finish(result){const p=this.pending;if(!p)return;clearTimeout(p.timer);clearTimeout(this.mockTimer);this.pending=null;if(result.status!=='success')this.blocked=true;p.resolve(result);}
 dispense(items,id){if(!this.connected||this.pending||this.blocked)throw Error('Hardware unavailable');
  return new Promise(resolve=>{this.pending={id,items,resolve,timer:setTimeout(()=>this.fail('timeout'),2000+items.reduce((n,i)=>n+i.qty,0)*this.unitTimeout)};
   const line=JSON.stringify({cmd:'dispense',request_id:id,items})+'\n';this.log('tx',line.trim());
   if(this.mock)this.mockTimer=setTimeout(()=>this.receive(JSON.stringify({request_id:id,status:'success',delivered:items})+'\n'),500);
   else this.port.write(line,e=>{if(e)this.fail('write_failed');});
  });
 }
 close(){this.stopped=true;clearInterval(this.reconnect);clearTimeout(this.settle);clearTimeout(this.mockTimer);this.fail('shutdown');if(this.port?.isOpen)this.port.close();}
}
