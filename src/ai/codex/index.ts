import { IS_DEBUG } from '../../conf.js'
import type { PositionInfo } from '../../sdk/IBotSDK.js'
import { RpsAI } from '../RpsAI.js'
import { Move, type GamePosition, type Round } from '../types.js'

const STATS_TTL_MS = 2 * 24 * 60 * 60 * 1000 // 2 days
const PERFORMANCE_WINDOW = 16
const MAX_PATTERN_CONTEXT = 6

type RealMove = Extract<Move, 'r' | 'p' | 's'>
const REAL_MOVES: RealMove[] = ['r', 'p', 's']
const BEATS: Record<RealMove, RealMove> = { r: 's', p: 'r', s: 'p' }
const LOSES_TO: Record<RealMove, RealMove> = { r: 'p', p: 's', s: 'r' }

interface StrategyPrediction {
  name: string
  probabilities: Record<RealMove, number>
  confidence: number
}

interface StrategyPerformance {
  correct: number
  total: number
  recentCorrect: number[]
}

interface PlayerProfile {
  enemyHistory: RealMove[]
  myHistory: RealMove[]
  outcomes: ('win' | 'loss' | 'draw')[]
  markovChains: Map<number, Map<string, Map<RealMove, number>>>
  patternMemory: Map<string, Map<RealMove, number>>
  transitions: Map<RealMove, Map<RealMove, number>>
  afterOutcome: Record<'win' | 'loss' | 'draw', Map<RealMove, number>>
  strategyPerformance: Map<string, StrategyPerformance>
  lastPredictions: Map<string, RealMove>
  processedRounds: number
  lastUpdate: number
}

function normalizeProbs(probs: Record<RealMove, number>) {
  const total = probs.r + probs.p + probs.s
  if (total === 0) return { r: 1 / 3, p: 1 / 3, s: 1 / 3 }
  return {
    r: probs.r / total,
    p: probs.p / total,
    s: probs.s / total,
  }
}

function uniformProbs(): Record<RealMove, number> {
  return { r: 1 / 3, p: 1 / 3, s: 1 / 3 }
}

function maxProbMove(probs: Record<RealMove, number>): RealMove {
  if (probs.r >= probs.p && probs.r >= probs.s) return 'r'
  if (probs.p >= probs.s) return 'p'
  return 's'
}

function randomRealMove(): RealMove {
  const index = Math.floor(Math.random() * REAL_MOVES.length)
  return REAL_MOVES[index]!
}

function getOutcome(
  myMove: RealMove,
  enemyMove: RealMove,
): 'win' | 'loss' | 'draw' {
  if (myMove === enemyMove) return 'draw'
  if (BEATS[myMove] === enemyMove) return 'win'
  return 'loss'
}

function getCounterMove(move: RealMove): RealMove {
  return LOSES_TO[move]
}

function log(message: string, ...args: unknown[]) {
  if (IS_DEBUG) {
    console.log('[codex]', message, ...args)
  }
}

class PredictionStrategies {
  static frequency(profile: PlayerProfile): StrategyPrediction {
    const counts: Record<RealMove, number> = { r: 1, p: 1, s: 1 }
    for (const move of profile.enemyHistory) {
      counts[move]++
    }
    return {
      name: 'frequency',
      probabilities: normalizeProbs(counts),
      confidence: Math.min(profile.enemyHistory.length / 12, 0.9),
    }
  }

  static markov(profile: PlayerProfile, order: number): StrategyPrediction {
    const name = `markov_${order}`
    if (profile.enemyHistory.length < order + 1) {
      return { name, probabilities: uniformProbs(), confidence: 0 }
    }

    const context = profile.enemyHistory.slice(-order).join('')
    const chain = profile.markovChains.get(order)
    const nextMap = chain?.get(context)

    if (!nextMap || nextMap.size === 0) {
      return { name, probabilities: uniformProbs(), confidence: 0 }
    }

    const base: Record<RealMove, number> = { r: 0.2, p: 0.2, s: 0.2 }
    let total = 0.6
    for (const [move, count] of nextMap) {
      base[move] += count
      total += count
    }

    return {
      name,
      probabilities: normalizeProbs(base),
      confidence: Math.min(total / 6, 0.95),
    }
  }

