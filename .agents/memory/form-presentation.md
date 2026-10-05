---
name: Form presentation
description: User's standing rule for how forms appear in the school system.
---

Use full pages or dialogs for forms, not inline forms.

**Why:** The user said, "i do not like the inline forms at all, either full page or dialog but no inline forms".

**How to apply:** Keep create/edit workflows out of list rows and embedded list-page panels. Put short forms in dialogs and longer workflows on dedicated pages. Search and filter controls can remain with their lists.

The user requested: "Whole system make it responsive like a mobile app."

They reinforced that the whole system should feel like a native mobile app, and explicitly allowed condensing menus and sections into floating buttons or similar controls. A resize-only desktop layout is not sufficient.

**Why:** Mobile usability must include both the platform console and school workspaces, not only the landing page.

**How to apply:** Check new screens, dense tables, navigation and create/edit dialogs on narrow phones as well as desktop. Do not treat clipped off-screen actions as a responsive layout.

Wizard navigation must not reuse the final submit button's DOM identity.

**Why:** A Next click can synchronously change a React button into a submit button before the browser applies the click's default action, prematurely persisting a record without review.

**How to apply:** Use distinct keys for navigation and final submit controls and prevent the navigation click's default action. Verify that advancing to review makes no writes before explicit Save.