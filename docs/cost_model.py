"""EduVillage infrastructure cost model. All provider prices verified 2026-10-16 from official pages (see
docs/INFRASTRUCTURE_COST_MODEL.md). Workload numbers are ASSUMPTIONS. Run: python costmodel.py [md|json]"""
import json, math, sys

INR = 96.5  # per USD, third-party quote (Pluang) seen 2026-10-16; timestamp unverified
SCEN = [100, 500, 1000, 5000, 10000, 50000, 100000]

PROFILES = {
    "P1 recorded-first": dict(mau=0.40, online_h=6,  live_min=30,  mb_per_min=0.8, peak_app=0.10, peak_live=0.03, email=0.3, db_mult=1.0, class_size=31),
    "P2 hybrid":         dict(mau=0.50, online_h=12, live_min=150, mb_per_min=2.0, peak_app=0.10, peak_live=0.06, email=0.4, db_mult=1.0, class_size=31),
    "P3 live-heavy":     dict(mau=0.60, online_h=20, live_min=600, mb_per_min=3.0, peak_app=0.15, peak_live=0.12, email=0.5, db_mult=1.5, class_size=31),
}
HEARTBEAT_PER_H = 240          # frontend NetworkContext: GET /health every 15 s per open tab (verified in code)
NONHB_PER_H = 80               # assumed non-heartbeat API calls per online hour
REC_MB_PER_MIN = 8.0           # assumed room-composite MP4 size
RETENTION_MONTHS = 6           # assumed recording retention policy
DB_KB_PER_REG = 80             # assumed relational data per registered user after ~12 months
RPS_PER_INSTANCE = 40          # planning assumption (UNMEASURED) for one Standard instance

def livekit(pm, peak_live, gb_down, egress_min):
    """Cheapest plan whose concurrency limit fits. Returns (plan, cost, exceeds_published_plans)."""
    plans = [  # name, base, inc_pm, conc, inc_gb, inc_egress, ov_pm, ov_gb, ov_eg
        ("Build (free)", 0, 5000, 100, 50, 60, None, None, None),
        ("Ship", 50, 150000, 1000, 250, 600, 0.0005, 0.12, 0.02),
        ("Scale", 500, 1500000, 5000, 3072, 8000, 0.0004, 0.10, 0.015),
    ]
    best = None
    for name, base, ipm, conc, igb, ieg, opm, ogb, oeg in plans:
        if peak_live > conc:
            continue
        if base == 0:
            if pm <= ipm and gb_down <= igb and egress_min <= ieg:
                return name, 0.0, False
            continue
        cost = base + max(0, pm - ipm) * opm + max(0, gb_down - igb) * ogb + max(0, egress_min - ieg) * oeg
        if best is None or cost < best[1]:
            best = (name, cost, False)
    if best:
        return best
    _, base, ipm, conc, igb, ieg, opm, ogb, oeg = plans[2]
    lower = base + max(0, pm - ipm) * opm + max(0, gb_down - igb) * ogb + max(0, egress_min - ieg) * oeg
    return "Scale limits exceeded -> Enterprise (price UNKNOWN)", lower, True


def emailjs(n):
    if n <= 200: return "EmailJS Free", 0
    if n <= 2000: return "EmailJS Personal", 9
    if n <= 5000: return "EmailJS Professional", 15
    if n <= 25000: return "EmailJS Business", 40
    return "Other provider (UNVERIFIED $0.10/1k est.)", n / 1000 * 0.10

def neon(R, db_gb):
    if R <= 100:
        return "Neon Free", 0.0
    cu = {500: 0.25, 1000: 0.5, 5000: 1, 10000: 2, 50000: 4, 100000: 8}[R]
    rate = 0.106 if R <= 10000 else 0.222  # Scale rate from 50k (30-day restore, fixed sizes)
    plan = "Neon Launch" if R <= 10000 else "Neon Scale"
    return plan, cu * 730 * rate + db_gb * 0.35

def run():
    out = []
    for R in SCEN:
        for pname, p in PROFILES.items():
            mau = R * p["mau"]
            peak_app = mau * p["peak_app"]
            peak_live = mau * p["peak_live"]
            pm = mau * p["live_min"]
            class_min = pm / p["class_size"]
            gb_down = pm * p["mb_per_min"] / 1024
            hb = mau * p["online_h"] * HEARTBEAT_PER_H
            nonhb = mau * p["online_h"] * NONHB_PER_H
            rps = peak_app * (HEARTBEAT_PER_H + NONHB_PER_H) / 3600
            email_n = mau * p["email"]
            db_gb = R * DB_KB_PER_REG * p["db_mult"] / 1024 / 1024
            rec_gb_month = class_min * REC_MB_PER_MIN / 1024
            stock_gb = rec_gb_month * RETENTION_MONTHS + mau * 5 / 1024  # + ~5 MB course material per MAU
            ai_hours = class_min / 60 * 1.1
            ai_cost = ai_hours * 0.04 + ai_hours * 12_000 * 0.15 / 1e6 + ai_hours * 800 * 0.60 / 1e6
            ai_requests = class_min / 60 * 1.1
            # backend
            if R <= 100:
                be_plan, be = "Render Free", 0.0
            else:
                n = max(1, math.ceil(rps / RPS_PER_INSTANCE))
                be_plan, be = f"Render Standard x{n}", n * 25.0
            worker = 7.0 if R >= 5000 else 0.0
            vercel = 0.0 if R <= 100 else 20.0
            nplan, ncost = neon(R, db_gb)
            lplan, lcost, lk_ent = livekit(pm, peak_live, gb_down, class_min)
            eplan, ecost = emailjs(email_n)
            r2 = max(0.0, stock_gb - 10) * 0.015
            total = vercel + be + worker + ncost + lcost + r2 + ecost + ai_cost
            out.append(dict(R=R, profile=pname, mau=mau, peak_app=peak_app, peak_live=peak_live, pm=pm, class_min=class_min,
                            gb_down=gb_down, hb=hb, nonhb=nonhb, api=hb + nonhb, rps=rps, email=email_n, db_gb=db_gb, rec_gb_month=rec_gb_month,
                            stock_gb=stock_gb, ai_hours=ai_hours, ai_requests=ai_requests, ai_cost=ai_cost, vercel=vercel, be_plan=be_plan, be=be,
                            worker=worker, neon_plan=nplan, neon=ncost, lk_plan=lplan, lk=lcost, lk_enterprise=lk_ent, r2=r2, email_plan=eplan, email_cost=ecost,
                            total=total, annual=total * 12, inr=total * INR, per_mau=total / mau,
                            per_institution=total / max(1, R / 1000), per_live_hour=lcost / (pm / 60)))
    return out

if __name__ == "__main__":
    rows = run()
    if len(sys.argv) > 1 and sys.argv[1] == "json":
        print(json.dumps(rows, indent=1, default=lambda x: None))
    else:
        for r in rows:
            print(f"{r['R']:>6} {r['profile']:<18} MAU={r['mau']:>7.0f} peakApp={r['peak_app']:>6.0f} peakLive={r['peak_live']:>6.0f} pm={r['pm']:>10.0f} rps={r['rps']:>6.1f} "
                  f"{r['be_plan']:<18} LK={r['lk_plan']:<26} lk=${r['lk']:>8.0f} neon=${r['neon']:>6.0f} r2=${r['r2']:>7.0f} em=${r['email_cost']:>5.0f} ai=${r['ai_cost']:>6.1f} total=${r['total']:>8.0f}")
