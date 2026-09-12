import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.js';
import {openDatabase} from '../database.js';
import {Hardware} from '../hardware.js';
const paymentKey='test-payment-adapter-secret-123456789';
test('feature defaults keep cash and coin enabled and QR off',()=>{
 const db=openDatabase(':memory:','1234');
 try{const features=JSON.parse(db.prepare("SELECT value FROM settings WHERE key='features'").get().value);assert.equal(features.cash,true);assert.equal(features.coin,true);assert.equal(features.promptpay,false);}finally{db.close();}
});
test('saved switches enforce payment availability and ordering without reserving stock',async t=>{
 const {req,auth,db,body,orderHeaders,a}=await setup(t);
 const current=(await req('/settings')).data;
 const settings={store_logo:current.store_logo,ui_text_json:current.ui_text_json,timezone:current.timezone,promptpay_id:current.promptpay_id,features:{...current.features,cash:false,promptpay:false},idle_seconds:90};
 assert.equal((await req('/settings',settings,{},'PUT')).status,401);
 assert.equal((await req('/settings',{...settings,features:{...settings.features,coin:false}},auth,'PUT')).status,400);
 assert.equal((await req('/settings',{...settings,idle_seconds:1},auth,'PUT')).status,400);
 assert.equal((await req('/settings',settings,auth,'PUT')).status,200);
 assert.deepEqual((await req('/settings')).data.features,settings.features);
 assert.equal((await req('/settings')).data.idle_seconds,90);
 assert.equal((await req('/checkout',body,orderHeaders)).status,400);
 assert.equal((await req('/checkout',{...body,payment_method:'promptpay'},orderHeaders)).status,400);
 assert.equal(db.prepare('SELECT stock FROM products WHERE id=?').get(a.id).stock,8);
 assert.equal((await req('/settings',{...settings,features:{...settings.features,ordering:false,coin:false}},auth,'PUT')).status,200);
 assert.equal((await req('/checkout',{...body,payment_method:'coin'},orderHeaders)).status,503);
 assert.equal((await req('/settings',settings,auth,'PUT')).status,200);
 const order=await req('/checkout',{...body,payment_method:'coin'},orderHeaders);assert.equal(order.status,201);
 assert.equal((await req('/settings',settings,auth,'PUT')).status,409);
 assert.equal((await req('/checkout',{...body,payment_method:'coin'},orderHeaders)).data.id,order.data.id);
});
async function setup(t,{demo=true,hardware=new Hardware({mock:true}),paymentProvider='local',omise}={}){
 const db=openDatabase(':memory:','1234');
 // Existing payment scenarios exercise QR explicitly; production defaults keep it off.
 db.prepare("UPDATE settings SET value=json_set(value,'$.promptpay',json('true')) WHERE key='features'").run();
 const system=createApp({db,hardware,paymentKey,demo,paymentProvider,omise});const server=system.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{system.close();await new Promise(r=>server.close(r));db.close();});
 const base=`http://127.0.0.1:${server.address().port}`;
 const req=async(path,body,headers={},method=body?'POST':'GET')=>{const res=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});return{status:res.status,data:res.status===204?null:await res.json()};};
 const token=(await req('/login',{password:'1234'})).data.token,auth={Authorization:'Bearer '+token};
 const a=(await req('/products',{slot:'A1',name:'Cookie',price:2000,stock:8},auth)).data;
 const b=(await req('/products',{slot:'B2',name:'Milk',price:3500,stock:5},auth)).data;
 const orderHeaders={'X-Order-Token':'test-order-token-long-enough-123456789','Idempotency-Key':'test-checkout-key-0001'};
 const body={items:[{product_id:a.id,qty:2},{product_id:b.id,qty:1}],payment_method:'cash'};
 const order=()=>req('/checkout',body,orderHeaders);
 return{db,req,auth,hardware,a,b,body,orderHeaders,order,base};
}
async function settled(req,id,headers){for(let i=0;i<30;i++){const r=(await req('/orders/'+id,null,headers)).data;if(r.status!=='dispensing')return r;await new Promise(r=>setTimeout(r,40));}throw Error('Dispense did not settle');}
test('Omise test checkout verifies payment, deduplicates creation and disables bypasses',async t=>{
 let charge,created=0;
 const omise={createCharge:async tx=>{created++;charge={object:'charge',id:'chrg_test123',livemode:false,amount:tx.total_amount,currency:'THB',metadata:{order_id:tx.id},source:{type:'promptpay',scannable_code:{image:{download_uri:'https://api.omise.co/test-qr'}}},status:'pending',paid:false};return charge;},retrieveCharge:async()=>charge};
 const {req,db,orderHeaders,body,hardware,auth}=await setup(t,{paymentProvider:'omise_test',omise});
 body.payment_method='promptpay';
 const settings=(await req('/settings')).data;assert.equal(settings.promptpay_available,true);assert.equal(settings.demo_payments,false);
 const tx=(await req('/checkout',body,orderHeaders)).data;
 assert.equal(tx.status,'awaiting_payment');assert.equal((await req('/checkout',body,orderHeaders)).data.id,tx.id);assert.equal(created,1);
 const pending=(await req('/orders/'+tx.id,null,orderHeaders)).data;assert.equal(pending.qr_image_url,'https://api.omise.co/test-qr');assert.equal(pending.qr_payload,null);assert.equal(hardware.logs.length,0);
 assert.equal((await req('/orders/'+tx.id+'/demo-payment',{},orderHeaders)).status,403);
 assert.equal((await req('/orders/'+tx.id+'/confirm-payment',{},auth)).status,403);
 charge={...charge,status:'successful',paid:true,amount:1};db.prepare('UPDATE omise_payments SET last_checked=0').run();
 assert.equal((await req('/orders/'+tx.id,null,orderHeaders)).status,502);assert.equal(hardware.logs.length,0);
 charge={...charge,amount:tx.total_amount};db.prepare('UPDATE omise_payments SET last_checked=0').run();
 await req('/orders/'+tx.id,null,orderHeaders);
 assert.equal((await settled(req,tx.id,orderHeaders)).status,'success');
 await req('/orders/'+tx.id,null,orderHeaders);assert.equal(hardware.logs.filter(l=>l.direction==='tx').length,1);
});

