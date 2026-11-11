import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {normalizeReport, inspectionView} from '../platform/server/incident-security/contract.js';
import {readInspection} from '../platform/server/incident-security/reader.js';
import {registerSecurityInspectionRoutes} from '../platform/server/security-inspection.js';
import {securityReportFixture} from './fixtures/security-inspection.mjs';

test('security reports retain legacy schema-v2 compatibility and derive per-node state', () => {
  const now=Date.now(), report=securityReportFixture(now), view=inspectionView(report,now);
  assert.equal(view.executionEnabled,false);assert.equal(view.stale,false);
  assert.deepEqual(view.report.assessments.map(a=>a.baseline.stable),[true,false]);
  assert.equal(view.report.assessments[1].verification.explanations[0].reason,'explicit-setting-missing');
  delete report.assessments;
  const legacy=normalizeReport(report,now);
  assert.deepEqual(legacy.assessments,[]);assert.equal(legacy.verification.diagnosedAt,null);
  assert.deepEqual(legacy.verification.explanations,[]);
});

test('service losses, restarts and SSH changes cannot be asserted stable by the producer', () => {
  for (const alter of [b=>{b.after.example_exporter='missing';},b=>{b.after.example_service='unhealthy';},b=>{b.continuity='changed';},b=>{b.sshConfigUnchanged=false;},b=>{b.after.new_service='healthy';}]) {
    const report=securityReportFixture(), baseline=report.assessments[0].baseline;
    baseline.stable=true;alter(baseline);
    assert.equal(normalizeReport(report).assessments[0].baseline.stable,false);
  }
});

test('per-node explanations must match a failed OpenSCAP rule on that node', () => {
  for (const alter of [
    r=>{r.assessments[1].verification.explanations[0].ruleId='unrelated';},
    r=>{r.assessments[0].verification.explanations=r.assessments[1].verification.explanations;},
    r=>{r.assessments[1].verification.explanations.push({...r.assessments[1].verification.explanations[0]});},
    r=>{r.assessments[1].verification.explanations[0].reason='unsupported';},
    r=>{r.assessments[1].verification.diagnosedAt=new Date(Date.now()+600000).toISOString();},
    r=>{r.assessments[1].observedAt=new Date(Date.now()-3600000).toISOString();},
    r=>{r.assessments.pop();}
  ]) {const report=securityReportFixture();alter(report);assert.throws(()=>normalizeReport(report),/Invalid security report/);}
});

test('a recent collection or annotation cannot refresh an old scan or vulnerability database', () => {
  const now=Date.now(),report=securityReportFixture(now);
  report.scans[0].startedAt=new Date(now-49*3600000).toISOString();
  report.scans[0].completedAt=new Date(now-48*3600000).toISOString();
  report.scans[0].database.builtAt=new Date(now-8*86400000).toISOString();
  const view=inspectionView(report,now);
  assert.equal(view.stale,true);assert.equal(view.report.scans[0].database.stale,true);
  assert.equal(view.report.assessments[1].verification.explanations.length,1);
});

test('report reader handles absent, corrupt and oversized files without reusing a prior snapshot', async t => {
  const directory=await mkdtemp(path.join(tmpdir(),'community-inspection-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const file=path.join(directory,'latest.json');assert.equal((await readInspection(file)).mode,'unavailable');
  await writeFile(file,JSON.stringify(securityReportFixture()));assert.equal((await readInspection(file)).report.assessments.length,2);
  await writeFile(file,'{');await assert.rejects(readInspection(file),/Security report unavailable/);
  await writeFile(file,'x'.repeat(2*1024*1024+1));await assert.rejects(readInspection(file),/Security report unavailable/);
});

test('inspection HTTP remains monitor-only and read-only, with redacted errors and no caching', async t => {
  const app=express();let broken=false,reads=0;
  registerSecurityInspectionRoutes(app,(req,res,next)=>{
    const role=req.get('x-fixture-role');if(!role)return res.sendStatus(401);req.user={role};next();
  },{hasPermission:user=>['admin','monitor'].includes(user.role),read:async()=>{reads++;if(broken)throw Error('fixture-private-path');return inspectionView(securityReportFixture());}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const url=`http://127.0.0.1:${server.address().port}/api/admin/security-inspection`;
  assert.equal((await fetch(url)).status,401);
  assert.equal((await fetch(url,{headers:{'x-fixture-role':'users-admin'}})).status,403);assert.equal(reads,0);
  for(const role of ['admin','monitor']){const response=await fetch(url,{headers:{'x-fixture-role':role}});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).report.assessments.length,2);}
  for(const method of ['POST','PUT','DELETE'])assert.equal((await fetch(url,{method,headers:{'x-fixture-role':'admin'}})).status,404);
  broken=true;const response=await fetch(url,{headers:{'x-fixture-role':'admin'}});assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/fixture-private-path/);
});
