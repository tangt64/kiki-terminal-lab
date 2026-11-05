import { useEffect, useRef, useState } from "react";
import { Field, OtpQrPreview, StatusMessage } from "./portal-shared.jsx";
import { TerminalLabBrand, KIKIOS_LOGO_MIME_TYPE, getTerminalLabFaviconHref } from "./terminal-lab-logo.jsx";
const LOGIN_DIALOG_FOCUSABLE_SELECTOR = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
function getDialogFocusableElements(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(LOGIN_DIALOG_FOCUSABLE_SELECTOR)).filter(element => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && element.getAttribute("aria-hidden") !== "true";
  });
}
export default function PortalLogin(props) {
  const [showResetPasswordForm, setShowResetPasswordForm] = useState(false);
  const [termsModalOpen, setTermsModalOpen] = useState(false);
  const [termsModalStep, setTermsModalStep] = useState(0);
  const authPanelRef = useRef(null);
  const loginUsernameRef = useRef(null);
  const signupNameRef = useRef(null);
  const termsModalRef = useRef(null);
  const termsModalTriggerRef = useRef(null);
  const useUploadedFavicon = props.platformStatus?.faviconMode === "upload" && Boolean(props.platformStatus?.faviconPath);
  const faviconPath = useUploadedFavicon ? props.platformStatus.faviconPath : getTerminalLabFaviconHref();
  const landingAuthEyebrow = props.platformStatus?.landingAuthEyebrow || "접속 안내";
  const landingAuthTitle = props.platformStatus?.landingAuthTitle || "로그인 또는 회원가입";
  const landingAuthCopy = props.platformStatus?.landingAuthCopy || "승인된 계정으로 클라우드와 협업 기능을 이용합니다.";
  const oauthLoginProviders = props.platformStatus?.oauthEnabled === false ? [] : [{
    key: "Kakao",
    label: "카카오로 로그인",
    href: "/api/auth/oauth/kakao",
    className: "is-kakao"
  }, {
    key: "Naver",
    label: "네이버로 로그인",
    href: "/api/auth/oauth/naver",
    className: "is-naver"
  }, {
    key: "Google",
    label: "Google로 로그인",
    href: "/api/auth/oauth/google",
    className: "is-google"
  }].filter(provider => props.platformStatus?.[`oauth${provider.key}Enabled`] && props.platformStatus?.[`oauth${provider.key}Configured`]);
  useEffect(() => {
    let faviconLink = document.querySelector("link[rel='icon']");
    if (!faviconLink) {
      faviconLink = document.createElement("link");
      faviconLink.setAttribute("rel", "icon");
      document.head.appendChild(faviconLink);
    }
    faviconLink.setAttribute("href", faviconPath);
    faviconLink.setAttribute("type", useUploadedFavicon ? String(props.platformStatus?.faviconMime || "image/x-icon") : KIKIOS_LOGO_MIME_TYPE);
  }, [faviconPath, props.platformStatus?.faviconMime, useUploadedFavicon]);
  const termsEnabled = props.platformStatus?.termsEnabled !== false;
  const signupTerms = termsEnabled ? ["standard_terms", "service_additional_terms"].map(key => (props.activeTerms || []).find(term => term.termsKey === key)).filter(Boolean) : [];
  const agreedTermIds = (props.signupForm.termsAgreementIds || []).map(Number);
  const allSignupTermsAgreed = signupTerms.length === 2 && signupTerms.every(term => agreedTermIds.includes(Number(term.id)));
  const activeTermsModalTerm = signupTerms[termsModalStep] || null;
  const openTermsModal = () => {
    termsModalTriggerRef.current = document.activeElement;
    setTermsModalStep(0);
    setTermsModalOpen(true);
  };
  const closeTermsModal = () => {
    setTermsModalOpen(false);
  };
  const confirmAllTerms = () => {
    props.setSignupForm(current => ({
      ...current,
      termsAgreementIds: signupTerms.map(term => term.id)
    }));
    setTermsModalOpen(false);
  };
  useEffect(() => {
    if (!termsModalOpen) return undefined;
    const dialog = termsModalRef.current;
    window.requestAnimationFrame(() => {
      const [firstFocusable] = getDialogFocusableElements(dialog);
      (firstFocusable || dialog)?.focus?.();
    });
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeTermsModal();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusableElements = getDialogFocusableElements(dialog);
      if (!focusableElements.length) {
        event.preventDefault();
        dialog.focus?.();
        return;
      }
      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      termsModalTriggerRef.current?.focus?.();
    };
  }, [termsModalOpen]);
  return <main className="community-auth"><section className="community-auth-intro"><h1><TerminalLabBrand className="auth-product-brand" logoPath={props.platformStatus?.landingLogoMode === "upload" ? props.platformStatus.landingLogoPath : ""} /></h1><p className="community-edition-label">COMMUNITY EDITION</p><p>클라우드·협업·운영을 한곳에서 관리합니다.</p></section><section className="auth-panel" ref={authPanelRef}>
          <div className="auth-panel-head">
            <p className="card-label">{landingAuthEyebrow}</p>
            <h3>{landingAuthTitle}</h3>
            <p>{landingAuthCopy}</p>
          </div>
          <div className="tabs" role="tablist" aria-label="auth">
            <button aria-controls="auth-panel-login" aria-selected={props.authTab === "login" ? "true" : "false"} className={`tab ${props.authTab === "login" ? "is-active" : ""}`} id="auth-tab-login" onClick={() => props.setAuthTab("login")} role="tab" type="button">
              로그인
            </button>
            <button aria-controls="auth-panel-signup" aria-selected={props.authTab === "signup" ? "true" : "false"} className={`tab ${props.authTab === "signup" ? "is-active" : ""}`} id="auth-tab-signup" onClick={() => props.setAuthTab("signup")} role="tab" type="button">
              회원가입
            </button>
          </div>

          <StatusMessage {...props.authStatus} />

          {props.authTab === "login" ? <div aria-labelledby="auth-tab-login" className="auth-tab-panel" id="auth-panel-login" role="tabpanel">
              <form className="auth-form" onSubmit={props.onLogin}>
                <Field inputRef={loginUsernameRef} label="아이디" value={props.loginForm.username} onChange={value => props.setLoginForm(current => ({
            ...current,
            username: value
          }))} />
                <Field label="비밀번호" type="password" value={props.loginForm.password} onChange={value => props.setLoginForm(current => ({
            ...current,
            password: value
          }))} />
                <Field label="OTP 코드" value={props.loginForm.otpCode} onChange={value => props.setLoginForm(current => ({
            ...current,
            otpCode: value
          }))} placeholder="필요한 경우 6자리 입력" />
                <button className="primary-btn" type="submit">로그인</button>
              </form>
              {oauthLoginProviders.length ? <div className="oauth-login-group" aria-label="소셜 로그인">
                  {oauthLoginProviders.map(provider => <a className={`oauth-login-btn ${provider.className}`} href={provider.href} key={provider.href}>{provider.label}</a>)}
                </div> : null}
              {props.pendingOtpEnrollment?.active ? <section className="auth-form auth-reset-form otp-enrollment-panel">
                  <div className="auth-panel-head compact-auth-head">
                    <p className="card-label">관리자 OTP 등록</p>
                    <h4>{`${props.pendingOtpEnrollment.name || props.pendingOtpEnrollment.username} 계정 보호 설정`}</h4>
                    <p>Google Authenticator 같은 앱에서 QR을 등록한 뒤 6자리 코드를 입력해 주세요. 등록이 끝나면 관리자 로그인이 완료됩니다.</p>
                  </div>
                  <div className="otp-setup-grid">
                    <div className="otp-setup-qr">
                      <OtpQrPreview alt="관리자 OTP 등록 QR" otpauthUrl={props.pendingOtpEnrollment.otpauthUrl} />
                    </div>
                    <div className="otp-setup-fields">
                      <Field label="비밀키" value={props.pendingOtpEnrollment.secret} onChange={() => {}} readOnly />
                      <Field label="OTP URL" value={props.pendingOtpEnrollment.otpauthUrl} onChange={() => {}} readOnly />
                      <Field label="OTP 코드" value={props.pendingOtpEnrollment.code} onChange={value => props.setPendingOtpEnrollment(current => ({
                ...current,
                code: value
              }))} placeholder="앱에 표시된 6자리 코드" />
                    </div>
                  </div>
                  <div className="admin-inline-actions">
                    <button className="primary-btn" onClick={props.onConfirmPendingOtpEnrollment} type="button">QR 등록 완료 및 OTP 활성화</button>
                  </div>
                </section> : null}
              <div className="auth-reset-toggle-wrap">
                <button aria-expanded={showResetPasswordForm ? "true" : "false"} className="ghost-btn auth-reset-toggle-btn" onClick={() => setShowResetPasswordForm(current => !current)} type="button">
                  {showResetPasswordForm ? "비밀번호 재설정 닫기" : "관리자 PIN으로 비밀번호 재설정"}
                </button>
              </div>
              {showResetPasswordForm ? <form className="auth-form auth-reset-form" onSubmit={props.onResetPasswordWithPin}>
                  <div className="auth-panel-head compact-auth-head">
                    <p className="card-label">비밀번호 재설정</p>
                    <h4>관리자 발급 PIN으로 초기화</h4>
                    <p>관리자가 발급한 1회용 PIN과 새 비밀번호를 입력해 주세요.</p>
                  </div>
                  <Field label="아이디" value={props.resetPinForm.username} onChange={value => props.setResetPinForm(current => ({
            ...current,
            username: value
          }))} />
                  <Field label="PIN 코드" value={props.resetPinForm.pin} onChange={value => props.setResetPinForm(current => ({
            ...current,
            pin: value
          }))} placeholder="6자리 PIN" />
                  <Field label="새 비밀번호" type="password" value={props.resetPinForm.newPassword} onChange={value => props.setResetPinForm(current => ({
            ...current,
            newPassword: value
          }))} />
                  <Field label="새 비밀번호 확인" type="password" value={props.resetPinForm.confirmPassword} onChange={value => props.setResetPinForm(current => ({
            ...current,
            confirmPassword: value
          }))} />
                  <button className="ghost-btn" type="submit">PIN으로 비밀번호 재설정</button>
                </form> : null}
            </div> : <form aria-labelledby="auth-tab-signup" className="auth-form" id="auth-panel-signup" onSubmit={props.onSignup} role="tabpanel">
                <Field inputRef={signupNameRef} label="이름" value={props.signupForm.name} onChange={value => props.setSignupForm(current => ({
          ...current,
          name: value
        }))} />
                <Field label="이메일" value={props.signupForm.email} onChange={value => props.setSignupForm(current => ({
          ...current,
          email: value
        }))} placeholder="name@example.com" />
                <div className="field-inline">
                  <Field label="아이디" value={props.signupForm.username} onChange={value => props.setSignupForm(current => ({
            ...current,
            username: value
          }))} />
                  <button className="ghost-btn field-inline-btn" onClick={props.checkUsername} type="button">중복 확인</button>
                </div>
                <StatusMessage {...props.signupCheck} />
                <Field label="비밀번호" type="password" value={props.signupForm.password} onChange={value => props.setSignupForm(current => ({
          ...current,
          password: value
        }))} />
                <Field label="비밀번호 확인" type="password" value={props.signupForm.confirmPassword} onChange={value => props.setSignupForm(current => ({
          ...current,
          confirmPassword: value
        }))} />
                <Field label="가입 사유" value={props.signupForm.signupReason} onChange={value => props.setSignupForm(current => ({
          ...current,
          signupReason: value
        }))} placeholder="예: 교육 실습 참여, 개인 학습, 팀 테스트" multiline />
                <Field label="과정 코드" value={props.signupForm.courseCode} onChange={value => props.setSignupForm(current => ({
          ...current,
          courseCode: value
        }))} placeholder="선택 입력" />
                {props.platformStatus?.inviteOnlyMode ? <Field label="초대 코드" value={props.signupForm.inviteCode} onChange={value => props.setSignupForm(current => ({
          ...current,
          inviteCode: value
        }))} placeholder="필수 입력" /> : <Field label="초대 코드" value={props.signupForm.inviteCode} onChange={value => props.setSignupForm(current => ({
          ...current,
          inviteCode: value
        }))} placeholder="선택 입력" />}
                {termsEnabled ? <div className="signup-terms-box">
                  <strong>약관 동의</strong>
                  {signupTerms.length === 2 ? <>
                      <div className={allSignupTermsAgreed ? "terms-confirm-status is-complete" : "terms-confirm-status"}>
                        {allSignupTermsAgreed ? "모든 약관 확인 및 동의 하였음" : "표준약관과 서비스 추가 약관을 확인해 주세요."}
                      </div>
                      <button className="ghost-btn" onClick={openTermsModal} type="button">{allSignupTermsAgreed ? "약관 다시 확인" : "약관 전체 확인"}</button>
                    </> : <p className="hint">회원가입 약관이 아직 준비되지 않았습니다. 관리자에게 문의해 주세요.</p>}
                </div> : null}
                <label className="compact-check signup-marketing-consent">
                  <input checked={props.signupForm.marketingEmailConsent === true} onChange={event => props.setSignupForm(current => ({
            ...current,
            marketingEmailConsent: event.target.checked
          }))} type="checkbox" />
                  <span>
                    <strong>마케팅 정보 이메일 수신 동의 (선택)</strong>
                    <small>쿠폰, 이벤트, 신규 과정 안내를 이메일로 받을 수 있으며 동의하지 않아도 회원가입과 서비스 이용에는 제한이 없습니다.</small>
                  </span>
                </label>
                <button className="primary-btn" type="submit">회원가입</button>
              </form>}
        </section></main>;
}
