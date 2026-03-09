import { IS_DEBUG } from '../../conf.ts'
import type { PositionInfo } from '../../sdk/IBotSDK.ts'
import { RpsAI } from '../RpsAI.js'
import type { GamePosition, Move } from '../types.ts'

const MOVES: Move[] = ['r', 'p', 's']

const BEAT: Record<Move, Move> = {
  r: 'p',
  p: 's',
  s: 'r',
  h: 'r',
}

const TTL = 1000 * 60 * 60 * 48

type Predictor =
  | 'freq'
  | 'markov1'
  | 'markov2'
  | 'pattern'
  | 'antiLose'
  | 'antiWin'
  | 'mirror'
  | 'bias'

type Meta = 0 | 1 | 2

type PredictorState = {
  lastPred: Move | null
  score: number
}

type PlayerStats = {
  updated: number

  history: Move[]
  myHistory: Move[]

  processedRounds: number

  moveCount: Record<Move, number>

  trans1: Record<Move, Record<Move, number>>
  trans2: Record<string, Record<Move, number>>

  predictors: Map<string, PredictorState>
}

export default class MonsterRpsAI extends RpsAI {
  private players = new Map<string, PlayerStats>()

  override async init(botLogin: string) {
    super.init(botLogin)

    setInterval(
      () => {
        const now = Date.now()

        for (const [login, stat] of this.players) {
          if (now - stat.updated > TTL) {
            this.players.delete(login)
          }
        }

        if (IS_DEBUG) console.log('[RPS-AI] cleanup')
      },
      1000 * 60 * 10,
    )
  }

  private debug(...a: any[]) {
    if (IS_DEBUG) console.log('[RPS-AI]', ...a)
  }

  private getPlayer(login: string): PlayerStats {
    let p = this.players.get(login)

    if (!p) {
      p = {
        updated: Date.now(),

        history: [],
        myHistory: [],

        processedRounds: 0,

        moveCount: { r: 0, p: 0, s: 0, h: 0 },

        trans1: {
          r: { r: 0, p: 0, s: 0, h: 0 },
          p: { r: 0, p: 0, s: 0, h: 0 },
          s: { r: 0, p: 0, s: 0, h: 0 },
          h: { r: 0, p: 0, s: 0, h: 0 },
        },

        trans2: {},

        predictors: new Map(),
      }

      this.players.set(login, p)
    }

    return p
  }

  private key(p: Predictor, meta: Meta) {
    return `${p}:${meta}`
  }

  private getPredictor(
    p: PlayerStats,
    name: Predictor,
    meta: Meta,
  ): PredictorState {
    const k = this.key(name, meta)

    if (!p.predictors.has(k)) {
      p.predictors.set(k, { lastPred: null, score: 0 })
    }

    return p.predictors.get(k)!
  }

  private record(p: PlayerStats, enemy: Move, mine: Move) {
    const last = p.history[p.history.length - 1]
    const last2 = p.history[p.history.length - 2]

    p.moveCount[enemy]++

    if (last) p.trans1[last][enemy]++

    if (last && last2) {
      const k = last2 + last

      if (!p.trans2[k]) {
        p.trans2[k] = { r: 0, p: 0, s: 0, h: 0 }
      }

      p.trans2[k][enemy]++
    }

    p.history.push(enemy)
    p.myHistory.push(mine)

    if (p.history.length > 200) p.history.shift()
    if (p.myHistory.length > 200) p.myHistory.shift()

    p.updated = Date.now()
  }

  private predictFrequency(p: PlayerStats): Move | null {
    const { r, p: pa, s } = p.moveCount

    const max = Math.max(r, pa, s)

    if (max === 0) return null

    if (max === r) return 'r'
    if (max === pa) return 'p'
    return 's'
  }

  private predictMarkov1(p: PlayerStats): Move | null {
    const last = p.history.at(-1)

    if (!last) return null

    const t = p.trans1[last]

    const max = Math.max(t.r, t.p, t.s)

    if (max === 0) return null

    if (max === t.r) return 'r'
    if (max === t.p) return 'p'
    return 's'
  }