  static pattern(profile: PlayerProfile): StrategyPrediction {
    const name = 'pattern_memory'
    if (profile.enemyHistory.length < 3) {
      return { name, probabilities: uniformProbs(), confidence: 0 }
    }

    for (
      let len = Math.min(profile.enemyHistory.length, MAX_PATTERN_CONTEXT);
      len >= 1;
      len--
    ) {
      const context = profile.enemyHistory.slice(-len).join('')
      const nextMoves = profile.patternMemory.get(context)
      if (!nextMoves || nextMoves.size === 0) continue

      const probs: Record<RealMove, number> = { r: 0.1, p: 0.1, s: 0.1 }
      let total = 0.3
      for (const [move, count] of nextMoves) {
        probs[move] += count
        total += count
      }

      return {
        name,
        probabilities: normalizeProbs(probs),
        confidence: Math.min((total * len) / 8, 0.95),
      }
    }

    return { name, probabilities: uniformProbs(), confidence: 0 }
  }

  static transition(profile: PlayerProfile): StrategyPrediction {
    const name = 'transition'
    if (profile.enemyHistory.length === 0) {
      return { name, probabilities: uniformProbs(), confidence: 0 }
    }

    const last = profile.enemyHistory[profile.enemyHistory.length - 1]!
    const map = profile.transitions.get(last)
    if (!map || map.size === 0) {
      return { name, probabilities: uniformProbs(), confidence: 0 }
    }

    const probs: Record<RealMove, number> = { r: 0.1, p: 0.1, s: 0.1 }
    let total = 0.3
    for (const [move, count] of map) {
      probs[move] += count
      total += count
    }

    return {
      name,
      probabilities: normalizeProbs(probs),
      confidence: Math.min(total / 5, 0.85),
    }
  }

  static afterOutcome(profile: PlayerProfile): StrategyPrediction {
    const name = 'after_outcome'
    if (profile.outcomes.length === 0) {
      return { name, probabilities: uniformProbs(), confidence: 0 }
    }

    const lastOutcome = profile.outcomes[profile.outcomes.length - 1]!
    const enemyOutcome =
      lastOutcome === 'win' ? 'loss' : lastOutcome === 'loss' ? 'win' : 'draw'
    const map = profile.afterOutcome[enemyOutcome]
    if (!map || map.size === 0) {
      return { name, probabilities: uniformProbs(), confidence: 0 }
    }

    const probs: Record<RealMove, number> = { r: 0.1, p: 0.1, s: 0.1 }
    let total = 0.3
    for (const [move, count] of map) {
      probs[move] += count
      total += count
    }

    return {
      name,
      probabilities: normalizeProbs(probs),
      confidence: Math.min(total / 6, 0.9),
    }
  }

  static antiRepetition(profile: PlayerProfile): StrategyPrediction {
    const name = 'anti_repetition'
    if (profile.enemyHistory.length < 2) {
      return { name, probabilities: uniformProbs(), confidence: 0 }
    }

    const last = profile.enemyHistory[profile.enemyHistory.length - 1]!
    const secondLast = profile.enemyHistory[profile.enemyHistory.length - 2]!
    if (last === secondLast) {
      const probs: Record<RealMove, number> = { r: 1, p: 1, s: 1 }
      probs[last] = 0.4
      return {
        name,
        probabilities: normalizeProbs(probs),
        confidence: 0.55,
      }
    }

    return { name, probabilities: uniformProbs(), confidence: 0 }
  }

  static momentum(profile: PlayerProfile): StrategyPrediction {
    const name = 'momentum'
    if (profile.enemyHistory.length < 3) {
      return { name, probabilities: uniformProbs(), confidence: 0 }
    }

    const recent = profile.enemyHistory.slice(-3)
    const counts: Record<RealMove, number> = { r: 0, p: 0, s: 0 }
    for (const move of recent) {
      counts[move]++
    }
    const entries = REAL_MOVES.map((move) => [move, counts[move]] as const)
    entries.sort((a, b) => b[1] - a[1])
    if (entries.length < 2) {
      return { name, probabilities: uniformProbs(), confidence: 0 }
    }

    const dominant = entries[0]!
    const second = entries[1]!
    if (dominant[1] <= second[1]) {
      return { name, probabilities: uniformProbs(), confidence: 0 }
    }

    const probs: Record<RealMove, number> = { r: 0.4, p: 0.4, s: 0.4 }
    probs[dominant[0]] = 1.3

    return {
      name,
      probabilities: normalizeProbs(probs),
      confidence: 0.35 + dominant[1] / 6,
    }
  }

  static beatOurLastMove(profile: PlayerProfile): StrategyPrediction {
    const name = 'beat_ours'
    if (profile.myHistory.length === 0) {
      return { name, probabilities: uniformProbs(), confidence: 0 }
    }

    const ourLast = profile.myHistory[profile.myHistory.length - 1]!
    const predicted = LOSES_TO[ourLast]
    const probs: Record<RealMove, number> = { r: 0.3, p: 0.3, s: 0.3 }
    probs[predicted] = 1.2

    return {
      name,
      probabilities: normalizeProbs(probs),
      confidence: 0.35,
    }
  }

