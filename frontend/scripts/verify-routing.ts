const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

interface RouteCheck {
  name: string;
  path: string;
  mustContain: string;
  expectStatus: number;
}

const checks: RouteCheck[] = [
  {
    name: "Landing page — no wallet connect box",
    path: "/",
    mustContain: "Open Dashboard",
    expectStatus: 200,
  },
  {
    name: "Landing page — secondary CTA exists",
    path: "/",
    mustContain: "Explore Transfer Flow",
    expectStatus: 200,
  },
  {
    name: "Landing page — devnet badge links to /stats",
    path: "/",
    mustContain: 'href="/stats"',
    expectStatus: 200,
  },
  {
    name: "Dashboard — loads without auth (no redirect)",
    path: "/dashboard",
    mustContain: "Connect wallet",
    expectStatus: 200,
  },
  {
    name: "Demo page — loads without auth",
    path: "/demo",
    mustContain: "Demo Mode",
    expectStatus: 200,
  },
  {
    name: "Stats page — loads without auth",
    path: "/stats",
    mustContain: "RailFi",
    expectStatus: 200,
  },
];

async function run() {
  console.log(`\n🔍 RailFi Routing Verification\n   Base: ${BASE}\n`);

  let passed = 0;
  let failed = 0;

  for (const check of checks) {
    const url = `${BASE}${check.path}`;

    try {
      const res = await fetch(url, { redirect: "manual" });
      const body = await res.text();

      const statusOk = res.status === check.expectStatus;
      const bodyOk = body.includes(check.mustContain);

      if (statusOk && bodyOk) {
        console.log(`  ✅ ${check.name}`);
        passed++;
      } else {
        console.log(`  ❌ ${check.name}`);
        if (!statusOk) {
          console.log(`     Status: expected ${check.expectStatus}, got ${res.status}`);
        }
        if (!bodyOk) {
          console.log(`     Missing in body: "${check.mustContain}"`);
        }
        failed++;
      }
    } catch (err) {
      console.log(`  💥 ${check.name} — threw: ${err}`);
      failed++;
    }
  }

  console.log(`\n  Result: ${passed}/${checks.length} passed · ${failed} failed\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

run();
