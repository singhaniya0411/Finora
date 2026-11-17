import jwt from "jsonwebtoken";
import crypto from "crypto";

export const generateAccessToken = (userId) => {
  return jwt.sign(
    { userId: userId.toString() },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: "15m" },
  );
};

export const generateRefreshToken = (userId) => {
  return jwt.sign(
    { userId: userId.toString() },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: "7d" },
  );
};

export const hashToken = (token) => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

export const getCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  path: "/",
});

export const setAuthCookies = (res, accessToken, refreshToken) => {
  const options = getCookieOptions();

  res.cookie("accessToken", accessToken, {
    ...options,
    maxAge: 15 * 60 * 1000,
  });

  res.cookie("refreshToken", refreshToken, {
    ...options,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
};

export const clearAuthCookies = (res) => {
  const options = getCookieOptions();

  res.clearCookie("accessToken", options);
  res.clearCookie("refreshToken", options);
};
