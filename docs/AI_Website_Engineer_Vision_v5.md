# AI Website Engineer — Vision & Strategy (v5)

> **The core idea:** separate **intelligence** from **execution**.
> The product is an AI that understands any website, reasons about what's wrong, and produces a high-quality remediation plan. *How* that plan is applied — a copy-paste snippet, a unified diff, a pull request, a CMS update, or a fully autonomous deploy — is a **pluggable execution layer**.
>
> This keeps the platform **universal** — every website, every tech stack, every CMS — while letting execution grow richer over time without ever changing the core AI.

*Supersedes v4. v4's business/GTM logic still holds; this version corrects the scope from "Next.js-first" to "universal-first" and formalizes the remediation model.*

---

# 1. Vision

Build the **AI Website Engineer** — the AI that continuously improves the quality of *any* production website.

Technical SEO is the entry point, not the destination. The long-term vision is the operating system for website growth: SEO, performance, accessibility, AI-search visibility, analytics quality, and conversion.

The platform is defined by its **intelligence**, not by any single execution mechanism.

> **The AI Website Engineer is not defined by its ability to create pull requests.**
> It is defined by its ability to understand websites, reason about problems, and produce high-quality remediation plans. A pull request is merely one way to apply a fix.

---

# 2. Positioning

- **Not another SEO dashboard.** Crawlers already find issues; that's commoditized.
- **Not a generic coding agent.** Coding agents open PRs; that's commoditizing and it only serves git-based sites.
- **We are the universal reasoning + remediation engine for website quality** — works on a Next.js app, a WordPress blog, a Shopify store, a .NET site, a headless-CMS front end, or a hand-written `index.html`, identically.

The moat is **quality of understanding + quality of remediation**, delivered through whatever execution rail the customer's stack supports.

---

# 3. The Architecture in One Picture

```
              Universal Website Scanner  (+ optional Repository Scanner)
                              │
                     Website Knowledge Graph
                              │
                      AI Reasoning Engine
                              │
              Structured Remediation Instruction     ← execution-agnostic
                              │
          ┌───────────────────┼───────────────────┐
          │          │         │         │         │
   Recommendation  Patch    Repo PR   CMS Update  Autonomous
     (universal)  (MVP)    (adapter) (adapter)   (enterprise)
```

**The AI engine never knows how a fix will be applied.** It emits structured remediation instructions; execution adapters convert them into snippets, diffs, PRs, CMS writes, API calls, or deploys. New rails are added without touching the intelligence.

---

# 4. Universal by Design

**Detection is universal** because it reads a website's *rendered output*, not its source. Every stack emits the same `<title>`, canonical tag, robots directives, and JSON-LD — so the scanner is tech-agnostic from day one. Optional repository/source access makes remediation *richer*, but is never *required* to detect or to help.

**Remediation is universal** because the base rails need no per-technology adapters:
- **Recommendation** and **Patch (unified diff)** work on *every* website with zero adapters.
- **Repo PR**, **CMS update**, and **Autonomous** are *progressive deepening* for stacks that support them.

Nothing is ever "unsupported." A site with no repo and an unknown backend still gets full detection, reasoning, and an exact patch to apply.

---

# 5. Remediation Policies (the execution layer)

| Policy | What it delivers | Adapters | Universal? | Stage |
|---|---|---|---|---|
| **1 · Recommendation** | Issue, why it matters, impact, confidence, exact fix guidance | None | ✅ | MVP |
| **2 · AI Patch** *(MVP default)* | A standard unified diff the developer applies anywhere | None | ✅ | MVP |
| **3 · Repository PR/MR** | Auto-opened PR/MR (GitHub, GitLab, Bitbucket) | Repo + framework adapter | git sites | Phase 2–3 |
| **4 · CMS / Platform Update** | Corrected field via CMS API (WordPress, Shopify, headless) | Per-platform adapter | CMS sites | Phase 3 |
| **5 · Autonomous Apply** | Validate → deploy → monitor → optional rollback | Full stack + trust | Enterprise | Phase 4 |

Each rung up increases automation, stickiness, trust required, and pricing power. Customers ascend the ladder as trust is earned — the product grows *with* the account.

Every remediation, regardless of rail, carries: **what's wrong, why it matters, expected impact, and a confidence score.** Explainability is constant; only the delivery changes.

---

# 6. Why This Is Both Universal *and* Fast to Ship

Universality usually costs time-to-market. Here it doesn't, because the MVP rails (Recommendation + Patch) require **no adapters at all**:

- **Broadest possible TAM** — every website on the internet, not one framework's slice.
- **Cheapest possible MVP** — crawl + rules + cheap-model reasoning + deterministic diff. No adapter engineering to reach first value.
- **Software margins** — delivery is mostly a rendered crawl plus a scoped LLM call. Target 80%+ gross margin.
- **Self-serve** — point us at a URL; get findings, explanations, and patches in minutes. No install required to see value.

The one honest tradeoff: **pre-deploy prevention isn't universal** (it needs a per-PR preview URL, which mainly the modern JS world has). So the universal baseline is *"catch it the moment it's live"* via continuous crawling of production/staging, with *pre-deploy* prevention offered as a premium capability where the plumbing allows.

---

# 7. Business Model

- **Unit of value: a monitored site (property)** — not a repo, because not every customer has one. A property = a domain/subdomain we continuously scan.
- **Free:** 1 property, periodic scan, recommendations, limited patches. The universal hook.
- **Pro (~$99/property/mo):** continuous monitoring, unlimited patches, all issue types, repo/CMS integration when available.
- **Team/Enterprise:** multi-property, autonomous apply, SSO/SOC 2, self-hosted crawler, private model.

Per-property pricing maps to the value (a site's traffic/revenue) and scales as customers add properties. Validate exact numbers with design partners.

---

# 8. Go-To-Market

**Message:** "Point us at your website. We find what's silently costing you traffic — and hand you the exact fix, on any stack."

Sell revenue protection and engineering leverage, not SEO reports. Distribution: a free universal scan as the top-of-funnel (any URL, instant value), then convert on continuous monitoring + one-click remediation. Integrations (GitHub/GitLab/CMS) deepen retention but don't gate entry.

---

# 9. Roadmap (execution deepens; intelligence is constant)

- **Phase 1 — Universal detection + reasoning + Recommendation + Patch.** No adapters. *(This is the MVP.)*
- **Phase 2 — Repository integration.** GitHub/GitLab/Bitbucket PR/MR from the same instructions.
- **Phase 3 — Framework & CMS adapters.** Next.js, Astro, Nuxt, Remix, SvelteKit, WordPress, Shopify — richer auto-apply.
- **Phase 4 — Autonomous apply.** Enterprise: validate → deploy → monitor → rollback.

Capability domains (SEO → performance → accessibility → AI-search → analytics → conversion) expand *on top of the same engine* once technical SEO is owned.

---

# 10. Guiding Principle

Keep intelligence independent from execution. That single decision makes the platform **universal, framework-agnostic, extensible, and future-proof** — any framework, CMS, deployment platform, or repository provider can be supported later by adding an execution adapter, never by changing the AI.

**North Star:** become the AI engineer responsible for continuously improving *every* production website — starting by finding what's wrong on any site and handing over the exact fix.
