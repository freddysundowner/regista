---
name: Viewer timezone
description: Viewer-local timestamp presentation across platform and school screens.
---

Display timestamps using the timezone of the person viewing, not server time or a fixed Nairobi timezone.

**Why:** The user requested universal timezone handling across the whole platform based on the viewer.

**How to apply:** Store instants in UTC and render in the browser timezone. Use the same timezone for activity-day grouping and timestamp date filters. Convert local datetime input to UTC, respecting daylight saving. Date-only values (birth dates, due dates, term dates) are calendar values and must not shift with timezone. Do not confuse a school's recurring schedule with a stored timestamp.
