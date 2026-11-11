# FirstLine app for Make

The FirstLine custom app for [Make](https://www.make.com), as files. Modules: **Personalise a lead**, **Get a job**, **Get credit balance**, and **Make an API call** (required for Make's review).

`make-app.test.ts` checks that every module only uses parameters it defines, that the API key is hidden in logs, and that the body *Personalise a lead* sends is accepted by the real API validation.

## Create the app in Make (about 15 minutes, once)

Make's docs (checked 2026-11-11) say the old VS Code extension is deprecated. The web editor is the simplest way:

1. In Make: **Custom Apps → + Create app**. Name `firstline-email`, label `FirstLine`, theme `#4f46e5` (from `app.json`). Upload `../../public/brand/firstline-icon.png` as the logo.
2. **Base** tab: paste `base.json`.
3. **Connections → Add**: label `FirstLine`, type **API key**. Paste `connection/parameters.json` in *Parameters* and `connection/communication.json` in *Communication*.
4. **Modules → Add** four times, type **Action**, with the connection from step 3. For each folder in `modules/`, use the name, label and description from `module.json` and paste:
   - `communication.json` → *Communication*
   - `mappable-parameters.json` → *Mappable parameters*
   - `interface.json` → *Interface*
5. Test it in a scenario: *Get credit balance* first (it checks the key), then *Personalise a lead*.

## Sharing

- **Private (now):** only you can use it until you install it in an organisation.
- **Invite link:** clicking **Publish** creates a link other Make users can install from. Publishing **can't be undone**: a published app can't be deleted or made private again, and published modules can't be removed, only hidden.
- **Public listing:** needs Make's review: a link to the API docs (`/docs/api`), test scenarios that use every module (including one that ends in an error), no personal data in logs, and the review form (support contact, categories, terms). Make reviews it first automatically, then by hand.

## Before the review

- The app name or label must not suggest a third party. "FirstLine" is also the name of another company (firstline.sh), so decide the brand first.
- The connection's default address is the current test address. Change `baseUrl` in `connection/parameters.json` to the final domain.
