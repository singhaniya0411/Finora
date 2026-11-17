import crypto from "crypto";

export const createCsrfToken = (res, existingToken = null) => {
  const csrfToken =
    existingToken && existingToken.length === 64
      ? existingToken
      : crypto.randomBytes(32).toString("hex");

  res.cookie("csrfToken", csrfToken, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/",
  });

  return csrfToken;
};

export const verifyCsrfToken = (req, res, next) => {
  const clientUrl = process.env.CLIENT_URL
    ? process.env.CLIENT_URL.replace(/\/$/, "")
    : null;
  const allowedOrigins = [
    clientUrl,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ].filter(Boolean);

  const origin = req.get("origin");

  // Validate origin if present (allows your CLIENT_URL,     localhost, and any Vercel domain)
  if (origin) {
    const isAllowed =
      allowedOrigins.includes(origin) || origin.endsWith(".vercel.app");
    if (!isAllowed) {
      return res.status(403).json({
        message: "Invalid request origin.",
      });
    }
  }

  const cookieToken = req.cookies?.csrfToken;
  const headerToken = req.get("X-CSRF-Token");

  if (
    !cookieToken ||
    !headerToken ||
    cookieToken.length !== headerToken.length
  ) {
    return res.status(403).json({
      message: "CSRF validation failed.",
    });
  }

  const cookieBuffer = Buffer.from(cookieToken);
  const headerBuffer = Buffer.from(headerToken);

  if (!crypto.timingSafeEqual(cookieBuffer, headerBuffer)) {
    return res.status(403).json({
      message: "CSRF validation failed.",
    });
  }

  next();
};
