import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Timeline pagination: 60 entries older than the cursor (occurred_on, id). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const before = searchParams.get("before");
  const supabase = await createClient();

  let query = supabase
    .from("interactions")
    .select("*")
    .eq("deal_id", id)
    .order("occurred_on", { ascending: false })
    .order("occurred_at", { ascending: false, nullsFirst: false })
    .limit(60);

  if (before) query = query.lt("occurred_on", before);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
