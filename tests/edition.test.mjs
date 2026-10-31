import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {isEducationApi,communitySection,isEducationAdminTab,isEducationWebSocketPath} from '../platform/shared/community-profile.js';
const provenance=JSON.parse(fs.readFileSync(new URL('../platform/SOURCE-PROVENANCE.json',import.meta.url),'utf8'));
test('the route inventory preserves every recorded noneducation endpoint',()=>{
  assert.equal(provenance.removedEducationRoutes.length+provenance.retainedGeneralRoutes.length,499);
  for(const route of provenance.retainedGeneralRoutes)assert.equal(isEducationApi(route.path),false,route.path);
  for(const endpoint of ['/api/auth/oauth/google','/api/auth/otp/setup/start','/api/qna','/api/admin/users','/api/admin/platform-status','/api/custom-lab-requests','/api/admin/mail-campaigns','/api/admin/jenkins/jobs','/api/marketing-surveys'])assert.equal(isEducationApi(endpoint),false,endpoint);
});
test('education endpoints and direct navigation remain excluded',()=>{
  for(const endpoint of ['/api/admin/course-access/assign','/api/admin/users/1/courses/4/revoke-access','/api/instructor-share/sessions','/materials/a.pdf','/api/admin/lab-exam-attempts/4/report.pdf','/api/admin/reports/b2b-summary','/reports/b2b-summary/share','/admin/reports/b2b-summary/print','/api/terminal/session','/api/admin/service-validation/setup','/api/admin/service-validation/cleanup','/api/llm/terminal-plan','/terminal-popup'])assert.equal(isEducationApi(endpoint),true,endpoint);
  assert.equal(communitySection('courses'),'terminalCloud');assert.equal(communitySection('qna'),'qna');assert.equal(isEducationAdminTab('labs'),true);assert.equal(isEducationAdminTab('sso'),false);
  assert.equal(isEducationAdminTab('b2bReport'),true);
  for(const value of ['/ws/instructor-share/view/demo','/ws/%69nstructor-share/publish/demo','/ws/INSTRUCTOR-SHARE/view/demo'])assert.equal(isEducationWebSocketPath(value),true);
  assert.equal(isEducationWebSocketPath('/ws/terminal/general-session'),false);
  assert.equal(isEducationApi('/api/cloud-console/instances/demo/terminal/session'),false);
  assert.equal(isEducationApi('/api/custom-lab-requests/1/terminal/session'),false);
  assert.equal(fs.existsSync(new URL('../platform/client/src/curriculum-2026-data.js',import.meta.url)),false);
});
