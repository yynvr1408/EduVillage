# Multi-college support

How LanternEd models colleges today, and the roadmap for institution-level administration. Details of the admin panel: [ADMIN_PANEL.md](ADMIN_PANEL.md). Tables: [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md).

## What is implemented

| Area | Behaviour |
|---|---|
| Colleges | Created by the administrator with a unique, unpredictable code (`EV-XXXX-XXXX`, 40 bits, unique across current and retired codes); can be activated or deactivated; the code can be regenerated and the old one is retired permanently |
| Branches and sections | Each college has branches; each branch has sections. Names are unique per parent; a section cannot name a different college than its branch (composite foreign key); either level can be deactivated without touching existing assignments |
| Registration | Students and teachers pick an active college, branch and section and enter the college code; everything is validated on the server before any record is written; the code identifies a college for registration and grants no privilege |
| Teacher assignment | A teacher is assigned to one college section, or to "All Sections" of one branch (a branch-wide assignment, not a section row). It limits which cohorts the teacher may link and which students a class can address |
| Branch-wide classes | One class with a branch audience; shown to enrolled students of that branch under "Other Classes"; one LiveKit room; students of other branches or colleges cannot see or join it |
| Isolation | Registration, class visibility, join tokens, summaries and recordings of branch-wide classes all check the student's college and branch on the server |
| Students | Their college and section are stored with the account; choosing a college section never enrols them in a course |
| Institution administrators | The platform administrator can delegate a teacher as a college's administrator (`CollegeAdministrator`, assigned via `/admin` or auto-granted to the founding admin on self-registration approval, see below); that teacher manages that one college — branches, sections, registration code, and the student/teacher roster — on their ordinary teacher session at `/teacher/institution`, with no access to college creation or activation. **A college has at most one administrator at a time** (`uq_college_administrator_one_per_college`, a database-level unique constraint on `college_id` alone, not just an application check) — delegating someone new requires removing the existing one first; the same teacher may administer several different colleges, just not share one college with a peer |
| College self-registration | A college can register itself (public, `POST /registration/colleges/request`), naming its founding administrator and verifying their email the same way student/teacher registration does. The platform administrator reviews pending requests at `/platform-console` and approves or rejects them; approval creates the college and delegates its founding administrator in one step, so a newly-approved college is never left with nobody able to approve its first students/teachers |
| Registration approval | Registering against a college no longer creates an immediately-active account — it waits (`UserStatus.pending`) for that college's administrator to approve or reject it from their own roster page. A collegeless registration (only reachable when the college requirement is switched off) is unaffected and stays instant, as before |
| Roster management | A college administrator sees every active/suspended student and teacher admitted to their college, and can suspend, reactivate, or remove someone from the institution (detaches them — their account, courses and submissions are untouched) — but never act on their own account |
| College deletion | The platform administrator can only *request* a college's deletion; completing it requires that college's own administrator to separately confirm with their own password plus an OTP emailed to the college's registered contact address — the platform administrator can never delete a college unilaterally |

## Roadmap

* College-scoped course catalogues and per-college visibility settings.
* An audit-log viewer with an institution column.
* Notifications for membership and class events (registration approved/rejected, deletion requested).

The design keeps these additive: authorisation checks already take the college as an argument, and existing accounts keep working unchanged.
