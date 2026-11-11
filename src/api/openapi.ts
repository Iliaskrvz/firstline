// OpenAPI 3.1 description of /api/v1. Mirrors src/api/schemas.ts (a test checks the two agree).
import { MAX_BATCH, MAX_WAIT_S, RATE_LIMIT_PER_MIN } from "./schemas";

const lead = {
  type: "object",
  required: ["email"],
  properties: {
    email: { type: "string", format: "email" },
    first_name: { type: ["string", "null"], maxLength: 100 },
    last_name: { type: ["string", "null"], maxLength: 100 },
    company: { type: ["string", "null"], maxLength: 200 },
    title: { type: ["string", "null"], maxLength: 200, description: "Job title." },
    website: { type: ["string", "null"], maxLength: 500, description: "Company website. Without it, the company domain of the email address is used (never gmail.com and similar)." },
    linkedin_headline: { type: ["string", "null"], maxLength: 500 },
    custom: { type: "object", additionalProperties: { type: ["string", "number", "boolean", "null"] }, description: "Extra fields, usable as {{variables}} in your copy." },
  },
};

const source = {
  copy: {
    type: "object",
    required: ["body"],
    description: "Your email. FirstLine writes only the [[slots]]; {{variables}} are filled from the lead.",
    properties: {
      subject: { type: "string", maxLength: 300 },
      body: { type: "string", maxLength: 10000, example: "Hi {{first_name}},\n\n[[opener · something specific from their website · 25]]\n\nWe help bakeries cut waste. Worth a call?" },
      style_rules: {
        type: "object",
        properties: {
          language: { type: "string", enum: ["auto", "en", "nl", "de", "fr"], default: "auto" },
          tone: { type: "string", maxLength: 200 },
          banned_phrases: { type: "array", items: { type: "string" }, maxItems: 50 },
          extra_rules: { type: "array", items: { type: "string" }, maxItems: 20 },
        },
      },
    },
  },
  campaign_id: { type: "string", format: "uuid", description: "Use the copy of a campaign you made in the app instead of sending copy." },
  options: {
    type: "object",
    properties: {
      writer: { type: "string", enum: ["pro", "lite"], default: "pro" },
      depth: {
        type: "object",
        description: "Deep and Local research are not available yet.",
        properties: { deep: { type: "boolean", default: false, enum: [false] }, local: { type: "boolean", default: false, enum: [false] } },
      },
    },
  },
  wait: { type: "integer", minimum: 0, maximum: MAX_WAIT_S, default: 0, description: "Seconds to wait for the result in this same call (n8n/Make). 0 = return at once." },
};

const result = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    email: { type: "string" },
    status: { type: "string", enum: ["queued", "processing", "personalised", "fallback", "failed", "skipped"], description: "fallback = no usable facts on the website: a neutral line, 0 credits." },
    detail: { type: ["string", "null"] },
    subject: { type: ["string", "null"] },
    email_body: { type: ["string", "null"], description: "The full email with your copy and the written slots." },
    slots: { type: ["object", "null"], additionalProperties: { type: "string" } },
    sources: { type: "array", items: { type: "object", properties: { fact: { type: "string" }, url: { type: "string" } } } },
    confidence: { type: ["string", "null"], enum: ["high", "medium", "low", null] },
    credits_used: { type: "integer" },
  },
};

const job = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    object: { const: "job" },
    kind: { type: "string", enum: ["single", "batch"] },
    status: { type: "string", enum: ["running", "done"] },
    created_at: { type: "string", format: "date-time" },
    finished_at: { type: ["string", "null"], format: "date-time" },
    lead_count: { type: "integer" },
    counts: { type: "object", additionalProperties: { type: "integer" } },
    credits_used: { type: "integer" },
    result: { ...result, description: "Single-lead jobs only: the same as results[0]." },
    results: { type: "array", items: result },
  },
};

const error = {
  type: "object",
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string", enum: ["unauthorized", "forbidden", "not_found", "invalid_request", "insufficient_credits", "rate_limited", "idempotency_conflict", "not_available", "server_error"] },
        message: { type: "string" },
        details: { type: "object" },
      },
    },
  },
};

