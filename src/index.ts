#!/usr/bin/env node

/**
 * Protonmail MCP Server
 * 
 * This MCP server provides email sending functionality using Protonmail's SMTP service.
 * It implements a single tool for sending emails with various options.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { SecureVersion } from "tls";
import { EmailService, EmailConfig } from "./email-service.js";

// Get environment variables for SMTP configuration
const PROTONMAIL_USERNAME = process.env.PROTONMAIL_USERNAME;
const PROTONMAIL_PASSWORD = process.env.PROTONMAIL_PASSWORD;
const PROTONMAIL_HOST = process.env.PROTONMAIL_HOST || "smtp.protonmail.ch";
const PROTONMAIL_PORT = parseInt(process.env.PROTONMAIL_PORT || "587", 10);
const PROTONMAIL_SECURE = process.env.PROTONMAIL_SECURE === "true";
const PROTONMAIL_REQUIRE_TLS = process.env.PROTONMAIL_REQUIRE_TLS !== "false";
const PROTONMAIL_TLS_MIN_VERSION =
  process.env.PROTONMAIL_TLS_MIN_VERSION || "TLSv1.2";
const PROTONMAIL_TLS_REJECT_UNAUTHORIZED =
  process.env.PROTONMAIL_TLS_REJECT_UNAUTHORIZED !== "false";
const PROTONMAIL_CONNECTION_TIMEOUT_MS = parseInt(
  process.env.PROTONMAIL_CONNECTION_TIMEOUT_MS || "10000",
  10
);
const PROTONMAIL_SOCKET_TIMEOUT_MS = parseInt(
  process.env.PROTONMAIL_SOCKET_TIMEOUT_MS || "10000",
  10
);
const RATE_LIMIT_PER_MINUTE = parseInt(
  process.env.PROTONMAIL_RATE_LIMIT_PER_MINUTE || "10",
  10
);
const ALLOW_LIST = new Set(
  (process.env.PROTONMAIL_ALLOW_LIST || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
);
const DEBUG = process.env.DEBUG === "true";

const allowedTlsVersions: SecureVersion[] = [
  "TLSv1",
  "TLSv1.1",
  "TLSv1.2",
  "TLSv1.3",
];

function normalizeTlsVersion(version: string): SecureVersion {
  return allowedTlsVersions.includes(version as SecureVersion)
    ? (version as SecureVersion)
    : "TLSv1.2";
}

const TLS_MIN_VERSION = normalizeTlsVersion(PROTONMAIL_TLS_MIN_VERSION);

// Validate required environment variables
if (!PROTONMAIL_USERNAME || !PROTONMAIL_PASSWORD) {
  console.error(
    "[Error] Missing required environment variables: PROTONMAIL_USERNAME and PROTONMAIL_PASSWORD must be set"
  );
  process.exit(1);
}

const SEND_TOOL_NAME = "send_email";
const HEALTH_TOOL_NAME = "health_check";
const HEADER_INJECTION_PATTERN = /[\r\n]/;
const allowListEnabled = ALLOW_LIST.size > 0;

// In-memory rate limiter state
const rateLimiterState = {
  windowStart: Date.now(),
  count: 0,
};

type LastSendResult =
  | {
      status: "success";
      timestamp: number;
      details?: string;
    }
  | {
      status: "error";
      timestamp: number;
      error: string;
    };

let lastSendResult: LastSendResult | null = null;

// Logging helpers
function debugLog(message: string): void {
  if (DEBUG) {
    console.error(`[Debug] ${message}`);
  }
}

function infoLog(message: string): void {
  console.error(`[Info] ${message}`);
}

function errorLog(message: string): void {
  console.error(`[Error] ${message}`);
}

// Validation schema for send_email tool
const sendEmailSchema = z.object({
  to: z.string().min(1, "'to' is required").max(2048),
  subject: z.string().min(1, "'subject' is required").max(512),
  body: z.string().min(1, "'body' is required").max(20000),
  isHtml: z.boolean().optional(),
  cc: z.string().optional(),
  bcc: z.string().optional(),
});

function parseSendEmailArgs(args: unknown): z.infer<typeof sendEmailSchema> {
  try {
    return sendEmailSchema.parse(args);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues
        .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
        .join("; ");
      throw new McpError(ErrorCode.InvalidParams, issues);
    }
    throw error;
  }
}

interface NormalizedEmailArgs {
  to: string[];
  subject: string;
  body: string;
  isHtml: boolean;
  cc: string[];
  bcc: string[];
}

function sanitizeHeaderField(value: string, fieldName: string): string {
  if (HEADER_INJECTION_PATTERN.test(value)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `'${fieldName}' cannot include newline characters`
    );
  }
  return value.trim();
}

function normalizeRecipientList(
  rawValue: string | undefined,
  fieldName: string
): string[] {
  if (!rawValue) {
    return [];
  }

  if (HEADER_INJECTION_PATTERN.test(rawValue)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `'${fieldName}' cannot include newline characters`
    );
  }

  return rawValue
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeEmailArgs(rawArgs: z.infer<typeof sendEmailSchema>): NormalizedEmailArgs {
  const toList = normalizeRecipientList(rawArgs.to, "to");

  if (toList.length === 0) {
    throw new McpError(
      ErrorCode.InvalidParams,
      "At least one recipient is required"
    );
  }

  const ccList = normalizeRecipientList(rawArgs.cc, "cc");
  const bccList = normalizeRecipientList(rawArgs.bcc, "bcc");
  const subject = sanitizeHeaderField(rawArgs.subject, "subject");

  return {
    to: toList,
    subject,
    body: rawArgs.body,
    isHtml: rawArgs.isHtml === true,
    cc: ccList,
    bcc: bccList,
  };
}

function enforceAllowList(recipients: string[]): void {
  if (!allowListEnabled) {
    return;
  }

  const disallowed = recipients.filter(
    (recipient) => !ALLOW_LIST.has(recipient.toLowerCase())
  );

  if (disallowed.length > 0) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Recipient(s) not permitted by allow list: ${disallowed.join(", ")}`
    );
  }
}

function formatRecipientField(list: string[]): string | undefined {
  return list.length ? list.join(", ") : undefined;
}

function checkRateLimit(): void {
  if (!Number.isFinite(RATE_LIMIT_PER_MINUTE) || RATE_LIMIT_PER_MINUTE <= 0) {
    return;
  }

  const now = Date.now();

  if (now - rateLimiterState.windowStart >= 60_000) {
    rateLimiterState.windowStart = now;
    rateLimiterState.count = 0;
  }

  if (rateLimiterState.count >= RATE_LIMIT_PER_MINUTE) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Rate limit exceeded (${RATE_LIMIT_PER_MINUTE} emails per minute)`
    );
  }

  rateLimiterState.count += 1;
}

async function buildHealthReport(): Promise<string> {
  let smtpStatus = "unknown";

  try {
    await emailService.verifyConnection();
    smtpStatus = "ok";
  } catch (error) {
    smtpStatus = `error: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }

  const rateLimitInfo = Number.isFinite(RATE_LIMIT_PER_MINUTE) &&
    RATE_LIMIT_PER_MINUTE > 0
      ? `${rateLimiterState.count}/${RATE_LIMIT_PER_MINUTE} in current minute window`
      : "disabled";

  const allowListInfo = allowListEnabled
    ? `enabled (${ALLOW_LIST.size} entries)`
    : "disabled";

  const lastSendInfo = lastSendResult
    ? lastSendResult.status === "success"
      ? `success at ${new Date(lastSendResult.timestamp).toISOString()}${
          lastSendResult.details ? ` (${lastSendResult.details})` : ""
        }`
      : `error at ${new Date(lastSendResult.timestamp).toISOString()}: ${
          lastSendResult.error
        }`
    : "no attempts yet";

  return [
    `SMTP: ${smtpStatus}`,
    `Rate limit: ${rateLimitInfo}`,
    `Allow list: ${allowListInfo}`,
    `Last send: ${lastSendInfo}`,
  ].join("\n");
}

// Create email service configuration
const emailConfig: EmailConfig = {
  host: PROTONMAIL_HOST,
  port: PROTONMAIL_PORT,
  secure: PROTONMAIL_SECURE,
  auth: {
    user: PROTONMAIL_USERNAME,
    pass: PROTONMAIL_PASSWORD,
  },
  debug: DEBUG,
  connectionTimeout: Number.isFinite(PROTONMAIL_CONNECTION_TIMEOUT_MS)
    ? PROTONMAIL_CONNECTION_TIMEOUT_MS
    : undefined,
  socketTimeout: Number.isFinite(PROTONMAIL_SOCKET_TIMEOUT_MS)
    ? PROTONMAIL_SOCKET_TIMEOUT_MS
    : undefined,
  requireTLS: PROTONMAIL_REQUIRE_TLS,
  tls: {
    minVersion: TLS_MIN_VERSION,
    rejectUnauthorized: PROTONMAIL_TLS_REJECT_UNAUTHORIZED,
  },
};

// Initialize email service
const emailService = new EmailService(emailConfig);

/**
 * Create an MCP server with capabilities for tools (to send emails)
 */
