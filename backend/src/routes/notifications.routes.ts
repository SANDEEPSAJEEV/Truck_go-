import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth";

export const notificationsRouter = Router();

notificationsRouter.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.auth!.sub },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return res.json({ notifications });
});

// Confirmed path, decompiled_user.js (markNotificationRead) — PATCH /notifications/:id/read.
notificationsRouter.patch("/:id/read", requireAuth, async (req: AuthedRequest, res) => {
  const notification = await prisma.notification.findUnique({ where: { id: req.params.id } });
  if (!notification || notification.userId !== req.auth!.sub) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Notification not found" } });
  }
  await prisma.notification.update({ where: { id: req.params.id }, data: { isRead: true } });
  return res.status(204).send();
});

notificationsRouter.patch("/read-all", requireAuth, async (req: AuthedRequest, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.auth!.sub, isRead: false },
    data: { isRead: true },
  });
  return res.status(204).send();
});
