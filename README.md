<p align="center"><a href="https://discord.com/invite/dsvFgDTr6c"><img height="60px" src="https://user-images.githubusercontent.com/31022056/158916278-4504b838-7ecb-4ab9-a900-7dc002aade78.png" alt="Join our Discord!"></a></p>

# Meeting BaaS MCP Server

This is the main MCP (Model Context Protocol) server powering [chat.meetingbaas.com](https://chat.meetingbaas.com), providing the LLM integration and AI capabilities for the Meeting BaaS chat interface. It's a fork of the [Vercel MCP template](https://github.com/vercel-labs/mcp-on-vercel) with Meeting BaaS-specific modifications.

The server exposes a single **Streamable HTTP** endpoint at `/mcp`. No Redis or SSE transport required.

## Quick Start

```bash
# Install dependencies
pnpm install

# Create .env
cat > .env <<EOF
NODE_ENV=production
PORT=3011
BAAS_URL=meetingbaas.com
EOF

# Build and run
pnpm local:build
pnpm local:start
```

The server is now listening on `http://localhost:3011/mcp`.

## Connect from Claude Code

```bash
claude mcp add meeting-baas \
  --transport http \
  http://localhost:3011/mcp \
  --header "x-api-version: v2" \
  --header "x-meeting-baas-api-key: YOUR_API_KEY"
```

Or add it manually to `~/.claude.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "meeting-baas": {
      "type": "http",
      "url": "http://localhost:3011/mcp",
      "headers": {
        "x-api-version": "v2",
        "x-meeting-baas-api-key": "YOUR_API_KEY"
      }
    }
  }
}
```

Restart Claude Code and the Meeting BaaS tools will appear.

## Features

- Integration with [Meeting BaaS SDK](https://www.npmjs.com/package/@meeting-baas/sdk) for video meeting management
- Calendar integration for automated meeting recordings
- Real-time transcription and audio streaming capabilities
- Comprehensive bot management tools

## SDK Integration

This project uses the official Meeting BaaS SDK (`@meeting-baas/sdk`) which provides:

- Complete type safety with comprehensive TypeScript definitions
- Automatic updates synced with OpenAPI specification
- Simplified access to all meeting automation capabilities
- Cross-platform consistency for all supported meeting providers (Google Meet, Zoom, Microsoft Teams)
- Pre-generated MPC tools for easy integration with AI systems
- Strongly typed functions for interacting with the complete Meeting BaaS API

## Environment Variables

Optional environment variables:

- `NODE_ENV`: Set to `"development"` to enable development mode.
- `PORT`: Port the server listens on (default: `3000`).
- `BAAS_URL`: Base domain for the Meeting BaaS API (default: `meetingbaas.com`).
- `BAAS_API_KEY`: Meeting BaaS API key (development mode only).

## Authentication

The server supports multiple ways to provide the Meeting BaaS API key:

1. Request headers (in order of precedence):
   - `x-meeting-baas-api-key`
   - `x-meetingbaas-apikey`
   - `x-api-key`
   - `Authorization` (as a Bearer token)

2. Environment variable (development mode only):

   ```bash
   BAAS_API_KEY=your-api-key
   ```

Note: In production, the API key should be provided through request headers. The environment variable is only used in development mode for testing purposes.

## API Version

Set the `x-api-version` header to `v1` or `v2` to choose the API version. Default is `v1`. The v2 API provides additional bot management, scheduled bots, and calendar connection tools.

## Meeting BaaS Integration

This fork includes several Meeting BaaS-specific tools:

### Meeting Management

- Join meetings with AI bots
- Record meetings with transcription
- Leave meetings and clean up resources

### Calendar Management

- Create and manage calendar integrations
- Schedule automated recordings
- List and manage calendar events
- Update calendar configurations

### Bot Management

- List and monitor active bots
- Get detailed bot metadata
- Manage bot configurations

## Contributing

This is a fork of the Vercel MCP template. For the original template, please visit [vercel-labs/mcp-on-vercel](https://github.com/vercel-labs/mcp-on-vercel).

## Documentation

For more information about the Meeting BaaS SDK, visit:

- [SDK Documentation](https://docs.meetingbaas.com/com/docs/typescript-sdk)
- [npm Package](https://www.npmjs.com/package/@meeting-baas/sdk)
- [GitHub Repository](https://github.com/Meeting-Baas/sdk)
