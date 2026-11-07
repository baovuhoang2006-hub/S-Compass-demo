const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const fixtures=require('../../../src/data/demo-fixtures.json');
const base=process.env.SCOMPASS_QA_URL||'http://localhost:3015';
const screenshotOptions={animations:'disabled',style:'header{position:static!important} nextjs-portal{display:none!important}'};
async function saved(p){await p.waitForTimeout(430);return p.evaluate(()=>JSON.parse(localStorage.getItem('s-compass-demo-v3')));}
async function close(p){await p.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();await p.getByRole('dialog').waitFor({state:'hidden'});}
async function shot(p,name){await p.evaluate(()=>scrollTo(0,0));await p.screenshot({...screenshotOptions,path:path.join(__dirname,name)});}
async function setup(p,method='rules'){
  await p.goto(`${base}/dispatcher`);
  if(method==='rules') await p.getByRole('button',{name:'Generate Proposed Plan'}).first().click();
  else {await p.getByRole('button',{name:'Compare Plans',exact:true}).click();await p.getByRole('button',{name:'View Detailed Comparison',exact:true}).click();await p.getByRole('button',{name:`Use ${method}`,exact:true}).click();await close(p);}
  await p.getByRole('button',{name:'Dispatch to rider',exact:true}).click();await p.getByRole('link',{name:'Rider',exact:true}).click();await p.locator('[data-rider-next]').waitFor();
}
async function run(b,mode){
  const ctx=await b.newContext({viewport:mode==='mobile'?{width:390,height:844}:{width:1440,height:1000},reducedMotion:'reduce'});
  const p=await ctx.newPage();p.setDefaultTimeout(12000);const errors=[];p.on('pageerror',e=>errors.push(e.message));const checks={};
  await p.goto(`${base}/rider`);await p.getByText('No plan dispatched yet',{exact:true}).waitFor();checks.emptyState=true;
  await setup(p);let s=await saved(p);const plan=s.currentPlan[s.shiftId];const source=fixtures.shifts.find(x=>x.id===s.shiftId);const next=plan.stops.find(x=>s.stopStates[s.shiftId][x.stopId].status==='pending'&&Number.isFinite(x.arriveMin));
  const card=p.locator('[data-rider-next]');const why=card.locator('details');
  assert.equal(await card.locator('[aria-label="Order ID"]').innerText(),next.stopId);
  assert.equal(await card.getByRole('button').count(),3);
  for(const name of ['Open Stop Card','Report Issue','Record Delivery Outcome']){
    const button=card.getByRole('button',{name,exact:true});assert((await button.boundingBox()).height>=44);
  }
  assert.equal(await why.getAttribute('open'),null);assert.equal(await card.getByText(/Estimated chance:/).isVisible(),false);
  await card.getByText('Why this stop?',{exact:true}).click();await card.getByText(/Estimated chance:/).waitFor();
  assert((await why.innerText()).includes(`${Math.round(next.p*100)}%`));
  for(const reason of next.reasons)assert((await why.innerText()).includes(reason));
  await card.getByText('Why this stop?',{exact:true}).click();
  assert((await card.innerText()).includes('COD · Collect cash'));assert((await card.innerText()).includes('Amount not provided in source data.'));
  assert.equal(await card.locator('a').count(),0);checks.codAndDisclosure=true;
  if(mode==='mobile')await card.screenshot({...screenshotOptions,path:path.join(__dirname,'after-mobile.png')});
  else await shot(p,'after-desktop.png');
  const long='VeryLongDemoNameWithoutSpaces'.repeat(5);
  await card.getByRole('heading',{level:3}).evaluate((el,t)=>el.textContent=t,long);
  await card.locator('p').first().evaluate((el,t)=>el.textContent='Recipient: '+t,long);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(mode==='mobile')await shot(p,'long-names-mobile.png');
  await p.reload();await card.waitFor();s=await saved(p);assert.deepEqual(s.currentPlan[s.shiftId].totals,plan.totals);
  checks.longNamesAndReload=true;
  // Validate keyboard focus and the existing shared dialog, without changing its workflow.
  await card.getByRole('button',{name:'Open Stop Card',exact:true}).focus();await p.keyboard.press('Enter');const d=p.getByRole('dialog');await d.waitFor();
  for(const name of ['Confirm on site','Suggest Correction','Report disputed information'])await d.getByRole('button',{name,exact:true}).first().waitFor();
  assert.equal(await d.getByRole('button',{name:'Approve',exact:true}).count(),0);
  await d.getByRole('button',{name:'Suggest Correction',exact:true}).click();await d.getByLabel('Correct information').fill('Demo observed entrance, pending review');
  await d.getByRole('button',{name:'Send correction for review'}).click();
  await d.getByText(/Official instructions remain unchanged/).waitFor();
  if(mode==='mobile')await d.screenshot({path:path.join(__dirname,'stop-card-mobile.png'),animations:'disabled'});
  await close(p);assert(await card.getByRole('button',{name:'Open Stop Card',exact:true}).evaluate(el=>document.activeElement===el));
  s=await saved(p);assert.equal(JSON.stringify(s.currentPlan[s.shiftId]),JSON.stringify(plan));assert(!s.overlays[source.stops.find(x=>x.id===next.stopId).locationKey]?.entrance?.includes('pending review'));
  checks.stopCardCorrectionAndKeyboard=true;
  // Keep the operational warning outside the analytical disclosure.
  await card.getByRole('button',{name:'Open Stop Card',exact:true}).click();await d.getByRole('button',{name:'Report disputed information',exact:true}).first().click();
  await d.getByLabel('Why is this card wrong?').fill('Demo safety report: gate instruction needs review');await d.getByRole('button',{name:'Report disputed information',exact:true}).last().click();await close(p);
  await card.getByRole('alert').getByText(/Site information disputed/).waitFor();assert.equal(await why.getAttribute('open'),null);
  checks.disputeWarningVisible=true;
  // A temporary incident stays separate from permanent knowledge correction.
  await card.getByRole('button',{name:'Report Issue',exact:true}).click();await d.getByLabel('What happened?').selectOption('wrong');
  await d.getByRole('button',{name:'Open stop card',exact:true}).click();await d.getByRole('heading',{name:'Delivery Instructions',exact:true}).waitFor();await close(p);
  await card.getByRole('button',{name:'Report Issue',exact:true}).click();await d.getByLabel('What happened?').selectOption('other');await d.getByLabel('Describe it').fill('Demo operational issue');await d.getByRole('button',{name:'Send report',exact:true}).click();
  await card.getByRole('button',{name:'Report Issue',exact:true}).click();await d.getByLabel('What happened?').selectOption('closed');await d.getByLabel('How long?').selectOption('rest');await d.getByRole('button',{name:'Send report',exact:true}).click();
  await p.getByText('Plan change proposed',{exact:true}).waitFor();await card.getByRole('alert').getByText(/Entrance temporarily unavailable/).waitFor();
  s=await saved(p);assert.equal(JSON.stringify(s.currentPlan[s.shiftId]),JSON.stringify(plan));assert(s.proposals.some(x=>x.status==='open'));
  if(mode==='mobile')await card.screenshot({path:path.join(__dirname,'warnings-mobile.png'),...screenshotOptions});
  checks.issueTypesAndReplanNotification=true;
  // Explicitly accept the existing proposal, retaining unscheduled orders instead of hiding them.
  await p.getByRole('button',{name:'Accept new plan',exact:true}).click();
  const unscheduled=p.locator('section[aria-labelledby="later"]').getByText('Dispatcher',{exact:true});
  assert((await unscheduled.count())>0);checks.unscheduledStopsVisible=true;
  const activeId=await card.locator('[aria-label="Order ID"]').innerText();
  assert.notEqual(activeId,next.stopId); // closed site is not selected as next delivery
  // Delivered then failed: selection, clock, counts, reason, history and evidence use old handlers.
  await card.getByRole('button',{name:'Record Delivery Outcome',exact:true}).click();await d.getByRole('button',{name:'Save outcome',exact:true}).click();
  s=await saved(p);assert.equal(s.stopStates[s.shiftId][activeId].status,'delivered');assert.equal(s.outcomes.at(-1).outcome,'delivered');
  const activePlanned=s.currentPlan[s.shiftId].stops.find(x=>x.stopId===activeId);assert(s.clockMin[s.shiftId]>=activePlanned.departMin);
  assert.notEqual(await card.locator('[aria-label="Order ID"]').innerText(),activeId);
  await card.getByRole('button',{name:'Record Delivery Outcome',exact:true}).click();await d.getByText('Not delivered',{exact:true}).click();assert(await d.getByRole('radio',{name:'Not delivered',exact:true}).isChecked());await d.getByLabel('Reason',{exact:true}).selectOption('COD payment not ready');await d.getByRole('button',{name:'Save outcome',exact:true}).click();
  await p.getByRole('button',{name:'Completed (2)',exact:true}).click();await p.getByText('failed',{exact:true}).waitFor();s=await saved(p);assert.equal(s.outcomes.at(-1).reason,'COD payment not ready');
  checks.outcomesCompletedClockAndSelection=true;
  await p.getByRole('link',{name:'Evidence',exact:true}).click();const dw=p.waitForEvent('download');await p.getByRole('button',{name:'Export CSV',exact:true}).click();const dl=await dw;const stream=await dl.createReadStream();let csv='';for await(const c of stream)csv+=c;
  for(const ev of ['correction_suggested','dispute_reported','issue_reported','outcome_recorded'])assert(csv.includes(ev));
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);checks.evidenceNoErrorsOrOverflow=true;
  await ctx.close();return checks;
}
async function prepaid(b){
  const p=await b.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});await setup(p,'baseline');
  const card=p.locator('[data-rider-next]');
  // Use real outcome actions until the first prepaid parcel, without editing fixture/state/route.
  for(let i=0;i<50;i++){
    if((await card.innerText()).includes('Prepaid')){
      assert(!(await card.innerText()).includes('Collect cash'));assert(!(await card.innerText()).includes('Amount not provided'));
      await shot(p,'prepaid-mobile.png');await p.close();return true;
    }
    await card.getByRole('button',{name:'Record Delivery Outcome',exact:true}).click();await p.getByRole('button',{name:'Save outcome',exact:true}).click();
  }
  throw Error('No prepaid parcel reached');
}
async function confirmed(b){
  const p=await b.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});await setup(p);
  const card=p.locator('[data-rider-next]');const id=await card.locator('[aria-label="Order ID"]').innerText();const before=await saved(p);
  await p.getByRole('link',{name:'Buyer simulation',exact:true}).click();await p.getByRole('button',{name:new RegExp('^'+id+' ·')}).click();
  await p.getByRole('button',{name:/Send confirmation request/}).click();await p.getByRole('button',{name:/^Confirm /}).click();
  await p.getByRole('link',{name:'Rider',exact:true}).click();await card.getByText(/Buyer confirmed:/).waitFor();
  const after=await saved(p);assert.equal(JSON.stringify(before.currentPlan),JSON.stringify(after.currentPlan));assert.equal(after.stopStates[after.shiftId][id].buyer.kind,'confirmed');
  await p.close();return true;
}
module.exports={confirmed};
if(require.main===module)(async()=>{const b=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});try{const result={};for(const mode of ['desktop','mobile']){result[mode]=await run(b,mode);console.log(mode,result[mode]);}result.prepaid=await prepaid(b);result.buyerConfirmedDisplay=await confirmed(b);fs.writeFileSync(path.join(__dirname,'browser-results.json'),JSON.stringify(result,null,2));console.log('RIDER QA PASS');}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
