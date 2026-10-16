# Classroom and course tools

What was added, how it works, and what has and has not been verified. Status labels: **verified** = a test that was run; **not verified** = needs a real device or people.

## Live classroom
| Feature | How it works | Verified |
|---|---|---|
| Teacher video as a small floating window | `FloatingVideo`: draggable, enlarge/shrink, hide to a "Show video" chip. Students see the teacher's camera; the teacher sees their own in the same window with camera, microphone and blur buttons. Small once something is shared, larger while video is all there is (unless the user picks a size). | real LiveKit Cloud browser test + unit tests |
| Whiteboard (type or write) | Teacher tools: pen, text, eraser, colours, line widths, undo, clear, save as PNG. Shared over the LiveKit **data channel** (a few hundred bytes per stroke, so it still works in audio-only mode). A student who joins late receives the whole board (the teacher re-sends it to each new participant). Students get a read-only board they can save as an image. Students' tokens cannot publish data, and receivers only accept board messages from publishers, so a student cannot forge the board. | real LiveKit browser test (live drawing, text, late joiner) + protocol unit tests + token test |
| Screen sharing, one or several | Teacher "Share screen", then "Add screen" for more screens or windows (each is its own track). Students get a tab per share plus "All screens". New content takes over the stage automatically. | real LiveKit browser test with one and two shares (Chromium auto-selected screen source) |
| Blurred teacher background | `@livekit/track-processors` background blur applied at the teacher's browser before sending, on by default with a toggle. The segmentation model is downloaded from a CDN the first time (needs internet). If the browser cannot do it the video is sent unblurred. | real browser test: processor starts, switches off and on; picture quality **not verified** (fake camera) |

Limits: the whiteboard is **not in the class recording** (the recording captures video tracks only; share the whiteboard tab as a screen to record it) and it is not stored after the class. In audio-only mode shared screens are paused (video is unsubscribed) but the whiteboard still works. Screen sharing is not available on most phones. Real screen content and real camera quality were not judged.

## Assignments
Students can attach **PDF, DOC and DOCX** files (up to 5 files, 20 MB each, `SUBMISSION_MAX_MB`) to a submission. The browser uploads straight to storage (R2 presigned PUT; local disk in development), then the server measures the size and checks the file's real bytes against its extension (a renamed file is rejected and removed). Files need a connection; the written answer still works offline. Teachers see and download each student's files in the submissions list. Adding or removing files follows the same rules as editing the answer (assignment open, before the deadline). Only the student and the course's teachers can download a file. Verified by 14 backend tests (real API and database, local storage) and 4 frontend tests; presigned-URL uploads to real R2 were **not** exercised.

## Lecture notes
The notes download is now **PDF** or **DOC (Word .docx)** instead of Markdown, generated in the browser (works offline). A PDF cannot show scripts outside Latin text (for example Telugu); the app then points to the DOC version. Verified with real PDF/DOCX bytes in unit tests.

## Course curriculum
"Import Syllabus" on the course page: paste lessons (one per line, or headings like Unit 1 / Chapter 2 / 3. Topic) or upload a text PDF (10 MB). The server proposes lessons, the teacher edits or removes them, then confirms and they are added in order in one transaction. Scanned (image-only) PDFs cannot be read and are rejected with a clear message. Verified with a real generated PDF.

## Course archive, restore and permanent delete
Active course: **Archive Course** (leaves the catalogue and self-enrolment; nothing is deleted). Archived course: **Restore Course** (back to published) and **Permanently Delete** (final). Restoring always returns the course to `published`, because the previous state is not stored.
