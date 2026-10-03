import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Real public-map regression. No application hooks, synthetic geometry or user profile.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.UI_BASE_URL || 'http://localhost:5191';
const phase = process.env.UI_PHASE || 'after';
const output = resolve(process.env.UI_OUTPUT || `data/generated/topic-interaction-ui/${phase}`);
const hash = (v) => createHash('sha256').update(v).digest('hex');
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const namedPath = 'data/extensions/research/south-china-sea-named-island-tests.json';
const testPath = 'data/extensions/research/south-china-sea-interaction-testpoints.json';
const maskPath = 'data/extensions/research/south-china-sea-interaction-mask.json';
const named = await read(namedPath), tests = await read(testPath), mask = await read(maskPath);
const allTests = tests.tests;
const regions = (await read('data/catalog/catalog.json')).regions;
const result = { base, phase, isolatedChrome: true, basemap: 'disabled',
  evidenceHashes: Object.fromEntries(await Promise.all([namedPath,testPath,maskPath].map(async p => [p,hash(await readFile(p))]))),
  cases: [], errors: [], limitations: [] };
const baseline = phase === 'after' ? await read('data/generated/topic-interaction-ui/before/results.json').catch(() => ({cases:[]})) : {cases:[]};
if(phase==='before')result.limitations.push('An initial harness run read selection from the URL although this UI stores it in the region select. The corrected repeat uses the actual select value; the final baseline below was rerun in full.');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const mercator = ([lon, lat]) => [(lon+180)/360,(1-Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))/Math.PI)/2];
const flatMercator = ([lon,lat]) => [lon,-Math.log(Math.tan(Math.PI/4+Math.max(-80,Math.min(80,lat))*Math.PI/360))*180/Math.PI];
const selected = async page => page.evaluate(() => ({
  region: document.querySelector('select[aria-label=地区]')?.value || null,
  heading: document.querySelector('.inspector > h2')?.textContent || '',
  selects: [...document.querySelectorAll('select')].map(s => ({label:s.getAttribute('aria-label'),value:s.value})),
}));
async function ready(page, mode) {
  await page.waitForFunction(mode => {
    const el=document.querySelector('.map-surface');
    return el?.getAttribute('aria-busy')==='false' && el.dataset.mapMode===mode && el.querySelector('canvas');
  },mode,{timeout:45000});
  await page.waitForTimeout(350);
}
function inRing([x,y],ring) {
  let v=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const [a,b]=ring[i],[c,d]=ring[j];
    if((b>y)!==(d>y) && x<(c-a)*(y-b)/(d-b)+a)v=!v;
  } return v;
}
function inGeometry(p,g) {
  const polys=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
  return polys.some(r=>inRing(p,r[0])&&!r.slice(1).some(h=>inRing(p,h)));
}
const geometryCache = new Map();
async function actualGeometry(scope) {
  if(!geometryCache.has(scope)) {
    const response=await fetch(`${base}/maps/${scope}.json`);
    assert(response.ok,`public geometry ${scope}: ${response.status}`);
    geometryCache.set(scope,await response.json());
  } return geometryCache.get(scope);
}
async function canvasBox(page) {
  const canvas=page.locator('.map-surface canvas').first();
  await canvas.scrollIntoViewIfNeeded();
  const box=await canvas.boundingBox();
  assert(box && box.width>50 && box.height>50,'visible map canvas');
  return {canvas,box};
}
async function tileCamera(page) {
  return page.locator('.map-surface').evaluate(el=>({
    center:el.dataset.mapCenter?.split(',').map(Number),zoom:Number(el.dataset.mapZoom)
  }));
}
async function drag(page,dx,dy) {
  const {box}=await canvasBox(page);
  const sx=box.x+box.width/2,sy=box.y+box.height/2;
  const k=Math.min(1,(box.width*.38)/Math.max(1,Math.abs(dx)),(box.height*.38)/Math.max(1,Math.abs(dy)));
  await page.mouse.move(sx,sy);await page.mouse.down();
  await page.mouse.move(sx+dx*k,sy+dy*k,{steps:20});
  await page.waitForTimeout(120);await page.mouse.up();await page.waitForTimeout(300);
  return [dx*k,dy*k];
}
async function tileZoom(page,target) {
  for(let i=0;i<25;i++) {
    const a=await tileCamera(page);if(Math.abs(a.zoom-target)<.55)return;
    const {canvas}=await canvasBox(page);await canvas.focus();
    await page.keyboard.press(a.zoom<target?'Equal':'Minus');
    await page.waitForTimeout(310);
    const b=await tileCamera(page);
    assert(Math.abs(b.zoom-a.zoom)>.05,'public keyboard zoom must change camera');
  } throw Error('Could not reach target zoom');
}
async function tilePan(page,coordinate) {
  for(let i=0;i<20;i++) {
    const {box}=await canvasBox(page),cam=await tileCamera(page);
    const p=mercator(coordinate),c=mercator(cam.center),scale=512*2**cam.zoom;
    const dx=(p[0]-c[0])*scale,dy=(p[1]-c[1])*scale;
    if(Math.hypot(dx,dy)<4)return;
    await drag(page,-dx,-dy);
  }
  const {box}=await canvasBox(page),cam=await tileCamera(page),p=mercator(coordinate),c=mercator(cam.center),scale=512*2**cam.zoom;
  // Browser pointer events use physical-pixel rounding. Exact centering is not
  // required: the final hit position is calculated from the observed camera.
  assert(Math.abs((p[0]-c[0])*scale)<box.width*.3&&Math.abs((p[1]-c[1])*scale)<box.height*.3,'public drag must bring target into viewport');
}
async function tileNavigate(page,coordinate,zoom) {
  await tileZoom(page,4);await tilePan(page,coordinate);
  await tileZoom(page,zoom);await tilePan(page,coordinate);
  await page.waitForTimeout(500);
  const {box}=await canvasBox(page),cam=await tileCamera(page),p=mercator(coordinate),c=mercator(cam.center),scale=512*2**cam.zoom;
  return {x:box.x+box.width/2+(p[0]-c[0])*scale,y:box.y+box.height/2+(p[1]-c[1])*scale,camera:cam};
}
// Canvas has no public camera attributes. Reproduce only its documented initial
// viewport fit from the real fetched scene, then track real drags/toolbar zooms.
async function canvasNavigate(page,coordinate,scope,zoomFactor=24) {
  const geo=await actualGeometry(scope),{box}=await canvasBox(page);
  const b=[Infinity,Infinity,-Infinity,-Infinity];
  const walk=x=>{if(Array.isArray(x)&&typeof x[0]==='number'){const p=flatMercator(x);b[0]=Math.min(b[0],p[0]);b[1]=Math.min(b[1],p[1]);b[2]=Math.max(b[2],p[0]);b[3]=Math.max(b[3],p[1]);}else if(Array.isArray(x))x.forEach(walk);};
  geo.features.forEach(f=>walk(f.geometry.coordinates));
  let scale=Math.min((box.width-36)/(b[2]-b[0]),(box.height-36)/(b[3]-b[1]));
  let tx=box.width/2-(b[0]+b[2])/2*scale,ty=box.height/2-(b[1]+b[3])/2*scale;
  const p=flatMercator(coordinate);
  for(let i=0;i<80;i++) {
    const dx=box.width/2-(p[0]*scale+tx),dy=box.height/2-(p[1]*scale+ty);
    if(Math.hypot(dx,dy)<.5)break;
    const [mx,my]=await drag(page,dx,dy);tx+=mx;ty+=my;
    if(i===79)throw Error('Canvas target too far for public drag');
  }
  let factor=1;
  while(factor*1.2<=zoomFactor) {
    await page.getByRole('button',{name:'放大',exact:true}).click();
    tx=box.width/2-(box.width/2-tx)*1.2;ty=box.height/2-(box.height/2-ty)*1.2;
    scale*=1.2;factor*=1.2;
  }
  const now=await canvasBox(page);
  return {x:now.box.x+p[0]*scale+tx,y:now.box.y+p[1]*scale+ty,camera:{source:'real-geometry-fit-plus-public-drag-and-zoom',scale,zoomFactor:factor}};
}
const nameOf=t=>t.nameZh||t.name||t.id;
const landById=id=>allTests.find(t=>t.id===id);
const namedPositive=named.tests.filter(t=>t.maskContainsPoint && (t.rawHitsByScope?.vietnam?.length || t.rawHitsByScope?.vietnam));
const positivePolygons=['Xisha','Nansha'].map(group=>{
  const p=mask.polygons.filter(p=>p.group===group).sort((a,b)=>(b.bbox[2]-b.bbox[0])*(b.bbox[3]-b.bbox[1])-(a.bbox[2]-a.bbox[0])*(a.bbox[3]-a.bbox[1]))[0];
  const t=allTests.find(t=>t.sourceRegionId===p.regionId&&t.sourcePolygonIndex===p.polygonIndex);
  assert(t);return {...t,id:`${group}-large-interior-${p.polygonIndex}`,group};
});
const scenarios = phase==='before'
  ? [{route:'vietnam',scope:'vietnam',points:[namedPositive[0],namedPositive[3],landById('Da Nang')]}]
  : [
    {route:'vietnam',scope:'vietnam',points:[...namedPositive.slice(0,4),...positivePolygons,...['Da Nang','Nha Trang','Cam Ranh','Quy Nhon','Sanya Hainan'].map(landById)]},
    ...['malaysia','singapore','brunei'].flatMap(scope=>[
      {route:scope,scope,points:[...positivePolygons,...(scope==='malaysia'?['Kota Kinabalu','Kudat','Kuching']:scope==='singapore'?['Singapore']:['Bandar Seri Begawan']).map(landById)]},
      {route:`malay-region?country=${scope}`,scope,points:[...positivePolygons,landById(scope==='malaysia'?'Kota Kinabalu':scope==='singapore'?'Singapore':'Bandar Seri Begawan')]},
    ])
  ];
