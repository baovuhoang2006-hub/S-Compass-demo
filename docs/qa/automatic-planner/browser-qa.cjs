const {chromium}=require('playwright');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const base=process.env.SCOMPASS_QA_URL||'http://localhost:3031';const out=process.env.SCOMPASS_QA_OUT||__dirname;fs.mkdirSync(out,{recursive:true});
const shot={animations:'disabled',style:'header{position:static!important}'};
async function saved(p){await p.waitForTimeout(430);return p.evaluate(()=>JSON.parse(localStorage.getItem('s-compass-demo-v3')));}
function fmt(n){const m=Math.round(n);return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;}
async function aligned(p,plan){
 const summary=p.getByRole('region',{name:'Current plan summary',exact:true});
 assert.equal(await summary.getAttribute('data-plan-method'),plan.method);
 await summary.getByText(`${plan.totals.expectedSuccess.toFixed(1)} / ${plan.totals.estimatedStops}`,{exact:true}).waitFor();
 await summary.getByText(fmt(plan.totals.endMin),{exact:true}).waitFor();
 assert.deepEqual(await p.locator('[data-delivery-stop]').evaluateAll(es=>es.map(e=>e.dataset.deliveryStop)),plan.stops.map(s=>s.stopId));
 assert.deepEqual(await p.locator('[data-route-stop]').evaluateAll(es=>es.map(e=>e.dataset.routeStop)),plan.stops.map(s=>s.stopId));
 const schedule=p.getByRole('region',{name:'Delivery Schedule'});const titles=await schedule.locator('button[title]').evaluateAll(es=>es.map(e=>e.title).join('\n'));const allSchedule=await schedule.innerText();
 for(const stop of plan.stops){
  const row=p.locator(`[data-delivery-stop="${stop.stopId}"]`);assert((await row.innerText()).includes(fmt(stop.arriveMin)));
  const route=p.locator(`[data-route-stop="${stop.stopId}"]`);const text=await route.innerText();assert(text.includes('#'+stop.seq));assert(text.includes(fmt(stop.arriveMin)));
  assert((titles+'\n'+allSchedule).includes(`#${stop.seq} · ${stop.stopId} · ${fmt(stop.arriveMin)}`),`Timeline differs for ${stop.stopId}`);
 }
 const stop=plan.stops[1];await p.locator(`[data-route-stop="${stop.stopId}"]`).click();
 await p.getByText('Why this stop/time?',{exact:true}).click();
 const why=p.getByText('Why this stop/time?',{exact:true}).locator('..');for(const reason of stop.reasons)await why.getByText(reason,{exact:true}).waitFor({state:'visible'});
 await p.getByText('Why this stop/time?',{exact:true}).click();
}
async function scenario(b,mode,shift,winner){
 const c=await b.newContext({viewport:mode==='mobile'?{width:390,height:844}:{width:1440,height:1000},reducedMotion:'reduce'});const p=await c.newPage();p.setDefaultTimeout(15000);const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(`${base}/dispatcher`);await p.locator('#shift').selectOption(shift);
 const before=await saved(p);assert.equal(before.draftPlan,null);
 await p.getByRole('button',{name:'Generate Proposed Plan',exact:true}).first().click();
 await p.getByText(`Automatically selected: ${winner==='model'?'Model-assisted planner (experimental)':'Rules-based planner'}`,{exact:true}).waitFor();
 let s=await saved(p);const plan=s.draftPlan;assert.equal(plan.method,winner);assert.equal(s.method,winner);assert.equal(s.comparison.length,3);assert.deepEqual(plan,s.comparison.find(x=>x.method===winner));assert.equal(await p.getByRole('dialog').count(),0);
 assert.deepEqual(s.currentPlan,before.currentPlan);assert.equal(s.events.filter(e=>e.type==='plan_dispatched').length,0);assert.equal(s.events.filter(e=>e.type==='plans_compared').length,1);assert.equal(s.events.filter(e=>e.type==='planner_auto_selected').length,1);
 await aligned(p,plan);const summary=p.getByRole('region',{name:'Current plan summary'});
 await summary.screenshot({...shot,path:path.join(out,`${shift}-${mode}-draft.png`)});
 await p.getByRole('region',{name:'Delivery Schedule'}).screenshot({...shot,path:path.join(out,`${shift}-${mode}-schedule.png`)});
 await p.getByRole('region',{name:'Route stop sequence'}).screenshot({...shot,path:path.join(out,`${shift}-${mode}-route.png`)});
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await p.getByRole('button',{name:'Compare Plans',exact:true}).click();await p.getByRole('button',{name:'View Detailed Comparison',exact:true}).click();
 const totals=s.comparison.map(x=>x.totals);
 for(const method of ['baseline','rules','model']){await p.getByRole('button',{name:'Use '+method,exact:true}).click();s=await saved(p);assert.deepEqual(s.draftPlan,s.comparison.find(x=>x.method===method));assert.deepEqual(s.comparison.map(x=>x.totals),totals);assert.equal(s.events.at(-1).type,'plan_draft_selected');assert.deepEqual(s.currentPlan,before.currentPlan);}
 await p.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();await p.getByRole('dialog').waitFor({state:'hidden'});await aligned(p,s.draftPlan);
 await p.reload();await p.getByRole('button',{name:'Dispatch to rider',exact:true}).waitFor();assert.deepEqual((await saved(p)).draftPlan,s.draftPlan);
 for(const role of ['buyer','rider']){await p.getByRole('combobox',{name:/Demo role switcher/}).selectOption(role);assert(await p.getByRole('button',{name:'Dispatch to rider',exact:true}).isDisabled());}
 await p.getByRole('combobox',{name:/Demo role switcher/}).selectOption('dispatcher');
 // Change a real buyer commitment without a dispatched plan; stale draft and comparison must be blocked.
 await p.getByRole('link',{name:'Buyer simulation',exact:true}).click();const id=plan.stops[0].stopId;await p.getByRole('button',{name:new RegExp('^'+id+' ·')}).click();await p.getByRole('button',{name:/Send confirmation request/}).click();await p.getByRole('button',{name:/^Ask for Evening/}).click();
 await p.getByRole('link',{name:'Dispatcher',exact:true}).click();assert(await p.getByRole('button',{name:'Dispatch to rider',exact:true}).isDisabled());
 await p.getByText('Selection is out of date. Inputs changed; generate a new proposed plan before dispatch.',{exact:true}).waitFor();
 await p.getByRole('button',{name:'Generate Proposed Plan',exact:true}).click();s=await saved(p);assert(s.draftPlan);assert.equal(s.draftPlan.stops.find(x=>x.stopId===id).block,'evening');
 assert(await p.getByRole('button',{name:'Dispatch to rider',exact:true}).isEnabled());await p.getByRole('button',{name:'Dispatch to rider',exact:true}).click();s=await saved(p);assert.equal(s.events.at(-1).type,'plan_dispatched');
 // A pending proposal prevents automatic selection and dispatch, without replacing current plan or commitments.
 await p.getByRole('link',{name:/^Replanning/}).click();await p.getByText('Simulate a scenario',{exact:true}).click();await p.getByRole('button',{name:'Send pickup request',exact:true}).click();const pending=await saved(p);assert(pending.proposals.some(x=>x.status==='open'));
 await p.getByRole('link',{name:'Dispatcher',exact:true}).click();await p.getByRole('button',{name:'Generate Proposed Plan',exact:true}).click();s=await saved(p);assert.equal(s.draftPlan,null);assert.deepEqual(s.proposals,pending.proposals);assert.deepEqual(s.currentPlan,pending.currentPlan);assert.deepEqual(s.stopStates,pending.stopStates);await p.getByText('Dispatcher review required — no automatic draft',{exact:true}).waitFor();assert.equal(await p.getByRole('button',{name:'Dispatch to rider',exact:true}).count(),0);
 await p.getByRole('region',{name:'Current plan summary'}).screenshot({...shot,path:path.join(out,`${shift}-${mode}-review.png`)});
 await p.getByRole('link',{name:'Evidence',exact:true}).click();const download=p.waitForEvent('download');await p.getByRole('button',{name:'Export CSV',exact:true}).click();const stream=await(await download).createReadStream();let csv='';for await(const chunk of stream)csv+=chunk;for(const event of ['planner_auto_selected','plan_draft_selected','planner_selection_review','plan_dispatched'])assert(csv.includes(event));
 assert.deepEqual(errors,[]);await c.close();return {winner,parcels:plan.totals.stops,expectedSuccess:plan.totals.expectedSuccess,minutesPerParcel:plan.totals.onRoadMin/plan.totals.stops,finish:fmt(plan.totals.endMin),oneClick:true,wholeWinningPlan:true,routeEtaSchedule:true,noAutoDispatch:true,manualOverride:true,staleGuards:true,pendingProposalProtected:true,evidence:true,errors};
}
(async()=>{const b=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});try{const result={};for(const mode of ['desktop','mobile']){result[mode]={};for(const [shift,winner] of [['shift-wed','model'],['shift-sat','rules']]){result[mode][shift]=await scenario(b,mode,shift,winner);console.log(mode,shift,'PASS');}}fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify(result,null,2));}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