test('Omise waits for asynchronous QR generation without recreating the charge',async t=>{
 let charge,created=0;
 const omise={createCharge:async tx=>{created++;return charge={object:'charge',id:'chrg_test_delayed',livemode:false,amount:tx.total_amount,currency:'THB',metadata:{order_id:tx.id},source:{type:'promptpay',scannable_code:null},status:'pending',paid:false};},retrieveCharge:async()=>charge};
 const {req,db,body,orderHeaders,hardware}=await setup(t,{paymentProvider:'omise_test',omise});body.payment_method='promptpay';
 const tx=(await req('/checkout',body,orderHeaders)).data;assert.equal(tx.status,'awaiting_payment');
 let current=(await req('/orders/'+tx.id,null,orderHeaders)).data;assert.equal(current.status,'awaiting_payment');assert.equal(current.qr_image_url,null);
 charge.source.scannable_code={image:{download_uri:'https://api.omise.co/delayed-qr'}};
 db.prepare('UPDATE omise_payments SET last_checked=0').run();
 current=(await req('/orders/'+tx.id,null,orderHeaders)).data;assert.equal(current.qr_image_url,'https://api.omise.co/delayed-qr');assert.equal(created,1);assert.equal(hardware.logs.length,0);
});

test('QR endpoint and webhook verify remote payment and handle duplicates without polling',async t=>{
 let charge,created=0;
 const omise={createCharge:async tx=>{created++;return charge={object:'charge',id:'chrg_test_webhook',livemode:false,amount:tx.total_amount,currency:'THB',metadata:{order_id:tx.id},source:{type:'promptpay',scannable_code:{image:{download_uri:'https://api.omise.co/qr'}}},status:'pending',paid:false};},retrieveCharge:async()=>charge};
 const {req,body,orderHeaders,hardware,db}=await setup(t,{paymentProvider:'omise_test',omise});
 assert.equal((await req('/payments/omise/qr',{items:body.items})).status,400);
 const result=await req('/payments/omise/qr',{items:body.items},orderHeaders);assert.equal(result.status,201);assert.equal(result.data.qr_image_url,'https://api.omise.co/qr');
 assert.equal((await req('/payments/omise/qr',{items:body.items},orderHeaders)).data.omise_charge_id,charge.id);assert.equal(created,1);
 const event={key:'charge.complete',data:{id:charge.id,status:'successful',paid:true}};
 assert.equal((await req('/webhooks/omise',event)).status,200);assert.equal(hardware.logs.length,0);
 charge.livemode=true;assert.equal((await req('/webhooks/omise',event)).status,502);charge.livemode=false;
 charge.amount++;assert.equal((await req('/webhooks/omise',event)).status,502);charge.amount--;
 charge.status='successful';charge.paid=true;
 const replies=await Promise.all([req('/webhooks/omise',event),req('/webhooks/omise',event)]);assert.ok(replies.every(r=>r.status===200));
 assert.equal(db.prepare('SELECT paid_amount FROM transactions WHERE id=?').get(result.data.id).paid_amount,charge.amount);
 assert.equal((await settled(req,result.data.id,orderHeaders)).status,'success');assert.equal(hardware.logs.filter(l=>l.direction==='tx').length,1);
 assert.equal((await req('/webhooks/omise',{key:'charge.create'})).status,200);
 assert.equal((await req('/webhooks/omise',{key:'charge.complete',data:{id:'chrg_test_unknown'}})).status,200);
});

