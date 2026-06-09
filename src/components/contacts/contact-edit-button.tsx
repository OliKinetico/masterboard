"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContactDialog } from "./contact-dialog";
import type { Contact } from "@/lib/types";

export function ContactEditButton({
  contact,
  clinics,
}: {
  contact: Contact;
  clinics: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil /> Edit
      </Button>
      <ContactDialog open={open} onClose={() => setOpen(false)} initial={contact} clinics={clinics} />
    </>
  );
}
