import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { hashPassword, signToken, verifyPassword } from "../auth.js";
import { HttpError } from "../errors.js";
import { audit } from "../db.js";
import { ah, parse } from "./util.js";

const DUMMY_HASH = await hashPassword("dummy-password-for-timing"); // equalizes timing for unknown usernames

export function authRoutes({ db, config, authn }) {
  const r = Router();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: {
        code: "RATE_LIMITED",
        message: "Too many sign-in attempts. Try again later.",
      },
    },
  });

  r.post(
    "/login",
    limiter,
    ah(async (req, res) => {
      const { username, password } = parse(
        z.object({
          username: z.string().min(1).max(64),
          password: z.string().min(1).max(200),
        }),
        req.body,
      );
      const user = db
        .prepare("SELECT * FROM users WHERE username=?")
        .get(username);
      const ok = await verifyPassword(
        password,
        user?.password_hash ?? DUMMY_HASH,
      );
      if (!user || !user.active || !ok) {
        audit(db, "anonymous", "LOGIN_FAILED", username);
        throw new HttpError(
          401,
          "INVALID_CREDENTIALS",
          "Wrong username or password",
        );
      }
      res.json({
        token: signToken(config, user),
        user: { id: user.id, username: user.username, role: user.role },
      });
    }),
  );

  r.get("/me", authn, (req, res) => res.json({ user: req.user }));
  return r;
}
