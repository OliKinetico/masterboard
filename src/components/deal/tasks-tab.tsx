"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { addTask, toggleTask } from "@/server/actions/deal-children";
import { formatDate, isOverdue } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Task } from "@/lib/types";

export function TasksTab({
  dealId,
  tasks,
  profilesById,
  canEdit,
}: {
  dealId: string;
  tasks: Task[];
  profilesById: Record<string, string>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");

  function submit() {
    if (!title.trim()) return;
    startTransition(async () => {
      const result = await addTask({ dealId, title, dueOn: due || null });
      if (result.error) toast.error(result.error);
      else {
        setTitle("");
        setDue("");
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {canEdit ? (
        <div className="flex gap-1.5">
          <Input
            placeholder="New task…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <Input
            type="date"
            className="w-40"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
          <Button onClick={submit} disabled={pending || !title.trim()}>
            <Plus /> Add
          </Button>
        </div>
      ) : null}

      {tasks.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title="No tasks"
          description="Follow-ups from quick-log land here too."
        />
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-center gap-3 px-4 py-2.5">
              <Checkbox
                checked={task.status === "done"}
                disabled={!canEdit || pending}
                onCheckedChange={(v) =>
                  startTransition(async () => {
                    await toggleTask(dealId, task.id, v === true);
                    router.refresh();
                  })
                }
                aria-label={`Mark ${task.title} ${task.status === "done" ? "open" : "done"}`}
              />
              <span
                className={cn(
                  "flex-1 text-sm",
                  task.status === "done" && "text-muted-foreground line-through",
                )}
              >
                {task.title}
              </span>
              {task.owner_user_id && profilesById[task.owner_user_id] ? (
                <span className="text-xs text-muted-foreground">
                  {profilesById[task.owner_user_id]}
                </span>
              ) : null}
              {task.due_on ? (
                <span
                  className={cn(
                    "text-xs",
                    task.status === "open" && isOverdue(task.due_on)
                      ? "font-medium text-red-600"
                      : "text-muted-foreground",
                  )}
                >
                  {formatDate(task.due_on)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
