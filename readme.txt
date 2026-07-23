=== Ars Nova Site Notes ===
Version: 1.1.0

In-context notes & change tasks for the WordPress FRONT END and the WP-ADMIN back end.

WHAT IT DOES
- Logged-in admins/editors see a "Notes" button in the admin bar on BOTH the front end
  and inside wp-admin (every admin screen except the Site Notes review page).
- Click it to open a per-page / per-screen notepad. Add checklist items, each with a
  priority (1-10) and a type (general / copy / design / bug / idea).
- Back-end notes attach to the specific admin screen (the ?page= slug is part of the key),
  so the Season Dashboard and each singer-dashboard view keep their own note set.
- Optionally link any note to a specific element on the page: click "link to element",
  then click the thing on the page/screen. A red target line is drawn from the note to it.
- Check items off; completed items show struck-through with who/when.
- WP-Admin -> "Site Notes": a full, filterable, sortable review list of every note across
  all pages, grouped by page/screen, with an Area filter (Front end / Back end) and an
  area chip on each group.

WHO CAN USE IT
- Anyone with the "edit_posts" capability (Editors and Administrators) by default.
  Filter: add_filter('ansn_capability', fn() => 'manage_options') to restrict to admins.

INSTALL / UPDATE
- Plugins -> Add New -> Upload Plugin -> choose ars-nova-site-notes.zip -> Install.
- If a previous version is installed, WordPress will offer "Replace current with uploaded".

DATA / SYNC
- Notes are stored as a private custom post type (ans_site_note), exposed via REST so
  they can be pulled into the project tracker (Google Sheet) by the marketing team.
- Each note carries a context of "frontend" or "admin" plus its page/screen URL.
- Front-end page matching uses the URL path (so a note set follows a page across dev/live);
  admin matching includes the query string so each admin screen is distinct.

CHANGELOG
- 1.1.0 — Added back-end (wp-admin) notes: notepad now works on admin screens (Season
  Dashboard, singer dashboards, etc.); notes tagged frontend/admin; review screen gains an
  Area filter + per-group area chip. Admin-bar button no longer hidden inside wp-admin.
- 1.0.3 — Front-end panel: composer moved above the notes list; "Notes on this page" label.
- 1.0.0 — Initial release (front-end notes).

Built for Ars Nova Singers by the marketing team.
