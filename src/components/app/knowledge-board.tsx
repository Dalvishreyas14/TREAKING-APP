"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BookOpen,
  ExternalLink,
  Pin,
  PinOff,
  Plus,
  Search,
  Star,
  Trash2,
} from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Progress } from "@/components/ui/primitives";
import { api, ApiClientError } from "@/lib/api/client";
import { RESOURCE_KIND_LABEL, RESOURCE_STATUS_LABEL, resourceSubtitle } from "@/lib/knowledge/resources";
import { cn } from "@/lib/utils";

/**
 * The knowledge board.
 *
 * Resources are a pipeline and notes are not, so they are presented differently
 * and deliberately so. A resource has a status that changes and a place it
 * belongs, so it gets shelves and a progress bar. A note is something you wrote
 * once and may never touch again, so it gets a list and no workflow — giving
 * notes statuses would be inventing a system for material that does not want one.
 *
 * Status changes are optimistic and rolled back on failure, because moving a book
 * from "reading now" to "finished" is a single tap that should feel instant and
 * should not re-sort the whole board under the user's finger while it waits.
 *
 * A note is never deleted without saying what happens to it. Notes are the one
 * thing here with no copy anywhere else, and this app does not keep a trash.
 */

export interface KnowledgeResource {
  id: string;
  title: string;
  kind: string;
  status: string;
  url: string | null;
  author: string | null;
  summary: string | null;
  progress: number;
  rating: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
  categoryName: string | null;
  categoryColor: string | null;
  noteCount: number;
}

export interface KnowledgeNote {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  resourceId: string | null;
  updatedAt: string;
  resourceTitle: string | null;
  taskTitle: string | null;
  taskStatus: string | null;
  goalTitle: string | null;
  projectName: string | null;
}

export interface Shelf {
  status: string;
  label: string;
  count: number;
}

const KINDS = ["BOOK", "COURSE", "ARTICLE", "VIDEO", "PODCAST", "PAPER", "TOOL", "OTHER"] as const;

const STATUS_TONE: Record<string, "lime" | "iris" | "amber" | "coral" | "outline" | "neutral"> = {
  IN_PROGRESS: "lime",
  WANTING: "outline",
  ON_HOLD: "amber",
  FINISHED: "iris",
  DROPPED: "coral",
};