  static cycleDetection(profile: PlayerProfile): StrategyPrediction {
    const name = 'cycle'
    if (profile.enemyHistory.length < 3) {
      return { name, probabilities: uniformProbs(), confidence: 0 }
    }

    const last3 = profile.enemyHistory.slice(-3)
    const forward = ['r', 'p', 's']
    const backward = ['r', 's', 'p']
    let forwardMatch = 0
    let backwardMatch = 0

    for (let i = 0; i < 3; i++) {
      if (last3[i] === forward[i]) forwardMatch++
      if (last3[i] === backward[i]) backwardMatch++
    }

    if (forwardMatch >= 2) {
      const next = LOSES_TO[last3[last3.length - 1]!]
      const probs: Record<RealMove, number> = { r: 0.5, p: 0.5, s: 0.5 }
      probs[next] = 1.8
      return {
        name,
        probabilities: normalizeProbs(probs),
        confidence: 0.45,
      }
    }

    if (backwardMatch >= 2) {
      const next = BEATS[last3[last3.length - 1]!]
      const probs: Record<RealMove, number> = { r: 0.5, p: 0.5, s: 0.5 }
      probs[next] = 1.8
      return {
        name,
        probabilities: normalizeProbs(probs),
        confidence: 0.45,
      }
    }

    return { name, probabilities: uniformProbs(), confidence: 0 }
  }
}

export default class CodexRpsAI extends RpsAI {
  private playerProfiles = new Map<string, PlayerProfile>()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null
  private greetedTables = new Set<number>()
  private tableOwner = new Map<number, string>()

  override async init(botLogin: string): Promise<void> {
    await super.init(botLogin)

    this.cleanupTimer = setInterval(
      () => this.cleanupStaleProfiles(),
      60 * 60 * 1000,
    )
  }

  private cleanupStaleProfiles(): void {
    const now = Date.now()
    for (const [login, profile] of this.playerProfiles.entries()) {
      if (now - profile.lastUpdate > STATS_TTL_MS) {
        this.playerProfiles.delete(login)
        log(`🧹 Removed stale profile: ${login}`)
      }
    }
  }

  private sendGreeting(pos: PositionInfo<GamePosition>) {
    if (this.greetedTables.has(pos.tableId)) return
    const enemy = pos.players.find(
      (p) => p !== null && p.login !== this.botLogin,
    )
    if (!enemy) return
    this.greetedTables.add(pos.tableId)
    this.sdk.message(
      pos.tableId,
      `Welcome ${enemy.login}! Codex is analyzing patterns with championship precision.`,
    )
  }

  private getProfile(login: string): PlayerProfile {
    let profile = this.playerProfiles.get(login)
    if (!profile) {
      profile = {
        enemyHistory: [],
        myHistory: [],
        outcomes: [],
        markovChains: new Map(),
        patternMemory: new Map(),
        transitions: new Map(),
        afterOutcome: {
          win: new Map(),
          loss: new Map(),
          draw: new Map(),
        },
        strategyPerformance: new Map(),
        lastPredictions: new Map(),
        processedRounds: 0,
        lastUpdate: Date.now(),
      }
      for (let order = 1; order <= 3; order++) {
        profile.markovChains.set(order, new Map())
      }
      this.playerProfiles.set(login, profile)
    }
    profile.lastUpdate = Date.now()
    return profile
  }

  private getCompletedRounds(position: GamePosition): Round[] {
    return position.rounds.filter(
      (round) =>
        round[0] !== null &&
        round[1] !== null &&
        round[0] !== Move.Hidden &&
        round[1] !== Move.Hidden,
    ) as Round[]
  }

  private updateMarkovChains(profile: PlayerProfile, newMove: RealMove) {
    const history = profile.enemyHistory
    for (let order = 1; order <= 3; order++) {
      if (history.length >= order) {
        const context = history.slice(-order).join('')
        const chain = profile.markovChains.get(order)!
        if (!chain.has(context)) {
          chain.set(context, new Map())
        }
        const nextMap = chain.get(context)!
        nextMap.set(newMove, (nextMap.get(newMove) || 0) + 1)
      }
    }
  }

