const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.SCOMPASS_QA_URL || 'http://localhost:3025';
const out = process.env.SCOMPASS_QA_OUT || __dirname;
fs.mkdirSync(out, { recursive: true });
const shot = { animations: 'disabled', style: 'header{position:static!important} nextjs-portal{display:none!important}' };
async function saved(p) {
  await p.waitForTimeout(430);
  return p.evaluate(() => JSON.parse(localStorage.getItem('s-compass-demo-v3')));
}
function protectedState(s) {
  return { currentPlan:s.currentPlan, stopStates:s.stopStates, outcomes:s.outcomes, overlays:s.overlays, corrections:s.corrections, proposals:s.proposals };
}
async function setup(p) {
  await p.goto(`${base}/dispatcher`);
  await p.getByRole('button', {name:'Generate Proposed Plan',exact:true}).first().click();
  await p.getByRole('button', {name:'Dispatch to rider',exact:true}).click();
  await p.getByRole('link', {name:'Rider',exact:true}).click();
  await p.getByRole('button', {name:'Record Delivery Outcome',exact:true}).click();
  await p.getByRole('button', {name:'Save outcome',exact:true}).click();
  const s=await saved(p);
  const next=s.currentPlan[s.shiftId].stops.find(x=>s.stopStates[s.shiftId][x.stopId].status==='pending').stopId;
  await p.getByRole('link', {name:'Buyer simulation',exact:true}).click();
  await p.getByRole('button', {name:new RegExp('^'+next+' ·')}).click();
  await p.getByRole('button', {name:/Send confirmation request/}).click();
  await p.getByRole('button', {name:/^Confirm /}).click();
  await p.getByRole('link', {name:'Risk Challenge',exact:true}).click();
  await p.getByRole('heading', {name:'Risk Challenge',exact:true}).waitFor();
  const baseline=await saved(p);
  assert(baseline.outcomes.length>0);
  assert(Object.values(baseline.stopStates[baseline.shiftId]).some(s=>s.buyer.kind==='confirmed'));
  return baseline;
}
async function runTest(p, expected, heading, name, before) {
  await p.getByRole('button', {name:/^(Run|Retry) scenario$/}).click();
  await p.locator(`[data-risk-status="${expected}"]`).waitFor();
  const result=p.getByRole('region', {name:'Risk test result',exact:true});
  await result.getByRole('heading', {name:heading,exact:true}).waitFor();
  const details=result.locator('details');
  assert.equal(await details.getAttribute('open'),null);
  assert.equal(await result.getByRole('button', {name:expected==='safe'?'Save test result to Evidence':'Record dispatcher review',exact:true}).count(),1);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(await saved(p),before,'Merely running a scenario must not mutate any persisted demo state');
  await p.evaluate(()=>scrollTo(0,0));
  await p.screenshot({...shot,path:path.join(out,`${name}.png`),fullPage:true});
  await result.getByText('Technical details & Evidence',{exact:true}).click();
  const meta={};
  for(const key of ['Incident ID','Status','INPUT','DETECTION','EXPLANATION','SAFE ACTION','OUTPUT','FALLBACK','WARNING']) {
    const term=details.locator('dt').filter({hasText:new RegExp('^'+key+'$')});
    assert.equal(await term.count(),1);
    meta[key]=await term.locator('..').locator('dd').innerText();
    assert(meta[key].length>0);
  }
  assert(meta['Incident ID'].startsWith('RISK-'));
  assert.equal(meta.Status,expected.toUpperCase());
  assert((await details.innerText()).includes('not an executed dispatch, quarantine or correction'));
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await result.getByText('Technical details & Evidence',{exact:true}).click();
  console.log(name,'PASS');
  return {result,meta};
}
async function checkStatus(result,label,status) {
  await result.locator(`[data-risk-check="${label}"]`).getByText(status,{exact:true}).waitFor();
}
async function run(browser,mode) {
  const ctx=await browser.newContext({viewport:mode==='mobile'?{width:390,height:844}:{width:1440,height:1000},reducedMotion:'reduce'});
  const p=await ctx.newPage();p.setDefaultTimeout(15000);
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  const baseline=await setup(p);const results={A:[],B:[],C:[]};
  for(const [count,capacity,budget,status,headline,cap,time] of [
    [20,40,500,'safe','System within configured limits','Pass','Pass'],
    [60,40,2000,'review','Capacity exceeded — Review required','Failed','Pass'],
    [100,40,500,'timeout','Processing time limit exceeded','Failed','Failed'],
  ]) {
    await p.getByLabel('Simulated parcels',{exact:true}).fill(String(count));
    await p.getByLabel('Demo capacity',{exact:true}).fill(String(capacity));
    await p.getByLabel('Demo time budget',{exact:true}).fill(String(budget));
    const {result,meta}=await runTest(p,status,headline,`a-${status}-${mode}`,baseline);
    await checkStatus(result,'Capacity check',cap);await checkStatus(result,'Time-budget check',time);
    assert.equal(meta.INPUT,`${count} simulated parcels; demo capacity ${capacity}; demo time budget ${budget} ms`);
    assert((await result.innerText()).includes(`${count*10} ms simulated work`));
    assert((await p.getByRole('region',{name:'Test inputs'}).innerText()).includes('not measured production performance'));
    results.A.push({status,capacity:cap,time,incident:meta['Incident ID']});
  }
  // A control edit clears the previous result; processing cancellation must not resurrect stale output.
  await p.getByLabel('Simulated parcels',{exact:true}).fill('20');
  assert.equal(await p.locator('[data-risk-status]').count(),0);
  await p.getByRole('button',{name:'Run scenario',exact:true}).click();
  await p.getByRole('button',{name:'B · AI output',exact:true}).click();
  await p.waitForTimeout(500);
  assert.equal(await p.locator('[data-risk-status]').count(),0);
  for(const [fault,status,headline,numeric,rules] of [
    ['none','safe','AI prediction passed safety checks','Pass','Pass'],
    ['nan','review','AI prediction rejected — Invalid number','Failed','Not evaluated'],
    ['infinity','review','AI prediction rejected — Infinite value','Failed','Not evaluated'],
    ['above_one','review','AI prediction rejected — Out of range','Failed','Not evaluated'],
    ['missing_feature','review','AI input rejected — Required data missing','Not evaluated','Not evaluated'],
    ['hard_conflict','review','AI suggestion blocked — Delivery window conflict','Pass','Failed'],
  ]) {
    await p.getByLabel('AI fault',{exact:true}).selectOption(fault);
    const {result,meta}=await runTest(p,status,headline,`b-${fault}-${mode}`,baseline);
    await checkStatus(result,'AI output validation',numeric);await checkStatus(result,'Operational delivery rules',rules);
    if(fault==='none'||fault==='hard_conflict') {
      const value=Number(meta.DETECTION.match(/(?:p_success=|Predicted )(\d+\.\d+)/)[1]);
      await result.getByText(`${(value*100).toFixed(1)}%`,{exact:true}).waitFor();
      assert((await result.innerText()).includes('Not a guarantee of delivery success'));
    } else if(fault==='above_one') {
      await result.getByText('125%',{exact:true}).waitFor();
      assert((await result.innerText()).includes('1.25'));
    } else assert.equal(await result.locator('[aria-label="Model probability · experimental"]').count(),0);
    if(fault==='hard_conflict') assert((await result.innerText()).includes('injected buyer commitment is simulated'));
    assert.equal(await result.getByRole('button',{name:'Create Rules draft',exact:true}).count(),status==='review'?1:0);
    results.B.push({fault,status,numeric,rules,incident:meta['Incident ID']});
  }
  await p.getByRole('button',{name:'C · Anomalous data',exact:true}).click();
  for(const [fault,headline,value] of [
    ['missing_pin','Delivery location is missing','Map pin: null'],
    ['duplicate_id','Duplicate order ID detected','appears twice'],
    ['negative_service','Invalid delivery processing time','−5 minutes'],
    ['invalid_window','Delivery window is not recognized','"overnight"'],
    ['conflicting_card','Conflicting delivery-site rules','Morning-only versus evening-only'],
  ]) {
    await p.getByLabel('Data anomaly',{exact:true}).selectOption(fault);
    await p.getByLabel('Risk order',{exact:true}).selectOption('WED-01');
    const {result,meta}=await runTest(p,'review',headline,`c-${fault}-${mode}`,baseline);
    const text=await result.innerText();
    for(const expected of [value,'WED-01','Hoa Sen Vocational College','not an observed outcome','No quarantine, repair or approval was performed'])assert(text.includes(expected));
    await checkStatus(result,'Data validation','Failed');
    assert.equal(await result.getByRole('button',{name:'Create Rules draft',exact:true}).count(),0);
    if(fault==='missing_pin')assert(text.includes('No verified entrance fallback available'));
    if(fault==='negative_service')assert(meta.INPUT.includes('"serviceMinutes":-5'));
    if(fault==='invalid_window')assert(meta.INPUT.includes('"window":"overnight"'));
    if(fault==='conflicting_card')assert(meta.INPUT.includes('[["morning"],["evening"]]'));
    if(fault==='duplicate_id')assert(meta.INPUT.includes('"idCount":2'));
    results.C.push({fault,status:'review',incident:meta['Incident ID']});
  }
  await p.getByLabel('Data anomaly',{exact:true}).selectOption('missing_pin');
  await p.getByLabel('Risk order',{exact:true}).selectOption('WED-17');
  const verified=await runTest(p,'review','Delivery location is missing',`c-verified-entrance-${mode}`,baseline);
  assert.equal(verified.meta.FALLBACK,'Verified entrance');
  assert((await verified.result.innerText()).includes('Verified entrance point available for review; not applied'));
  // Recording is an Evidence event only, never a resolution or a source-data correction.
  await verified.result.getByRole('button',{name:'Record dispatcher review',exact:true}).click();
  await p.getByText(/This does not resolve the incident or apply a correction/).waitFor();
  let s=await saved(p);assert.deepEqual(protectedState(s),protectedState(baseline));
  assert.equal(s.events.at(-1).type,'risk_incident_reviewed');assert(s.events.at(-1).summary.includes(verified.meta['Incident ID']));
  assert.equal(s.events.at(-1).input,verified.meta.INPUT);
  assert.equal(s.events.at(-1).output,`${verified.meta.DETECTION} | ${verified.meta['SAFE ACTION']}`);
  await p.getByRole('button',{name:'B · AI output',exact:true}).click();
  await p.getByLabel('AI fault',{exact:true}).selectOption('none');
  await p.getByRole('button',{name:'Run scenario',exact:true}).click();await p.locator('[data-risk-status="safe"]').waitFor();
  await p.getByRole('button',{name:'Save test result to Evidence',exact:true}).click();
  s=await saved(p);assert.equal(s.events.at(-1).type,'risk_incident_reviewed');assert(s.events.at(-1).summary.endsWith(': safe'));
  await p.getByLabel('AI fault',{exact:true}).selectOption('nan');
  await p.getByRole('button',{name:'Run scenario',exact:true}).click();await p.locator('[data-risk-status="review"]').waitFor();
  const beforeDraft=await saved(p);
  await p.getByRole('button',{name:'Create Rules draft',exact:true}).click();
  await p.getByText('Rules draft created for dispatcher review; no automatic dispatch.',{exact:true}).waitFor();
  s=await saved(p);assert.equal(s.draftPlan.method,'rules');assert.equal(s.events.at(-1).type,'risk_rules_fallback');assert.deepEqual(protectedState(s),protectedState(beforeDraft));
  assert.equal(s.events.filter(e=>e.type==='plan_dispatched').length,beforeDraft.events.filter(e=>e.type==='plan_dispatched').length);
  await p.getByRole('link',{name:'Evidence',exact:true}).click();
  const download=p.waitForEvent('download');await p.getByRole('button',{name:'Export CSV',exact:true}).click();
  const stream=await(await download).createReadStream();let csv='';for await(const chunk of stream)csv+=chunk;
  for(const event of ['risk_incident_reviewed','risk_rules_fallback','outcome_recorded','buyer_confirmed'])assert(csv.includes(event));
  assert.deepEqual(errors,[]);
  results.protectedState=true;results.verifiedEntranceFallback=true;results.inputEditsAndCancellation=true;results.evidence=true;results.rulesDraftOnly=true;results.errors=errors;
  await ctx.close();return results;
}
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
  try { const results={}; for(const mode of ['desktop','mobile'])results[mode]=await run(browser,mode); fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify(results,null,2));console.log('ALL RISK UI V2 BROWSER CHECKS PASS'); }
  finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