let serial=0;
try {
  for(const size of (phase==='before'?[{name:'desktop',width:1440,height:1000,touch:false}]:[{name:'desktop',width:1440,height:1000,touch:false},{name:'mobile',width:390,height:844,touch:true}])) {
    for(const mode of (phase==='before'?['tiles']:['tiles','canvas'])) {
      const context=await browser.newContext({viewport:{width:size.width,height:size.height},hasTouch:size.touch,isMobile:size.touch,deviceScaleFactor:1});
      await context.addInitScript(()=>sessionStorage.setItem('fangyu-private-basemap-v1',JSON.stringify({mode:'disabled'})));
      const page=await context.newPage();page.setDefaultTimeout(25000);
      page.on('pageerror',e=>result.errors.push({mode,size:size.name,error:String(e)}));
      if(mode==='canvas')await page.route('**/map-manifest.json',r=>r.abort());
      for(const scenario of scenarios)for(const test of scenario.points) {
        if(process.env.UI_MODE && mode!==process.env.UI_MODE)continue;
        if(process.env.UI_SIZE && size.name!==process.env.UI_SIZE)continue;
        if(process.env.UI_SCOPE && scenario.scope!==process.env.UI_SCOPE)continue;
        if(process.env.UI_ROUTE && scenario.route!==process.env.UI_ROUTE)continue;
        if(process.env.UI_TEST && nameOf(test)!==process.env.UI_TEST)continue;
        // Full route coverage belongs to desktop tiles. Representative mobile and
        // fallback checks avoid duplicating every route/coordinate combination.
        if(phase==='after' && (size.touch || mode==='canvas')) {
          if(scenario.route.startsWith('malay-region'))continue;
          if(size.touch && mode==='canvas') {
            if(scenario.scope!=='vietnam'||![namedPositive[0],landById('Da Nang')].includes(test))continue;
          } else if(scenario.scope==='vietnam') {
            if(![namedPositive[0],namedPositive[3],landById('Da Nang')].includes(test))continue;
          } else {
            const land=landById(scenario.scope==='malaysia'?'Kota Kinabalu':scenario.scope==='singapore'?'Singapore':'Bandar Seri Begawan');
            if(test!==land && !(size.touch&&mode==='tiles'&&scenario.scope==='malaysia'&&test===positivePolygons[1]))continue;
          }
        }
        const row={index:++serial,mode,size:size.name,route:scenario.route,scope:scenario.scope,test:nameOf(test),coordinate:test.coordinate,phase};
        result.cases.push(row);
        try {
          await page.goto(`${base}/#/${scenario.route}`);await page.reload();await ready(page,mode);
          const checkbox=page.getByRole('checkbox',{name:'显示点位',exact:true});if(await checkbox.count())await checkbox.uncheck();
          const geo=await actualGeometry(scenario.scope);
          row.rawGeometryHits=geo.features.filter(f=>inGeometry(test.coordinate,f.geometry)).map(f=>({id:String(f.properties?.regionId||f.id),name:f.properties?.name}));
          row.baseline=baseline.cases.find(r=>JSON.stringify(r.coordinate)===JSON.stringify(test.coordinate)&&r.scope===scenario.scope&&r.actualAdministrativeHit) || null;
          row.expectedBlocked=mask.polygons.some(p=>inGeometry(test.coordinate,p.geometry));
          const screen=mode==='tiles'?await tileNavigate(page,test.coordinate,10):await canvasNavigate(page,test.coordinate,scenario.scope);
          row.screen=screen;const {canvas,box}=await canvasBox(page);
          assert(screen.x>box.x+2&&screen.x<box.x+box.width-2&&screen.y>box.y+2&&screen.y<box.y+box.height-2,'target inside actual canvas');
          row.targetUnobscured=await canvas.evaluate((el,p)=>document.elementFromPoint(p.x,p.y)===el,{x:screen.x,y:screen.y});
          assert(row.targetUnobscured,'actual canvas receives the pointer, without an overlay intercepting it');
          row.before=await selected(page);await page.mouse.move(0,0);await page.waitForTimeout(100);
          row.beforeCanvasHash=hash(await canvas.screenshot());
          if(!size.touch) {await page.mouse.move(screen.x,screen.y);await page.waitForTimeout(180);}
          row.hover=await page.locator('.map-hover-card').allTextContents();
          row.cursor=await canvas.evaluate(el=>getComputedStyle(el).cursor);
          row.hoverCanvasHash=hash(await canvas.screenshot());
          if(size.touch)await page.touchscreen.tap(screen.x,screen.y);else await page.mouse.click(screen.x,screen.y);
          await page.waitForTimeout(400);row.after=await selected(page);
          row.afterTooltip=await page.locator('.map-hover-card').allTextContents();
          row.afterCanvasHash=hash(await canvas.screenshot());
          row.selectionChanged=row.before.region!==row.after.region;
          row.actualAdministrativeHit=row.hover.length>0||row.selectionChanged;
          row.sourceHasRegion=row.rawGeometryHits.some(f=>regions.some(r=>r.id===f.id));
          if(phase==='after'&&row.expectedBlocked) {
            assert.equal(row.hover.length,0,'blocked administrative hover');
            assert.equal(row.selectionChanged,false,'blocked administrative click/touch');
            assert.equal(row.afterTooltip.length,0,'blocked post-click tooltip');
            assert.notEqual(row.cursor,'pointer','blocked administrative pointer cursor');
            assert.equal(row.beforeCanvasHash,row.hoverCanvasHash,'blocked hover leaves canvas pixels unchanged');
            assert.equal(row.beforeCanvasHash,row.afterCanvasHash,'blocked click leaves canvas pixels unchanged');
            if(size.touch)await page.touchscreen.tap(screen.x,screen.y);else await page.mouse.click(screen.x,screen.y);
            await page.waitForTimeout(180);
            row.afterRepeat=await selected(page);
            assert.equal(row.afterRepeat.region,row.before.region,'repeated blocked click/touch');
            row.verdict=row.baseline?.mode===mode?'blocked-baseline-confirmed':row.sourceHasRegion?'blocked-real-source-polygon':'no-source-hit-not-guard-proof';
          } else if(!row.expectedBlocked&&row.sourceHasRegion) {
            assert(row.selectionChanged,'ordinary land remains selectable');
            assert(row.rawGeometryHits.some(f=>f.id===row.after.region),'selected actual source region');
            if(!size.touch)assert(row.hover.length>0,'ordinary land hover retained');
            row.verdict='ordinary-land-preserved';
          } else row.verdict=row.actualAdministrativeHit?'baseline-administrative-hit':'no-hit-observed';
          row.screenshot=`${String(serial).padStart(3,'0')}-${size.name}-${mode}-${scenario.scope}.png`;
          await page.screenshot({path:resolve(output,row.screenshot),fullPage:true});
          row.passed=true;
        } catch(e) {
          row.passed=false;row.error=String(e);console.error('FAIL',row.route,row.test,row.error);
          await page.screenshot({path:resolve(output,`failure-${serial}.png`),fullPage:true}).catch(()=>{});
        }
        console.log(row.passed?'PASS':'FAIL',serial,scenario.route,row.test,row.verdict||'');
        await writeFile(resolve(output,'results.json'),JSON.stringify(result,null,2));
      }
      await context.close();
    }
  }
} finally {
  if(phase==='after')result.limitations.push('Desktop tiles cover all direct and malay-region country routes. Mobile and Canvas use representative direct routes. Canvas far-sea points on MY/SG/BN are not exercised through public pan because their native maps contain no matching polygons and SG/BN fitted extents require excessive dragging; direct-renderer guard checks are maintained separately. Public simplified Canvas geometry can omit small polygons present in vector tiles, so no-source-hit cases are not evidence of a guard-induced change.');
  result.passed=result.cases.length>0&&result.cases.every(r=>r.passed)&&result.errors.length===0;
  result.summary=Object.fromEntries([...new Set(result.cases.map(r=>r.verdict||'failed'))].map(v=>[v,result.cases.filter(r=>(r.verdict||'failed')===v).length]));
  await writeFile(resolve(output,'results.json'),JSON.stringify(result,null,2));
  await browser.close();
}
console.log(JSON.stringify({phase,passed:result.passed,summary:result.summary,errors:result.errors},null,2));
if(!result.passed)process.exitCode=1;
