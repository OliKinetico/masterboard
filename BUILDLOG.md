# BUILDLOG

Plain-English log of what was built at each step, key decisions, and trade-offs. Newest entries at the bottom. One git commit per step, message format `[P1.2] …`.

---

## P0 — Foundations

### [P0.1] Scaffold, tooling, design tokens
- Scaffolded Next.js **15.5.19** (App Router, TypeScript strict, `src/` dir, `@/*` alias) with Tailwind CSS v4. npm's `latest` Next tag was a *preview* build, so I pinned the newest stable 15.x (ASSUMPTIONS #1).
- Installed the UI/runtime stack: `@supabase/supabase-js` + `@supabase/ssr`, Radix primitives + `cmdk` + `sonner` (the shadcn/ui component set is vendored in `src/components/ui` rather than pulled through the shadcn CLI — same code style, zero CLI nondeterminism), `lucide-react`, `dnd-kit` (kanban drag), `recharts` (analytics), `postgres` (seed/scripts driver), `vitest` + `tsx` for tests/scripts.
- Design tokens in `globals.css` as Tailwind v4 `@theme`: Kinetico teal (`brand-600 #0D9488 / brand-700 #0F766E`) as primary, slate neutrals, light surfaces. Inter via `next/font`. `[data-financial]` opts tables/figures into tabular numerals; all £ formatting goes through `src/lib/format.ts`.
- npm scripts: `dev`, `build`, `typecheck`, `lint`, `test`, `db:reset` (full migrate + seed via `scripts/db-reset.ts`).
- Trade-off: vendoring the shadcn-style components adds files to the repo but makes the build reproducible offline and pins their behaviour; this is what shadcn itself recommends for products.
