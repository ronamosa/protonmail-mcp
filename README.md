# Protonmail MCP Server

<p align="center">
  This MCP server is provided by <a href="https://amotivv.com">amotivv, inc.</a>, the creators of <a href="https://memorybox.dev">Memory Box</a>.
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

<p align="center">
  <a href="https://github.com/amotivv/memory-box">
    <img src="https://storage.googleapis.com/amotivv-public/memory-box-logo.png" alt="Memory Box" width="300" />
  </a>
</p>

This MCP server provides email sending functionality using Protonmail's SMTP service. It allows both Claude Desktop and Cline VSCode extension to send emails on your behalf using your Protonmail credentials. The implementation now includes basic safety rails (schema validation, allow lists, and per-minute rate limiting) along with a `health_check` tool for quick diagnostics.

## Compatibility

This MCP server is compatible with:
- **Claude Desktop App**: The standalone desktop application for Claude
- **Cline VSCode Extension**: The Claude extension for Visual Studio Code

The same implementation works across both platforms since they both use the Model Context Protocol (MCP) standard.

## Features

- Send emails to one or multiple recipients
- Support for CC and BCC recipients
- Support for both plain text and HTML email content
- Comprehensive error handling and logging

## Configuration

The server requires the following environment variables to be set in the MCP settings files for both Claude Desktop and Cline:

### Claude Desktop Configuration
Located at: `/Users/your-username/Library/Application Support/Claude/claude_desktop_config.json`

### Claude Code Configuration

Claude Code stores MCP settings in your global Claude profile—either through the `claude` CLI or the `~/.claude.json` file. You can configure this server in either of the following ways:

1. **CLI:**  
   ```bash
   claude mcp add --transport stdio protonmail \
     /Users/your-username/Repos/protonmail-mcp/node_modules/.bin/protonmail-mcp \
     --env PROTONMAIL_USERNAME=you@proton.me \
     --env PROTONMAIL_PASSWORD=your-smtp-password
   ```
   You can add additional `--env` flags for the optional variables listed below.

2. **Config file (`~/.claude.json`):**
   ```json
   {
     "projects": {
       "/path/to/your/project": {
         "mcpServers": {
           "protonmail-mcp": {
             "command": "/Users/your-username/Repos/protonmail-mcp/node_modules/.bin/protonmail-mcp",
             "env": {
               "PROTONMAIL_USERNAME": "you@proton.me",
               "PROTONMAIL_PASSWORD": "smtp-password"
             }
           }
         }
       }
     }
   }
   ```
   Replace the project path, command path, and env values with your own. Restart Claude Code after modifying the file.

### Cline VSCode Extension Configuration
Located at: `/Users/your-username/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`

Both configuration files require the following environment variables:

- `PROTONMAIL_USERNAME`: Your Protonmail email address
- `PROTONMAIL_PASSWORD`: Your Protonmail SMTP password (not your regular login password)
- `PROTONMAIL_HOST`: SMTP server hostname (default: smtp.protonmail.ch)
- `PROTONMAIL_PORT`: SMTP server port (default: 587 for STARTTLS, 465 for SSL/TLS)
- `PROTONMAIL_SECURE`: Whether to use a secure connection (default: "false" for port 587, "true" for port 465)
- `PROTONMAIL_REQUIRE_TLS`: Enforce STARTTLS (default: `true`)
- `PROTONMAIL_TLS_MIN_VERSION`: Minimum TLS version (default: `TLSv1.2`; supported: `TLSv1`, `TLSv1.1`, `TLSv1.2`, `TLSv1.3`)
- `PROTONMAIL_TLS_REJECT_UNAUTHORIZED`: Reject invalid SMTP certificates (default: `true`)
- `PROTONMAIL_CONNECTION_TIMEOUT_MS`: Timeout for establishing SMTP connections (default: `10000`)
- `PROTONMAIL_SOCKET_TIMEOUT_MS`: Timeout for SMTP socket activity (default: `10000`)
- `PROTONMAIL_RATE_LIMIT_PER_MINUTE`: Maximum emails per minute (set `0` or negative to disable, default: `10`)
- `PROTONMAIL_ALLOW_LIST`: Optional comma-separated list of recipient addresses allowed to receive email
- `DEBUG`: Enable debug logging (set to "true" to see detailed logs, "false" to hide them)

