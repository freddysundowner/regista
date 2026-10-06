---
name: Navigation naming
description: User requirements for consistent page names, central subscriptions, and persistent sidebar state.
---

Use one name per page throughout navigation and page headings, without a second competing page name. Subscription payments across schools belong on one central Subscriptions page, distinct from student fee Payments.

**Why:** The user requested a central page and said “dont call it 2 names, also even the other pages let them not have 2 names.”

**How to apply:** Keep sidebar, mobile navigation, and visible page titles consistent. Preserve meaningful section labels and financial terms without treating them as alternative page names.

Sidebar collapse must persist in browser storage across reloads and restarts.

**Why:** The user explicitly requested a collapsible sidebar that stores its state so it survives restart.

**How to apply:** Preserve the desktop preference without breaking the mobile menu, and handle unavailable browser storage gracefully.
