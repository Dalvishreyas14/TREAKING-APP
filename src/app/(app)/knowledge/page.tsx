import { BookMarked, Library, Pin, StickyNote } from "lucide-react";

import { KnowledgeBoard, type KnowledgeResource, type KnowledgeNote } from "@/components/app/knowledge-board";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { RESOURCE_STATUS_LABEL } from "@/lib/knowledge/resources";

export const dynamic = "force-dynamic";

/**
 * Knowledge.
 *
 * Two things share this screen because they are two halves of one habit, and
 * separating them is what makes both worse. A `Resource` is something you intend
 * to learn from — a book, a course, a paper — and a `Note` is something you wrote
 * while learning. A highlight with no book attached is a sentence you will not
 * find again; a book with no highlights is a title in a list. Putting them
 * together means the note is filed under the thing it came from, and both are
 * reachable from the same search box.
 *
 * Both are computed server-side from raw rows on every load, like the analytics
 * trends: the counts here are cheap, always current, and have no narrative to
 * store.
 *
 * The counts at the top are deliberately the *unfiltered* totals for the
 * default view. Once a search term or a shelf filter is applied, the header
 * switches to describing what is on screen, so a user who searched and got four
 * results is never told they have ninety-one.
 */

const RESOURCE_ORDER = ["WANTING", "IN_PROGRESS", "ON_HOLD", "FINISHED", "DROPPED"] as const;

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const status =
    RESOURCE_ORDER.find((s) => s === params.status) ??
    (params.status === "ALL" ? "ALL" : undefined);

  // Unfiltered totals, for the header. One grouped query rather than six counts.
  const [shelfCounts, looseCount, totalNotes] = await Promise.all([
    prisma.resource.groupBy({
      by: ["status"],
      where: { userId: user.id },
      _count: { _all: true },
    }),
    prisma.note.count({
      where: {
        userId: user.id,
        taskId: null,
        goalId: null,
        projectId: null,
        resourceId: null,
      },
    }),
    prisma.note.count({ where: { userId: user.id } }),
  ]);

  const countBy = new Map(shelfCounts.map((row) => [row.status, row._count._all]));

  const resources = await prisma.resource.findMany({
    where: {
      userId: user.id,
      ...(status && status !== "ALL" ? { status } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" as const } },
              { author: { contains: q, mode: "insensitive" as const } },
              { summary: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      title: true,
      kind: true,
      status: true,
      url: true,
      author: true,
      summary: true,
      progress: true,
      rating: true,
      startedAt: true,
      finishedAt: true,
      updatedAt: true,
      category: { select: { name: true, color: true } },
      _count: { select: { notes: true } },
    },
  });

  /*
   * Note bodies are loaded for exactly the resources on screen, rather than every
   * note this user has ever written. A highlight list of four hundred entries
   * under every card is not more useful than a list of the two attached to the
   * book being looked at, and it would make this page's cost scale with the wrong
   * thing.
   *
   * `loose: true` brings in the unfiled notes, which is where a search for
   * something you half-remember writing usually lands.
   */
  const notes = await prisma.note.findMany({
    where: {
      userId: user.id,
      ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { body: { contains: q, mode: "insensitive" } }] } : {}),
      ...(q
        ? {}
        : {
            OR: [
              { resourceId: { in: resources.map((r) => r.id) } },
              { resourceId: null, taskId: null, goalId: null, projectId: null },
            ],
          }),
    },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: 200,
    select: {
      id: true,
      title: true,
      body: true,
      pinned: true,
      resourceId: true,
      taskId: true,
      goalId: true,
      projectId: true,
      updatedAt: true,
      resource: { select: { title: true } },
      task: { select: { title: true, status: true } },
      goal: { select: { title: true } },
      project: { select: { name: true } },
    },
  });

  const filtered = Boolean(q) || Boolean(status && status !== "ALL");

  const resourceRows: KnowledgeResource[] = resources.map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    status: r.status,
    url: r.url,
    author: r.author,
    summary: r.summary,
    progress: r.progress,
    rating: r.rating,
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
    categoryName: r.category?.name ?? null,
    categoryColor: r.category?.color ?? null,
    noteCount: r._count.notes,
  }));

  const noteRows: KnowledgeNote[] = notes.map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    pinned: n.pinned,
    resourceId: n.resourceId,
    updatedAt: n.updatedAt.toISOString(),
    resourceTitle: n.resource?.title ?? null,
    taskTitle: n.task?.title ?? null,
    taskStatus: n.task?.status ?? null,
    goalTitle: n.goal?.title ?? null,
    projectName: n.project?.name ?? null,
  }));

  const inProgress = countBy.get("IN_PROGRESS") ?? 0;
  const finished = countBy.get("FINISHED") ?? 0;
  const finishedThisYear = resources.filter(
    (r) => r.status === "FINISHED" && r.finishedAt && r.finishedAt.getFullYear() === new Date().getFullYear(),
  ).length;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Knowledge</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          {filtered
            ? `${resourceRows.length} ${resourceRows.length === 1 ? "resource" : "resources"} and ${noteRows.length} ${noteRows.length === 1 ? "note" : "notes"} matching.`
            : `${inProgress} in progress · ${finished} finished · ${finishedThisYear} this year · ${looseCount} unfiled ${looseCount === 1 ? "note" : "notes"} of ${totalNotes}`}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ShelfFigure
          label="Reading now"
          value={countBy.get("IN_PROGRESS") ?? 0}
          detail={`${countBy.get("WANTING") ?? 0} queued`}
          icon={Library}
        />
        <ShelfFigure
          label="Finished"
          value={countBy.get("FINISHED") ?? 0}
          detail={`${finishedThisYear} this year`}
          icon={BookMarked}
        />
        <ShelfFigure
          label="On hold"
          value={countBy.get("ON_HOLD") ?? 0}
          detail={`${countBy.get("DROPPED") ?? 0} dropped`}
          icon={Pin}
        />
        <ShelfFigure
          label="Unfiled notes"
          value={looseCount}
          detail={`of ${totalNotes} total`}
          icon={StickyNote}
        />
      </div>

      <KnowledgeBoard
        resources={resourceRows}
        notes={noteRows}
        shelves={RESOURCE_ORDER.map((s) => ({
          status: s,
          label: RESOURCE_STATUS_LABEL[s],
          count: countBy.get(s) ?? 0,
        }))}
        activeShelf={status ?? "ALL"}
        query={q}
      />
    </div>
  );
}

function ShelfFigure({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: number;
  detail: string;
  icon: typeof Library;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-line bg-surface p-4">
      <span className="flex items-center gap-1.5 text-[11px] text-ink-subtle">
        <Icon className="size-3" />
        {label}
      </span>
      <span className="text-2xl font-semibold tabular-nums text-ink">{value}</span>
      <span className="text-[11px] text-ink-subtle">{detail}</span>
    </div>
  );
}