  private updatePatternMemory(profile: PlayerProfile, newMove: RealMove) {
    const history = profile.enemyHistory
    const maxContext = Math.min(history.length, MAX_PATTERN_CONTEXT)
    for (let len = 1; len <= maxContext; len++) {
      const context = history.slice(-len).join('')
      const bucket =
        profile.patternMemory.get(context) ?? new Map<RealMove, number>()
      bucket.set(newMove, (bucket.get(newMove) || 0) + 1)
      profile.patternMemory.set(context, bucket)
    }
  }

  private updateTransitions(profile: PlayerProfile, newMove: RealMove) {
    if (profile.enemyHistory.length === 0) return
    const previous = profile.enemyHistory[profile.enemyHistory.length - 1]!
    let bucket = profile.transitions.get(previous)
    if (!bucket) {
      bucket = new Map()
      profile.transitions.set(previous, bucket)
    }
    bucket.set(newMove, (bucket.get(newMove) || 0) + 1)
  }

  private updateAfterOutcome(
    profile: PlayerProfile,
    newMove: RealMove,
    lastOutcome: 'win' | 'loss' | 'draw',
  ) {
    const enemyOutcome =
      lastOutcome === 'win' ? 'loss' : lastOutcome === 'loss' ? 'win' : 'draw'
    const bucket = profile.afterOutcome[enemyOutcome]
    bucket.set(newMove, (bucket.get(newMove) || 0) + 1)
  }

  private updateStrategyPerformance(
    profile: PlayerProfile,
    actualMove: RealMove,
  ) {
    for (const [strategyName, predicted] of profile.lastPredictions) {
      const perf = profile.strategyPerformance.get(strategyName) ?? {
        correct: 0,
        total: 0,
        recentCorrect: [],
      }
      const isCorrect = predicted === actualMove ? 1 : 0
      perf.correct += isCorrect
      perf.total++
      perf.recentCorrect.push(isCorrect)
      if (perf.recentCorrect.length > PERFORMANCE_WINDOW) {
        perf.recentCorrect.shift()
      }
      profile.strategyPerformance.set(strategyName, perf)
    }
    profile.lastPredictions.clear()
  }

  private getStrategyWeight(
    profile: PlayerProfile,
    strategyName: string,
  ): number {
    const perf = profile.strategyPerformance.get(strategyName)
    if (!perf || perf.total < 3) {
      return 1
    }

    const recentAccuracy =
      perf.recentCorrect.reduce((sum, value) => sum + value, 0) /
      perf.recentCorrect.length
    const overallAccuracy = perf.correct / perf.total
    const accuracy = 0.65 * recentAccuracy + 0.35 * overallAccuracy
    return Math.max(0.2, 1 + (accuracy - 0.33) * 3)
  }

  private processCompletedRounds(
    pos: PositionInfo<GamePosition>,
    enemyLogin: string,
  ) {
    const profile = this.getProfile(enemyLogin)
    const botIndex = pos.botIndex!
    const enemyIndex = botIndex === 0 ? 1 : 0
    const completed = this.getCompletedRounds(pos.position)
    const newRounds = completed.slice(profile.processedRounds)

    for (const round of newRounds) {
      const enemyMove = round[enemyIndex] as RealMove
      const myMove = round[botIndex] as RealMove
      const prevOutcome =
        profile.outcomes.length > 0
          ? profile.outcomes[profile.outcomes.length - 1]
          : null

      if (prevOutcome) {
        this.updateAfterOutcome(profile, enemyMove, prevOutcome)
      }

      this.updateStrategyPerformance(profile, enemyMove)
      this.updateMarkovChains(profile, enemyMove)
      this.updateTransitions(profile, enemyMove)
      this.updatePatternMemory(profile, enemyMove)

      profile.enemyHistory.push(enemyMove)
      profile.myHistory.push(myMove)
      const outcome = getOutcome(myMove, enemyMove)
      profile.outcomes.push(outcome)
      profile.lastUpdate = Date.now()

      log(
        `📝 Round ${profile.enemyHistory.length}: enemy=${enemyMove} my=${myMove} outcome=${outcome}`,
      )
    }

    profile.processedRounds = completed.length
  }

  private getAllPredictions(profile: PlayerProfile): StrategyPrediction[] {
    return [
      PredictionStrategies.frequency(profile),
      PredictionStrategies.markov(profile, 1),
      PredictionStrategies.markov(profile, 2),
      PredictionStrategies.markov(profile, 3),
      PredictionStrategies.pattern(profile),
      PredictionStrategies.transition(profile),
      PredictionStrategies.afterOutcome(profile),
      PredictionStrategies.antiRepetition(profile),
      PredictionStrategies.momentum(profile),
      PredictionStrategies.beatOurLastMove(profile),
      PredictionStrategies.cycleDetection(profile),
    ]
  }

