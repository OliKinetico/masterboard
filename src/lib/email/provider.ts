import type { EmailProvider } from "./types";
import { FixtureEmailProvider } from "./providers/fixture";
import { GraphEmailProvider } from "./providers/graph";

/** Adapter selection by env (spec §8): EMAIL_PROVIDER=fixture|graph. */
export function getEmailProvider(): EmailProvider {
  switch (process.env.EMAIL_PROVIDER ?? "fixture") {
    case "graph":
      return new GraphEmailProvider();
    case "fixture":
    default:
      return new FixtureEmailProvider();
  }
}

export function getMailbox(): string {
  return process.env.GRAPH_MAILBOX ?? "oli@kinetico.health";
}
