import type { EmailMessage, EmailProvider } from "../types";
import { FIXTURE_EMAILS } from "../fixtures";

/**
 * Default provider (EMAIL_PROVIDER=fixture): deterministic seeded mailbox.
 * Serves matched-by-address, matched-by-alias and unmatched messages so the
 * whole matcher pipeline is demonstrable without credentials.
 */
export class FixtureEmailProvider implements EmailProvider {
  readonly name = "fixture";

  async listDelta(since: Date | null): Promise<EmailMessage[]> {
    if (!since) return [...FIXTURE_EMAILS];
    return FIXTURE_EMAILS.filter(
      (m) => new Date(m.receivedAt).getTime() > since.getTime(),
    );
  }
}
