export async function request(path,{body,token,orderToken,headers,...options}={}){
 const res=await fetch('/api'+path,{...options,headers:{...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`} :{}),...(orderToken?{'X-Order-Token':orderToken}:{}),...headers},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
 if(res.status===204)return null;
 const data=await res.json();if(!res.ok)throw Object.assign(Error(data.error||'Request failed'),{status:res.status});return data;
}
export const money=n=>new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB',maximumFractionDigits:2}).format((n||0)/100);
