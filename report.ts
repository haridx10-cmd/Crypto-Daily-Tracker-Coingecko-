// Survivor Board — REPORTER
// Vercel cron: daily 01:35 UTC (07:05 IST). Checks which of yesterday's
// launches are still alive, computes the stats, drafts the post.
//
// The draft deliberately ends with a [YOUR READ] placeholder. Do not remove it.
// X's Original Content Rewards rules exclude "aggregated compilations lacking
// substantial perspective" — the human sentence is what makes this original
// content rather than a bot feed.

import { createClient } from '@supabase/supabase-js'

const GT = 'https://api.geckoterminal.com/api/v2'
const NETWORK = 'solana'

// The survival bar. Publish this definition in your bio or a pinned reply —
// a number nobody can audit is worth nothing, and someone WILL ask.
const MIN_LIQ_USD = 5_000
const MIN_VOL_24H = 1_000

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const usd = (n: number) =>
  n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('unauthorized', { status: 401 })
  }

  const now = Date.now()
  const from = new Date(now - 48 * 3600_000).toISOString()
  const to = new Date(now - 24 * 3600_000).toISOString()

  // Yesterday's cohort: created 24-48h ago, not yet survival-checked.
  const { data: cohort, error } = await supabase
    .from('launches')
    .select('pool_address, initial_liq_usd')
    .gte('pool_created_at', from)
    .lt('pool_created_at', to)
    .is('checked_at', null)

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
  if (!cohort?.length) return Response.json({ ok: true, note: 'empty cohort — collector may not have been running 48h yet' })

  // Batch survival check, 30 addresses per call (GeckoTerminal's multi limit).
  const alive = new Map<string, { liq: number; vol: number; txns: number }>()
  for (let i = 0; i < cohort.length; i += 30) {
    const batch = cohort.slice(i, i + 30).map(r => r.pool_address)
    const res = await fetch(
      `${GT}/networks/${NETWORK}/pools/multi/${batch.join(',')}`,
      { headers: { Accept: 'application/json;version=20230302' } }
    )
    if (res.ok) {
      const json = await res.json()
      for (const p of json.data ?? []) {
        const a = p.attributes
        alive.set(a.address, {
          liq: Number(a.reserve_in_usd ?? 0),
          vol: Number(a.volume_usd?.h24 ?? 0),
          txns: Number(a.transactions?.h24?.buys ?? 0) + Number(a.transactions?.h24?.sells ?? 0),
        })
      }
    }
    await new Promise(r => setTimeout(r, 2200))
  }

  // Score the cohort.
  const checkedAt = new Date().toISOString()
  const updates = cohort.map(row => {
    const m = alive.get(row.pool_address)
    const survived = !!m && m.liq >= MIN_LIQ_USD && m.vol >= MIN_VOL_24H
    return {
      pool_address: row.pool_address,
      checked_at: checkedAt,
      liq_usd_24h: m?.liq ?? 0,
      vol_usd_24h: m?.vol ?? 0,
      txns_24h: m?.txns ?? 0,
      survived,
    }
  })
  await supabase.from('launches').upsert(updates, { onConflict: 'pool_address' })

  const launched = cohort.length
  const survivors = updates.filter(u => u.survived)
  const survived = survivors.length
  const rate = (survived / launched) * 100

  const liqOf = (addr: string) =>
    Number(cohort.find(c => c.pool_address === addr)?.initial_liq_usd ?? 0)
  const medAlive = median(survivors.map(s => liqOf(s.pool_address)))
  const medDead = median(
    updates.filter(u => !u.survived).map(u => liqOf(u.pool_address))
  )

  // Survival rate by opening-liquidity bucket — this is the line that makes
  // the post useful rather than just grim.
  const buckets: [string, number, number][] = [
    ['under $5k', 0, 5_000],
    ['$5-20k', 5_000, 20_000],
    ['$20-50k', 20_000, 50_000],
    ['over $50k', 50_000, Infinity],
  ]
  let best = { label: '—', rate: -1, n: 0 }
  for (const [label, lo, hi] of buckets) {
    const inB = updates.filter(u => {
      const l = liqOf(u.pool_address)
      return l >= lo && l < hi
    })
    if (inB.length < 10) continue // don't report a rate off a tiny sample
    const r = (inB.filter(u => u.survived).length / inB.length) * 100
    if (r > best.rate) best = { label, rate: r, n: inB.length }
  }

  const draft = [
    `yesterday: ${launched.toLocaleString()} launched on solana.`,
    `${survived} still alive this morning.`,
    ``,
    `${rate.toFixed(1)}% survival.`,
    ``,
    `the ones that lived opened with a median ${usd(medAlive)} in liquidity.`,
    `the ones that didn't opened with ${usd(medDead)}.`,
    best.n
      ? `\nbest odds were in the ${best.label} band — ${best.rate.toFixed(1)}% of ${best.n} made it.`
      : ``,
    ``,
    `[YOUR READ — one sentence. delete this line and write it.]`,
    ``,
    `alive = still holding ${usd(MIN_LIQ_USD)} liquidity and ${usd(MIN_VOL_24H)} of 24h volume.`,
  ].filter(Boolean).join('\n')

  await supabase.from('boards').upsert({
    board_date: new Date().toISOString().slice(0, 10),
    launched,
    survived,
    survival_rate: Number(rate.toFixed(2)),
    median_liq_alive: medAlive,
    median_liq_dead: medDead,
    best_bucket: best.n ? best.label : null,
    draft_post: draft,
  })

  return Response.json({ ok: true, launched, survived, rate: rate.toFixed(1), draft })
}