test('webhook never vends cancelled orders and retries verification after API failure',async t=>{
 let charge,unavailable=true;
 const omise={createCharge:async tx=>(charge={object:'charge',id:'chrg_test_cancelled',livemode:false,amount:tx.total_amount,currency:'THB',metadata:{order_id:tx.id},source:{type:'promptpay',scannable_code:null},status:'pending',paid:false}),retrieveCharge:async()=>{if(unavailable)throw Object.assign(Error('Omise unavailable'),{status:502});return charge;}};
 const {req,body,orderHeaders,hardware}=await setup(t,{paymentProvider:'omise_test',omise});
 const tx=(await req('/payments/omise/qr',{items:body.items},orderHeaders)).data;
 const event={key:'charge.complete',data:{id:charge.id}};
 assert.equal((await req('/webhooks/omise',event)).status,502);
 await req('/orders/'+tx.id+'/cancel',{},orderHeaders);unavailable=false;charge.status='successful';charge.paid=true;
 assert.equal((await req('/webhooks/omise',event)).status,200);assert.equal(hardware.logs.length,0);
});

for(const terminalStatus of ['expired','cancelled','failed'])test('late Omise payment is recorded once without vending: '+terminalStatus,async t=>{
 let charge;
 const omise={createCharge:async tx=>(charge={object:'charge',id:'chrg_test_late',livemode:false,amount:tx.total_amount,currency:'THB',metadata:{order_id:tx.id},source:{type:'promptpay',scannable_code:null},status:'pending',paid:false}),retrieveCharge:async()=>charge};
 const {req,db,body,orderHeaders,hardware,a,auth}=await setup(t,{paymentProvider:'omise_test',omise});
 const tx=(await req('/payments/omise/qr',{items:body.items},orderHeaders)).data;
 await req('/orders/'+tx.id+'/cancel',{},orderHeaders);
 db.prepare('UPDATE transactions SET status=? WHERE id=?').run(terminalStatus,tx.id);
 const stock=db.prepare('SELECT stock FROM products WHERE id=?').get(a.id).stock;
 charge.status='successful';charge.paid=true;
 const event={key:'charge.complete',data:{id:charge.id}};
 const replies=await Promise.all([req('/webhooks/omise',event),req('/webhooks/omise',event)]);assert.ok(replies.every(r=>r.status===200));
 const recorded=db.prepare('SELECT * FROM transactions WHERE id=?').get(tx.id);
 assert.equal(recorded.status,terminalStatus);assert.equal(recorded.paid_amount,tx.total_amount);assert.equal(recorded.refund_due,tx.total_amount);assert.equal(recorded.error_code,'omise_late_payment');
 assert.equal(db.prepare('SELECT count(*) n FROM payment_events WHERE transaction_id=?').get(tx.id).n,1);
 assert.equal(db.prepare('SELECT stock FROM products WHERE id=?').get(a.id).stock,stock);assert.equal(hardware.logs.length,0);
 const stats=(await req('/stats',null,auth)).data;assert.equal(stats.recent_transactions.find(t=>t.id===tx.id).refund_due,tx.total_amount);assert.equal(stats.total_sales,0);
});

