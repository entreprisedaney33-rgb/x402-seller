# x402-seller-mcp

An [MCP](https://modelcontextprotocol.io) server that turns every paid endpoint of
[x402-seller](https://x402-seller-0ay3.onrender.com) — crypto prices, DeFi data,
on-chain reads, web reading, Claude-powered text tasks — into a tool your agent
(Claude Desktop, Cursor, or any MCP client) can call.

Tools are generated **at startup** from the server's own
[`/.well-known/x402.json`](https://x402-seller-0ay3.onrender.com/.well-known/x402.json)
discovery document — not hand-listed — so the tool list always matches what's actually
live on the origin.

## Two modes

- **No wallet configured (default)** — calling a tool fetches the endpoint, gets back
  the real `402 Payment Required` challenge, and returns a plain-language explanation
  (price, network, how to enable payment) instead of the actual data. Safe to try with
  zero setup.
- **Wallet configured** (`BUYER_PRIVATE_KEY` set) — calls are paid automatically over
  x402 (via [`@x402/fetch`](https://www.npmjs.com/package/@x402/fetch)) and return the
  real result plus the settlement receipt (payer address, transaction hash).

## Install

```bash
npx x402-seller-mcp
```

That's the whole install — nothing to clone, build, or configure to try it in
explain-only mode.

## Claude Desktop

Add this to your `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "x402-seller": {
      "command": "npx",
      "args": ["-y", "x402-seller-mcp"]
    }
  }
}
```

To enable automatic payments, add an `env` block (see **Enabling payments** below):

```json
{
  "mcpServers": {
    "x402-seller": {
      "command": "npx",
      "args": ["-y", "x402-seller-mcp"],
      "env": {
        "BUYER_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

Restart Claude Desktop after editing the config.

## Cursor

Cursor uses the same `mcpServers` shape — add the same block to `~/.cursor/mcp.json`
(or your project's `.cursor/mcp.json`), then reload the MCP servers from
Settings → MCP.

## Enabling payments

⚠️ **Use a throwaway wallet, never a wallet holding significant funds.** The private
key you set here can sign USDC transfers on Base up to whatever price each tool call
costs (all endpoints on this server are priced at $0.005–$0.02 per call) — but any
process with the key in its environment can, in principle, use it. Generate a fresh
wallet dedicated to this MCP server and fund it with a few dollars of USDC on Base,
nothing more.

1. Generate a wallet (any EVM wallet works — e.g. with [viem](https://viem.sh):
   `node -e "const {generatePrivateKey,privateKeyToAccount}=require('viem/accounts');const k=generatePrivateKey();console.log(k, privateKeyToAccount(k).address)"`,
   or MetaMask/any wallet app export).
2. Send a small amount of USDC on **Base** (the network this server settles on) to that
   wallet's address — a few dollars covers hundreds of calls at these prices.
3. Set `BUYER_PRIVATE_KEY` to that wallet's private key (the `0x...`-prefixed hex
   string) in your MCP client's config (see examples above) or in your shell
   environment if running the server directly.
4. Restart the MCP server (or your MCP client). Tool calls will now pay automatically
   and return real results.

## Configuration

| Env var | Required | Default | Purpose |
|---|---|---|---|
| `BUYER_PRIVATE_KEY` | No | _(unset)_ | EVM private key used to pay for tool calls. Unset = explain-only mode. |
| `X402_ORIGIN` | No | `https://x402-seller-0ay3.onrender.com` | Which x402 server to expose as tools — point this at a different x402-compatible server (or a local dev instance) if needed. |

## Tools

One tool per paid resource in the origin's discovery document, named
`<method>_<path>` (e.g. `get_api_gas_base`, `post_api_web_read`). Run the server and
call `tools/list`, or browse
[`/.well-known/x402.json`](https://x402-seller-0ay3.onrender.com/.well-known/x402.json)
directly, for the current full list and per-tool input schemas — deliberately not
duplicated here, since it would drift from the live origin.

## Related

For a general-purpose agent that just wants a small set of everyday tools
(fact verification, market data, gas price, quick AI tasks) instead of one
tool per endpoint, see
[`@dm2233/agent-data-mcp`](https://www.npmjs.com/package/@dm2233/agent-data-mcp)
(npm) — it wraps this same 33-endpoint catalog as 5 grouped tools.

## Development

```bash
git clone https://github.com/entreprisedaney33-rgb/x402-seller.git
cd x402-seller/mcp
npm install
node server.js          # runs on stdio, waits for a client
```

`test/manual-test.mjs` is a standalone harness that spawns the server exactly like an
MCP client would (via `StdioClientTransport`) and drives it with the official
`Client` class — `listTools()`, then `callTool()` in both modes. Run it directly with
`node test/manual-test.mjs` after `npm install` (it reads `BUYER_PRIVATE_KEY` from the
parent repo's `.env` if present, to exercise the paid path too).

## License

MIT
