import { notFound } from "next/navigation";
import Link from "next/link";
import { Mail, MessageCircle, Phone } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, isStaff } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/ui/avatar";
import { formatDate } from "@/lib/format";
import { CONTACT_ROLE_LABELS, INTERACTION_TYPE_LABELS } from "@/lib/domain";
import type { Contact, Interaction } from "@/lib/types";
import { ContactEditButton } from "@/components/contacts/contact-edit-button";
import { WhatsAppImportButton } from "@/components/whatsapp/whatsapp-import-button";

export const dynamic = "force-dynamic";

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const { data: contact } = await supabase
    .from("contacts")
    .select("*, clinics(id, name)")
    .eq("id", id)
    .maybeSingle();
  if (!contact) notFound();

  const [{ data: interactions }, { data: clinics }] = await Promise.all([
    supabase
      .from("interactions")
      .select("*, deals(id, name)")
      .eq("contact_id", id)
      .order("occurred_on", { ascending: false })
      .limit(30),
    supabase
      .from("clinics")
      .select("id, name")
      .is("merged_into_clinic_id", null)
      .order("name")
      .limit(500),
  ]);

  const c = contact as unknown as Contact & { clinics: { id: string; name: string } | null };
  const staff = isStaff(profile);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="rounded-lg border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <UserAvatar name={c.full_name} className="h-12 w-12 text-sm" />
            <div>
              <h1 className="text-xl font-semibold tracking-tight">{c.full_name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary">{CONTACT_ROLE_LABELS[c.role]}</Badge>
                {c.clinics ? (
                  <Link href={`/clinics/${c.clinics.id}`}>
                    <Badge variant="outline" className="hover:border-brand-300 hover:bg-brand-50">
                      {c.clinics.name}
                    </Badge>
                  </Link>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">cross-deal</Badge>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {c.emails.map((e) => (
                  <span key={e} className="inline-flex items-center gap-1">
                    <Mail className="h-3 w-3" /> {e}
                  </span>
                ))}
                {c.phone ? (
                  <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {c.phone}</span>
                ) : null}
                {c.whatsapp_number ? (
                  <span className="inline-flex items-center gap-1 text-green-700">
                    <MessageCircle className="h-3 w-3" /> {c.whatsapp_number}
                  </span>
                ) : null}
              </div>
              {c.notes ? <p className="mt-2 text-sm text-muted-foreground">{c.notes}</p> : null}
            </div>
          </div>
          {staff ? (
            <div className="flex gap-1.5">
              <WhatsAppImportButton contactId={c.id} contactName={c.full_name} />
              <ContactEditButton
                contact={c}
                clinics={(clinics ?? []) as Array<{ id: string; name: string }>}
              />
            </div>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Recent interactions</CardTitle></CardHeader>
        <CardContent className="space-y-1.5">
          {(interactions ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No interactions logged with this contact yet.
            </p>
          ) : (
            ((interactions ?? []) as unknown as Array<Interaction & { deals: { id: string; name: string } | null }>).map((i) => (
              <Link
                key={i.id}
                href={i.deals ? `/deals/${i.deals.id}` : "#"}
                className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors hover:border-brand-300"
              >
                <Badge variant="secondary" className="w-20 justify-center text-[10px]">
                  {INTERACTION_TYPE_LABELS[i.type]}
                </Badge>
                <span className="min-w-0 flex-1 truncate">{i.summary}</span>
                <span className="text-xs text-muted-foreground">{i.deals?.name}</span>
                <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">
                  {formatDate(i.occurred_on)}
                </span>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