test('Omise failed creation is not retried and releases reserved stock',async t=>{
 let created=0;
 const {req,body,orderHeaders,a,hardware}=await setup(t,{paymentProvider:'omise_test',omise:{createCharge:async()=>{created++;throw Error('timeout');}}});
 body.payment_method='promptpay';const tx=(await req('/checkout',body,orderHeaders)).data;
 assert.equal(tx.status,'failed');assert.equal(tx.error_code,'omise_creation_failed');
 await req('/checkout',body,orderHeaders);assert.equal(created,1);
 assert.equal((await req('/products')).data.find(p=>p.id===a.id).stock,8);assert.equal(hardware.logs.length,0);
});

test('Omise failed charges release stock and late cancelled payments never dispense',async t=>{
 let charge;
 const omise={createCharge:async tx=>(charge={object:'charge',id:'chrg_'+tx.id.replaceAll('-',''),livemode:false,amount:tx.total_amount,currency:'THB',metadata:{order_id:tx.id},source:{type:'promptpay',scannable_code:{image:{download_uri:'https://api.omise.co/test-qr'}}},status:'pending',paid:false}),retrieveCharge:async()=>charge};
 const {req,body,orderHeaders,a,hardware}=await setup(t,{paymentProvider:'omise_test',omise});body.payment_method='promptpay';
 const tx=(await req('/checkout',body,orderHeaders)).data;charge.status='failed';
 assert.equal((await req('/orders/'+tx.id,null,orderHeaders)).data.status,'failed');
 assert.equal((await req('/products')).data.find(p=>p.id===a.id).stock,8);
 const next=(await req('/checkout',body,{...orderHeaders,'Idempotency-Key':'omise-second-order-key'})).data;
 await req('/orders/'+next.id+'/cancel',{},orderHeaders);charge.status='successful';charge.paid=true;
 assert.equal((await req('/orders/'+next.id,null,orderHeaders)).data.status,'cancelled');assert.equal(hardware.logs.length,0);
});

test('Omise test refuses real hardware',()=>{
 const db=openDatabase(':memory:','1234'),hardware={mock:false};
 try{assert.throws(()=>createApp({db,hardware,paymentKey,demo:false,paymentProvider:'omise_test',omise:{}}),/mock hardware/);}finally{db.close();}
});

