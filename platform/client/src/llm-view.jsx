import {StatusMessage} from './portal-views.jsx';

export default function LlmView(props) {
  const quota = props.llmQuotaStatus;
  const quotaText = quota?.enabled === false ? '질문 횟수 제한 없음' : quota?.bypassed ? '관리자 예외 적용 중' : `오늘 ${quota?.usedQuestions || 0}/${quota?.dailyLimit || 10}회 사용`;
  function onKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      props.onAskLlm(event);
    }
  }
  return <section className="portal-stack"><section className="simple-panel llm-shell">
    <div className="portal-detail-head"><div><p className="card-label">AI 질문</p><h3>클라우드와 시스템 운영에 관해 질문하세요</h3></div><button className="mini-btn" type="button" onClick={props.onResetLlmConversation}>대화 초기화</button></div>
    <p className="llm-usage-note">{quotaText}</p>
    <StatusMessage {...props.llmStatus}/>
    <div className="llm-chat-stream">{props.llmMessages?.length ? props.llmMessages.map(message => <article className={`llm-chat-bubble-row is-${message.role}`} key={message.id}><div className={`llm-chat-bubble is-${message.role}`}><strong>{message.role === 'user' ? '나' : 'AI'}</strong><div className="llm-chat-text">{message.text}</div></div></article>) : <div className="llm-empty-state">아직 대화가 없습니다.</div>}</div>
    <form className="llm-composer" onSubmit={props.onAskLlm}><textarea aria-label="AI 질문" value={props.llmQuestion} onChange={event => props.setLlmQuestion(event.target.value)} onKeyDown={onKeyDown} placeholder="예: 서버의 네트워크 연결 문제는 어떤 순서로 확인하나요?"/><div className="llm-composer-actions"><span className="hint">Enter로 전송, Shift+Enter로 줄바꿈</span><button className="primary-btn" disabled={quota?.enabled && !quota?.bypassed && quota?.canAsk === false} type="submit">질문 보내기</button></div></form>
  </section></section>;
}
