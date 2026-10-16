# Multi-college support

How EduVillage models colleges today, and the roadmap for institution-level administration. Details of the admin panel: [ADMIN_PANEL.md](ADMIN_PANEL.md). Tables: [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md).

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

## Roadmap

* Institution administrators (a membership-based role scoped to one college) and a membership approval workflow.
* College-scoped course catalogues and per-college visibility settings.
* An audit-log viewer with an institution column.
* Notifications for membership and class events.

The design keeps these additive: memberships would be rows linking a user to a college with a role and status, authorisation checks would take the college as an argument, and existing accounts keep working unchanged.