test('multi-item stock reservation, no unpaid dispense, payment deduplication and success',async t=>{
 const {req,auth,hardware,order,orderHeaders,a,b}=await setup(t);
 assert.equal((await req('/stats')).status,401);
 const tx=(await order()).data;assert.equal(tx.status,'awaiting_payment');assert.equal(tx.total_amount,7500);assert.equal(hardware.logs.length,0);
 assert.equal((await order()).data.id,tx.id);assert.equal((await req('/products')).data.find(p=>p.id===a.id).stock,6);
 assert.equal((await req('/checkout',{items:[{product_id:a.id,qty:1}],payment_method:'cash'},orderHeaders)).status,409);
 assert.equal((await req('/orders/'+tx.id)).status,404);
 const payment={order_id:tx.id,amount:7500,event_id:'payment-event-0001'};
 assert.equal((await req('/payments',payment)).status,401);
 assert.equal((await req('/payments',payment,{'X-Payment-Key':paymentKey})).data.status,'dispensing');
 assert.equal((await req('/payments',payment,{'X-Payment-Key':paymentKey})).status,200);
 const done=await settled(req,tx.id,orderHeaders);assert.equal(done.status,'success');assert.deepEqual(done.delivered,[{slot:'A1',qty:2},{slot:'B2',qty:1}]);
 assert.equal(hardware.logs.filter(l=>l.direction==='tx').length,1);assert.equal((await req('/stats',null,auth)).data.items_sold,3);
});
test('cancellation, expiry, stock limits and demo guard',async t=>{
 const {req,db,order,orderHeaders,a}=await setup(t,{demo:false});
 assert.equal((await req('/checkout',{items:[{product_id:a.id,qty:9}],payment_method:'coin'},orderHeaders)).status,409);
 const tx=(await order()).data;
 assert.equal((await req(`/orders/${tx.id}/demo-payment`,{},orderHeaders)).status,403);
 assert.equal((await req(`/orders/${tx.id}/cancel`,{},orderHeaders)).data.status,'cancelled');assert.equal((await req('/products')).data.find(p=>p.id===a.id).stock,8);
 const next=(await req('/checkout',{items:[{product_id:a.id,qty:1}],payment_method:'coin'},{...orderHeaders,'Idempotency-Key':'test-checkout-key-0002'})).data;
 db.prepare('UPDATE transactions SET expires_at=0 WHERE id=?').run(next.id);
 assert.equal((await req('/orders/'+next.id,null,orderHeaders)).data.status,'expired');assert.equal((await req('/products')).data.find(p=>p.id===a.id).stock,8);
});
test('partial cash locks cancellation; staff can reconcile a refund and restore inventory',async t=>{
 const {req,order,orderHeaders,auth,a}=await setup(t);const tx=(await order()).data;
 await req('/payments',{order_id:tx.id,amount:1000,event_id:'cash-event-0001'},{'X-Payment-Key':paymentKey});
 assert.equal((await req(`/orders/${tx.id}/cancel`,{},orderHeaders)).status,409);
 const result=await req(`/orders/${tx.id}/resolve`,{delivered:[{slot:'A1',qty:0},{slot:'B2',qty:0}]},auth);assert.equal(result.data.refund_due,1000);
 assert.equal((await req('/products')).data.find(p=>p.id===a.id).stock,8);
 assert.equal((await req(`/orders/${tx.id}/resolve`,{delivered:[{slot:'A1',qty:0},{slot:'B2',qty:0}]},auth)).status,409);
});
test('partial hardware failure stays locked and reconciles each quantity',async t=>{
 const h=new Hardware({mock:true});h.dispense=async()=>{h.blocked=true;return{status:'uncertain',error_code:'motor_jam',delivered:[{slot:'A1',qty:1},{slot:'B2',qty:0}]};};
 const {req,order,auth,orderHeaders,a,b}=await setup(t,{hardware:h});const tx=(await order()).data;
 await req('/payments',{order_id:tx.id,amount:7500,event_id:'payment-event-0001'},{'X-Payment-Key':paymentKey});
 assert.equal((await req('/orders/'+tx.id,null,orderHeaders)).data.status,'uncertain');
 assert.equal((await req('/products/'+a.id,{slot:'A1',name:'Cookie',price:2000,stock:90},auth,'PUT')).status,409);
 const r=await req(`/orders/${tx.id}/resolve`,{delivered:[{slot:'A1',qty:1},{slot:'B2',qty:0}]},auth);assert.equal(r.data.status,'partial');assert.equal(r.data.refund_due,5500);
 const products=(await req('/products')).data;assert.equal(products.find(p=>p.id===a.id).stock,7);assert.equal(products.find(p=>p.id===b.id).stock,5);assert.equal(h.blocked,true);
});
test('dynamic settings validate timezone, keep password private, generate QR and invalidate sessions',async t=>{
 const {req,auth,a,orderHeaders}=await setup(t);
 const s=(await req('/settings')).data;assert.equal(s.admin_password,undefined);
 const body={store_logo:'',timezone:'Asia/Bangkok',promptpay_id:'0812345678',ui_text_json:{headline:'ขนมอร่อยรอคุณอยู่'}};
 assert.equal((await req('/settings',{...body,timezone:'Bad/Timezone'},auth,'PUT')).status,400);
 assert.equal((await req('/settings',body,auth,'PUT')).status,200);
 const tx=(await req('/checkout',{items:[{product_id:a.id,qty:1}],payment_method:'promptpay'},orderHeaders)).data;
 const qr=(await req('/orders/'+tx.id,null,orderHeaders)).data.qr_payload;assert.match(qr,/^000201/);assert.match(qr,/540520.00/);
 await req(`/orders/${tx.id}/cancel`,{},orderHeaders);
 assert.equal((await req('/password',{current_password:'1234',new_password:'new-password'},auth,'PUT')).status,200);
 assert.equal((await req('/stats',null,auth)).status,401);
 assert.equal((await req('/login',{password:'new-password'})).status,200);
});
test('uploads decode actual image bytes and serve WebP',async t=>{
 const {base,auth}=await setup(t);const sharp=(await import('sharp')).default;
 const bytes=await sharp({create:{width:2,height:2,channels:3,background:'#f9c9db'}}).png().toBuffer();
 const form=new FormData();form.append('image',new Blob([bytes],{type:'image/png'}),'product.png');
 const res=await fetch(base+'/api/upload',{method:'POST',headers:auth,body:form});assert.equal(res.status,201);const {image_url}=await res.json();
 t.after(async()=>{await(await import('node:fs/promises')).unlink(new URL('../public'+image_url,import.meta.url));});
 const img=await fetch(base+image_url);assert.equal(img.status,200);assert.match(img.headers.get('content-type'),/image\/webp/);
});
test('serial parser tolerates non-object messages and rejects malformed receipts safely',async()=>{
 const make=()=>{const h=new Hardware({mock:true});h.mock=false;h.port={write:()=>{}};return h;};
 const h=make(),pending=h.dispense([{slot:'A1',qty:1}],'review');
 for(const msg of [null,[],true,42,'noise'])assert.doesNotThrow(()=>h.receive(JSON.stringify(msg)+'\n'));
 assert.ok(h.pending);h.receive(JSON.stringify({request_id:'review',status:'success',delivered:[{slot:'A1',qty:1}]})+'\n');assert.equal((await pending).status,'success');h.close();
 for(const status of ['success','error'])for(const delivered of [[null],[{slot:'A1',qty:-1}],[{slot:'A1',qty:1.5}],[{slot:'A1',qty:2}],[{slot:'B2',qty:1}],[{slot:'A1',qty:1},{slot:'A1',qty:1}],{},'bad']){
  const controller=make(),result=controller.dispense([{slot:'A1',qty:1}],'review');
  assert.doesNotThrow(()=>controller.receive(JSON.stringify({request_id:'review',status,delivered})+'\n'));
  const receipt=await result;assert.equal(receipt.status,'uncertain');assert.deepEqual(receipt.delivered,[]);assert.equal(controller.blocked,true);controller.close();
 }
});

test('serial protocol enforces correlation and complete queue receipts',async()=>{
 const h=new Hardware({mock:true});h.mock=false;h.port={write:()=>{}};const promise=h.dispense([{slot:'A1',qty:2}],'expected');
 h.receive('{"status":"success","request_id":"wrong","delivered":[{"slot":"A1","qty":2}]}\n');assert.ok(h.pending);
 h.receive('{"status":"success","request_id":"expected",');h.receive('"delivered":[{"slot":"A1","qty":1}]}\n');assert.equal((await promise).status,'uncertain');assert.equal(h.blocked,true);h.close();
});
