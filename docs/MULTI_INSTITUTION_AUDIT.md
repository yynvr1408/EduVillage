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
| Institution administrators | The platform administrator can delegate a teacher as a college's administrator (`CollegeAdministrator`, assigned via `/admin` or self-serve at `/teacher/institution`'s own API, `app/api/v1/institution_admin.py`); that teacher gets branch/section management for that one college on their ordinary teacher session, with no access to college creation or activation. Delegation is direct (admin-assigned), idempotent, and revocable at any time |

## Roadmap

* A self-service membership request/approval workflow — today, becoming an institution administrator is always a direct platform-admin assignment, not something a teacher can request.
* College-scoped course catalogues and per-college visibility settings.
* An audit-log viewer with an institution column.
* Notifications for membership and class events.

The design keeps these additive: a membership-request flow would add a status to the existing `CollegeAdministrator` row rather than changing its shape, authorisation checks already take the college as an argument, and existing accounts keep working unchanged.
