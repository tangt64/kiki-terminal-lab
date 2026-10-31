export function createSharedRateLimiter({ windowMs, max, keyFn, consume, isAvailable = () => true, onError = () => {} }) {
  if (typeof consume !== "function") throw new TypeError("consume is required");
  return async function sharedRateLimiter(req, res, next) {
    const key = String(keyFn(req) || req.ip || "anonymous");
    if (!isAvailable()) {
      res.status(503).json({ message: "서비스 데이터 저장소를 확인하고 있습니다. 잠시 후 다시 시도해 주세요." });
      return;
    }
    try {
      const result = await consume({ key, windowMs, max });
      if (!result.allowed) {
        res.setHeader("Retry-After", String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
        res.status(429).json({ message: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." });
        return;
      }
      next();
    } catch (error) {
      onError(error);
      res.status(503).json({ message: "요청 보호 기능을 확인하고 있습니다. 잠시 후 다시 시도해 주세요." });
    }
  };
}

export function createDatabaseAvailabilityGate({ isAvailable, isProduction }) {
  return function databaseAvailabilityGate(req, res, next) {
    if (!isAvailable() && isProduction && req.path.startsWith("/api/") && req.path !== "/api/health") {
      res.status(503).json({
        code: "DATABASE_UNAVAILABLE",
        message: "서비스 데이터 저장소를 복구하고 있습니다. 잠시 후 다시 시도해 주세요.",
      });
      return;
    }
    next();
  };
}

export function sendHealthResponse(res, { databaseAvailable, instance, role }) {
  res.status(databaseAvailable ? 200 : 503).json({
    ok: databaseAvailable,
    instance,
    role,
    database: databaseAvailable ? "available" : "unavailable",
  });
}
