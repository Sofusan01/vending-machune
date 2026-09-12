import {useCallback,useEffect,useRef,useState} from 'react';
import {QRCodeSVG} from 'qrcode.react';
import {motion} from 'framer-motion';
import {ShoppingBag,Plus,Minus,X,ArrowRight,ChevronLeft,ChevronRight,Coins,Banknote,QrCode,Check,Box,Layers} from 'lucide-react';
import './kiosk.css';
import {defaultFeatures} from '../../shared/features.js';
import {defaultText} from '../../shared/ui-text.js';
import {request,money} from './api';
import Modal from './Modal';
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))||fallback;}catch{return fallback;}};
const terminal=['success','partial','failed','cancelled','expired'];
function ProductImage({product}){return product.image_url?<img className="w-full h-full object-contain drop-shadow-md" draggable="false" src={product.image_url} alt={product.name}/>:<span className="product-emoji" aria-hidden="true">{product.type.toLowerCase().includes('drink')?'🧃':'🍪'}</span>;}




const playPop = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.1);
  } catch(e) {}
};

const playSuccess = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const playNote = (freq, startTime, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.1, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };
    playNote(523.25, ctx.currentTime, 0.2);
    playNote(659.25, ctx.currentTime + 0.1, 0.2);
    playNote(783.99, ctx.currentTime + 0.2, 0.4);
  } catch(e) {}
};

