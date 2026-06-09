"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { PipelineColumn } from "@/lib/domain";
import type { PipelineDeal } from "./types";

/**
 * Moving to dead prompts for a reason; to reengage prompts for a date
 * (spec §5.1 — enforced again by DB constraints).
 */
export function MoveDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: { deal: PipelineDeal; to: PipelineColumn } | null;
  onCancel: () => void;
  onConfirm: (extras: { deadReason?: string; reengageOn?: string }) => void;
}) {
  const [deadReason, setDeadReason] = useState("");
  const [reengageOn, setReengageOn] = useState("");

  useEffect(() => {
    if (pending) {
      setDeadReason("");
      const inSixWeeks = new Date();
      inSixWeeks.setDate(inSixWeeks.getDate() + 42);
      setReengageOn(inSixWeeks.toISOString().slice(0, 10));
    }
  }, [pending]);

  const isDead = pending?.to === "dead";
  const valid = isDead ? deadReason.trim().length > 0 : reengageOn.length > 0;

  return (
    <Dialog open={!!pending} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {isDead ? "Mark deal as dead" : "Move to re-engage"}
          </DialogTitle>
          <DialogDescription>
            {pending?.deal.name}
            {isDead
              ? " — record why this died so the funnel analytics stay honest."
              : " — when should this come back onto the radar?"}
          </DialogDescription>
        </DialogHeader>

        {isDead ? (
          <div className="space-y-1.5">
            <Label htmlFor="dead-reason">Dead reason (required)</Label>
            <Textarea
              id="dead-reason"
              autoFocus
              rows={3}
              placeholder="e.g. Vendor wanted 8× EBITDA — unbridgeable on price."
              value={deadReason}
              onChange={(e) => setDeadReason(e.target.value)}
            />
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="reengage-on">Re-engage on (required)</Label>
            <Input
              id="reengage-on"
              type="date"
              autoFocus
              value={reengageOn}
              onChange={(e) => setReengageOn(e.target.value)}
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            onClick={() =>
              onConfirm(
                isDead ? { deadReason: deadReason.trim() } : { reengageOn },
              )
            }
            data-testid="confirm-move"
          >
            {isDead ? "Mark dead" : "Schedule re-engage"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
