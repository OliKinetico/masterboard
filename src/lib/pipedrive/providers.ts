import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { parseCsv } from "@/lib/csv-parse";
import type {
  PdActivity, PdDeal, PdFile, PdNote, PdOrg, PdPerson,
  PipedriveData, PipedriveProvider,
} from "./types";

/**
 * CSV provider (default): reads exports from /imports/pipedrive/*.csv —
 * fixture CSVs are shipped there. Missing files are treated as empty sets.
 */
export class CsvPipedriveProvider implements PipedriveProvider {
  readonly name = "fixture";

  private read<T>(file: string): T[] {
    const full = path.join(process.cwd(), "imports", "pipedrive", file);
    if (!existsSync(full)) return [];
    return parseCsv(readFileSync(full, "utf8")) as T[];
  }

  async fetchAll(): Promise<PipedriveData> {
    return {
      orgs: this.read<PdOrg>("orgs.csv"),
      persons: this.read<PdPerson>("persons.csv"),
      deals: this.read<PdDeal>("deals.csv"),
      notes: this.read<PdNote>("notes.csv"),
      activities: this.read<PdActivity>("activities.csv"),
      files: this.read<PdFile>("files.csv"),
    };
  }
}

/**
 * API provider (PIPEDRIVE_PROVIDER=api) — COMPLETE implementation, env-gated,
 * ⚠ UNTESTED AGAINST A LIVE PIPEDRIVE ACCOUNT. Paginates v1 endpoints with
 * api_token auth. Field mapping mirrors the CSV columns.
 */
export class ApiPipedriveProvider implements PipedriveProvider {
  readonly name = "api";

  private get config() {
    const apiKey = process.env.PIPEDRIVE_API_KEY;
    const domain = process.env.PIPEDRIVE_DOMAIN;
    if (!apiKey || !domain) {
      throw new Error("ApiPipedriveProvider needs PIPEDRIVE_API_KEY and PIPEDRIVE_DOMAIN");
    }
    return { apiKey, domain };
  }

  private async paged<T>(endpoint: string): Promise<T[]> {
    const { apiKey, domain } = this.config;
    const out: T[] = [];
    let start = 0;
    for (;;) {
      const url = `https://${domain}/api/v1/${endpoint}?api_token=${apiKey}&start=${start}&limit=500`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Pipedrive ${endpoint} failed: ${res.status}`);
      const json = (await res.json()) as {
        data: T[] | null;
        additional_data?: { pagination?: { more_items_in_collection: boolean; next_start: number } };
      };
      out.push(...(json.data ?? []));
      const page = json.additional_data?.pagination;
      if (!page?.more_items_in_collection) break;
      start = page.next_start;
    }
    return out;
  }

  async fetchAll(): Promise<PipedriveData> {
    interface RawOrg { id: number; name: string; address: string | null; address_postal_code: string | null }
    interface RawPerson {
      id: number; name: string; org_id: { value: number } | null;
      email: Array<{ value: string }>; phone: Array<{ value: string }>;
    }
    interface RawDeal {
      id: number; title: string; org_id: { value: number } | null;
      stage_id: number; status: string; value: number; add_time: string; lost_reason: string | null;
    }
    interface RawStage { id: number; name: string }
    interface RawNote { id: number; deal_id: number | null; content: string; add_time: string }
    interface RawActivity {
      id: number; deal_id: number | null; type: string; subject: string;
      note: string | null; due_date: string; done: boolean;
    }
    interface RawFile { id: number; deal_id: number | null; name: string; url: string }

    const [orgs, persons, deals, stages, notes, activities, files] = await Promise.all([
      this.paged<RawOrg>("organizations"),
      this.paged<RawPerson>("persons"),
      this.paged<RawDeal>("deals"),
      this.paged<RawStage>("stages"),
      this.paged<RawNote>("notes"),
      this.paged<RawActivity>("activities"),
      this.paged<RawFile>("files"),
    ]);

    const stageName = new Map(stages.map((s) => [s.id, s.name]));

    return {
      orgs: orgs.map((o) => ({
        id: String(o.id),
        name: o.name,
        address: o.address ?? "",
        postcode: o.address_postal_code ?? "",
      })),
      persons: persons.map((p) => ({
        id: String(p.id),
        name: p.name,
        email: p.email?.[0]?.value ?? "",
        phone: p.phone?.[0]?.value ?? "",
        org_id: p.org_id ? String(p.org_id.value) : "",
      })),
      deals: deals.map((d) => ({
        id: String(d.id),
        title: d.title,
        org_id: d.org_id ? String(d.org_id.value) : "",
        stage: stageName.get(d.stage_id) ?? "",
        status: d.status,
        value: String(d.value ?? ""),
        add_time: d.add_time,
        lost_reason: d.lost_reason ?? "",
      })),
      notes: notes
        .filter((n) => n.deal_id)
        .map((n) => ({
          id: String(n.id),
          deal_id: String(n.deal_id),
          content: n.content,
          add_time: n.add_time,
        })),
      activities: activities
        .filter((a) => a.deal_id)
        .map((a) => ({
          id: String(a.id),
          deal_id: String(a.deal_id),
          type: a.type,
          subject: a.subject,
          note: a.note ?? "",
          due_date: a.due_date,
          done: a.done ? "1" : "0",
        })),
      files: files
        .filter((f) => f.deal_id)
        .map((f) => ({
          id: String(f.id),
          deal_id: String(f.deal_id),
          name: f.name,
          url: f.url,
        })),
    };
  }
}

export function getPipedriveProvider(): PipedriveProvider {
  return (process.env.PIPEDRIVE_PROVIDER ?? "fixture") === "api"
    ? new ApiPipedriveProvider()
    : new CsvPipedriveProvider();
}
