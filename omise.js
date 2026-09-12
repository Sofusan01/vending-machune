// Server-only PromptPay integration. This adapter deliberately accepts test keys only.
export function createOmise({secretKey=process.env.OMISE_SECRET_KEY,fetchImpl=fetch}={}) {
 if(!/^skey_test_[A-Za-z0-9]+$/.test(secretKey||''))throw Error('Set OMISE_SECRET_KEY to your Omise test secret key (skey_test_...)');
 async function request(path,body) {
  let response;
  try {
   response=await fetchImpl('https://api.omise.co'+path,{
    method:body?'POST':'GET',
    headers:{Authorization:'Basic '+Buffer.from(secretKey+':').toString('base64'),'Omise-Version':'2019-05-29',...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},
    body:body?new URLSearchParams(body):undefined,signal:AbortSignal.timeout(15000)
   });
  } catch {throw Object.assign(Error('Cannot reach Omise. Check your internet connection and Omise dashboard before trying again.'),{status:502});}
  if(!response.ok)throw Object.assign(Error('Omise rejected the request. Check your test key, PromptPay availability and charge in the Omise dashboard.'),{status:502});
  return response.json();
 }
 return {
  createCharge:tx=>request('/charges',{'amount':String(tx.total_amount),'currency':'THB','source[type]':'promptpay','metadata[order_id]':tx.id,'description':'Vending test order '+tx.id,'expires_at':new Date(tx.expires_at).toISOString()}),
  retrieveCharge:id=>request('/charges/'+encodeURIComponent(id))
 };
}

export function validateCharge(charge,tx,expectedId) {
 if(charge.object!=='charge'||!/^chrg_(?:test_)?[A-Za-z0-9]+$/.test(charge.id||'')||(expectedId&&charge.id!==expectedId)||charge.livemode!==false||charge.amount!==tx.total_amount||charge.currency?.toLowerCase()!=='thb'||charge.source?.type!=='promptpay'||charge.metadata?.order_id!==tx.id)
  throw Object.assign(Error('Omise charge does not match this test order'),{status:502});
}

export function chargeQr(charge) {
 const value=charge.source?.scannable_code?.image?.download_uri;
 // Omise may finish generating the QR after the initial charge response.
 if(value==null&&charge.status==='pending')return null;
 try {const url=new URL(value);if(url.origin==='https://api.omise.co'&&!url.username&&!url.password)return url.href;}catch{}
 throw Object.assign(Error('Omise did not return a valid PromptPay QR image'),{status:502});
}
