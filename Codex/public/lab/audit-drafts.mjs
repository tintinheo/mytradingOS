// Device-local recovery copies, never presented as a saved server audit.
let dbPromise;
function db(){return dbPromise??=new Promise((resolve,reject)=>{const request=indexedDB.open('vn100-recovery',1);request.onupgradeneeded=()=>request.result.createObjectStore('drafts');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
export async function loadDrafts(scope){const database=await db();return new Promise((resolve,reject)=>{const request=database.transaction('drafts').objectStore('drafts').get(scope);request.onsuccess=()=>resolve(request.result||[]);request.onerror=()=>reject(request.error);});}
export async function saveDrafts(scope,pending){if(!scope)throw new Error('No account scope');const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction('drafts','readwrite');tx.objectStore('drafts').put(pending,scope);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);});}
