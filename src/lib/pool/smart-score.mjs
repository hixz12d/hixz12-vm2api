/**
 * Smart scheduling score for NEW sessions (strategy: 'smart').
 *
 * Bound sessions never consult this module; the sticky path wins first.
 *
 *   value  = weekly urgency × 5h headroom × 5h reset bonus
 *   choose = argmin (active sessions + 1) / value   (weighted least-sessions)
 *
 * weekly urgency: unused 7d share that must be spent per hour before it resets.
 * 5h headroom:    1 below the soft line, then linear down to a floor at the
 *                 hard safety line. Fades out during the last hour before reset.
 * reset bonus:    unused 5h share that resets soon is worth a little more.
 */

import { headerWindowOrEmpty, officialWindow, parseResetMs, wipeElapsedHeaderWindows } from './quota-window.mjs'
import { resolveTierKey, resolveTierPolicy } from './quota-tiers.mjs'

const HOUR_MS = 60 * 60 * 1000
const WEEK_HOURS = 7 * 24

export const DEFAULT_SMART_CONFIG = Object.freeze({
  /** 5h utilization where new-session preference starts to fall, per tier. */
  soft_5h: Object.freeze({ max: 0.65, pro: 0.5, default: 0.5 }),
  /** A session with a request inside this window counts as active load. */
  active_window_min: 5,
  /** No account may hold more than this share of active sessions while others can take one. */
  max_share: 0.8,
  /** The share cap applies once this many sessions (including the new one) are active. */
  share_min_sessions: 3,
  /** The share cap only spills onto accounts whose 5h headroom factor is at least this. */
  spill_min_headroom: 0.25,
  /** Lowest 5h headroom factor just below the hard safety line. */
  headroom_floor: 0.05,
  /** Largest extra weight for unused 5h quota that resets soon (0.5 = up to ×1.5). */
  reset_bonus: 0.5,
  /** Lowest weekly urgency relative to the most urgent candidate. */
  weekly_floor: 0.05,
})

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n))
}

function ratio(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return clamp(n > 1.5 ? n / 100 : n, 0, 1)
}

function num(value, fallback, lo, hi) {
  const n = Number(value)
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback
}

export function normalizeSmartConfig(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const soft = src.soft_5h && typeof src.soft_5h === 'object' ? src.soft_5h : {}
  const base = DEFAULT_SMART_CONFIG
  return {
    soft_5h: {
      max: num(soft.max, base.soft_5h.max, 0, 1),
      pro: num(soft.pro, base.soft_5h.pro, 0, 1),
      default: num(soft.default, base.soft_5h.default, 0, 1),
    },
    active_window_min: num(src.active_window_min, base.active_window_min, 1, 120),
    max_share: num(src.max_share, base.max_share, 0.5, 1),
    share_min_sessions: Math.round(num(src.share_min_sessions, base.share_min_sessions, 2, 1000)),
    spill_min_headroom: num(src.spill_min_headroom, base.spill_min_headroom, 0, 1),
    headroom_floor: num(src.headroom_floor, base.headroom_floor, 0.01, 1),
    reset_bonus: num(src.reset_bonus, base.reset_bonus, 0, 2),
    weekly_floor: num(src.weekly_floor, base.weekly_floor, 0, 1),
  }
}

/** Live header window first, official probe second. Elapsed windows read as empty. */
function windowOf(unified, key, now) {
  const header = headerWindowOrEmpty(unified, key, { now })
  if (header.utilization != null || header.reset != null) {
    return { utilization: ratio(header.utilization) ?? 0, resetMs: parseResetMs(header.reset), known: true }
  }
  const official = officialWindow(unified, key)
  const resetMs = parseResetMs(official.reset ?? official.resets_at)
  if (Number.isFinite(resetMs) && resetMs <= now) return { utilization: 0, resetMs: NaN, known: true }
  return { utilization: ratio(official.utilization) ?? 0, resetMs, known: Number.isFinite(resetMs) }
}

export function quotaViewOf(account = {}, now = Date.now()) {
  const unified = account?.unified || {}
  const wiped = { ...unified, headers: wipeElapsedHeaderWindows(unified, { now }).headers || unified.headers }
  return { w5: windowOf(wiped, '5h', now), w7: windowOf(wiped, '7d', now) }
}

/**
 * Raw per-account factors. `weekly` is un-normalized (share per hour);
 * normalizeScores() rescales it across the candidate set.
 */