export default function Kiosk(){
 const [settings,setSettings]=useState(null),[products,setProducts]=useState([]),[error,setError]=useState(''),[page,setPage]=useState(0),[now,setNow]=useState(Date.now());
 const [cart,setCart]=useState(()=>{const saved=read('vending-cart',{});return Date.now()-(saved.updated||0)<60000&&Array.isArray(saved.items)?saved.items:[];});
 const [selected,setSelected]=useState(null),[qty,setQty]=useState(1),[checkout,setCheckout]=useState(false),[asleep,setAsleep]=useState(false);
 const [session,setSession]=useState(()=>read('vending-order',null)),[order,setOrder]=useState(null),[busy,setBusy]=useState(false);
 const [size,setSize]=useState({width:window.innerWidth,height:window.innerHeight});
 const [flight,setFlight]=useState(null),[cartPop,setCartPop]=useState(0),[celebration,setCelebration]=useState(null);
 const features={...defaultFeatures,...settings?.features};
 const cartTarget=useRef(null),quantityImage=useRef(null),celebrated=useRef(new Set());
 useEffect(()=>{if(!flight)return;const timer=setTimeout(()=>setFlight(null),850);return()=>clearTimeout(timer);},[flight]);
 useEffect(()=>{if(asleep){setFlight(null);setCelebration(null);}},[asleep]);
 useEffect(()=>{
  if(!features.animations||asleep||order?.status!=='success'||celebrated.current.has(order.id))return;
  celebrated.current.add(order.id);
  if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)setCelebration(order.id); playSuccess(); },[order?.id,order?.status,asleep,features.animations]);
 useEffect(()=>{if(!celebration)return;const timer=setTimeout(()=>setCelebration(null),2000);return()=>clearTimeout(timer);},[celebration]);
 const lastTouch=useRef(Date.now());const t={...defaultText,...settings?.ui_text_json};
 const refresh=useCallback(async()=>{const [s,p]=await Promise.all([request('/settings'),request('/products')]);setSettings(s);setProducts(p);},[]);
 useEffect(()=>{refresh().catch(e=>setError(e.message));const timer=setInterval(()=>refresh().catch(()=>{}),10000);return()=>clearInterval(timer);},[refresh]);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);const resize=()=>setSize({width:window.innerWidth,height:window.innerHeight});window.addEventListener('resize',resize);return()=>{clearInterval(timer);window.removeEventListener('resize',resize);};},[]);
 useEffect(()=>{localStorage.setItem('vending-cart',JSON.stringify({items:cart,updated:Date.now()}));},[cart]);
 useEffect(()=>{if(session)localStorage.setItem('vending-order',JSON.stringify(session));else localStorage.removeItem('vending-order');},[session]);
 useEffect(()=>{
  if(!features.screensaver){setAsleep(false);return;}
  lastTouch.current=Date.now();
  const touch=()=>{lastTouch.current=Date.now();setAsleep(false);};
  window.addEventListener('pointerdown',touch,{capture:true,passive:true});window.addEventListener('keydown',touch);
  const timer=setInterval(()=>{if(Date.now()-lastTouch.current>=(settings?.idle_seconds||60)*1000){setCart([]);setSelected(null);setCheckout(false);setAsleep(true);}},500);
  return()=>{clearInterval(timer);window.removeEventListener('pointerdown',touch,true);window.removeEventListener('keydown',touch);};
 },[settings?.idle_seconds,features.screensaver]);
 useEffect(()=>{
  if(!session)return;let stopped=false,timer;
  async function poll(){try{
   if(!session.id){const tx=await request('/checkout',{method:'POST',orderToken:session.token,headers:{'Idempotency-Key':session.key},body:session.body});if(!stopped){setOrder(tx);setSession(s=>({...s,id:tx.id}));setCart([]);setCheckout(false);}return;}
   const tx=await request('/orders/'+session.id,{orderToken:session.token});if(!stopped){setOrder(tx);setError('');if(terminal.includes(tx.status))refresh().catch(()=>{});}
  }catch(e){if(!stopped){
   if(session.id&&e.status===404){
    localStorage.removeItem('vending-order');setSession(null);setOrder(null);setCart([]);setCheckout(false);setAsleep(false);lastTouch.current=Date.now();
    setError('The saved order could not be found. You can start a new order. If you already paid, contact staff.');refresh().catch(()=>{});return;
   }
   setError(e.message);if(!session.id&&e.status&&e.status<500){setSession(null);return;}
  }}
  if(!stopped)timer=setTimeout(poll,1200);
  }
  poll();return()=>{stopped=true;clearTimeout(timer);};
 },[session,refresh]);
 const cartRows=cart.map(i=>({...i,product:products.find(p=>p.id===i.product_id)})).filter(i=>i.product);
 const count=cartRows.reduce((n,i)=>n+i.qty,0),total=cartRows.reduce((n,i)=>n+i.qty*i.product.price,0);
 const columns=Math.min(Math.max(products.length,1),size.width>=1100?4:size.width>=750?3:2);
 const rows=Math.max(1,Math.min(2,Math.floor((size.height-330)/210)));
 const perPage=columns*rows,pages=Math.max(1,Math.ceil(products.length/perPage)),visible=products.slice(Math.min(page,pages-1)*perPage,(Math.min(page,pages-1)+1)*perPage);
 const open=p=>{if(!features.ordering||!p.stock||session)return; setSelected(p);setQty(1);};
 const selectedInCart=cart.find(i=>i.product_id===selected?.id)?.qty||0;
 const available=selected?Math.min(selected.stock-selectedInCart,10-selectedInCart,20-count):0;
 function add(){if(!features.ordering||qty>available||qty<1)return; playPop(); const source=quantityImage.current?.getBoundingClientRect(),target=cartTarget.current?.getBoundingClientRect();
  if(features.animations&&source&&target&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
   const x=source.left+source.width/2-32,y=source.top+source.height/2-32;
   setFlight({id:crypto.randomUUID(),product:selected,x,y,dx:target.left+target.width/2-32-x,dy:target.top+target.height/2-32-y});
  }
  setCartPop(n=>n+1);
setCart(c=>c.some(i=>i.product_id===selected.id)?c.map(i=>i.product_id===selected.id?{...i,qty:i.qty+qty}:i):[...c,{product_id:selected.id,qty}]);setSelected(null);}
 function begin(method){if(session||!count||!features.ordering||!features[method])return; setError('');const token=crypto.randomUUID()+crypto.randomUUID();setSession({token,key:crypto.randomUUID(),body:{items:cartRows.map(({product_id,qty})=>({product_id,qty})),payment_method:method}});}
 async function orderAction(path){setBusy(true);setError('');try{setOrder(await request('/orders/'+session.id+path,{method:'POST',orderToken:session.token}));}catch(e){setError(e.message);}finally{setBusy(false);}}
 function finish(){setSession(null);setOrder(null);setCart([]);setCheckout(false);setError('');lastTouch.current=Date.now();refresh().catch(()=>{});}
 const clock=settings?new Intl.DateTimeFormat('en-GB',{timeZone:settings.timezone,hour:'2-digit',minute:'2-digit'}).format(now):'—';
 return <main className={`kiosk kiosk-spatial${asleep?' is-asleep':''}${features.animations?'':' motion-disabled'}${features.slot_labels?'':' slots-hidden'}`} style={{'--columns':columns,'--rows':products.length<=columns?1:rows}}>
  <div className="spatial-scene" aria-hidden="true"><div className="spatial-grid"/><div className="spatial-orbit"><i/><i/><i/></div></div>
  <header className="k-header"><div className="k-brand">{settings?.store_logo?<img src={settings.store_logo} alt={t.store_name}/>:<div className="k-brand-mark"><Box/></div>}<div><strong>{t.store_name}</strong><small>SELF-SERVICE / REIMAGINED</small></div></div><div className="k-clock">{settings?.demo_payments&&<span className="demo-pill">{t.demo_mode}</span>}{features.clock&&<time>{clock}</time>}</div></header>
  <section className="k-intro"><div><p><span className="spatial-dot"/>SELECT. TAP. ENJOY.</p><h1>{t.headline}</h1><div className="k-description">{t.subtitle}</div></div><div className="spatial-emblem" aria-hidden="true"><Layers/><span>EVERYDAY<br/>UPGRADED.</span></div></section>
  <div className="k-collection"><span><Box size={16}/> THE COLLECTION <b>{String(products.length).padStart(2,'0')}</b></span><div className="k-pagination"><span>{String(Math.min(page,pages-1)+1).padStart(2,'0')} / {String(pages).padStart(2,'0')}</span>{pages>1&&<><button aria-label={t.previous} disabled={page<=0} onClick={()=>{setPage(p=>p-1); }}><ChevronLeft/></button><button aria-label={t.next} disabled={page>=pages-1} onClick={()=>{setPage(p=>p+1); }}><ChevronRight/></button></>}</div></div>
  {!features.ordering&&!session&&<div className="k-error" role="status">Ordering is temporarily paused. Please check back soon.</div>}
  {error&&!session&&<div className="k-error" role="alert">{error}</div>}
  <section className={`k-product-grid${products.length===1?' single-product':''}`} aria-label="Products">{visible.map(p=><motion.button whileTap={!features.animations||!features.ordering||!p.stock||session?undefined:{scale:0.98}} transition={{type:'spring',stiffness:420,damping:26}} className="k-product" style={{'--accent':p.color}} key={p.id} disabled={!features.ordering||!p.stock||!!session} onClick={()=>open(p)}><div className="k-product-visual"><span className="k-slot">{p.slot}</span><span className="k-product-type">{p.type}</span><div className="product-plinth" aria-hidden="true"/><div className="spatial-product-image"><ProductImage product={p}/></div>{!p.stock&&<span className="sold-out">{t.sold_out}</span>}</div><div className="k-product-info"><div><h2>{p.name}</h2><span>{money(p.price)}</span></div><span className="k-plus"><Plus/></span></div></motion.button>)}{!products.length&&<div className="k-empty"><Box size={40}/><p>{settings?t.empty_products:t.loading}</p></div>}</section>
  <footer className="k-cart rounded-3xl backdrop-blur-xl"><div ref={cartTarget} className="cart-target" aria-live="polite" aria-atomic="true"><ShoppingBag aria-hidden="true"/><span key={cartPop} className={cartPop?"cart-count cart-count-pop":"cart-count"}>{count}</span><span className="sr-only">{t.your_cart}</span></div><div className="k-cart-label"><ShoppingBag/><div><strong>{t.your_cart}</strong><small>{count} / 20</small></div></div><div className="k-cart-items">{cartRows.length?cartRows.map(i=><div className="cart-chip" key={i.product_id}><span>{i.product.name} × {i.qty}</span><button aria-label={`${t.remove} ${i.product.name}`} onClick={()=>{setCart(c=>c.filter(x=>x.product_id!==i.product_id)); }}><X size={17}/></button></div>):<span className="muted">{t.empty_cart}</span>}</div><button className="k-primary" disabled={!features.ordering||!count||!!session} onClick={()=>{setCheckout(true); }}>{money(total)}<span>{t.checkout}</span><ArrowRight/></button></footer>
  {selected&&!asleep&&<Modal label={t.choose_quantity} onClose={()=>{setSelected(null); }} className="k-modal"><button className="modal-x" aria-label={t.close} onClick={()=>{setSelected(null); }}><X/></button><div ref={quantityImage} className="quantity-image"><ProductImage product={selected}/></div><h2>{selected.name}</h2><p>{money(selected.price)} · {Math.max(0,available)} {t.available}</p><div className="quantity-controls"><button aria-label="−" disabled={qty<=1} onClick={()=>{setQty(q=>q-1); }}><Minus/></button><strong>{qty}</strong><button aria-label="+" disabled={qty>=available} onClick={()=>{setQty(q=>q+1); }}><Plus/></button></div><button className="k-primary full" disabled={!features.ordering||available<1} onClick={add}>{t.add_to_cart} · {money(qty*selected.price)}</button></Modal>}
  {checkout&&!session&&!asleep&&<Modal label={t.pay_title} onClose={()=>{setCheckout(false); }} className="k-modal"><button className="modal-x" aria-label={t.close} onClick={()=>{setCheckout(false); }}><X/></button><h2>{t.pay_title}</h2><p className="checkout-total">{money(total)}</p><div className="payment-options">{[['cash',Banknote],['coin',Coins],['promptpay',QrCode]].filter(([method])=>features[method]).map(([method,Icon])=><button key={method} disabled={!features.ordering||(method==='promptpay'&&!settings?.promptpay_available)} onClick={()=>begin(method)}><Icon/><span>{t[method]}</span><ArrowRight size={18}/></button>)}</div></Modal>}
  {session&&!asleep&&<Modal label={t.pay_title} className="k-modal">{features.animations&&celebration===order?.id&&<div className="success-confetti" aria-hidden="true">{Array.from({length:28},(_,i)=><i key={i} style={{'--x':`${(i*37)%100}%`,'--drift':`${((i*23)%120)-60}px`,'--delay':`${(i%7)*55}ms`,'--spin':`${i%2?450:-400}deg`,'--color':['#d5f58a','#253129','#a5bd88','#e6eedc'][i%4]}}/>)}</div>}<h2>{!order?t.loading:order.status==='awaiting_payment'?t.waiting_payment:order.status==='dispensing'?t.dispensing:order.status==='success'?t.success:order.status==='expired'?t.expired:order.status==='cancelled'?t.cancelled:order.status==='failed'?'Payment failed':t.uncertain}</h2>{order?.error_code==='omise_creation_failed'&&<p role="alert">Could not create the Omise test QR. Check your test key, internet connection and PromptPay access. Check the dashboard before starting a new order.</p>}{order&&<><p className="checkout-total">{money(order.total_amount)}</p>{order.status==='awaiting_payment'&&<>{order.payment_method==='promptpay'?((order.qr_payload||order.qr_image_url)?<><div className="qr-box">{order.qr_image_url?<img src={order.qr_image_url} alt="Omise test PromptPay QR" width={210} height={210}/>:<QRCodeSVG value={order.qr_payload} size={210} marginSize={4} level="M"/>}</div><p>{settings?.payment_provider==='omise_test'?'Test payment: mark this charge Successful in the Omise dashboard.':t.scan_qr}</p></>:<p>{t.loading}</p>):<div className="cash-instructions">{order.payment_method==='coin'?<Coins size={52}/>:<Banknote size={52}/>}<p>{order.payment_method==='coin'?t.insert_coin:t.insert_cash}</p></div>}<p>{t.remaining}: <b>{money(order.total_amount-order.paid_amount)}</b></p>{settings?.demo_payments&&<button disabled={busy} className="demo-payment" onClick={()=>orderAction('/demo-payment')}>{t.demo_payment}</button>}{order.paid_amount===0&&<button className="full secondary" disabled={busy} onClick={()=>orderAction('/cancel')}>{t.cancel}</button>}</>}{order.status==='dispensing'&&<div className="dispensing-icon animate-bounce"><ShoppingBag size={64}/></div>}{order.status==='success'&&<><div className="success-heart"><Check size={56}/></div><p>{t.pick_up}</p></>}{order.refund_due>0&&<p>{t.refund_due}: {money(order.refund_due)}</p>}{terminal.includes(order.status)&&<button className="k-primary full" onClick={()=>{finish(); }}>{t.close}</button>}</>}{error&&<p role="alert" className="k-error">{error}</p>}</Modal>}
  {asleep&&<button className="screensaver" aria-label={t.touch_to_order} onPointerDown={e=>{e.stopPropagation();lastTouch.current=Date.now();setAsleep(false);}} onClick={()=>{setAsleep(false); }}><div className="screensaver-brand">{settings?.store_logo?<img src={settings.store_logo} alt=""/>:<Box size={40}/ >}{t.store_name}</div><span className="screensaver-kicker">A SMALL BREAK. A NEW PERSPECTIVE.</span><h1>{t.screensaver_title}</h1><div className="marquee-window"><div className="marquee-track">{[0,1].map(copy=><div className="marquee-group" aria-hidden={copy===1} key={copy}>{(products.length?products:[{id:0,name:t.store_name,type:'',image_url:'',color:'#d8ef90'}]).map(p=><div className="marquee-card" key={p.id}><ProductImage product={p}/><span>{p.name}</span></div>)}</div>)}</div></div><div className="touch-prompt">{t.touch_to_order}<ArrowRight/></div>{session&&<small>{t.resume_order}</small>}</button>}
  {flight&&features.animations&&!asleep&&<div key={flight.id} className="cart-flight" aria-hidden="true" style={{left:flight.x,top:flight.y,'--fly-x':`${flight.dx}px`,'--fly-y':`${flight.dy}px`}}><ProductImage product={flight.product}/></div>}
 </main>;
}
