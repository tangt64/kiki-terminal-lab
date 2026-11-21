import { useEffect, useState } from "react";



let qrCodeLibPromise = null;

function loadQrCodeLib() {
  if (!qrCodeLibPromise) {
    qrCodeLibPromise = import("qrcode").then((module) => module.default || module);
  }
  return qrCodeLibPromise;
}

export function StatusMessage({ tone, message }) {
  if (!message) return null;
  return <div className={`status ${tone ? `is-${tone}` : ""}`}>{message}</div>;
}

























export function OtpQrPreview({ otpauthUrl, alt = "OTP QR" }) {
  const [qrDataUrl, setQrDataUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!otpauthUrl) {
      setQrDataUrl("");
      return undefined;
    }
    loadQrCodeLib()
      .then((QRCodeLib) => QRCodeLib.toDataURL(otpauthUrl, {
        margin: 1,
        width: 220,
        color: { dark: "#0f172a", light: "#ffffff" },
      }))
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [otpauthUrl]);

  if (!otpauthUrl) return <div className="hint">OTP 등록 URL이 없습니다.</div>;
  if (!qrDataUrl) return <div className="hint">QR을 준비하는 중입니다.</div>;
  return <img alt={alt} src={qrDataUrl} />;
}

export function Field({ label, value, onChange, type = "text", placeholder = "", readOnly = false, inputRef = null, multiline = false }) {
  return (
    <label className="field">
      <span>{label}</span>
      {multiline ? (
        <textarea
          ref={inputRef}
          readOnly={readOnly}
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <input
          ref={inputRef}
          readOnly={readOnly}
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          placeholder={placeholder}
          type={type}
        />
      )}
    </label>
  );
}