export function KnowledgeBoard({
  resources: initialResources,
  notes: initialNotes,
  shelves,
  activeShelf,
  query,
}: {
  resources: KnowledgeResource[];
  notes: KnowledgeNote[];
  shelves: Shelf[];
  activeShelf: string;
  query: string;
}) {
  const router = useRouter();
  const [resources, setResources] = React.useState(initialResources);
  const [notes, setNotes] = React.useState(initialNotes);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState(query);
  const [editing, setEditing] = React.useState<KnowledgeResource | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [noteDraft, setNoteDraft] = React.useState<KnowledgeNote | null>(null);

  const [syncedFrom, setSyncedFrom] = React.useState(initialResources);
  if (syncedFrom !== initialResources) {
    setSyncedFrom(initialResources);
    setResources(initialResources);
  }
  const [notesSynced, setNotesSynced] = React.useState(initialNotes);
  if (notesSynced !== initialNotes) {
    setNotesSynced(initialNotes);
    setNotes(initialNotes);
  }

  async function move(resource: KnowledgeResource, status: string) {
    const previous = resource.status;
    setResources((current) =>
      current.map((r) => (r.id === resource.id ? { ...r, status } : r)),
    );
    setBusyId(resource.id);
    try {
      const updated = await api.patch<{ progress: number; startedAt: string | null; finishedAt: string | null }>(
        `/api/v1/resources/${resource.id}`,
        { status },
      );
      // The server owns the dates and the bar, so the optimistic card is corrected
      // from its response rather than from a guess at what the rule would do.
      setResources((current) =>
        current.map((r) =>
          r.id === resource.id
            ? { ...r, status, progress: updated.progress, startedAt: updated.startedAt, finishedAt: updated.finishedAt }
            : r,
        ),
      );
      if (status === "FINISHED") toast.success(`Finished ${resource.title}.`);
      else if (status === "DROPPED") toast.message(`Dropped ${resource.title}.`);
    } catch (error) {
      setResources((current) =>
        current.map((r) => (r.id === resource.id ? { ...r, status: previous } : r)),
      );
      toast.error(error instanceof ApiClientError ? error.message : "Could not move that.");
    } finally {
      setBusyId(null);
    }
  }

  async function setProgress(resource: KnowledgeResource, progress: number) {
    const previous = resource.progress;
    setResources((current) =>
      current.map((r) => (r.id === resource.id ? { ...r, progress } : r)),
    );
    try {
      await api.patch(`/api/v1/resources/${resource.id}`, { progress });
    } catch (error) {
      setResources((current) =>
        current.map((r) => (r.id === resource.id ? { ...r, progress: previous } : r)),
      );
      toast.error(error instanceof ApiClientError ? error.message : "Could not save that.");
    }
  }

  async function rate(resource: KnowledgeResource, rating: number) {
    try {
      await api.patch(`/api/v1/resources/${resource.id}`, { rating });
      setResources((current) =>
        current.map((r) => (r.id === resource.id ? { ...r, rating } : r)),
      );
      toast.success("Rated.");
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Could not rate that.");
    }
  }

  async function removeResource(resource: KnowledgeResource) {
    // The count is on the card, so the warning can be specific rather than a
    // generic "are you sure".
    const warning =
      resource.noteCount > 0
        ? `${resource.noteCount} ${resource.noteCount === 1 ? "note stays" : "notes stay"} and will become unfiled.`
        : "This cannot be undone.";

    if (!window.confirm(`Delete "${resource.title}"?\n\n${warning}`)) return;

    try {
      const result = await api.delete<{ detachedNotes: number }>(
        `/api/v1/resources/${resource.id}`,
      );
      toast.success(
        result.detachedNotes > 0
          ? `Deleted. ${result.detachedNotes} ${result.detachedNotes === 1 ? "note is" : "notes are"} now unfiled.`
          : "Resource deleted.",
      );
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Could not delete that.");
    }
  }

  async function pin(note: KnowledgeNote) {
    const pinned = !note.pinned;
    setNotes((current) =>
      current.map((n) => (n.id === note.id ? { ...n, pinned } : n)),
    );
    try {
      await api.patch(`/api/v1/notes/${note.id}`, { pinned });
    } catch (error) {
      setNotes((current) =>
        current.map((n) => (n.id === note.id ? { ...n, pinned: !pinned } : n)),
      );
      toast.error(error instanceof ApiClientError ? error.message : "Could not pin that.");
    }
  }

  async function removeNote(note: KnowledgeNote) {
    // A note has no copy anywhere else in this app, so the warning says so
    // rather than offering a false "you can undo this".
    if (!window.confirm(`Delete "${note.title}"?\n\nThis cannot be undone.`)) return;
    try {
      await api.delete(`/api/v1/notes/${note.id}`);
      setNotes((current) => current.filter((n) => n.id !== note.id));
      toast.success("Note deleted.");
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Could not delete that note.");
    }
  }

  function submitSearch(value: string) {
    setSearch(value);
    const params = new URLSearchParams();
    if (value.trim()) params.set("q", value.trim());
    if (activeShelf !== "ALL") params.set("status", activeShelf);
    router.push(`/knowledge${params.size > 0 ? `?${params}` : ""}`);
  }

  const pinned = notes.filter((n) => n.pinned);
  const loose = notes.filter((n) => !n.pinned && !n.resourceId);
  const attached = notes.filter((n) => !n.pinned && n.resourceId);
  const byResource = new Map<string, KnowledgeNote[]>();
  for (const note of attached) {
    if (!note.resourceId) continue;
    const list = byResource.get(note.resourceId);
    if (list) list.push(note);
    else byResource.set(note.resourceId, [note]);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-subtle" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitSearch(search);
            }}
            placeholder="Search titles, authors, notes…"
            className="pl-8"
            aria-label="Search your knowledge base"
          />
        </div>
        {search !== query ? (
          <Button size="sm" variant="ghost" onClick={() => submitSearch(search)}>
            Search
          </Button>
        ) : null}
        <Button size="sm" variant="lime" onClick={() => setCreating(true)}>
          <Plus /> Add resource
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setNoteDraft(blankNote())}>
          <Plus /> New note
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <ShelfChip
          active={activeShelf === "ALL"}
          label="Everything"
          count={shelves.reduce((n, s) => n + s.count, 0)}
          onClick={() => router.push("/knowledge")}
        />
        {shelves.map((shelf) => (
          <ShelfChip
            key={shelf.status}
            active={activeShelf === shelf.status}
            label={shelf.label}
            count={shelf.count}
            onClick={() =>
              router.push(`/knowledge?status=${shelf.status}`)
            }
          />
        ))}
      </div>

      {resources.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={BookOpen}
              title={query || activeShelf !== "ALL" ? "Nothing matches" : "Nothing saved yet"}
              description={
                query || activeShelf !== "ALL"
                  ? "Try a different search, or clear the filter to see everything."
                  : "Add the book, course or paper you are working through, then attach notes to it as you go."
              }
              action={
                query || activeShelf !== "ALL"
                  ? { label: "Show everything", onClick: () => router.push("/knowledge") }
                  : { label: "Add a resource", onClick: () => setCreating(true) }
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {resources.map((resource) => (
            <ResourceCard
              key={resource.id}
              resource={resource}
              notes={byResource.get(resource.id) ?? []}
              busy={busyId === resource.id}
              onMove={(status) => void move(resource, status)}
              onProgress={(value) => void setProgress(resource, value)}
              onRate={(value) => void rate(resource, value)}
              onEdit={() => setEditing(resource)}
              onDelete={() => void removeResource(resource)}
              onPinNote={(note) => void pin(note)}
              onDeleteNote={(note) => void removeNote(note)}
            />
          ))}
        </div>
      )}

      {pinned.length > 0 || loose.length > 0 ? (
        <div className="flex flex-col gap-3">
          {pinned.length > 0 ? (
            <NoteSection
              title="Pinned"
              notes={pinned}
              onPin={(note) => void pin(note)}
              onDelete={(note) => void removeNote(note)}
              onEdit={(note) => setNoteDraft(note)}
            />
          ) : null}
          {loose.length > 0 ? (
            <NoteSection
              title="Unfiled notes"
              notes={loose}
              onPin={(note) => void pin(note)}
              onDelete={(note) => void removeNote(note)}
              onEdit={(note) => setNoteDraft(note)}
            />
          ) : null}
        </div>
      ) : null}

      <ResourceDialog
        open={creating || editing !== null}
        resource={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
      <NoteDialog
        note={noteDraft}
        resources={resources}
        onClose={() => setNoteDraft(null)}
      />
    </div>
  );
}