For detailed information about Protonmail's SMTP service, including how to get your SMTP password, please refer to the [official Protonmail SMTP documentation](https://proton.me/support/smtp-submission).

## Usage

Once configured, you can use the MCP server with the following tools:

### send_email

Sends an email using your Protonmail SMTP account.

**Parameters:**

- `to`: Recipient email address(es). Multiple addresses can be separated by commas.
- `subject`: Email subject line
- `body`: Email body content (can be plain text or HTML)
- `isHtml`: (Optional) Whether the body contains HTML content (default: false)
- `cc`: (Optional) CC recipient(s), separated by commas
- `bcc`: (Optional) BCC recipient(s), separated by commas

**Example:**

```
<use_mcp_tool>
<server_name>protonmail-mcp</server_name>
<tool_name>send_email</tool_name>
<arguments>
{
  "to": "recipient@example.com",
  "subject": "Test Email from Cline",
  "body": "This is a test email sent via the Protonmail MCP server.",
  "cc": "optional-cc@example.com"
}
</arguments>
</use_mcp_tool>
```

### health_check

Returns a quick status report summarizing SMTP connectivity, rate-limit state, allow-list configuration, and the last send attempt. This is useful for verifying credentials without sending a message.

```
<use_mcp_tool>
<server_name>protonmail-mcp</server_name>
<tool_name>health_check</tool_name>
<arguments>{}</arguments>
</use_mcp_tool>
```

## Troubleshooting

If you encounter issues with the MCP server, check the following:

1. Ensure your Protonmail SMTP credentials are correct in both configuration files
2. Verify that the SMTP port is not blocked by your firewall
3. Check if your Protonmail account has any sending restrictions
4. Look for error messages in the logs:
   - Claude Desktop app logs
   - Cline VSCode extension output panel
5. Restart the Claude Desktop app or reload the VSCode window after configuration changes

## Development

To build the project:

```bash
cd protonmail-mcp
npm install
npm run build
```

To modify the server, edit the files in the `src` directory and rebuild the project. The high-level plan for the current hardening work lives in `docs/SDD.md`.

## Installation

This MCP server can be installed in both Claude Desktop and Cline VSCode extension. Here's how to add it to your environment:

### Manual Installation

1. Clone this repository to your local machine:
   ```bash
   git clone https://github.com/your-username/protonmail-mcp.git
   cd protonmail-mcp
   ```

2. Install dependencies and build the project:
   ```bash
   npm install
   npm run build
   ```

3. Add the server configuration using either the Claude Code CLI/`~/.claude.json`, Claude Desktop config file, or the Cline settings file, depending on which client you are using (see Configuration section above).

### Using Cline to Install from GitHub

Cline can automatically clone and build MCP servers from GitHub repositories. To use this feature:

1. Provide Cline with the GitHub repository URL
2. Let Cline clone and build the server
3. Provide any necessary configuration information (like SMTP credentials)

For detailed instructions on installing MCP servers from GitHub using Cline, see the [Cline MCP Server Installation Documentation](https://docs.cline.bot/mcp-server-from-github).

## Resources

- [Protonmail SMTP Documentation](https://proton.me/support/smtp-submission) - Official guide for using Protonmail's SMTP service
- [Nodemailer Documentation](https://nodemailer.com/) - The email sending library used by this MCP server
- [Model Context Protocol Documentation](https://github.com/modelcontextprotocol/mcp) - Documentation for the MCP protocol
- [Claude Desktop App](https://claude.ai/download) - Download the Claude Desktop application
- [Cline VSCode Extension](https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev) - Install the Cline extension for VSCode
- [Cline MCP Documentation](https://docs.cline.bot/mcp-servers/mcp-quickstart) - Cline's documentation for MCP servers
- [Installing MCP Servers from GitHub](https://docs.cline.bot/mcp-server-from-github) - Guide for installing MCP servers from GitHub repositories

### Finding More MCP Servers

You can find additional MCP servers in these repositories and directories:

- [Official MCP Servers Repository](https://github.com/modelcontextprotocol/servers) - Collection of official MCP servers
- [Awesome-MCP Servers Repository](https://github.com/punkpeye/awesome-mcp-servers) - Community-curated list of MCP servers
- [mcpservers.org](https://mcpservers.org/) - Online directory of MCP servers
- [mcp.so](https://mcp.so/) - Another directory for discovering MCP servers

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
