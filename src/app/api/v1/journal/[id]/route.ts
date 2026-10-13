import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";

/**
 * PATCH /api/v1/journal/:id    DELETE /api/v1/journal/:id
 *
 * A PATCH here never moves an entry to a different day. `@@unique([userId,
 * date])` means changing the date is a conflict waiting to happen, and moving a
 * reflection to another day is a confusing thing to do by accident — so the
 * date is immutable and the entry stays where it was written.
 */

const params = z.object({ id: z.string().min(1) });

const body = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  content: z.string().trim().min(1).max(50000).optional(),
  mood: z.coerce.number().int().min(1).max(5).nullable().optional(),
  energy: z.coerce.number().int().min(1).max(5).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
});

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

const entrySelect = {
  id: true,
  date: true,
  title: true,
  content: true,
  mood: true,
  energy: true,
  tags: true,
  aiSummary: true,
  wordCount: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const PATCH = withApi({
  method: "PATCH",
  params,
  body,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const existing = await prisma.journalEntry.findUnique({
      where: { id: params.id },
      select: { id: true, userId: true },
    });
    assertOwnership(existing, user.id);

    const entry = await prisma.journalEntry.update({
      where: { id: existing!.id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.content !== undefined
          ? { content: body.content, wordCount: countWords(body.content) }
          : {}),
        ...(body.mood !== undefined ? { mood: body.mood } : {}),
        ...(body.energy !== undefined ? { energy: body.energy } : {}),
        ...(body.tags !== undefined ? { tags: body.tags } : {}),
      },
      select: entrySelect,
    });

    return entry;
  },
});

export const DELETE = withApi({
  method: "DELETE",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    const existing = await prisma.journalEntry.findUnique({
      where: { id: params.id },
      select: { id: true, userId: true },
    });
    assertOwnership(existing, user.id);

    await prisma.journalEntry.delete({ where: { id: existing!.id } });

    return { id: existing!.id, deleted: true };
  },
});
