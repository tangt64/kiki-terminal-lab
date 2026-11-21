
import {AdminField} from "./portal-views.jsx";

































export function AdminInvitesTab(props) {
  return (
    <section className="portal-stack">
      <form className="admin-simple-card admin-form" onSubmit={props.onCreateInvite}>
        <div className="admin-card-header">
          <strong>초대 코드 등록</strong>
          <div className="admin-inline-actions">
            <button className="mini-btn" onClick={props.onGenerateInviteCode} type="button">코드 생성</button>
          </div>
        </div>
        <div className="admin-form-grid compact-admin-grid">
          <AdminField label="코드" required>
            <input value={props.inviteForm.code} onChange={(event) => props.setInviteForm((current) => ({ ...current, code: event.target.value }))} placeholder="예: LAB-INVITE-001" />
          </AdminField>
          <AdminField label="설명">
            <input value={props.inviteForm.label} onChange={(event) => props.setInviteForm((current) => ({ ...current, label: event.target.value }))} placeholder="예: 4월 교육 초대" />
          </AdminField>
          <AdminField label="발송 이메일">
            <input value={props.inviteForm.recipientEmail || ""} onChange={(event) => props.setInviteForm((current) => ({ ...current, recipientEmail: event.target.value }))} placeholder="선택 입력" />
          </AdminField>

          <AdminField label="최대 사용 횟수">
            <input min="1" type="number" value={props.inviteForm.maxUses} onChange={(event) => props.setInviteForm((current) => ({ ...current, maxUses: event.target.value }))} />
          </AdminField>
          <AdminField label="만료일">
            <input type="date" value={props.inviteForm.expiresAt || ""} onChange={(event) => props.setInviteForm((current) => ({ ...current, expiresAt: event.target.value }))} />
          </AdminField>
        </div>
        <div className="portal-actions">
          <button className="primary-btn" type="submit">초대 코드 저장</button>
        </div>
      </form>
      <section className="admin-simple-card">
        <div className="admin-card-header">
          <strong>초대 코드 목록</strong>
        </div>
        <div className="admin-table admin-table-scroll">
          {(props.adminInvites || []).map((invite) => (
            <div className="admin-table-row admin-course-grid" key={invite.id}>
              <span>
                <strong>{invite.code}</strong>
                <div className="hint">{invite.label || "-"}</div>
              </span>
              <span>
                <div>{invite.active ? "사용 중" : "중지"}</div>
                <div className="hint">{`사용 ${invite.usedCount || 0}/${invite.maxUses || 1}`}</div>
              </span>
              <div className="admin-inline-actions">
                <button className="mini-btn" onClick={() => props.onToggleInvite(invite.id)} type="button">{invite.active ? "중지" : "사용"}</button>
                <button className="mini-btn danger-mini-btn" onClick={() => props.onDeleteInvite(invite.id)} type="button">삭제</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
