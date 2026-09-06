// Survivor Board — COLLECTOR
// Vercel cron: every 15 minutes. Records every new Solana pool as it appears.
//
// WHY THIS EXISTS: no free API lets you ask "what launched yesterday?"
// retroactively. GeckoTerminal's new_pools endpoint is a rolling window of the
// most recent pools only. If you aren't recording continuously, yesterday is
// gone. This job is the memory.

import { createClient } from '@supabase/supabase-js'

const GT = 'https://api.geckoterminal.com/api/v2'
const NETWORK = 'solana'
const PAGES = 3 // ~60 pools per run; at 15-min cadence that covers normal flow

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type Pool = {
  attributes: {
    address: string
    name: string
    pool_created_at: string
    reserve_in_usd: string
    fdv_usd: string | null
  }
  relationships?: {
    base_token?: { data?: { id?: string } }
    dex?: { data?: { id?: string } }
  }
}

export async function GET(req: Request) {
  // Vercel cron sends this header; reject anything else so the endpoint
  // can't be spammed into rate-limit exhaustion.
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('unauthorized', { status: 401 })
  }

  const rows: any[] = []

  for (let page = 1; page <= PAGES; page++) {
    const res = await fetch(`${GT}/networks/${NETWORK}/new_pools?page=${page}`, {
      headers: { Accept: 'application/json;version=20230302' },
    })
    if (!res.ok) break
    const json = await res.json()
    const pools: Pool[] = json.data ?? []
    if (!pools.length) break

    for (const p of pools) {
      const a = p.attributes
      rows.push({
        pool_address: a.address,
        network: NETWORK,
        name: a.name,
        base_token_id: p.relationships?.base_token?.data?.id ?? null,
        dex: p.relationships?.dex?.data?.id ?? null,
        pool_created_at: a.pool_created_at,
        initial_liq_usd: Number(a.reserve_in_usd ?? 0),
        initial_fdv_usd: a.fdv_usd ? Number(a.fdv_usd) : null,
      })
    }

    await new Promise(r => setTimeout(r, 2200)) // stay under 30 req/min
  }

  // ignoreDuplicates keeps the FIRST snapshot we ever took of a pool, which is
  // the whole point — initial liquidity must be the launch value, not a later one.
  const { error } = await supabase
    .from('launches')
    .upsert(rows, { onConflict: 'pool_address', ignoreDuplicates: true })

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
  return Response.json({ ok: true, seen: rows.length })
}
