import { IS_DEBUG } from '../../conf.js'
import type { PositionInfo } from '../../sdk/IBotSDK.js'
import { RpsAI } from '../RpsAI.js'
import type { GamePosition, Move, Round } from '../types.js'

type MoveChar = 'r' | 'p' | 's'

const MOVES: MoveChar[] = ['r', 'p', 's']

const COUNTER: Record<MoveChar, MoveChar> = {
  r: 'p',
  p: 's',
  s: 'r',
}

const LOSE_TO: Record<MoveChar, MoveChar> = {
  r: 's',
  p: 'r',
  s: 'p',
}

type PlayerStats = {
  lastUpdate: number

  total: Record<MoveChar, number>

  transitions: Record<string, Record<MoveChar, number>>

  transitions2: Record<string, Record<MoveChar, number>>
}

export default class SmartRpsAI extends RpsAI {
  private greetingSent = new Set<number>()

  private memory = new Map<string, PlayerStats>()

  private TTL = 1000 * 60 * 60 * 48

  override async init(botLogin: string) {
    await super.init(botLogin)

    setInterval(() => this.cleanup(), 1000 * 60 * 30)
  }

  private cleanup() {
    const now = Date.now()

    for (const [k, v] of this.memory) {
      if (now - v.lastUpdate > this.TTL) {
        this.memory.delete(k)
      }
    }
  }

  private getEnemy(pos: PositionInfo<GamePosition>) {
    return pos.players.find((p) => p && p.login !== this.botLogin)
  }

  private getStats(login: string): PlayerStats {
    let s = this.memory.get(login)

    if (!s) {
      s = {
        lastUpdate: Date.now(),

        total: { r: 0, p: 0, s: 0 },

        transitions: {},

        transitions2: {},
      }

      this.memory.set(login, s)
    }

    return s
  }

  private updateStats(login: string, rounds: Round[]) {
    const stats = this.getStats(login)

    stats.lastUpdate = Date.now()

    const enemyMoves: MoveChar[] = []

    for (const r of rounds) {
      const m = r[0]

      const e = r[1]

      if (e && e !== 'h') {
        enemyMoves.push(e as MoveChar)
      }
    }

    if (enemyMoves.length === 0) return

    const last = enemyMoves[enemyMoves.length - 1]
    if (!last) return

    stats.total[last]++

    if (enemyMoves.length >= 2) {
      const k = enemyMoves[enemyMoves.length - 2]
      if (!k) return

      const map = (stats.transitions[k] ||= { r: 0, p: 0, s: 0 })

      map[last]++
    }

    if (enemyMoves.length >= 3) {
      const k = enemyMoves.slice(-3, -1).join('')

      const map = (stats.transitions2[k] ||= { r: 0, p: 0, s: 0 })

      map[last!]++
    }
  }

  private normalize(counts: Record<MoveChar, number>) {
    const s = counts.r + counts.p + counts.s

    if (s === 0) return { r: 1 / 3, p: 1 / 3, s: 1 / 3 }

    return {
      r: counts.r / s,

      p: counts.p / s,

      s: counts.s / s,
    }
  }

  private merge(
    a: Record<MoveChar, number>,
    b: Record<MoveChar, number>,
    w: number,
  ) {
    a.r += b.r * w

    a.p += b.p * w

    a.s += b.s * w
  }

  private predict(login: string, rounds: Round[]) {
    const stats = this.getStats(login)

    const prob = { r: 0, p: 0, s: 0 }

    const debug: any = {}

    const freq = this.normalize(stats.total)

    this.merge(prob, freq, 1)

    debug.freq = freq

    const enemyMoves: MoveChar[] = []

    for (const r of rounds) {
      const e = r[1]

      if (e && e !== 'h') enemyMoves.push(e as MoveChar)
    }

    if (enemyMoves.length >= 1) {
      const last = enemyMoves[enemyMoves.length - 1]
      if (!last) return

      const t = stats.transitions[last]
      if (!t) return

      if (t) {
        const p = this.normalize(t)

        this.merge(prob, p, 2)

        debug.markov1 = p
      }

      const repeat: { r: number; p: number; s: number } = { r: 0, p: 0, s: 0 }

      repeat[last] += 1

      this.merge(prob, repeat, 0.6)

      debug.repeat = repeat

      const counter: { r: number; p: number; s: number } = { r: 0, p: 0, s: 0 }

      counter[COUNTER[last]] += 1

      this.merge(prob, counter, 0.7)

      debug.counter = counter
    }

    if (enemyMoves.length >= 2) {
      const k = enemyMoves.slice(-2).join('')

      const t = stats.transitions2[k]

      if (t) {
        const p = this.normalize(t)

        this.merge(prob, p, 3)

        debug.markov2 = p
      }
    }

    const sum = prob.r + prob.p + prob.s

    prob.r /= sum

    prob.p /= sum

    prob.s /= sum

    debug.final = prob

    return { prob, debug }
  }

  private bestResponse(prob: Record<MoveChar, number>): MoveChar {
    let best = 'r'

    let bestScore = -Infinity

    for (const m of MOVES) {
      const win = prob[LOSE_TO[m]]

      const lose = prob[COUNTER[m]]

      const score = win - lose

      if (score > bestScore) {
        bestScore = score

        best = m
      }
    }

    return best as MoveChar
  }

  private sendGreeting(pos: PositionInfo<GamePosition>) {
    if (!this.greetingSent.has(pos.tableId)) {
      this.greetingSent.add(pos.tableId)

      const enemy = this.getEnemy(pos)

      setTimeout(() => {
        this.sdk.message(pos.tableId, `Hello ${enemy?.login}! Let's play.`)
      }, 0)
    }
  }

  override async getBestMove(pos: PositionInfo<GamePosition>): Promise<Move> {
    this.sendGreeting(pos)

    const enemy = this.getEnemy(pos)

    if (!enemy) {
      return MOVES[Math.floor(Math.random() * 3)] as Move
    }

    const rounds = pos.position.rounds

    this.updateStats(enemy.login, rounds)

    const res = this.predict(enemy.login, rounds)
    if (!res) return MOVES[Math.floor(Math.random() * 3)] as Move

    const { prob, debug } = res

    const move = this.bestResponse(prob)

    if (IS_DEBUG) {
      console.log('----- RPS AI DEBUG -----')

      console.log('Enemy:', enemy.login)

      console.log('Rounds:', rounds)

      console.log('Prediction:', debug)

      console.log('Chosen move:', move)

      console.log('------------------------')
    }

    return move as Move
  }

  override onGameEnd(tableId: number) {
    this.greetingSent.delete(tableId)
  }
}