const server = new Server(
  {
    name: "protonmail-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * Handler that lists available tools.
 * Exposes a single "send_email" tool that lets clients send emails.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  debugLog("[Setup] Listing available tools");

  return {
    tools: [
      {
        name: SEND_TOOL_NAME,
        description: "Send an email using Protonmail SMTP",
        inputSchema: {
          type: "object",
          properties: {
            to: {
              type: "string",
              description:
                "Recipient email address(es). Multiple addresses can be separated by commas.",
            },
            subject: {
              type: "string",
              description: "Email subject line",
            },
            body: {
              type: "string",
              description: "Email body content (plain text or HTML)",
            },
            isHtml: {
              type: "boolean",
              description: "Whether the body contains HTML content",
              default: false,
            },
            cc: {
              type: "string",
              description: "CC recipient(s), separated by commas",
            },
            bcc: {
              type: "string",
              description: "BCC recipient(s), separated by commas",
            },
          },
          required: ["to", "subject", "body"],
        },
      },
      {
        name: HEALTH_TOOL_NAME,
        description:
          "Check SMTP connectivity, rate limit state, and last send outcome",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

/**
 * Handler for the send_email tool.
 * Sends an email with the provided details and returns success message.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  debugLog(`[Tool] Executing tool: ${request.params.name}`);

  switch (request.params.name) {
    case SEND_TOOL_NAME: {
      const args = request.params.arguments;

      if (!args || typeof args !== "object") {
        throw new McpError(ErrorCode.InvalidParams, "Invalid arguments");
      }

      const parsedArgs = parseSendEmailArgs(args);
      const normalized = normalizeEmailArgs(parsedArgs);
      enforceAllowList([
        ...normalized.to,
        ...normalized.cc,
        ...normalized.bcc,
      ]);
      checkRateLimit();

      try {
        const result = await emailService.sendEmail({
          to: normalized.to.join(", "),
          subject: normalized.subject,
          body: normalized.body,
          isHtml: normalized.isHtml,
          cc: formatRecipientField(normalized.cc),
          bcc: formatRecipientField(normalized.bcc),
        });

        lastSendResult = {
          status: "success",
          timestamp: Date.now(),
          details: result.info?.messageId,
        };

        return {
          content: [
            {
              type: "text",
              text: `Email sent successfully to ${normalized.to.join(", ")}${
                normalized.cc.length ? ` (CC: ${normalized.cc.join(", ")})` : ""
              }${
                normalized.bcc.length
                  ? ` (BCC: ${normalized.bcc.join(", ")})`
                  : ""
              }.`,
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        errorLog(`Failed to send email: ${message}`);

        lastSendResult = {
          status: "error",
          timestamp: Date.now(),
          error: message,
        };

        throw new McpError(
          ErrorCode.InternalError,
          `Failed to send email: ${message}`
        );
      }
    }

    case HEALTH_TOOL_NAME: {
      const report = await buildHealthReport();
      return {
        content: [
          {
            type: "text",
            text: report,
          },
        ],
      };
    }

    default:
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${request.params.name}`
      );
  }
});

/**
 * Start the server using stdio transport.
 * This allows the server to communicate via standard input/output streams.
 */
async function main() {
  debugLog("[Setup] Starting Protonmail MCP server...");

  try {
    // Verify SMTP connection on startup
    await emailService.verifyConnection();

    const transport = new StdioServerTransport();
    await server.connect(transport);

    debugLog("[Setup] Protonmail MCP server started successfully");
  } catch (error) {
    console.error(
      `[Error] Server startup failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exit(1);
  }
}

// Set up error handling
process.on("uncaughtException", (error) => {
  errorLog(`Uncaught exception: ${error.message}`);
});

process.on("unhandledRejection", (reason) => {
  errorLog(
    `Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`
  );
});

// Start the server
main().catch((error) => {
  console.error(`[Error] Server error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
