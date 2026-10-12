import Link from "next/link";
import { getHealth } from "@/lib/api/health";

export default async function Home() {
  const result = await getHealth();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-5xl font-bold tracking-tight">
        yan<span className="text-cyan-600 dark:text-cyan-400">i</span>x
      </h1>
      <p className="text-lg text-zinc-600 dark:text-zinc-400">
        Zoom into a computer, from a syscall down to silicon, and watch one
        request travel through the Linux kernel and the hardware underneath it.
      </p>

      <section
        aria-label="API status"
        className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 px-4 py-3 font-mono text-sm"
      >
        <span
          aria-hidden="true"
          className={`size-2.5 rounded-full ${result.ok ? "bg-emerald-400" : "bg-red-400"}`}
        />
        {result.ok ? (
          <span>
            API is up · version {result.health.version}
          </span>
        ) : (
          <span>API is down · {result.error}</span>
        )}
      </section>

      <Link
        href="/desktop"
        className="group flex items-center justify-between gap-4 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-3 transition hover:bg-cyan-500/15"
      >
        <span>
          <span className="block font-semibold">Open the desktop lab</span>
          <span className="block text-sm text-zinc-600 dark:text-zinc-400">
            Click apps on a simulated Linux desktop and watch every step from
            user space to the kernel, the hardware and the network.
          </span>
        </span>
        <span aria-hidden className="text-xl transition group-hover:translate-x-1">
          →
        </span>
      </Link>

      <p className="text-sm text-zinc-500">
        The catalog API and the zoomable map arrive in phases 1 to 3.
      </p>
    </main>
  );
}
