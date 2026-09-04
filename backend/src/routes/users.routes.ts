import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { toPublicUser } from "./auth.routes";

export const usersRouter = Router();

usersRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.auth!.sub } });
  if (!user) return res.status(404).json({ error: { code: "NOT_FOUND", message: "User not found" } });
  return res.json({ user: toPublicUser(user) });
});

const editProfileSchema = z.object({
  fullName: z.string().min(2).optional(),
  companyName: z.string().optional(),
  email: z.string().email().optional(),
  avatarUrl: z.string().url().optional(),
});

usersRouter.patch("/me", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = editProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  const user = await prisma.user.update({ where: { id: req.auth!.sub }, data: parsed.data });
  return res.json({ user: toPublicUser(user) });
});
