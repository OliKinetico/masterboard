"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import { UserAvatar } from "@/components/ui/avatar";
import { addComment } from "@/server/actions/deal-children";
import { formatDateTime } from "@/lib/format";
import type { Comment } from "@/lib/types";

/** Comments — the one surface execs can write to (spec §4.11). */
export function CommentsTab({
  dealId,
  comments,
  profilesById,
  canComment,
}: {
  dealId: string;
  comments: Comment[];
  profilesById: Record<string, string>;
  canComment: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await addComment(dealId, body);
      if (result.error) toast.error(result.error);
      else setBody("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {canComment ? (
        <div className="space-y-1.5">
          <Textarea
            placeholder="Add a comment for the deal team…"
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={submit} disabled={pending || !body.trim()}>
              <Send /> Comment
            </Button>
          </div>
        </div>
      ) : null}

      {comments.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="No comments"
          description="Execs and the deal team can discuss the deal here without touching the record."
        />
      ) : (
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-3 rounded-lg border bg-card p-3">
              <UserAvatar name={profilesById[c.author_user_id] ?? "?"} className="h-8 w-8" />
              <div className="min-w-0 flex-1">
                <p className="text-xs">
                  <span className="font-semibold">
                    {profilesById[c.author_user_id] ?? "Unknown"}
                  </span>
                  <span className="ml-2 text-muted-foreground">
                    {formatDateTime(c.created_at)}
                  </span>
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{c.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