export function scoreFactors({ account = null, tier = null, policy = null, config = {}, now = Date.now() } = {}) {
  const cfg = normalizeSmartConfig(config)
  const tierKey = resolveTierKey(account?.unified?.account_tier || account?.account_tier || tier)
  const effective = policy || resolveTierPolicy({}, tierKey)
  const hard = ratio(effective?.limit_5h ?? effective?.safety_ratio) ?? 0.85
  const soft = Math.min(cfg.soft_5h[tierKey] ?? cfg.soft_5h.default, hard)
  const { w5, w7 } = quotaViewOf(account, now)

  const remaining7 = 1 - w7.utilization
  const hours7 = Number.isFinite(w7.resetMs) && w7.resetMs > now ? (w7.resetMs - now) / HOUR_MS : WEEK_HOURS
  const weekly = Math.max(remaining7, 0.01) / Math.max(hours7, 1)

  const hours5 = Number.isFinite(w5.resetMs) && w5.resetMs > now ? (w5.resetMs - now) / HOUR_MS : null
  // In the last hour the current 5h usage matters less: a session opened now lives into the next window.
  const fade = hours5 == null ? 1 : clamp(hours5, 0, 1)
  const u5 = w5.utilization * fade
  let headroom = 1
  if (u5 > soft) {
    const span = Math.max(hard - soft, 0.01)
    headroom = clamp(1 - (1 - cfg.headroom_floor) * ((u5 - soft) / span), cfg.headroom_floor, 1)
  }
  const bonus = hours5 == null ? 1 : 1 + cfg.reset_bonus * (1 - u5) * clamp(1 - hours5 / 5, 0, 1)

  return {
    tier: tierKey,
    u5: w5.utilization,
    u7: w7.utilization,
    hours5,
    hours7,
    soft5: soft,
    hard5: hard,
    weekly,
    weeklyKnown: w7.known,
    headroom,
    bonus,
  }
}

/** Scale weekly urgency to 0..1 across candidates and combine factors into a single value. */
export function normalizeScores(factorsList = [], config = {}) {
  const cfg = normalizeSmartConfig(config)
  const top = Math.max(0, ...factorsList.filter((f) => f?.weeklyKnown).map((f) => f.weekly || 0))
  return factorsList.map((f) => {
    // No 7d data yet (fresh import): neutral middle, neither starved nor flooded.
    const weeklyNorm = !f.weeklyKnown ? 0.5 : top > 0 ? Math.max(f.weekly / top, cfg.weekly_floor) : 1
    return { ...f, weeklyNorm, value: weeklyNorm * f.headroom * f.bonus }
  })
}

/**
 * Weighted least-sessions with a share cap.
 * items: [{ key, value, sessions }] → selected item.
 */
export function chooseByScore(items = [], config = {}) {
  const cfg = normalizeSmartConfig(config)
  if (!items.length) return null
  const total = items.reduce((sum, item) => sum + Math.max(0, item.sessions || 0), 0)
  let pool = items
  if (items.length > 1 && total + 1 >= cfg.share_min_sessions) {
    // Spill only onto accounts that still have 5h room; a session parked near
    // the hard line would be forced off again and lose its cache anyway.
    const capped = items.filter(
      (item) =>
        (Math.max(0, item.sessions || 0) + 1) / (total + 1) <= cfg.max_share &&
        (item.factors?.headroom ?? 1) >= cfg.spill_min_headroom,
    )
    if (capped.length) pool = capped
  }
  let best = null
  let bestCost = Infinity
  for (const item of pool) {
    const cost = (Math.max(0, item.sessions || 0) + 1) / Math.max(item.value, 1e-6)
    if (
      cost < bestCost - 1e-12 ||
      (Math.abs(cost - bestCost) <= 1e-12 && best && String(item.key).localeCompare(String(best.key)) < 0)
    ) {
      best = item
      bestCost = cost
    }
  }
  return best
}

export function formatSmartReason(item) {
  if (!item) return 'smart'
  const f = item.factors || {}
  const pct = (x) => (x == null ? '-' : `${Math.round(x * 100)}`)
  const hrs = (x) => (x == null ? '-' : `${Math.round(x * 10) / 10}h`)
  return (
    `smart v=${(item.value ?? 0).toFixed(3)} n=${item.sessions ?? 0}` +
    ` 5h=${pct(f.u5)}%@${hrs(f.hours5)} 7d=${pct(f.u7)}%@${hrs(f.hours7)}`
  )
}
