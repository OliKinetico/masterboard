import type { EmailAttachment, EmailMessage, EmailProvider } from "../types";

/**
 * Microsoft Graph provider (EMAIL_PROVIDER=graph) — COMPLETE implementation,
 * env-gated, ⚠ UNTESTED AGAINST A LIVE TENANT (built in a fixture-only
 * environment; see README "Going live" for the Azure AD app registration:
 * Application permission Mail.Read, admin consent, scoped to one mailbox).
 *
 * Auth: OAuth2 client-credentials against Azure AD v2 (no SDK dependency —
 * plain fetch keeps the surface auditable).
 * Sync: $filter on receivedDateTime > since, paged via @odata.nextLink.
 */

const GRAPH = "https://graph.microsoft.com/v1.0";

interface GraphMessage {
  id: string;
  subject: string | null;
  bodyPreview: string | null;
  body: { content: string | null } | null;
  receivedDateTime: string;
  from: { emailAddress: { name: string | null; address: string | null } } | null;
  toRecipients: Array<{ emailAddress: { name: string | null; address: string | null } }>;
  ccRecipients: Array<{ emailAddress: { name: string | null; address: string | null } }>;
  hasAttachments: boolean;
  webLink: string | null;
}

interface GraphAttachment {
  name: string | null;
  "@odata.type": string;
}

export class GraphEmailProvider implements EmailProvider {
  readonly name = "graph";
  private token: { value: string; expiresAt: number } | null = null;

  private get config() {
    const tenantId = process.env.GRAPH_TENANT_ID;
    const clientId = process.env.GRAPH_CLIENT_ID;
    const clientSecret = process.env.GRAPH_CLIENT_SECRET;
    const mailbox = process.env.GRAPH_MAILBOX;
    if (!tenantId || !clientId || !clientSecret || !mailbox) {
      throw new Error(
        "GraphEmailProvider needs GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET and GRAPH_MAILBOX",
      );
    }
    return { tenantId, clientId, clientSecret, mailbox };
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) {
      return this.token.value;
    }
    const { tenantId, clientId, clientSecret } = this.config;
    const res = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          scope: "https://graph.microsoft.com/.default",
          grant_type: "client_credentials",
        }),
      },
    );
    if (!res.ok) {
      throw new Error(`Graph token request failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = {
      value: json.access_token,
      expiresAt: Date.now() + json.expires_in * 1000,
    };
    return this.token.value;
  }

  private async graphGet<T>(url: string): Promise<T> {
    const token = await this.getToken();
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error(`Graph request failed (${res.status}): ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  async listDelta(since: Date | null): Promise<EmailMessage[]> {
    const { mailbox } = this.config;
    const select =
      "id,subject,bodyPreview,body,receivedDateTime,from,toRecipients,ccRecipients,hasAttachments,webLink";
    const filter = since
      ? `&$filter=receivedDateTime gt ${since.toISOString()}`
      : "";
    let url: string | null =
      `${GRAPH}/users/${encodeURIComponent(mailbox)}/messages?$select=${select}` +
      `&$orderby=receivedDateTime asc&$top=50${filter}`;

    const out: EmailMessage[] = [];
    while (url) {
      const page: { value: GraphMessage[]; "@odata.nextLink"?: string } =
        await this.graphGet(url);
      for (const m of page.value) {
        out.push(await this.toEmailMessage(m, mailbox));
      }
      url = page["@odata.nextLink"] ?? null;
    }
    return out;
  }

  private async toEmailMessage(
    m: GraphMessage,
    mailbox: string,
  ): Promise<EmailMessage> {
    let attachments: EmailAttachment[] = [];
    if (m.hasAttachments) {
      const res = await this.graphGet<{ value: GraphAttachment[] }>(
        `${GRAPH}/users/${encodeURIComponent(mailbox)}/messages/${m.id}/attachments?$select=name`,
      );
      attachments = res.value
        .filter((a) => a["@odata.type"] === "#microsoft.graph.fileAttachment")
        .map((a) => ({
          name: a.name ?? "attachment",
          // deep link into the message in Outlook on the web
          deepLink: m.webLink ?? "",
        }));
    }
    return {
      graphId: m.id,
      from: {
        name: m.from?.emailAddress.name ?? "",
        address: m.from?.emailAddress.address ?? "",
      },
      to: m.toRecipients.map((r) => ({
        name: r.emailAddress.name ?? "",
        address: r.emailAddress.address ?? "",
      })),
      cc: m.ccRecipients.map((r) => ({
        name: r.emailAddress.name ?? "",
        address: r.emailAddress.address ?? "",
      })),
      subject: m.subject ?? "(no subject)",
      bodyPreview: m.bodyPreview ?? "",
      body: m.body?.content ?? m.bodyPreview ?? "",
      receivedAt: m.receivedDateTime,
      attachments,
    };
  }
}
