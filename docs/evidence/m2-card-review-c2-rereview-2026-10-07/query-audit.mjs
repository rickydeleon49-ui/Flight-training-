import { writeFileSync } from 'node:fs';
import { buildSyntheticDatabase,T0 } from '../m2-card-review-c2-scope-corrections-2026-10-07/proof/syntheticDataset.mjs';
import { getLibraryReviewDue,getLibraryRecentReviews,nextLocalMidnightUtc } from '../m2-card-review-c2-scope-corrections-2026-10-07/proof/contractModel.mjs';
const {db}=buildSyntheticDatabase(5000,10000);
function measuredRead(read){
 const calls=[];
 const measured={prepare(sql){const s=db.prepare(sql);return Object.fromEntries(['all','get'].map(method=>[method,(...params)=>{const r=s[method](...params),rows=method==='all'?r:r?[r]:[];calls.push({sql:sql.replace(/\s+/g,' ').trim(),method,rows:rows.length,estimatedJsonUtf8Bytes:Buffer.byteLength(JSON.stringify(rows),'utf8')});return r;} ]));}};
 const result=read(measured);
 return {returnedRows:result.materials?.length??result.rows.length,calls:calls.length,returnedSqlRows:calls.reduce((a,c)=>a+c.rows,0),estimatedJsonUtf8Bytes:calls.reduce((a,c)=>a+c.estimatedJsonUtf8Bytes,0),detail:calls};
}
try{
 const audit={node:process.version,sqlite:process.versions.sqlite,due:measuredRead(m=>getLibraryReviewDue(m,{nowUtc:T0,nextLocalMidnightUtc:nextLocalMidnightUtc(T0,'UTC'),limit:50})),history:measuredRead(m=>getLibraryRecentReviews(m,{limit:20}))};
 writeFileSync(new URL('query-audit.json',import.meta.url),JSON.stringify(audit,null,2)+'\n');
 for(const [k,v] of Object.entries(audit))if(typeof v==='object')console.log(k,JSON.stringify({returnedRows:v.returnedRows,sqlCalls:v.calls,returnedSqlRows:v.returnedSqlRows,estimatedJsonUtf8Bytes:v.estimatedJsonUtf8Bytes}));
}finally{db.close();}
