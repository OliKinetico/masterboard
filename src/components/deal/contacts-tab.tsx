"use client";

import { useState } from "react";
import Link from "next/link";
import { Users, Plus, Mail, Phone, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { UserAvatar } from "@/components/ui/avatar";
import { CONTACT_ROLE_LABELS } from "@/lib/domain";
import type { Clinic, Contact } from "@/lib/types";
import { ContactDialog } from "@/components/contacts/contact-dialog";

export function ContactsTab({
  clinics,
  contacts,
  canEdit,
}: {
  clinics: Clinic[];
  contacts: Contact[];
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const clinicById = new Map(clinics.map((c) => [c.id, c]));

  return (
    <div className="space-y-3">
      {canEdit ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus /> Add contact
          </Button>
        </div>
      ) : null}

      {contacts.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No contacts yet"
          description="Owners, directors, practice managers, advisers and solicitors connected to this deal."
          action={canEdit ? <Button size="sm" onClick={() => setOpen(true)}>Add the first contact</Button> : undefined}
        />
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {contacts.map((c) => (
            <Link
              key={c.id}
              href={`/contacts/${c.id}`}
              className="flex items-start gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-brand-300"
            >
              <UserAvatar name={c.full_name} className="h-9 w-9" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{c.full_name}</p>
                  <Badge variant="secondary" className="text-[10px]">
                    {CONTACT_ROLE_LABELS[c.role]}
                  </Badge>
                </div>
                {c.clinic_id && clinicById.get(c.clinic_id) ? (
                  <p className="text-xs text-muted-foreground">
                    {clinicById.get(c.clinic_id)!.name}
                  </p>
                ) : null}
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  {c.emails[0] ? (
                    <span className="inline-flex items-center gap-1">
                      <Mail className="h-3 w-3" /> {c.emails[0]}
                    </span>
                  ) : null}
                  {c.phone ? (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3 w-3" /> {c.phone}
                    </span>
                  ) : null}
                  {c.whatsapp_number ? (
                    <span className="inline-flex items-center gap-1 text-green-700">
                      <MessageCircle className="h-3 w-3" /> WhatsApp
                    </span>
                  ) : null}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <ContactDialog
        open={open}
        onClose={() => setOpen(false)}
        initial={null}
        defaultClinicId={clinics[0]?.id}
        clinics={clinics}
      />
    </div>
  );
}
