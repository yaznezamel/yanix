import { connection } from "next/server";

// Server-side only: the browser never sees this URL. In docker compose it is
// the service name (http://api:8000); locally it defaults to the dev server.
const API_URL = process.env.YANIX_API_URL ?? "http://localhost:8000";

export type Health = {
  status: "ok";
  version: string;
};

export type HealthResult =
  | { ok: true; health: Health }
  | { ok: false; error: string };

export async function getHealth(): Promise<HealthResult> {
  // Render at request time, not at build time when the API is not running.
  await connection();
  try {
    const res = await fetch(`${API_URL}/api/v1/health`, { cache: "no-store" });
    if (!res.ok) {
      return { ok: false, error: `API answered ${res.status}` };
    }
    return { ok: true, health: (await res.json()) as Health };
  } catch {
    return { ok: false, error: `Cannot reach the API at ${API_URL}` };
  }
}
