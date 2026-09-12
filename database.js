import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
export const slots=['A1','A2','A3','A4','A5','B1','B2','B3','B4','B5'];
import {defaultText} from './shared/ui-text.js';
import {defaultFeatures} from './shared/features.js';
export {defaultText};
export function hashPassword(password){const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(password,salt,64).toString('hex');}
export function verifyPassword(password,encoded){try{const [salt,key]=encoded.split(':');return timingSafeEqual(scryptSync(String(password),salt,64),Buffer.from(key,'hex'));}catch{return false;}}
export function openDatabase(filename=process.env.DB_PATH||'./data/vending-v2.sqlite',password=process.env.ADMIN_PASSWORD){
 if(filename!==':memory:')mkdirSync(dirname(resolve(filename)),{recursive:true});
 const db=new Database(filename);db.pragma('journal_mode = WAL');db.pragma('foreign_keys = ON');db.pragma('busy_timeout = 5000');
 if(db.prepare("SELECT name FROM sqlite_master WHERE name='transactions'").get()&&!db.prepare('PRAGMA table_info(transactions)').all().some(c=>c.name==='items_json')){db.close();throw Error('Version 1 database detected. Use a new DB_PATH; see migration notes in README.');}
 db.exec(`CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY,slot TEXT NOT NULL UNIQUE,name TEXT NOT NULL,price INTEGER NOT NULL CHECK(price>=0),stock INTEGER NOT NULL CHECK(stock>=0),type TEXT NOT NULL DEFAULT '',color TEXT NOT NULL DEFAULT '#f9c9db',image_url TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS transactions(id TEXT PRIMARY KEY,items_json TEXT NOT NULL,total_amount INTEGER NOT NULL,payment_method TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),expires_at INTEGER NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,access_hash TEXT NOT NULL,paid_amount INTEGER NOT NULL DEFAULT 0,delivered_json TEXT NOT NULL DEFAULT '[]',error_code TEXT,kind TEXT NOT NULL DEFAULT 'sale',refund_due INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS payment_events(event_id TEXT PRIMARY KEY,transaction_id TEXT NOT NULL REFERENCES transactions(id),amount INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,expires INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS tx_status ON transactions(status);`);
 const put=db.prepare('INSERT OR IGNORE INTO settings VALUES (?,?)');
 for(const [k,v] of Object.entries({store_logo:'',ui_text_json:defaultText,timezone:'Asia/Bangkok',promptpay_id:'',features:defaultFeatures,idle_seconds:60}))put.run(k,JSON.stringify(v));
 if(!db.prepare("SELECT 1 FROM settings WHERE key='admin_password'").get()){if(!password||password.length<4){db.close();throw Error('Set ADMIN_PASSWORD (4+ characters) for first initialization');}put.run('admin_password',hashPassword(password));}
 db.prepare("UPDATE transactions SET status='uncertain',error_code='server_restarted' WHERE status='dispensing' OR (status='awaiting_payment' AND paid_amount>0)").run();
 db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());return db;
}
export function publicSettings(db){return Object.fromEntries(db.prepare("SELECT * FROM settings WHERE key!='admin_password'").all().map(r=>[r.key,JSON.parse(r.value)]));}