  private predictMarkov2(p: PlayerStats): Move | null {
    if (p.history.length < 2) return null

    const last = p.history.at(-1)!
    const prev = p.history.at(-2)!

    const key = prev + last
    const t = p.trans2[key]

    if (!t) return null

    const max = Math.max(t.r, t.p, t.s)

    if (max === 0) return null

    if (max === t.r) return 'r'
    if (max === t.p) return 'p'
    return 's'
  }

  private predictPattern(p: PlayerStats): Move | null {
    const h = p.history

    if (h.length < 6) return null

    const a = h.slice(-3).join('')
    const b = h.slice(-6, -3).join('')

    if (a === b) return h.at(-3) ?? null

    return null
  }

  private predictAntiLose(p: PlayerStats): Move | null {
    const my = p.myHistory.at(-1)
    const en = p.history.at(-1)

    if (!my || !en) return null

    if (BEAT[en] === my) return BEAT[en]

    return null
  }

  private predictAntiWin(p: PlayerStats): Move | null {
    const my = p.myHistory.at(-1)
    const en = p.history.at(-1)

    if (!my || !en) return null

    if (BEAT[my] === en) return en

    return null
  }

  private predictMirror(p: PlayerStats): Move | null {
    return p.myHistory.at(-1) ?? null
  }

  private predictBias(): Move {
    const x = Math.random()

    if (x < 0.36) return 'r'
    if (x < 0.69) return 'p'
    return 's'
  }

  private applyMeta(pred: Move, meta: Meta): Move {
    if (meta === 0) return pred
    if (meta === 1) return BEAT[pred]
    return BEAT[BEAT[pred]]
  }

  override async getBestMove(pos: PositionInfo<GamePosition>): Promise<Move> {
    const myIndex = pos.botIndex

    if (myIndex === undefined || myIndex === null) return 'r'

    const enemyIndex = myIndex === 0 ? 1 : 0

    const enemy = pos.players[enemyIndex]

    if (!enemy) return 'r'

    const p = this.getPlayer(enemy.login)

    this.debug('rounds', pos.position.rounds.length)

    for (let i = p.processedRounds; i < pos.position.rounds.length; i++) {
      const r = pos.position.rounds[i]
      if (!r) continue

      const mine = r[myIndex]
      const en = r[enemyIndex]

      if (mine && en && mine !== 'h' && en !== 'h') {
        this.record(p, en, mine)
      }
    }

    p.processedRounds = pos.position.rounds.length

    const predictions: Record<Predictor, Move | null> = {
      freq: this.predictFrequency(p),
      markov1: this.predictMarkov1(p),
      markov2: this.predictMarkov2(p),
      pattern: this.predictPattern(p),
      antiLose: this.predictAntiLose(p),
      antiWin: this.predictAntiWin(p),
      mirror: this.predictMirror(p),
      bias: this.predictBias(),
    }

    this.debug('predictions', predictions)

    const votes: Record<Move, number> = { r: 0, p: 0, s: 0, h: 0 }

    for (const name in predictions) {
      const pred = predictions[name as Predictor]

      if (!pred) continue

      for (const meta of [0, 1, 2] as Meta[]) {
        const st = this.getPredictor(p, name as Predictor, meta)

        const move = this.applyMeta(pred, meta)

        votes[BEAT[move]] += 1 + st.score * 0.1

        st.lastPred = move
      }
    }

    this.debug('votes', votes)

    let best: Move[] = []
    let max = -Infinity

    for (const m of MOVES) {
      if (votes[m] > max) {
        max = votes[m]
        best = [m]
      } else if (votes[m] === max) {
        best.push(m)
      }
    }

    const move = best[Math.floor(Math.random() * best.length)]

    this.debug('selected', move)

    return move ?? 'r'
  }

  override onGameEnd(): void {}
}
