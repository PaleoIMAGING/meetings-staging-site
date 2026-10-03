# PaleoIMAGING Website and Organization TODO

This file tracks website development and organization-wide coordination tasks. All website content and project documentation should be written in English.

These are implementation tasks and proposals for review, not additional scientific commitments agreed at the Gdańsk workshop. Repository creation, renaming, and configuration must be verified before marking tasks complete.

## 1. Inventory and agreed structure

- [ ] Inspect the current local repositories, READMEs, website files, and links.
- [ ] Confirm the WG4 rename from `wg4-community` to `wg4-datasets`, including its local directory and Git remote.
- [ ] Confirm that the WG1, WG2, and WG3 repositories have been created and cloned.
- [ ] Confirm that `paleoimaging.github.io` has been created and cloned.
- [ ] Keep `Community-Hub` as the central community forum.
- [ ] Keep the existing map, tutorial, converter, and data-survey repositories while integrating their content into website navigation.
- [ ] Do not create a separate tutorials repository.

| Repository | Intended role |
| --- | --- |
| `.github` | Organization profile and shared contribution guidance |
| `paleoimaging.github.io` | Public Jekyll website and this coordination checklist |
| `Community-Hub` | Central community forum using GitHub Discussions |
| `wg1-standard-materials` | WG1 workspace |
| `wg2-interlab-comparison` | WG2 workspace |
| `wg3-best-practices` | WG3 workspace |
| `wg4-datasets` | WG4 workspace |
| `Paleoimaging-techniques-map` | Source code and inventory for the map displayed within the website |
| `git-introduction` | Introductory Git and GitHub learning materials |
| `git-demo` | Practical tutorial examples and exercises |
| `microXRF_to_NetCDF` | Conversion tool |
| `PANGAEA-Paleoimaging-Deep-Search` | Dataset survey and metadata resources |

## 2. Jekyll website foundation

- [ ] Create the Jekyll structure, configuration, dependency files, and layouts.
- [ ] Select a simple, accessible, responsive visual design.
- [ ] Reuse the existing PaleoIMAGING logo and available assets.
- [ ] Set the organization website URL and link handling consistently.
- [ ] Create navigation: Home, About, Working Groups, Resources, Tutorials, News, and Community.
- [ ] Add clear links to the PAGES PaleoIMAGING page, GitHub organization, and community forum.
- [ ] Document local preview and build instructions in the website README.
- [ ] Keep this checklist and internal development guidance out of generated website navigation; exclude them from the build where appropriate.

## 3. Organization profile and public content

- [ ] Review `.github/profile/README.md` and adapt relevant public information for the website.
- [ ] Retain a concise organization profile with links to the website, forum, WGs, and tools.
- [ ] Avoid maintaining duplicate long descriptions in multiple repositories.
- [ ] Present the network's purpose and complementary imaging techniques clearly.
- [ ] Distinguish workshop decisions, proposals, and pending discussions.
- [ ] Verify names, institutional affiliations, scientific claims, and credits before publication.
- [ ] Update descriptions that still present community-wide resources as serving only WG4.

## 4. Working group pages and workspaces

- [ ] Create a Working Groups overview page.
- [ ] Create WG1 — Standard materials.
- [ ] Create WG2 — Interlab comparison.
- [ ] Create WG3 — Best practices and workflows.
- [ ] Create WG4 — Datasets.
- [ ] Use a consistent page structure: purpose, activities, contacts, resources, and participation links.
- [ ] Prepare consistent README templates for the four WG repositories.
- [ ] Use the official Gdańsk minutes as the source for documented outcomes and assigned actions.
- [ ] Keep André and Andrei distinct when documenting responsibilities.
- [ ] Confirm contacts and responsibilities with each WG before presenting them publicly.
- [ ] Label private workspace links as requiring authorized access.
- [ ] Keep internal notes and unpublished materials in the private workspaces unless approved for public release.

## 5. Map integration

- [ ] Inspect how the existing map is generated and published.
- [ ] Display the interactive map within the website, with a dedicated page and navigation entry.
- [ ] Choose an integration method after inspecting the existing implementation.
- [ ] Initially retain the map repository as the source of code and inventory data.
- [ ] Keep the Excel inventory available for download and document how updates reach the map.
- [ ] Avoid creating independently maintained copies of the inventory.
- [ ] Verify institutional names, techniques, coordinates, credits, and public suitability of the inventory.
- [ ] Check map behavior on mobile devices and provide a usable fallback link.

## 6. Tutorials and resources

- [ ] Review `git-introduction` and `git-demo` for overlap and complementary content.
- [ ] Create a Tutorials landing page with a suggested learning sequence.
- [ ] Link introductory lessons to `git-introduction`.
- [ ] Link practical examples and exercises to `git-demo`.
- [ ] Explain how to join GitHub, participate in Discussions, and contribute changes.
- [ ] Reuse or adapt suitable explanations on the website without duplicating maintained exercises unnecessarily.
- [ ] Create resource entries for the conversion tool and PANGAEA dataset survey.
- [ ] Describe NetCDF and Zarr conversion, metadata, and training as WG4 activities without implying unfinished tools are available.
- [ ] Add appropriate Proton Drive and Zenodo links only after confirming their intended audience and access.

## 7. Community forum

- [ ] Confirm GitHub Discussions is enabled in `Community-Hub`.
- [ ] Review existing categories before adding new ones.
- [ ] Provide clear categories or navigation for WG1, WG2, WG3, and WG4.
- [ ] Retain useful general categories such as Announcements and Questions & Help.
- [ ] Update the hub README to explain its role and link to the website and WG workspaces.
- [ ] Review contribution guidance and the code of conduct.
- [ ] Confirm with the group the intended public participation and moderation arrangements.
- [ ] Keep private WG discussions out of the public forum when restricted access is needed.

## 8. Organization permissions review

- [ ] Review organization base permissions.
- [ ] Audit access to every private WG repository.
- [ ] Decide whether all organization members should have read access to all WG workspaces.
- [ ] Create or review WG teams and their membership.
- [ ] Assign write access according to the agreed collaboration model.
- [ ] Review owner, administrator, and outside-collaborator access.
- [ ] Verify effective permissions with an ordinary member account.
- [ ] Confirm website visibility separately from source repository visibility.
- [ ] Keep person-specific access findings and sensitive administrative details in a private space.

## 9. Review and publication

- [ ] Build and preview the website locally.
- [ ] Check navigation, internal links, external links, and renamed repository references.
- [ ] Check readability, keyboard navigation, mobile layout, and image alternative text.
- [ ] Verify the map and tutorial links in the preview.
- [ ] Prepare a draft for Petra and the group to review.
- [ ] Record feedback and outstanding content or governance decisions here.
- [ ] Configure GitHub Pages publication after draft review.
- [ ] Verify the published website and document the update workflow.

## 10. Decisions still to confirm

- [ ] Final website design and navigation labels.
- [ ] Public versus private scope of community participation and WG materials.
- [ ] WG contacts, content reviewers, and update responsibilities.
- [ ] Map integration method and inventory update workflow.
- [ ] Relationship between Proton Drive, Zenodo, GitHub, and longer-term storage.
- [ ] Whether any overlapping tutorial content should be consolidated later.

## Completion notes

When completing a task, mark its checkbox and add a short note or a link to the relevant commit, issue, or review where useful. Preserve pending decisions rather than presenting them as completed agreements.
