"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClinicDialog } from "./clinic-dialog";
import type { Clinic } from "@/lib/types";

export function ClinicEditButton({ clinic }: { clinic: Clinic }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil /> Edit
      </Button>
      <ClinicDialog open={open} onClose={() => setOpen(false)} initial={clinic} />
    </>
  );
}
