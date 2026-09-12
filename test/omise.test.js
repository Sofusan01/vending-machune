import test from 'node:test';
import assert from 'node:assert/strict';
import {createOmise,validateCharge,chargeQr} from '../omise.js';
test('Omise adapter rejects live keys and keeps test credentials server-side',async()=>{
 assert.throws(()=>createOmise({secretKey:'skey_live_example'}),/test secret/);
 assert.throws(()=>createOmise({secretKey:''}),/test secret/);
 const requests=[];
 const omise=createOmise({secretKey:'skey_test_example',fetchImpl:async(url,options)=>{requests.push({url,options});return{ok:true,json:async()=>({})};}});
 await omise.createCharge({id:'order-1',total_amount:2500,expires_at:Date.now()+300000});
 await omise.retrieveCharge('chrg_example');
 assert.equal(requests[0].url,'https://api.omise.co/charges');
 assert.equal(requests[0].options.body.get('amount'),'2500');
 assert.equal(requests[0].options.body.get('source[type]'),'promptpay');
 assert.equal(requests[0].options.body.get('metadata[order_id]'),'order-1');
 assert.equal(requests[1].options.method,'GET');
 assert.equal(requests[1].options.headers.Authorization,'Basic '+Buffer.from('skey_test_example:').toString('base64'));
});
test('charge validation rejects live, foreign, wrong amount and wrong currency responses',()=>{
 const tx={id:'order-1',total_amount:2500};
 const charge={object:'charge',id:'chrg_example',livemode:false,amount:2500,currency:'THB',source:{type:'promptpay'},metadata:{order_id:'order-1'}};
 validateCharge(charge,tx,'chrg_example');
 validateCharge({...charge,id:'chrg_test_68yfvu4lpkrvzao2a38'},tx,'chrg_test_68yfvu4lpkrvzao2a38');
 for(const patch of [{livemode:true},{amount:2501},{currency:'USD'},{metadata:{order_id:'other'}},{id:'chrg_other'},{source:{type:'card'}}])assert.throws(()=>validateCharge({...charge,...patch},tx,'chrg_example'));
 assert.throws(()=>chargeQr({source:{scannable_code:{image:{download_uri:'https://evil.example/qr'}}}}));
 assert.equal(chargeQr({status:'pending',source:{scannable_code:null}}),null);
});
