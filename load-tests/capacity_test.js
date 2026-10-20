// k6 load test implementing the "Baseline" and "Ramp" scenarios from
// docs/CAPACITY_TEST_PLAN.md (sections 4.1 and 4.2), against the "Authentication",
// "Registration lookups", "Discovery / enrolment" and "Classes" request groups from section 3.
//
// WRITTEN BUT NEVER RUN. This file exists so the capacity test plan has an executable starting
// point; running it against any real environment (even staging) is a separate, deliberate step —
// see docs/CAPACITY_TEST_PLAN.md section 7 ("Safe execution procedure") before doing so. It
// refuses to run against the known production host as a hard safety floor, but that check is not
// a substitute for actually pointing BASE_URL at a real staging environment.
//
// Prerequisites (none of this repository provides them):
//   - k6 installed (https://k6.io/docs/get-started/installation/) — not a project dependency.
//   - A staging deployment with its own Neon project, R2 bucket and LiveKit project (see plan
//     section 1). EMAILJS_* must be blank there so OTPs come back in the API response.
//   - Seeded synthetic accounts: a platform admin is NOT needed by this script, but a pool of
//     already-APPROVED student/teacher accounts is, because registration approval requires a
//     college administrator action this script does not perform. Create them through the normal
//     registration + approval flow against staging first; see docs/CAPACITY_TEST_PLAN.md §1.
//
// Usage (baseline — one iteration per endpoint group, 5 minutes):
//   k6 run -e BASE_URL=https://your-staging-host -e SCENARIO=baseline \
//          -e TEST_EMAILS=a@staging.test,b@staging.test -e TEST_PASSWORD=... \
//          load-tests/capacity_test.js
//
// Usage (ramp — staged virtual-user increase per plan §4.2):
//   k6 run -e BASE_URL=https://your-staging-host -e SCENARIO=ramp \
//          -e TEST_EMAILS=a@staging.test,b@staging.test -e TEST_PASSWORD=... \
//          load-tests/capacity_test.js
//
// TEST_EMAILS should list far more accounts than peak VUs (plan §1: "at least 10x"), since
// the login rate limit in app/services/rate_limit_service.py is per-account.

import http from 'k6/http'
import { check, fail, sleep } from 'k6'

const PRODUCTION_HOSTS = ['eduvillage-api.onrender.com']

const BASE_URL = (__ENV.BASE_URL || '').replace(/\/$/, '')
const TEST_EMAILS = (__ENV.TEST_EMAILS || '').split(',').map((s) => s.trim()).filter(Boolean)
const TEST_PASSWORD = __ENV.TEST_PASSWORD || ''
const SCENARIO = __ENV.SCENARIO || 'baseline'

export const options = {
  scenarios: {
    baseline: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '5m',
      exec: 'baseline',
    },
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      // Plan §4.2 steps: 10, 25, 50, 100, 250, 500, 1000 concurrent app users, 10 min per step.
      // Starts intentionally small here (10/25/50) — raise the later stages yourself once the
      // smaller steps pass clean, rather than jumping straight to four-digit concurrency.
      stages: [
        { duration: '10m', target: 10 },
        { duration: '10m', target: 25 },
        { duration: '10m', target: 50 },
      ],
      exec: 'rampIteration',
    },
  },
  thresholds: {
    // Plan §6 acceptance criteria.
    'http_req_duration{group:read}': ['p(95)<500'],
    'http_req_duration{group:login}': ['p(95)<1500'],
    'http_req_duration{group:join_token}': ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
}

function assertSafeTarget() {
  if (!BASE_URL) fail('BASE_URL is required — point it at a staging deployment, never leave it unset.')
  if (PRODUCTION_HOSTS.some((h) => BASE_URL.includes(h))) {
    fail(`BASE_URL (${BASE_URL}) matches a known PRODUCTION host. Refusing to run. Use a staging deployment instead.`)
  }
  if (TEST_EMAILS.length === 0 || !TEST_PASSWORD) {
    fail('TEST_EMAILS and TEST_PASSWORD are required — seed approved synthetic accounts on staging first.')
  }
}

function pickEmail(vuId) {
  return TEST_EMAILS[vuId % TEST_EMAILS.length]
}

function login(email) {
  const res = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ email, password: TEST_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { group: 'login' } }
  )
  check(res, { 'login succeeded': (r) => r.status === 200 })
  return res
}

function journey(email) {
  login(email)

  const health = http.get(`${BASE_URL}/health`, { tags: { group: 'read' } })
  check(health, { 'health ok': (r) => r.status === 200 })

  const colleges = http.get(`${BASE_URL}/api/v1/registration/colleges`, { tags: { group: 'read' } })
  check(colleges, { 'colleges lookup ok': (r) => r.status === 200 })

  const catalog = http.get(`${BASE_URL}/api/v1/courses/catalog`, { tags: { group: 'read' } })
  check(catalog, { 'catalog ok': (r) => r.status === 200 })

  const classes = http.get(`${BASE_URL}/api/v1/classes`, { tags: { group: 'read' } })
  check(classes, { 'classes list ok': (r) => r.status === 200 })

  // Join-token issuance against a real class is intentionally NOT exercised generically here —
  // it needs a live, startable class id specific to your seeded staging data. Extend this
  // function with your own staging class id before using it for the "Classes" request group,
  // e.g.:
  //   const joinToken = http.post(`${BASE_URL}/api/v1/classes/${CLASS_ID}/join-token`, null, {
  //     tags: { group: 'join_token' },
  //   })

  http.post(`${BASE_URL}/api/v1/auth/logout`, null, { tags: { group: 'login' } })
}

export function baseline() {
  assertSafeTarget()
  journey(pickEmail(0))
}

export function rampIteration() {
  assertSafeTarget()
  journey(pickEmail(__VU))
  sleep(1) // a human pauses between actions; this is not a request-flood tool
}