function ShelfChip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors",
        active
          ? "border-lime bg-lime-soft text-ink"
          : "border-line text-ink-subtle hover:border-line-strong hover:text-ink-muted",
      )}
    >
      {label}
      <span className="tabular-nums opacity-60">{count}</span>
    </button>
  );
}

function ResourceCard({
  resource,
  notes,
  busy,
  onMove,
  onProgress,
  onRate,
  onEdit,
  onDelete,
  onPinNote,
  onDeleteNote,
}: {
  resource: KnowledgeResource;
  notes: KnowledgeNote[];
  busy: boolean;
  onMove: (status: string) => void;
  onProgress: (value: number) => void;
  onRate: (value: number) => void;
  onEdit: () => void;
  onDelete: () => void;
  onPinNote: (note: KnowledgeNote) => void;
  onDeleteNote: (note: KnowledgeNote) => void;
}) {
  const finishedAt = resource.finishedAt ? new Date(resource.finishedAt) : null;
  const showProgress =
    resource.status === "IN_PROGRESS" || resource.status === "ON_HOLD" || resource.status === "FINISHED";

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="truncate">{resource.title}</CardTitle>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-subtle">
              <span>{RESOURCE_KIND_LABEL[resource.kind] ?? resource.kind}</span>
              {resource.author ? <span className="truncate">{resource.author}</span> : null}
              {resource.categoryName ? (
                <span style={{ color: resource.categoryColor ?? undefined }}>{resource.categoryName}</span>
              ) : null}
            </p>
          </div>
          <Badge variant={STATUS_TONE[resource.status] ?? "neutral"} size="sm">
            {RESOURCE_STATUS_LABEL[resource.status as keyof typeof RESOURCE_STATUS_LABEL] ??
              resource.status}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3">
        <p className="text-[12px] text-ink-muted">
          {resourceSubtitle({ status: resource.status as never, progress: resource.progress }, finishedAt)}
        </p>

        {resource.summary ? (
          <p className="line-clamp-3 text-[12px] leading-relaxed text-ink-subtle">{resource.summary}</p>
        ) : null}

        {showProgress ? (
          <div className="flex flex-col gap-1.5">
            <Progress value={resource.progress} />
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={resource.progress}
              disabled={busy}
              onChange={(e) => onProgress(Number(e.target.value))}
              aria-label={`How far through ${resource.title} you are`}
              className="w-full accent-lime"
            />
          </div>
        ) : null}

        {resource.status === "FINISHED" || resource.status === "DROPPED" ? (
          <div className="flex items-center gap-1" role="group" aria-label={`Rate ${resource.title}`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onRate(n)}
                aria-label={`${n} star${n === 1 ? "" : "s"}`}
                aria-pressed={resource.rating === n}
                className="p-0.5"
              >
                <Star
                  className={cn(
                    "size-3.5 transition-colors",
                    resource.rating && n <= resource.rating
                      ? "fill-amber text-amber"
                      : "text-ink-subtle hover:text-amber",
                  )}
                />
              </button>
            ))}
          </div>
        ) : null}

        {notes.length > 0 ? (
          <ul className="flex flex-col gap-1.5 border-t border-line pt-2">
            {notes.slice(0, 4).map((note) => (
              <li key={note.id} className="group flex items-start gap-1.5">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-ink-subtle" aria-hidden />
                <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-ink-subtle">
                  <span className="text-ink-muted">{note.title}</span>
                  {note.body ? ` — ${note.body.slice(0, 120)}${note.body.length > 120 ? "…" : ""}` : ""}
                </p>
                <button
                  type="button"
                  onClick={() => onPinNote(note)}
                  aria-label={note.pinned ? "Unpin" : "Pin"}
                  aria-pressed={note.pinned}
                  className="shrink-0 text-ink-subtle opacity-0 transition-opacity hover:text-lime group-hover:opacity-100"
                >
                  {note.pinned ? <Pin className="size-3 text-lime" /> : <PinOff className="size-3" />}
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteNote(note)}
                  aria-label={`Delete note ${note.title}`}
                  className="shrink-0 text-ink-subtle opacity-0 transition-opacity hover:text-negative group-hover:opacity-100"
                >
                  <Trash2 className="size-3" />
                </button>
              </li>
            ))}
            {notes.length > 4 ? (
              <li className="pl-3 text-[11px] text-ink-subtle">
                and {notes.length - 4} more {notes.length - 4 === 1 ? "note" : "notes"}
              </li>
            ) : null}
          </ul>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
          {resource.status !== "IN_PROGRESS" ? (
            <Button size="xs" variant="lime" disabled={busy} onClick={() => onMove("IN_PROGRESS")}>
              Start
            </Button>
          ) : (
            <Button size="xs" variant="ghost" disabled={busy} onClick={() => onMove("ON_HOLD")}>
              Pause
            </Button>
          )}
          {resource.status !== "FINISHED" ? (
            <Button size="xs" variant="ghost" disabled={busy} onClick={() => onMove("FINISHED")}>
              Finish
            </Button>
          ) : null}
          {resource.status !== "DROPPED" ? (
            <Button size="xs" variant="ghost" disabled={busy} onClick={() => onMove("DROPPED")}>
              Drop
            </Button>
          ) : null}
          {resource.url ? (
            <a
              href={resource.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] text-ink-subtle hover:text-ink"
            >
              <ExternalLink className="size-3" />
              Link
            </a>
          ) : null}
          <span className="flex-1" />
          <Button size="xs" variant="ghost" onClick={onEdit}>
            Edit
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={onDelete}
            aria-label={`Delete ${resource.title}`}
            className="text-ink-subtle hover:text-negative"
          >
            <Trash2 />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function NoteSection({
  title,
  notes,
  onPin,
  onDelete,
  onEdit,
}: {
  title: string;
  notes: KnowledgeNote[];
  onPin: (note: KnowledgeNote) => void;
  onDelete: (note: KnowledgeNote) => void;
  onEdit: (note: KnowledgeNote) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2">
          {notes.map((note) => (
            <li key={note.id} className="group flex items-start gap-2.5 rounded-control px-1 py-1 hover:bg-surface-2">
              <button
                type="button"
                onClick={() => onPin(note)}
                aria-label={note.pinned ? "Unpin" : "Pin"}
                aria-pressed={note.pinned}
                className="mt-0.5 shrink-0 text-ink-subtle transition-colors hover:text-ink"
              >
                {note.pinned ? <Pin className="size-3.5 text-lime" /> : <PinOff className="size-3.5" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink">{note.title}</p>
                {note.body ? (
                  <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-ink-subtle">
                    {note.body}
                  </p>
                ) : null}
                <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-ink-subtle">
                  {note.resourceTitle ? <span>in {note.resourceTitle}</span> : null}
                  {note.taskTitle ? (
                    <span className={cn(note.taskStatus === "DONE" && "line-through")}>
                      on {note.taskTitle}
                    </span>
                  ) : null}
                  {note.goalTitle ? <span>towards {note.goalTitle}</span> : null}
                  {note.projectName ? <span>in {note.projectName}</span> : null}
                  {!note.resourceTitle && !note.taskTitle && !note.goalTitle && !note.projectName ? (
                    <span>unfiled</span>
                  ) : null}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <Button size="xs" variant="ghost" onClick={() => onEdit(note)}>
                  Edit
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => onDelete(note)}
                  aria-label={`Delete ${note.title}`}
                  className="text-ink-subtle hover:text-negative"
                >
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ResourceDialog({
  open,
  resource,
  onClose,
}: {
  open: boolean;
  resource: KnowledgeResource | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = React.useState("");
  const [author, setAuthor] = React.useState("");
  const [kind, setKind] = React.useState<string>("BOOK");
  const [status, setStatus] = React.useState<string>("WANTING");
  const [url, setUrl] = React.useState("");
  const [summary, setSummary] = React.useState("");
  const [progress, setProgress] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Re-seed whenever the dialog opens on a different resource, which is what
  // makes it work for both create and edit without a second component.
  const seedKey = resource?.id ?? "new";
  const [lastSeed, setLastSeed] = React.useState(seedKey);
  if (open && lastSeed !== seedKey) {
    setLastSeed(seedKey);
    setTitle(resource?.title ?? "");
    setAuthor(resource?.author ?? "");
    setKind(resource?.kind ?? "BOOK");
    setStatus(resource?.status ?? "WANTING");
    setUrl(resource?.url ?? "");
    setSummary(resource?.summary ?? "");
    setProgress(resource?.progress ?? 0);
    setError(null);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const payload = {
      title,
      author: author || null,
      kind,
      status,
      url: url || null,
      summary: summary || null,
      progress,
    };
    try {
      if (resource) await api.patch(`/api/v1/resources/${resource.id}`, payload);
      else await api.post("/api/v1/resources", payload);
      toast.success(resource ? "Saved." : "Added to your shelf.");
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{resource ? "Edit resource" : "Add a resource"}</DialogTitle>
          <DialogDescription>
            Its shelf and progress bar are yours to set. Moving it to finished will
            fill the bar and date it; dropping it keeps the progress you reached.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[13px] font-medium text-ink">Title</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Thinking, Fast and Slow" />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[13px] font-medium text-ink">Author</span>
              <Input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Daniel Kahneman" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[13px] font-medium text-ink">Kind</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="h-9 rounded-control border border-line bg-surface px-2.5 text-[13px] text-ink"
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {RESOURCE_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[13px] font-medium text-ink">Shelf</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="h-9 rounded-control border border-line bg-surface px-2.5 text-[13px] text-ink"
              >
                {Object.entries(RESOURCE_STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[13px] font-medium text-ink">Link</span>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                inputMode="url"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[13px] font-medium text-ink">How far through</span>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={progress}
                onChange={(e) => setProgress(Number(e.target.value))}
                className="flex-1 accent-lime"
              />
              <span className="w-10 text-right text-[12px] tabular-nums text-ink-muted">
                {progress}%
              </span>
            </div>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[13px] font-medium text-ink">Why it is on the list</span>
            <Textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
              placeholder="What you are trying to get out of it."
            />
          </label>

          {error ? <p className="text-[12px] text-negative">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="lime" onClick={submit} loading={busy} loadingText="Saving" disabled={!title.trim()}>
            {resource ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function blankNote(): KnowledgeNote {
  return {
    id: "",
    title: "",
    body: "",
    pinned: false,
    resourceId: null,
    updatedAt: new Date().toISOString(),
    resourceTitle: null,
    taskTitle: null,
    taskStatus: null,
    goalTitle: null,
    projectName: null,
  };
}

function NoteDialog({
  note,
  resources,
  onClose,
}: {
  note: KnowledgeNote | null;
  resources: KnowledgeResource[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [resourceId, setResourceId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const isNew = note?.id === "";
  const [lastNote, setLastNote] = React.useState<KnowledgeNote | null>(note);
  if (note !== lastNote) {
    setLastNote(note);
    setTitle(note?.title ?? "");
    setBody(note?.body ?? "");
    setResourceId(note?.resourceId ?? "");
    setError(null);
  }

  async function submit() {
    if (!note) return;
    setBusy(true);
    setError(null);
    const payload = { title, body, resourceId: resourceId || null };
    try {
      if (isNew) await api.post("/api/v1/notes", payload);
      else await api.patch(`/api/v1/notes/${note!.id}`, payload);
      toast.success(isNew ? "Note saved." : "Note updated.");
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save that note.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={note !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isNew ? "New note" : "Edit note"}</DialogTitle>
          <DialogDescription>
            A note can stand on its own, or be filed under the resource it came
            from. Filing it is what makes it findable in six months.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[13px] font-medium text-ink">Title</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The thing worth remembering" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[13px] font-medium text-ink">Note</span>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[13px] font-medium text-ink">From</span>
            <select
              value={resourceId}
              onChange={(e) => setResourceId(e.target.value)}
              className="h-9 rounded-control border border-line bg-surface px-2.5 text-[13px] text-ink"
            >
              <option value="">Nothing in particular</option>
              {resources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </label>
          {error ? <p className="text-[12px] text-negative">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="lime" onClick={submit} loading={busy} loadingText="Saving" disabled={!title.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
