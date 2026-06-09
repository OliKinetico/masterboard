"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Clinic + contact create/update (staff-only via RLS). */

export async function upsertClinic(input: {
  id?: string;
  name: string;
  tradingName?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  postcode?: string | null;
  region?: string | null;
  companiesHouseNumber?: string | null;
  website?: string | null;
  phone?: string | null;
  disciplines: string[];
  revenueEstimate?: number | null;
  practitionerCount?: number | null;
  sitesCount?: number | null;
  score?: number | null;
}) {
  const supabase = await createClient();
  const row = {
    name: input.name.trim(),
    trading_name: input.tradingName || null,
    address_line1: input.addressLine1 || null,
    city: input.city || null,
    postcode: input.postcode || null,
    region: input.region || null,
    companies_house_number: input.companiesHouseNumber || null,
    website: input.website || null,
    phone: input.phone || null,
    disciplines: input.disciplines,
    revenue_estimate: input.revenueEstimate ?? null,
    practitioner_count: input.practitionerCount ?? null,
    sites_count: input.sitesCount ?? 1,
    score: input.score ?? null,
    source: "manual" as const,
  };

  if (input.id) {
    const { error } = await supabase.from("clinics").update(row).eq("id", input.id);
    if (error) return { error: error.message };
    revalidatePath(`/clinics/${input.id}`);
    revalidatePath("/clinics");
    return { ok: true, clinicId: input.id };
  }

  const { data, error } = await supabase
    .from("clinics")
    .insert(row)
    .select("id")
    .single();
  if (error) return { error: error.message };

  // keep the email matcher learning: alias = clinic name
  await supabase
    .from("clinic_aliases")
    .insert({ clinic_id: data.id, alias: row.name });

  revalidatePath("/clinics");
  return { ok: true, clinicId: data.id };
}

export async function upsertContact(input: {
  id?: string;
  clinicId?: string | null;
  fullName: string;
  role: string;
  emails: string[];
  phone?: string | null;
  whatsappNumber?: string | null;
  notes?: string | null;
}) {
  const supabase = await createClient();
  const row = {
    clinic_id: input.clinicId || null,
    full_name: input.fullName.trim(),
    role: input.role,
    emails: input.emails.map((e) => e.trim().toLowerCase()).filter(Boolean),
    phone: input.phone || null,
    whatsapp_number: input.whatsappNumber || null,
    notes: input.notes || null,
  };

  if (input.id) {
    const { error } = await supabase.from("contacts").update(row).eq("id", input.id);
    if (error) return { error: error.message };
    revalidatePath(`/contacts/${input.id}`);
    revalidatePath("/contacts");
    return { ok: true, contactId: input.id };
  }

  const { data, error } = await supabase
    .from("contacts")
    .insert(row)
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidatePath("/contacts");
  return { ok: true, contactId: data.id };
}
