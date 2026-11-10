---
adr: 0001
title: Saved requests are a flat list
status: accepted
date: 2026-11-10
deciders: author
supersedes: null
superseded-by: null
source: conversation (PRD open question, prd.md:103; shape-notes.md:116)
produced-by: lz-adr
---

# 0001. Saved requests are a flat list

## Context

`prd.md` left open how saved requests are organised: "directories (as templates will be), a flat list, or tags", to be
decided before Milestone 1 planning (`prd.md:103`). Slice 5 of M1 (saved requests and environments) could not be
planned until it was settled (`roadmap.md`).

Two facts bound the choice. Request templates, a later milestone, are stated to live in directories
(`shape-notes.md:25`, `prd.md:70`). What separates a template from a saved request beyond its origin is a separate open
question, for the templates milestone (`prd.md:107`). Slice 6 narrows history by saved request, so a call refers to a
saved request, not to any grouping of them. M1 has an appetite of about two weeks and no margin left (`roadmap.md`,
calibration).

## Decision

Store saved requests as one flat list with no grouping: no directories, no tags. A saved request has a name and the
request it saves, and is listed and found by name. Calls link to a saved request by its id.

## Alternatives

| Option | Why it lost |
|---|---|
| Directories, as templates will be | Templates are a different thing: "Templates are requests before sending. After sending there is a request and the template." Matching saved requests to the templates' directories is not required by that, and the flat list was chosen "because rush for MVP" (author, 2026-11-10). |
| Tags | Left out of the MVP, not ruled out: "Because it was mvp. Should be added later" (author, 2026-11-10). |

## Consequences

**Gained:** slice 5 needs no folder or tag model, no moving or renaming of groups, and no empty-folder handling. Slice
6's filter by saved request depends only on the saved request's id.

**Given up:** no way to group saved requests. Finding one in a long list depends on its name and on search. Templates
will be organised in directories and saved requests will not, so the two will not look alike in the UI.

**Watch for:** tags are expected later (author). Adding them, or directories, is an addition to the saved-request
document and to the list UI; this ADR is then superseded, not edited. Revisit when the saved-request list no longer
fits on one screen, or when the templates milestone is shaped and decides how templates and saved requests relate.