const errors = {
  "400": { description: "Invalid request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  "401": { description: "Missing or invalid API key", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  "429": { description: `Over ${RATE_LIMIT_PER_MIN} requests per minute for this key (see Retry-After)`, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
};

const jobResponses = {
  "200": { description: "Done (with wait): results included", content: { "application/json": { schema: { $ref: "#/components/schemas/Job" } } } },
  "202": { description: "Accepted: poll GET /jobs/{id} or wait for the webhook", content: { "application/json": { schema: { $ref: "#/components/schemas/Job" } } } },
  "402": { description: "Not enough credits", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  "422": { description: "Idempotency-Key reused with a different body", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  ...errors,
};

const idemHeader = {
  name: "Idempotency-Key",
  in: "header",
  required: false,
  schema: { type: "string", maxLength: 200 },
  description: "Retrying with the same key returns the same job and never charges twice.",
};

export function openApiSpec(baseUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "FirstLine API",
      version: "1.0.0",
      description:
        "Personalise cold emails: FirstLine reads each lead's company website and writes only the [[slots]] in your copy, citing every fact. " +
        "Uses the same prepaid credits as the app: credits are reserved when a job is accepted, charged when a lead is personalised, and given back on fallback.",
    },
    servers: [{ url: `${baseUrl.replace(/\/+$/, "")}/api/v1` }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "An API key from Settings → API keys (fl_live_…)." } },
      schemas: { Lead: lead, Job: job, Result: result, Error: error },
    },
    paths: {
      "/personalize": {
        post: {
          operationId: "personalizeLead",
          summary: "Personalise one lead",
          parameters: [idemHeader],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["lead"], properties: { lead: { $ref: "#/components/schemas/Lead" }, ...source } } } },
          },
          responses: jobResponses,
        },
      },
      "/personalize/batch": {
        post: {
          operationId: "personalizeBatch",
          summary: `Personalise up to ${MAX_BATCH} leads`,
          parameters: [idemHeader],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", required: ["leads"], properties: { leads: { type: "array", items: { $ref: "#/components/schemas/Lead" }, minItems: 1, maxItems: MAX_BATCH }, ...source } },
              },
            },
          },
          responses: jobResponses,
        },
      },
      "/jobs/{id}": {
        get: {
          operationId: "getJob",
          summary: "Get a job and its results",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
            { name: "wait", in: "query", required: false, schema: { type: "integer", minimum: 0, maximum: MAX_WAIT_S }, description: "Seconds to wait for the job to finish." },
          ],
          responses: { "200": { description: "The job", content: { "application/json": { schema: { $ref: "#/components/schemas/Job" } } } }, "404": { description: "Not found" }, ...errors },
        },
      },
      "/credits": {
        get: {
          operationId: "getCredits",
          summary: "Credit balance",
          responses: {
            "200": {
              description: "Balance",
              content: { "application/json": { schema: { type: "object", properties: { object: { const: "credits" }, available: { type: "integer" }, reserved: { type: "integer" } } } } },
            },
            ...errors,
          },
        },
      },
    },
    webhooks: {
      "job.completed": {
        post: {
          summary: "A single-lead job finished",
          description: "Signed: FirstLine-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of \"<t>.<raw body>\" with your endpoint secret>. Reject if t is more than 5 minutes off.",
          requestBody: { content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" }, type: { const: "job.completed" }, created: { type: "string" }, data: { $ref: "#/components/schemas/Job" } } } } } },
          responses: { "200": { description: "Any 2xx within 10 seconds counts as received. Otherwise retried after 1 min, 5 min, 30 min, 2 h, 6 h and 24 h." } },
        },
      },
      "batch.completed": {
        post: {
          summary: "A batch job finished",
          requestBody: { content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" }, type: { const: "batch.completed" }, created: { type: "string" }, data: { $ref: "#/components/schemas/Job" } } } } } },
          responses: { "200": { description: "Any 2xx within 10 seconds counts as received." } },
        },
      },
    },
  };
}
