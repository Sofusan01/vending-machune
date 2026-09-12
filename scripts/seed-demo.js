import {openDatabase,slots} from '../database.js';
if(process.env.HARDWARE_MODE!=='mock'||process.env.DEMO_PAYMENTS!=='true')throw Error('Demo seed requires mock hardware and DEMO_PAYMENTS=true');
const db=openDatabase();
if(db.prepare('SELECT 1 FROM products').get()){db.close();throw Error('Demo seed only runs on an empty catalog');}
const catalog=[['Strawberry milk',3500,'Drink','#f8c8dc'],['Butter cookies',2500,'Snack','#f5dfb4'],['Matcha latte',4000,'Drink','#cfe5c7'],['Choco bites',3000,'Snack','#ddc6b7'],['Peach tea',3000,'Drink','#ffdcc1'],['Oat cookies',2500,'Snack','#eadbbd'],['Berry juice',3500,'Drink','#e3caea'],['Potato chips',2000,'Snack','#fff0b6'],['Mineral water',1500,'Drink','#cbe5ed'],['Vanilla wafers',2000,'Snack','#f5d4cd']];
db.transaction(()=>catalog.forEach(([name,price,type,color],i)=>db.prepare('INSERT INTO products(slot,name,price,stock,type,color) VALUES (?,?,?,?,?,?)').run(slots[i],name,price,8,type,color)))();
db.close();console.log('Added 10 demo products. Upload your own product images in /admin.');
