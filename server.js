import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import sharp from 'sharp';
import {z} from 'zod';
import generatePayload from 'promptpay-qr';
import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {mkdirSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDatabase,publicSettings,hashPassword,verifyPassword,slots} from './database.js';
import {Hardware} from './hardware.js';
import {defaultFeatures} from './shared/features.js';
import {createOmise,validateCharge,chargeQr} from './omise.js';
const root=dirname(fileURLToPath(import.meta.url));
const hash=v=>createHash('sha256').update(String(v)).digest('hex');
const equal=(a,b)=>timingSafeEqual(Buffer.from(hash(a)),Buffer.from(hash(b)));
const imageURL=z.string().regex(/^(|\/uploads\/[a-f0-9-]+\.webp)$/);
const productSchema=z.object({slot:z.enum(slots),name:z.string().trim().min(1).max(80),price:z.number().int().min(1).max(1000000),stock:z.number().int().min(0).max(1000),type:z.string().max(40).default(''),color:z.string().regex(/^#[0-9a-f]{6}$/i).default('#f9c9db'),image_url:imageURL.default('')});
const orderSchema=z.object({items:z.array(z.object({product_id:z.number().int().positive(),qty:z.number().int().min(1).max(10)})).min(1).max(10),payment_method:z.enum(['promptpay','cash','coin'])});
const reject=(message,status=409)=>{throw Object.assign(Error(message),{status});};
export function createApp({db=openDatabase(),hardware=new Hardware(),paymentKey=process.env.PAYMENT_API_KEY,demo=process.env.DEMO_PAYMENTS==='true',paymentProvider=process.env.PAYMENT_PROVIDER||'local',omise}={}){
 if(!paymentKey||paymentKey.length<24)throw Error('Set PAYMENT_API_KEY to at least 24 characters');
 if(demo&&!hardware.mock)throw Error('Demo payment is only allowed with mock hardware');
 if(!['local','omise_test'].includes(paymentProvider))throw Error('PAYMENT_PROVIDER must be local or omise_test');
 if(paymentProvider==='omise_test'){
  if(!hardware.mock)throw Error('Omise test payments require mock hardware');
  omise ||= createOmise();
  demo=false;
 }
 db.exec('CREATE TABLE IF NOT EXISTS omise_payments(order_id TEXT PRIMARY KEY REFERENCES transactions(id),charge_id TEXT UNIQUE,qr_image_url TEXT,last_checked INTEGER NOT NULL DEFAULT 0)');
 const omisePayment=id=>db.prepare('SELECT * FROM omise_payments WHERE order_id=?').get(id);
 if(db.prepare("SELECT 1 FROM transactions WHERE status='uncertain'").get())hardware.blocked=true;
 const app=express();app.disable('x-powered-by');app.use(helmet({contentSecurityPolicy:{directives:{imgSrc:["'self'",'data:','https://api.omise.co']}}}));app.use(express.json({limit:'64kb'}));
 app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');next();});
 // Reject cross-origin browser mutations. Host remains loopback by default.
 app.use('/api',(req,res,next)=>{if(!['GET','HEAD'].includes(req.method)&&req.headers.origin){try{if(new URL(req.headers.origin).host!==req.headers.host)return res.status(403).json({error:'Cross-origin request denied'});}catch{return res.sendStatus(403);}}next();});
 const uploads=resolve(root,'public/uploads');mkdirSync(uploads,{recursive:true});app.use('/uploads',express.static(uploads,{dotfiles:'deny',maxAge:'1d'}));
 const auth=(req,res,next)=>{const token=req.headers.authorization?.replace(/^Bearer /,'');if(!token||!db.prepare('SELECT 1 FROM sessions WHERE token=? AND expires>?').get(hash(token),Date.now()))return res.status(401).json({error:'Please sign in'});next();};
 const paymentAuth=(req,res,next)=>equal(req.headers['x-payment-key']||'',paymentKey)?next():res.status(401).json({error:'Invalid payment adapter key'});
 const get=id=>db.prepare('SELECT * FROM transactions WHERE id=?').get(id);
 const view=tx=>{const {access_hash,idempotency_key,...safe}=tx;return{...safe,items:JSON.parse(tx.items_json),delivered:JSON.parse(tx.delivered_json)};};
 const orderAuth=(req,res,next)=>{const tx=get(req.params.id);if(!tx||!equal(hash(req.headers['x-order-token']||''),tx.access_hash))return res.status(404).json({error:'Order not found'});req.order=tx;next();};
 const active=()=>db.prepare("SELECT 1 FROM transactions WHERE status IN ('awaiting_payment','dispensing','uncertain')").get();
 const restore=tx=>{for(const i of JSON.parse(tx.items_json))if(i.product_id)db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(i.qty,i.product_id);};
 function expire(){db.transaction(()=>{for(const tx of db.prepare("SELECT * FROM transactions WHERE status='awaiting_payment' AND paid_amount=0 AND expires_at<?").all(Date.now())){restore(tx);db.prepare("UPDATE transactions SET status='expired' WHERE id=?").run(tx.id);}})();}
 const timer=setInterval(expire,1000);timer.unref();expire();
 app.post('/api/login',rateLimit({windowMs:900000,limit:10,standardHeaders:'draft-8',legacyHeaders:false}),(req,res)=>{const password=z.string().max(128).parse(req.body.password);if(!verifyPassword(password,db.prepare("SELECT value FROM settings WHERE key='admin_password'").get().value))return res.status(401).json({error:'Incorrect password'});const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES (?,?)').run(hash(token),Date.now()+28800000);res.json({token});});
 app.post('/api/logout',auth,(req,res)=>{db.prepare('DELETE FROM sessions WHERE token=?').run(hash(req.headers.authorization.slice(7)));res.sendStatus(204);});
 app.get('/api/settings',(req,res)=>res.json({...publicSettings(db),demo_payments:demo,payment_provider:paymentProvider,promptpay_available:paymentProvider==='omise_test'||!!publicSettings(db).promptpay_id,slots}));
 app.put('/api/settings',auth,(req,res)=>{
  if(active())reject('Finish the active order before changing settings');
  const schema=z.object({store_logo:imageURL,ui_text_json:z.record(z.string().regex(/^[a-z_]{1,50}$/),z.string().min(1).max(200)),timezone:z.string().max(80).refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}},'Invalid timezone'),promptpay_id:z.string().regex(/^(|0\d{9}|\d{13}|\d{15})$/),features:z.object(Object.fromEntries(Object.keys(defaultFeatures).map(key=>[key,z.boolean()]))).strict().optional(),idle_seconds:z.number().int().min(15).max(3600).optional()}).strict();
  const body=schema.parse(req.body);
  const features={...defaultFeatures,...publicSettings(db).features,...body.features};
  if(features.ordering&&!['cash','coin','promptpay'].some(key=>features[key]))reject('Enable at least one payment method or pause ordering',400);
  db.transaction(()=>{for(const [k,v] of Object.entries(body))db.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(v),k);})();res.json(publicSettings(db));
 });
 app.put('/api/password',auth,(req,res)=>{const {current_password,new_password}=z.object({current_password:z.string().max(128),new_password:z.string().min(4).max(128)}).parse(req.body);if(!verifyPassword(current_password,db.prepare("SELECT value FROM settings WHERE key='admin_password'").get().value))reject('Incorrect current password',401);db.transaction(()=>{db.prepare("UPDATE settings SET value=? WHERE key='admin_password'").run(hashPassword(new_password));db.prepare('DELETE FROM sessions').run();})();res.json({message:'Password changed. Sign in again.'});});
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1}});
 app.post('/api/upload',auth,upload.single('image'),async(req,res)=>{if(!req.file)reject('Choose an image',400);const filename=randomUUID()+'.webp';try{await sharp(req.file.buffer,{limitInputPixels:20000000}).rotate().resize(1000,1000,{fit:'inside',withoutEnlargement:true}).webp({quality:85}).toFile(resolve(uploads,filename));}catch{reject('Invalid or oversized image',400);}res.status(201).json({image_url:'/uploads/'+filename});});
 app.get('/api/products',(req,res)=>res.json(db.prepare('SELECT * FROM products WHERE active=1 ORDER BY slot').all()));
 app.post('/api/products',auth,(req,res)=>{if(active())reject('Finish the active order first');const p=productSchema.parse(req.body);const old=db.prepare('SELECT * FROM products WHERE slot=?').get(p.slot);if(old?.active)reject('Slot already assigned');if(old)db.prepare('UPDATE products SET name=@name,price=@price,stock=@stock,type=@type,color=@color,image_url=@image_url,active=1 WHERE slot=@slot').run(p);else db.prepare('INSERT INTO products(slot,name,price,stock,type,color,image_url) VALUES (@slot,@name,@price,@stock,@type,@color,@image_url)').run(p);res.status(201).json(db.prepare('SELECT * FROM products WHERE slot=?').get(p.slot));});
 app.put('/api/products/:id',auth,(req,res)=>{if(active())reject('Finish the active order first');const p=productSchema.parse(req.body);const r=db.prepare('UPDATE products SET slot=@slot,name=@name,price=@price,stock=@stock,type=@type,color=@color,image_url=@image_url WHERE id=@id AND active=1').run({...p,id:req.params.id});if(!r.changes)reject('Product not found',404);res.json({...p,id:Number(req.params.id)});});
 app.delete('/api/products/:id',auth,(req,res)=>{if(active())reject('Finish the active order first');const r=db.prepare('UPDATE products SET active=0,stock=0 WHERE id=?').run(req.params.id);res.sendStatus(r.changes?204:404);});
 function startDispense(tx){
  db.prepare("UPDATE transactions SET status='dispensing' WHERE id=?").run(tx.id);
  const items=JSON.parse(tx.items_json).map(({slot,qty})=>({slot,qty}));
  let pending;try{pending=hardware.dispense(items,tx.id);}catch{hardware.blocked=true;db.prepare("UPDATE transactions SET status='uncertain',error_code='dispatch_failed' WHERE id=?").run(tx.id);return;}
  pending.then(result=>{db.prepare('UPDATE transactions SET status=?,delivered_json=?,error_code=? WHERE id=?').run(result.status,JSON.stringify(result.delivered),result.error_code||null,tx.id);}).catch(e=>{hardware.blocked=true;console.error(e);});
 }
 const qrView=tx=>({...view(tx),qr_image_url:tx.status==='awaiting_payment'?omisePayment(tx.id)?.qr_image_url||null:null,omise_charge_id:omisePayment(tx.id)?.charge_id||null});
 app.post(['/api/checkout','/api/payments/omise/qr'],rateLimit({windowMs:60000,limit:30,standardHeaders:'draft-8',legacyHeaders:false}),async(req,res)=>{
  if(req.path==='/api/payments/omise/qr'){
   if(paymentProvider!=='omise_test')reject('Omise test mode is disabled',503);
   if(req.body?.payment_method&&req.body.payment_method!=='promptpay')reject('This endpoint accepts PromptPay only',400);
   req.body={...req.body,payment_method:'promptpay'};
  }
  expire();const body=orderSchema.parse(req.body);const idempotency=z.string().min(16).max(100).parse(req.headers['idempotency-key']);const access=z.string().min(32).max(100).parse(req.headers['x-order-token']);
  if(new Set(body.items.map(i=>i.product_id)).size!==body.items.length||body.items.reduce((n,i)=>n+i.qty,0)>20)reject('Use distinct products and at most 20 units',400);
  const previous=db.prepare('SELECT * FROM transactions WHERE idempotency_key=?').get(idempotency);
  if(previous){if(!equal(previous.access_hash,hash(access)))reject('Key belongs to another order');const priorItems=JSON.parse(previous.items_json).map(({product_id,qty})=>({product_id,qty}));if(JSON.stringify(priorItems)!==JSON.stringify(body.items)||previous.payment_method!==body.payment_method)reject('Key belongs to different cart');return res.json(qrView(previous));}
  if(active()||!hardware.connected||hardware.blocked)reject('Machine busy or unavailable');
  const features={...defaultFeatures,...publicSettings(db).features};
  if(!features.ordering)reject('Ordering is temporarily paused',503);
  if(!features[body.payment_method])reject('This payment method is disabled',400);
  if(body.payment_method==='promptpay'&&paymentProvider==='local'&&!publicSettings(db).promptpay_id)reject('PromptPay is not configured',400);
  const items=body.items.map(i=>{const p=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(i.product_id);if(!p||p.stock<i.qty)reject('Product unavailable or insufficient stock');return{product_id:p.id,slot:p.slot,name:p.name,price:p.price,qty:i.qty};});
  const id=randomUUID(),total=items.reduce((n,i)=>n+i.price*i.qty,0);
  const useOmise=paymentProvider==='omise_test'&&body.payment_method==='promptpay';
  if(useOmise&&(total<2000||total>15000000))reject('Omise PromptPay total must be between THB 20 and THB 150,000',400);
  db.transaction(()=>{for(const i of items){const r=db.prepare('UPDATE products SET stock=stock-? WHERE id=? AND stock>=?').run(i.qty,i.product_id,i.qty);if(!r.changes)reject('Insufficient stock');}db.prepare('INSERT INTO transactions(id,items_json,total_amount,payment_method,status,expires_at,idempotency_key,access_hash) VALUES (?,?,?,?,?,?,?,?)').run(id,JSON.stringify(items),total,body.payment_method,'awaiting_payment',Date.now()+300000,idempotency,hash(access));if(useOmise)db.prepare('INSERT INTO omise_payments(order_id) VALUES (?)').run(id);})();
  if(useOmise){
   try{
    const tx=get(id),charge=await omise.createCharge(tx);validateCharge(charge,tx);
    db.prepare('UPDATE omise_payments SET charge_id=?,qr_image_url=? WHERE order_id=?').run(charge.id,chargeQr(charge),id);
   }catch{
    // Never retry charge creation automatically after an ambiguous network result.
    const tx=get(id);if(tx.status==='awaiting_payment')db.transaction(()=>{restore(tx);db.prepare("UPDATE transactions SET status='failed',error_code='omise_creation_failed' WHERE id=?").run(id);})();
   }
  }
  res.status(201).json(qrView(get(id)));
 });
 function applyOmiseCharge(payment,charge){
  expire();const tx=get(payment.order_id);validateCharge(charge,tx,payment.charge_id);
  if(tx.status!=='awaiting_payment'){
   // A confirmed late payment still belongs in the ledger, but must never vend.
   if(charge.status==='successful'&&charge.paid===true&&['expired','cancelled','failed'].includes(tx.status)&&tx.paid_amount===0){
    db.transaction(()=>{
     const recorded=db.prepare('INSERT OR IGNORE INTO payment_events(event_id,transaction_id,amount) VALUES (?,?,?)').run('omise-'+charge.id,tx.id,tx.total_amount);
     if(recorded.changes)db.prepare("UPDATE transactions SET paid_amount=?,refund_due=?,error_code='omise_late_payment' WHERE id=?").run(tx.total_amount,tx.total_amount,tx.id);
    })();
   }
   return;
  }
  if(charge.status==='pending'&&!payment.qr_image_url){const qr=chargeQr(charge);if(qr)db.prepare('UPDATE omise_payments SET qr_image_url=? WHERE order_id=?').run(qr,tx.id);}
  if(charge.status==='successful'&&charge.paid===true)credit(tx.id,tx.total_amount,'omise-'+charge.id);
  else if(['failed','expired'].includes(charge.status))db.transaction(()=>{restore(tx);db.prepare('UPDATE transactions SET status=?,error_code=? WHERE id=?').run(charge.status,'omise_'+charge.status,tx.id);})();
 }
 app.post('/api/webhooks/omise',async(req,res)=>{
  if(paymentProvider!=='omise_test')reject('Omise test mode is disabled',503);
  const event=z.object({key:z.string(),data:z.object({id:z.string().regex(/^chrg_(?:test_)?[A-Za-z0-9]+$/)}).optional()}).parse(req.body);
  if(event.key!=='charge.complete')return res.json({received:true,ignored:true});
  if(!event.data)reject('Missing charge ID',400);
  const payment=db.prepare('SELECT * FROM omise_payments WHERE charge_id=?').get(event.data.id);
  if(!payment)return res.json({received:true,ignored:true});
  // Payload status and amount are untrusted. Fetch the charge using our secret key.
  const charge=await omise.retrieveCharge(payment.charge_id);
  applyOmiseCharge(payment,charge);
  res.json({received:true});
 });
 app.get('/api/orders/:id',orderAuth,async(req,res)=>{
  expire();const id=req.params.id,payment=omisePayment(id);
  if(payment&&get(id).status==='awaiting_payment'&&payment.charge_id){
   if(!omise)reject('Restart with PAYMENT_PROVIDER=omise_test to check this order',503);
   if(Date.now()-payment.last_checked>=3000){
    db.prepare('UPDATE omise_payments SET last_checked=? WHERE order_id=?').run(Date.now(),id);
    applyOmiseCharge(payment,await omise.retrieveCharge(payment.charge_id));
   }
  }
  const tx=get(id),payload=!payment&&tx.payment_method==='promptpay'&&tx.status==='awaiting_payment'?generatePayload(publicSettings(db).promptpay_id,{amount:tx.total_amount/100}):null;
  res.json({...view(tx),qr_payload:payload,qr_image_url:tx.status==='awaiting_payment'?omisePayment(id)?.qr_image_url||null:null,omise_charge_id:payment?.charge_id||null});
 });
 app.post('/api/orders/:id/cancel',orderAuth,(req,res)=>{const tx=get(req.params.id);if(tx.status!=='awaiting_payment'||tx.paid_amount!==0)reject('Paid or dispensing orders cannot be cancelled');db.transaction(()=>{restore(tx);db.prepare("UPDATE transactions SET status='cancelled' WHERE id=?").run(tx.id);})();res.json(view(get(tx.id)));});
 function credit(id,amount,eventId){
  const payment=omisePayment(id);if(payment&&eventId!=='omise-'+payment.charge_id)reject('Confirm this test payment in the Omise dashboard',403);
  const seen=db.prepare('SELECT * FROM payment_events WHERE event_id=?').get(eventId);if(seen){if(seen.transaction_id!==id||seen.amount!==amount)reject('Payment event conflict');return get(id);}
  expire();const tx=get(id);if(!tx||tx.status!=='awaiting_payment')reject('Order is not awaiting payment');if(amount>tx.total_amount-tx.paid_amount)reject('Overpayment unsupported; adapter must inhibit excess acceptance');
  db.transaction(()=>{db.prepare('INSERT INTO payment_events(event_id,transaction_id,amount) VALUES (?,?,?)').run(eventId,id,amount);db.prepare('UPDATE transactions SET paid_amount=paid_amount+? WHERE id=?').run(amount,id);})();
  const updated=get(id);if(updated.paid_amount===updated.total_amount)startDispense(updated);return get(id);
 }
 const paymentBody=z.object({order_id:z.string().uuid(),amount:z.number().int().positive(),event_id:z.string().min(8).max(100)});
 app.post('/api/payments',paymentAuth,(req,res)=>{const b=paymentBody.parse(req.body);res.json(view(credit(b.order_id,b.amount,b.event_id)));});
 app.post('/api/orders/:id/demo-payment',orderAuth,(req,res)=>{if(!demo)reject('Demo payments disabled',403);const tx=get(req.params.id);res.json(view(credit(tx.id,tx.total_amount-tx.paid_amount,'demo-'+tx.id)));});
 app.post('/api/orders/:id/confirm-payment',auth,(req,res)=>{const tx=get(req.params.id);if(!tx)reject('Order not found',404);res.json(view(credit(tx.id,tx.total_amount-tx.paid_amount,'manual-'+tx.id)));});
 app.get('/api/hardware',auth,(req,res)=>res.json({...hardware.state(),logs:hardware.logs}));
 app.post('/api/hardware/test',auth,(req,res)=>{
  if(active()||hardware.blocked||!hardware.connected)reject('Finish or reconcile active order first');const slot=z.enum(slots).parse(req.body.slot),p=db.prepare('SELECT * FROM products WHERE slot=? AND active=1').get(slot);if(p&&p.stock<1)reject('Assigned slot is out of stock');
  const id=randomUUID(),items=[{product_id:p?.id||null,slot,name:p?.name||'Motor test',price:0,qty:1}];db.transaction(()=>{if(p)db.prepare('UPDATE products SET stock=stock-1 WHERE id=?').run(p.id);db.prepare('INSERT INTO transactions(id,items_json,total_amount,payment_method,status,expires_at,idempotency_key,access_hash,kind) VALUES (?,?,?,?,?,?,?,?,?)').run(id,JSON.stringify(items),0,'test','dispensing',Date.now(),id,hash(randomUUID()),'test');})();startDispense(get(id));res.status(202).json(view(get(id)));
 });
 app.post('/api/orders/:id/resolve',auth,(req,res)=>{
  const b=z.object({delivered:z.array(z.object({slot:z.enum(slots),qty:z.number().int().min(0).max(20)})).max(10)}).parse(req.body);const tx=get(req.params.id);if(!tx||!['uncertain','awaiting_payment'].includes(tx.status))reject('Order does not need reconciliation');
  const items=JSON.parse(tx.items_json);if(b.delivered.length!==items.length||new Set(b.delivered.map(i=>i.slot)).size!==items.length||!items.every(i=>b.delivered.some(d=>d.slot===i.slot&&d.qty<=i.qty)))reject('Enter actual quantity for every ordered slot',400);
  if(tx.status==='awaiting_payment'&&b.delivered.some(d=>d.qty>0))reject('No dispense was started; delivered quantities must be zero',400);
  let value=0;db.transaction(()=>{for(const i of items){const qty=b.delivered.find(d=>d.slot===i.slot).qty;value+=qty*i.price;if(i.product_id)db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(i.qty-qty,i.product_id);}const all=items.every(i=>b.delivered.find(d=>d.slot===i.slot).qty===i.qty);db.prepare('UPDATE transactions SET status=?,delivered_json=?,refund_due=?,error_code=? WHERE id=?').run(all?'success':b.delivered.some(d=>d.qty>0)?'partial':'failed',JSON.stringify(b.delivered),Math.max(0,tx.paid_amount-value),'operator_reconciled',tx.id);})();res.json(view(get(tx.id)));
 });
 app.get('/api/stats',auth,(req,res)=>res.json({total_sales:db.prepare("SELECT COALESCE(SUM(paid_amount-refund_due),0) n FROM transactions WHERE status IN ('success','partial') AND kind='sale'").get().n,items_sold:db.prepare("SELECT delivered_json FROM transactions WHERE status IN ('success','partial') AND kind='sale'").all().reduce((n,t)=>n+JSON.parse(t.delivered_json).reduce((s,i)=>s+i.qty,0),0),low_stock:db.prepare('SELECT * FROM products WHERE active=1 AND stock<=3').all(),recent_transactions:db.prepare('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 50').all().map(view),active_orders:db.prepare("SELECT * FROM transactions WHERE status IN ('awaiting_payment','dispensing','uncertain')").all().map(view),hardware:hardware.state()}));
 const dist=resolve(root,'admin/dist');if(existsSync(dist)){app.use(express.static(dist));app.get('/{*path}',(req,res,next)=>req.path.startsWith('/api/')?next():res.sendFile(resolve(dist,'index.html')));}
 app.use((req,res)=>res.status(404).json({error:'Not found'}));app.use((err,req,res,next)=>{const status=err instanceof z.ZodError||err instanceof multer.MulterError?400:err.code?.startsWith('SQLITE_CONSTRAINT')?409:err.status||500;if(status===500)console.error(err);res.status(status).json({error:status===500?'Request failed':err instanceof z.ZodError?'Invalid input':err.message});});
 return{app,db,hardware,close(){clearInterval(timer);hardware.close();}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const system=createApp();const server=system.app.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log('Kiosk: http://localhost:3000 • Admin: http://localhost:3000/admin'));const stop=()=>{system.close();server.close(()=>{system.db.close();process.exit(0);});setTimeout(()=>process.exit(1),12000).unref();};process.on('SIGINT',stop);process.on('SIGTERM',stop);}