  private ensemblePredict(
    profile: PlayerProfile,
    predictions: StrategyPrediction[],
  ): Record<RealMove, number> {
    const combined: Record<RealMove, number> = { r: 0, p: 0, s: 0 }
    let totalWeight = 0

    log('\n' + '='.repeat(60))
    log('🎯 ENSEMBLE PREDICTION')
    log('='.repeat(60))

    for (const pred of predictions) {
      if (pred.confidence === 0) continue
      const weight =
        this.getStrategyWeight(profile, pred.name) * pred.confidence

      if (weight < 0.05) continue
      for (const move of REAL_MOVES) {
        combined[move] += pred.probabilities[move] * weight
      }
      totalWeight += weight
      profile.lastPredictions.set(pred.name, maxProbMove(pred.probabilities))

      log(
        `📊 ${pred.name.padEnd(14)} | ` +
          `R:${(pred.probabilities.r * 100).toFixed(1).padStart(5)}% ` +
          `P:${(pred.probabilities.p * 100).toFixed(1).padStart(5)}% ` +
          `S:${(pred.probabilities.s * 100).toFixed(1).padStart(5)}% | ` +
          `conf:${pred.confidence.toFixed(2)} weight:${weight.toFixed(2)}`,
      )
    }

    if (totalWeight === 0) {
      log('⚠️ No confident predictions, defaulting to uniform distribution')
      return uniformProbs()
    }

    const normalized = normalizeProbs(combined)

    log('-'.repeat(60))
    log(
      `🎯 COMBINED:        | ` +
        `R:${(normalized.r * 100).toFixed(1).padStart(5)}% ` +
        `P:${(normalized.p * 100).toFixed(1).padStart(5)}% ` +
        `S:${(normalized.s * 100).toFixed(1).padStart(5)}%`,
    )
    log('='.repeat(60))

    return normalized
  }

  private selectBestMove(enemyProbs: Record<RealMove, number>): RealMove {
    const expected: Record<RealMove, number> = { r: 0, p: 0, s: 0 }
    for (const ourMove of REAL_MOVES) {
      for (const theirMove of REAL_MOVES) {
        const prob = enemyProbs[theirMove]
        if (ourMove === theirMove) {
          expected[ourMove] += prob * 0
        } else if (BEATS[ourMove] === theirMove) {
          expected[ourMove] += prob * 1
        } else {
          expected[ourMove] -= prob
        }
      }
    }

    log(
      `💰 EV: R:${expected.r.toFixed(3)} P:${expected.p.toFixed(3)} S:${expected.s.toFixed(3)}`,
    )

    let bestMove: RealMove = 'r'
    let bestEV = expected.r
    for (const move of REAL_MOVES) {
      if (expected[move] > bestEV) {
        bestEV = expected[move]
        bestMove = move
      }
    }

    const goodMoves = REAL_MOVES.filter(
      (move) => expected[move] > bestEV - 0.08,
    )
    if (goodMoves.length > 1 && Math.random() < 0.2) {
      const randomChoice =
        goodMoves[Math.floor(Math.random() * goodMoves.length)]!
      log(`🎲 Anti-exploitation: switching from ${bestMove} to ${randomChoice}`)
      return randomChoice
    }

    log(`✅ Selected move: ${bestMove} (EV ${bestEV.toFixed(3)})`)
    return bestMove
  }

  override async getBestMove(pos: PositionInfo<GamePosition>): Promise<Move> {
    this.sendGreeting(pos)

    if (pos.botIndex === null) {
      return randomRealMove()
    }

    const enemy = pos.players.find(
      (player) => player !== null && player.login !== this.botLogin,
    )
    if (!enemy) {
      return randomRealMove()
    }

    this.tableOwner.set(pos.tableId, enemy.login)
    this.processCompletedRounds(pos, enemy.login)
    const profile = this.getProfile(enemy.login)

    log(
      `\n🧠 Playing ${enemy.login} | history ${profile.enemyHistory.length} moves`,
    )

    const predictions = this.getAllPredictions(profile)
    const enemyProbs = this.ensemblePredict(profile, predictions)
    const bestMove = this.selectBestMove(enemyProbs)

    return bestMove as Move
  }

  override onGameEnd(tableId: number): void {
    this.greetedTables.delete(tableId)
    const owner = this.tableOwner.get(tableId)
    if (owner) {
      const profile = this.playerProfiles.get(owner)
      if (profile) profile.processedRounds = 0
      this.tableOwner.delete(tableId)
    }
  }
}
