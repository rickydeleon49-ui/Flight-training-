const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const req = createRequire(path.join(process.cwd(), 'package.json'));
const { buildSync } = req('esbuild');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/rickymac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const phase = process.argv[2] || 'before';
const out = process.env.OUTPUT_DIR;
if (!out) throw Error('Set OUTPUT_DIR to a new disposable directory; do not overwrite saved evidence');
fs.mkdirSync(out,{recursive:true});
const source = fs.readFileSync('src/pages/StudyLibrary/MaterialDetail.tsx', 'utf8');
const start = source.indexOf('                <div className={`file-row');
const end = source.indexOf('\n                {fileMissing ? (', start);
if (start < 0 || end < 0) throw Error('Cannot locate production file-row JSX');
const jsx = source.slice(start,end);
const code = `import {renderToStaticMarkup} from 'react-dom/server';
import {Button} from './src/components/ui/Button';
import {DocumentIcon,AlertIcon,ExternalIcon} from './src/components/ui/Icons';
export function render(mode='pdf') {
 const fileMissing=mode==='missing', canSplit=mode==='pdf',canHandleFiles=()=>true;
 const material={originalFileName:'07_afh_ch6_a_very_long_original_training_document_name_for_layout.pdf',fileSize:6291456};
 const formatFileSize=()=> '6.0 MB';
 const setSplitting=()=>{},setSplittingManually=()=>{},open=()=>{};
 return renderToStaticMarkup(${jsx});
}`;
const bundle=buildSync({stdin:{contents:code,loader:'tsx',resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/*','react-dom/server'],write:false});
const mod={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(req,mod,mod.exports);
const css=['src/styles/tokens.css','src/styles/base.css','src/styles/layout.css','src/components/ui/ui.css','src/pages/StudyLibrary/studyLibrary.css'].map(f=>fs.readFileSync(f,'utf8')).join('\n');
let fonts='';
for (const weight of [400,500,600]) {
 const f=path.join(process.cwd(),`node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2`);
 if(fs.existsSync(f)) fonts+=`@font-face{font-family:Inter;font-style:normal;font-weight:${weight};src:url(data:font/woff2;base64,${fs.readFileSync(f).toString('base64')}) format('woff2');}`;
}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
 const page=await browser.newPage();
 await page.route('**/*',r=>r.abort());
 const results=[];
 for(const width of [320,480,640,960]) for(const scale of [1,1.5,2]) for(const mode of ['pdf','missing','other']) {
  await page.setViewportSize({width,height:700});
  const html=`<!doctype html><html style="font-size:${16*scale}px"><head><meta charset="utf-8"><style>${fonts}${css}</style></head><body><main style="padding:16px"><div class="card"><div class="card__body">${mod.exports.render(mode)}</div></div></main></body></html>`;
  await page.setContent(html); await page.evaluate(()=>document.fonts.ready);
  const metrics=await page.evaluate(()=>{
   const row=document.querySelector('.file-row');
   const details=row.querySelector('.file-row__details') || row.querySelector('div');
   const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
   const d=rect(details),r=rect(row),buttons=[...row.querySelectorAll('button')].map(rect);
   const size=details.querySelector('.tiny'); const range=document.createRange();range.selectNodeContents(size);const sr=range.getBoundingClientRect();
   const overlaps=buttons.some(b=> b.x<d.right-1 && b.right>d.x+1 && b.y<d.bottom-1 && b.bottom>d.y+1);
   const outside=buttons.some(b=> b.x<r.x-1 || b.right>r.right+1);
   return {details:d,row:r,buttons,overlaps,outside,sizeWithinDetails:sr.x>=d.x-1&&sr.right<=d.right+1,documentOverflow:document.documentElement.scrollWidth>innerWidth,usableDetails:d.width>=Math.min(100,r.width/2)};
  });
  const ok=!metrics.overlaps&&!metrics.outside&&metrics.sizeWithinDetails&&!metrics.documentOverflow&&metrics.usableDetails;
  results.push({width,scale,mode,ok,...metrics});
  if(width===640&&scale===1&&mode==='pdf') {
   await page.screenshot({path:path.join(out,`${phase}-640.png`),fullPage:true});fs.writeFileSync(path.join(out,`${phase}-fixture.html`),html);
  }
  if(width===320&&scale===2&&mode==='pdf') await page.screenshot({path:path.join(out,`${phase}-320-large.png`),fullPage:true});
 }
 await browser.close();
 fs.writeFileSync(path.join(out,`${phase}-layout.json`),JSON.stringify({phase,source:'Production MaterialDetail file-row JSX, real Button/Icons and production CSS; synthetic data; isolated Chromium, no app/profile/database/network.',passed:results.filter(r=>r.ok).length,total:results.length,results},null,2)+'\n');
 console.log(`${phase}: ${results.filter(r=>r.ok).length}/${results.length} layout cases pass`);
 if(phase==='after' && results.some(r=>!r.ok)) process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
