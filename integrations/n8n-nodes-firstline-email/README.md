# n8n-nodes-firstline-email

An [n8n](https://n8n.io) community node for **FirstLine**: it reads each lead's company website and writes the personalised parts of your cold email (the `[[slots]]`), citing every fact. Everything else in your email stays word for word.

## Installation

In n8n: **Settings → Community Nodes → Install**, then enter `n8n-nodes-firstline-email`. See the [n8n community nodes guide](https://docs.n8n.io/integrations/community-nodes/installation/).

## Credentials

1. In FirstLine, open **Settings → API** and click **Create key**. Copy the key (it starts with `fl_live_` and is shown once).
2. In n8n, create a **FirstLine API** credential and paste the key. Leave **Base URL** as it is unless your FirstLine address is different.

The credential test calls `GET /api/v1/credits`.

## Operations

| Resource | Operation | What it does |
| --- | --- | --- |
| Lead | Personalise | Sends one lead and your email; returns the written email, the slots, the sources and the credits used. |
| Job | Get | Gets a job by ID (for results that took longer than the wait time). |
| Credit | Get Balance | Available and reserved credits. |

### Personalise a lead

- **Email**: the lead's email address. Add first name, company, website and job title under **Additional Fields**. Without a website, the domain of the email address is used.
- **Email Body**: your email with slots, for example:

  ```
  Hi {{first_name}},

  [[opener · something specific from their website · 25]]

  We help bakeries cut waste with daily order forecasts. Worth a call next week?
  ```

  Or choose **FirstLine Campaign** and paste a campaign ID to use copy you made in the app.
- **Wait for Result**: up to 60 seconds. Most leads finish within 30. If the job is still running, the output has `status: "running"` and an `id`: use **Job → Get** with that ID.
- **Idempotency Key** (optional): use something unique per lead, like a row ID. If n8n retries the step, the same result comes back and you're never charged twice.

The output's `result` field holds the lead's result: `status` (`personalised`, `fallback`, `failed`), `subject`, `email_body`, `slots`, `sources` and `credits_used`. A `fallback` (no usable facts on the website) costs 0 credits.

### Example workflow

Google Sheets (new row) → **FirstLine: Personalise** (Email = `{{$json.email}}`, Company = `{{$json.company}}`, Idempotency Key = `{{$json.row_number}}`) → Google Sheets (update row with `{{$json.result.email_body}}`).

## Limits

60 requests per minute per API key. Credits are reserved when a lead is accepted and returned on a fallback.

## Resources

- [FirstLine API docs](https://firstline.46-17-99-33.sslip.io/docs/api)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## License

MIT
