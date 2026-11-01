import { useEffect, useMemo, useRef, useState } from "react";
import { getQuotaUsagePercent, getQuotaUsageToneClass } from "./quota-usage.js";
import { COMMUNITY_BRAND_NAME } from "./terminal-lab-logo.jsx";

const CREATOR_SIGNATURE = "CHOI GOOKHYUN (TANG)";
const CLICK_REVEAL_THRESHOLD = 7;
const CLICK_RESET_MS = 1800;
const SIGNATURE_SHOW_MS = 4200;
const TERMINAL_SHOW_MS = 5600;

function getLoadLabel(percent) {
  if (percent >= 92) return "critical";
  if (percent >= 78) return "hot";
  if (percent >= 60) return "warn";
  return "calm";
}

export default function InteractiveLogoStage({
  className = "",
  quotaStatus,
  children,
  title = COMMUNITY_BRAND_NAME,
}) {
  const [clickCount, setClickCount] = useState(0);
  const [showSignature, setShowSignature] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const clickResetTimerRef = useRef(0);
  const signatureTimerRef = useRef(0);
  const terminalTimerRef = useRef(0);

  const quotaPercent = useMemo(() => getQuotaUsagePercent(quotaStatus), [quotaStatus]);
  const quotaToneClass = useMemo(() => getQuotaUsageToneClass(quotaStatus), [quotaStatus]);
  const nextRevealStep = Math.min(100, Math.round((clickCount / CLICK_REVEAL_THRESHOLD) * 100));

  useEffect(
    () => () => {
      window.clearTimeout(clickResetTimerRef.current);
      window.clearTimeout(signatureTimerRef.current);
      window.clearTimeout(terminalTimerRef.current);
    },
    [],
  );

  function scheduleSignatureHide() {
    window.clearTimeout(signatureTimerRef.current);
    signatureTimerRef.current = window.setTimeout(() => setShowSignature(false), SIGNATURE_SHOW_MS);
  }

  function scheduleTerminalHide() {
    window.clearTimeout(terminalTimerRef.current);
    terminalTimerRef.current = window.setTimeout(() => setShowTerminal(false), TERMINAL_SHOW_MS);
  }

  function handleRevealClick() {
    window.clearTimeout(clickResetTimerRef.current);
    setClickCount((current) => {
      const next = current + 1;
      if (next >= CLICK_REVEAL_THRESHOLD) {
        setShowSignature(true);
        scheduleSignatureHide();
        return 0;
      }
      clickResetTimerRef.current = window.setTimeout(() => setClickCount(0), CLICK_RESET_MS);
      return next;
    });
  }

  function handleToggleTerminal() {
    setShowTerminal((current) => {
      const next = !current;
      if (next) scheduleTerminalHide();
      else window.clearTimeout(terminalTimerRef.current);
      return next;
    });
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleRevealClick();
      return;
    }
    if (event.key.toLowerCase() === "t") {
      event.preventDefault();
      handleToggleTerminal();
    }
  }

  return (
    <div
      aria-label={`${title} logo. Click 7 times for creator signature, double click for hidden console.`}
      className={`logo-stage ${className} ${quotaToneClass} ${showSignature ? "is-signature-visible" : ""} ${showTerminal ? "is-terminal-visible" : ""}`.trim()}
      onClick={handleRevealClick}
      onDoubleClick={handleToggleTerminal}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      title={`${title} - Core/RAM/Volume resource load ${quotaPercent}% (${getLoadLabel(quotaPercent)})`}
    >
      <span className="logo-stage-orbit" />
      <span className="logo-stage-particles" />
      <span aria-hidden="true" className="logo-stage-critical-star" />
      <span aria-hidden="true" className="logo-stage-reveal-meter">
        <span style={{ width: `${nextRevealStep}%` }} />
      </span>
      {children}
      <div aria-live="polite" className="logo-stage-easter-stack">
        {showSignature ? (
          <div className="logo-stage-easter-egg is-signature">
            <strong>{CREATOR_SIGNATURE}</strong>
          </div>
        ) : null}
        {showTerminal ? (
          <div className="logo-stage-easter-egg is-terminal">
            <strong>{CREATOR_SIGNATURE}</strong>
          </div>
        ) : null}
      </div>
    </div>
  );
}
