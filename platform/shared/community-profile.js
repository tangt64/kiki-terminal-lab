// One mandatory edition boundary, used by browser navigation and the HTTP server.
export const EDUCATION_SECTIONS=new Set(['curriculum2026','courses','iltCourses','onlineCourses','governmentCourses','courseQuotes','writtenExam','labExam','certificates','surveys','surveyResults','offlineSchedule','terminal','arena']);
export const EDUCATION_ADMIN_TABS=new Set(['access','governmentAccess','schedule','labs','domains','sshRequests','resizeRequests','curricula','courses','iltCourses','onlineCourses','examCourses','surveyResults','textbooks','courseCodes','courseLevels','courseCategories','courseProgramTypes','writtenExams','labExams','certificates','quotes','payments','arena','b2bReport']);
export function isEducationAdminTab(tab){return EDUCATION_ADMIN_TABS.has(tab);}
export function communitySection(section){return EDUCATION_SECTIONS.has(section)?'terminalCloud':section||'terminalCloud';}
export function isEducationApi(value){
  const path=String(value||'').split('?')[0];
  return /^\/(?:api\/(?:admin\/|public\/)?(?:courses?|textbooks|curricula|written-exams|lab-exams|certificates|course-surveys|course-access-requests|course-quotes|course-codes|course-levels|course-categories|course-program-types|course-instructors|course-materials|course-packages|exam-entitlements|schedule-events|schedule-summary|labs|lab-requests|lab-domains|lab-exam-sessions|instructor-shares|arena|payments)(?:\/|$)|instructor-share(?:\/|$))/.test(path)
    || /\/users\/[^/]+\/(?:courses|course-access|course-packages|exam-entitlements)(?:\/|$)/.test(path)
    || /^\/(?:api\/(?:admin\/)?(?:exams|course-access|lab-exam-attempts|example-files|instructor-share|materials)(?:\/|$)|certificate(?:\/|$)|lab-exam-snapshots(?:\/|$)|materials(?:\/|$))/.test(path)
    || /^\/(?:api\/admin\/reports\/b2b-summary|(?:admin\/)?reports\/b2b-summary|terminal-popup)(?:\/|$)/.test(path)
    || /^\/api\/(?:terminal\/(?:readiness|session)|llm\/terminal-plan|admin\/service-validation\/(?:setup|cleanup))(?:\/|$)/.test(path);
}
export function isEducationWebSocketPath(value) {
  let pathname = String(value || '').split('?')[0];
  try { pathname = decodeURIComponent(pathname); } catch { return true; }
  return /^\/ws\/instructor-share(?:\/|$)/i.test(pathname);
}
export function emptyEducationResponse(){return {courses:[],labs:[],textbooks:[],exams:[],writtenExams:[],labExams:[],certificates:[],requests:[],responses:[],summary:[],quotes:[],payments:[],events:[],items:[],categories:[],levels:[],codes:[],programTypes:[],curricula:[],attempts:[],total:0};}
export function isLabBoardPath(value){
  const path=String(value||'').split('?')[0];
  return /^\/(?:api\/board-rooms|board(?:-(?:fonts|icons|libraries|pdf))?)(?:\/|$)/i.test(path)||/^\/board-sandbox\.html(?:\/|$)/i.test(path);
}
export function installEducationBoundary(app){
  app.use((req,res,next)=>{
    if(isLabBoardPath(req.path))return res.status(404).json({code:'LAB_BOARD_NOT_INCLUDED',message:'랩보드는 Community 배포본에 포함되지 않습니다.'});
    if(req.path==='/api/health'){const json=res.json.bind(res);res.json=body=>json({...body,product:'terminal-lab-community',version:'0.2.2'});}
    if(isEducationApi(req.path))return res.status(404).json({code:'EDUCATION_NOT_INCLUDED',message:'교육 기능은 Community 배포본에 포함되지 않습니다.'});
    if(req.path==='/' && (['terminal','instructor-share'].includes(req.query.popup) || req.query.curriculum==='2026'))return res.status(404).json({code:'EDUCATION_NOT_INCLUDED'});
    if(['/instructor-share','/arena-preview'].some(prefix=>req.path.startsWith(prefix)))return res.status(404).end();
    next();
  });
}
