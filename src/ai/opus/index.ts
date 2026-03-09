import { IS_DEBUG } from '../../conf.ts'
import type { PositionInfo } from '../../sdk/IBotSDK.ts'
import { RpsAI } from '../RpsAI.js'
import { Move, type GamePosition } from '../types.ts'

// ============================================================================
// OPUS RPS AI - Championship-Level Rock Paper Scissors AI
// ============================================================================
// Uses ensemble of multiple prediction strategies with dynamic weight adjustment
// based on each strategy's historical accuracy.
// ============================================================================

type RealMove = 'r' | 'p' | 's'
const REAL_MOVES: RealMove[] = ['r', 'p', 's']

// What beats what
const BEATS: Record<RealMove, RealMove> = { r: 's', p: 'r', s: 'p' }
// What loses to what
const LOSES_TO: Record<RealMove, RealMove> = { r: 'p', p: 's', s: 'r' }

// ============================================================================
// TYPES
// ============================================================================

interface StrategyPrediction {
  name: string
  probabilities: Record<RealMove, number>
  confidence: number
}

interface StrategyPerformance {
  correct: number
  total: number
  recentCorrect: number[] // sliding window of last N predictions (1 = correct, 0 = wrong)
}

interface PlayerData {
  // Raw history
  enemyMoves: RealMove[]
  myMoves: RealMove[]
  outcomes: ('win' | 'loss' | 'draw')[]

  // Markov chain data (order -> (context -> (nextMove -> count)))
  markovChains: Map<number, Map<string, Map<RealMove, number>>>

  // Meta-strategy: what does enemy do after win/loss/draw
  afterOutcome: Record<'win' | 'loss' | 'draw', Map<RealMove, number>>

  // Transition matrix: P(next | current)
  transitions: Map<RealMove, Map<RealMove, number>>

  // Pattern detection: LZ-style pattern -> next move frequencies
  patterns: Map<string, Map<RealMove, number>>

  // Strategy performance tracking
  strategyPerformance: Map<string, StrategyPerformance>

  // Last predictions for performance tracking
  lastPredictions: Map<string, RealMove>

  // Game-specific data
  currentGameMoves: RealMove[]
  currentGameMyMoves: RealMove[]

  // Timestamps
  lastUpdate: number
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function getCounterMove(move: RealMove): RealMove {
  return LOSES_TO[move]
}

function getOutcome(
  myMove: RealMove,
  enemyMove: RealMove,
): 'win' | 'loss' | 'draw' {
  if (myMove === enemyMove) return 'draw'
  if (BEATS[myMove] === enemyMove) return 'win'
  return 'loss'
}

function normalizeProbs(
  probs: Record<RealMove, number>,
): Record<RealMove, number> {
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

function log(message: string, ...args: unknown[]) {
  if (IS_DEBUG) console.log(message, ...args)
}

// ============================================================================
// PREDICTION STRATEGIES
// ============================================================================

class PredictionStrategies {
  // Strategy 1: Frequency Analysis
  static frequency(data: PlayerData): StrategyPrediction {
    const probs: Record<RealMove, number> = { r: 1, p: 1, s: 1 } // Laplace smoothing
    for (const move of data.enemyMoves) {
      probs[move]++
    }
    return {
      name: 'frequency',
      probabilities: normalizeProbs(probs),
      confidence: Math.min(data.enemyMoves.length / 10, 1),
    }
  }

  // Strategy 2: Markov Chain (order 1-4)
  static markov(data: PlayerData, order: number): StrategyPrediction {
    const name = `markov_${order}`
    if (data.enemyMoves.length < order + 1) {
      return { name, probabilities: uniformProbs(), confidence: 0 }
    }

    const context = data.enemyMoves.slice(-order).join('')
    const chain = data.markovChains.get(order)
    const nextMoves = chain?.get(context)

    if (!nextMoves || nextMoves.size === 0) {
      return { name, probabilities: uniformProbs(), confidence: 0 }
    }

    const probs: Record<RealMove, number> = { r: 0.1, p: 0.1, s: 0.1 }
    let total = 0.3
    for (const [move, count] of nextMoves) {
      probs[move] += count
      total += count
    }

    return {
      name,
      probabilities: normalizeProbs(probs),
      confidence: Math.min(total / 5, 1),
    }
  }

  // Strategy 3: Meta-strategy (what does enemy do after win/loss/draw)
  static metaStrategy(data: PlayerData): StrategyPrediction {
    if (data.outcomes.length === 0) {
      return { name: 'meta', probabilities: uniformProbs(), confidence: 0 }
    }

    const lastOutcome = data.outcomes[data.outcomes.length - 1]
    // Enemy's outcome is opposite of ours
    const enemyOutcome =
      lastOutcome === 'win' ? 'loss' : lastOutcome === 'loss' ? 'win' : 'draw'
    const afterData = data.afterOutcome[enemyOutcome]

    if (!afterData || afterData.size === 0) {
      return { name: 'meta', probabilities: uniformProbs(), confidence: 0 }
    }

    const probs: Record<RealMove, number> = { r: 0.1, p: 0.1, s: 0.1 }
    let total = 0.3
    for (const [move, count] of afterData) {
      probs[move] += count
      total += count
    }

    return {
      name: 'meta',
      probabilities: normalizeProbs(probs),
      confidence: Math.min(total / 5, 1),
    }
  }

  // Strategy 4: Transition analysis (what move follows current)
  static transition(data: PlayerData): StrategyPrediction {
    if (data.enemyMoves.length === 0) {
      return {
        name: 'transition',
        probabilities: uniformProbs(),
        confidence: 0,
      }
    }

    const lastMove = data.enemyMoves[data.enemyMoves.length - 1]!
    const trans = data.transitions.get(lastMove)

    if (!trans || trans.size === 0) {
      return {
        name: 'transition',
        probabilities: uniformProbs(),
        confidence: 0,
      }
    }

    const probs: Record<RealMove, number> = { r: 0.1, p: 0.1, s: 0.1 }
    let total = 0.3
    for (const [move, count] of trans) {
      probs[move] += count
      total += count
    }

    return {
      name: 'transition',
      probabilities: normalizeProbs(probs),
      confidence: Math.min(total / 5, 1),
    }
  }

  // Strategy 5: Pattern matching (LZ-style)
  static pattern(data: PlayerData): StrategyPrediction {
    const history = data.enemyMoves.join('')
    let bestPattern = ''
    let bestMatch: Map<RealMove, number> | null = null

    // Try to find longest matching pattern
    for (let len = Math.min(6, history.length - 1); len >= 2; len--) {
      const pattern = history.slice(-len)
      const matches = data.patterns.get(pattern)
      if (matches && matches.size > 0) {
        bestPattern = pattern
        bestMatch = matches
        break
      }
    }

    if (!bestMatch) {
      return { name: 'pattern', probabilities: uniformProbs(), confidence: 0 }
    }

    const probs: Record<RealMove, number> = { r: 0.1, p: 0.1, s: 0.1 }
    let total = 0.3
    for (const [move, count] of bestMatch) {
      probs[move] += count
      total += count
    }

    return {
      name: 'pattern',
      probabilities: normalizeProbs(probs),
      confidence: Math.min((total * bestPattern.length) / 10, 1),
    }
  }

  // Strategy 6: Anti-repetition (humans avoid repeating)
  static antiRepetition(data: PlayerData): StrategyPrediction {
    if (data.enemyMoves.length < 2) {
      return {
        name: 'anti_repetition',
        probabilities: uniformProbs(),
        confidence: 0,
      }
    }

    const last = data.enemyMoves[data.enemyMoves.length - 1]!
    const secondLast = data.enemyMoves[data.enemyMoves.length - 2]!

    // If enemy repeated last move, they're less likely to repeat again
    if (last === secondLast) {
      const probs: Record<RealMove, number> = { r: 1, p: 1, s: 1 }
      probs[last] = 0.5 // Lower probability for repeated move
      return {
        name: 'anti_repetition',
        probabilities: normalizeProbs(probs),
        confidence: 0.6,
      }
    }

    return {
      name: 'anti_repetition',
      probabilities: uniformProbs(),
      confidence: 0,
    }
  }

  // Strategy 7: Win-stay-lose-shift detection
  static wsls(data: PlayerData): StrategyPrediction {
    if (data.outcomes.length === 0 || data.enemyMoves.length === 0) {
      return { name: 'wsls', probabilities: uniformProbs(), confidence: 0 }
    }

    const lastOutcome = data.outcomes[data.outcomes.length - 1]!
    const lastEnemyMove = data.enemyMoves[data.enemyMoves.length - 1]!

    // Enemy's outcome is opposite
    const enemyWon = lastOutcome === 'loss'
    const enemyLost = lastOutcome === 'win'

    if (enemyWon) {
      // If enemy won, they might stay with same move
      const probs: Record<RealMove, number> = { r: 0.5, p: 0.5, s: 0.5 }
      probs[lastEnemyMove] = 2
      return {
        name: 'wsls',
        probabilities: normalizeProbs(probs),
        confidence: 0.5,
      }
    } else if (enemyLost) {
      // If enemy lost, they might shift to what would have beaten our move
      const myLastMove = data.myMoves[data.myMoves.length - 1]!
      const counterToOurMove = getCounterMove(myLastMove)
      const probs: Record<RealMove, number> = { r: 0.5, p: 0.5, s: 0.5 }
      probs[counterToOurMove] = 2
      return {
        name: 'wsls',
        probabilities: normalizeProbs(probs),
        confidence: 0.5,
      }
    }

    return { name: 'wsls', probabilities: uniformProbs(), confidence: 0 }
  }

  // Strategy 8: Beat-last-move (common human tendency)
  static beatLastMove(data: PlayerData): StrategyPrediction {
    if (data.myMoves.length === 0) {
      return {
        name: 'beat_last_move',
        probabilities: uniformProbs(),
        confidence: 0,
      }
    }

    // Human might try to beat our last move
    const myLastMove = data.myMoves[data.myMoves.length - 1]!
    const counterToOurMove = getCounterMove(myLastMove)

    const probs: Record<RealMove, number> = { r: 0.5, p: 0.5, s: 0.5 }
    probs[counterToOurMove] = 1.5

    return {
      name: 'beat_last_move',
      probabilities: normalizeProbs(probs),
      confidence: 0.4,
    }
  }

  // Strategy 9: Game-specific pattern (within current game only)
  static gamePattern(data: PlayerData): StrategyPrediction {
    if (data.currentGameMoves.length < 2) {
      return {
        name: 'game_pattern',
        probabilities: uniformProbs(),
        confidence: 0,
      }
    }

    // Look for patterns in current game
    const probs: Record<RealMove, number> = { r: 1, p: 1, s: 1 }
    for (const move of data.currentGameMoves) {
      probs[move]++
    }

    return {
      name: 'game_pattern',
      probabilities: normalizeProbs(probs),
      confidence: Math.min(data.currentGameMoves.length / 5, 0.8),
    }
  }

  // Strategy 10: Cycle detection (r->p->s->r or r->s->p->r)
  static cycleDetection(data: PlayerData): StrategyPrediction {
    if (data.enemyMoves.length < 3) {
      return { name: 'cycle', probabilities: uniformProbs(), confidence: 0 }
    }

    const last3 = data.enemyMoves.slice(-3)

    // Check for forward cycle: r->p->s
    const forwardCycle = ['r', 'p', 's', 'r', 'p', 's']
    const backwardCycle = ['r', 's', 'p', 'r', 's', 'p']

    let forwardMatch = 0
    let backwardMatch = 0

    for (let i = 0; i < 3; i++) {
      for (let offset = 0; offset < 3; offset++) {
        if (last3[i] === forwardCycle[i + offset]) forwardMatch++
        if (last3[i] === backwardCycle[i + offset]) backwardMatch++
      }
    }

    if (forwardMatch >= 2) {
      // Predict next in forward cycle
      const lastMove = data.enemyMoves[data.enemyMoves.length - 1]!
      const nextInCycle = LOSES_TO[lastMove]
      const probs: Record<RealMove, number> = { r: 0.5, p: 0.5, s: 0.5 }
      probs[nextInCycle] = 2
      return {
        name: 'cycle',
        probabilities: normalizeProbs(probs),
        confidence: 0.6,
      }
    }

    if (backwardMatch >= 2) {
      // Predict next in backward cycle
      const lastMove = data.enemyMoves[data.enemyMoves.length - 1]!
      const nextInCycle = BEATS[lastMove]
      const probs: Record<RealMove, number> = { r: 0.5, p: 0.5, s: 0.5 }
      probs[nextInCycle] = 2
      return {
        name: 'cycle',
        probabilities: normalizeProbs(probs),
        confidence: 0.6,
      }
    }

    return { name: 'cycle', probabilities: uniformProbs(), confidence: 0 }
  }
}

// ============================================================================
// MAIN AI CLASS
// ============================================================================

export default class OpusRpsAI extends RpsAI {
  private playerData = new Map<string, PlayerData>()
  private greetingSent = new Set<number>()
  private readonly STATS_EXPIRY_MS = 2 * 24 * 60 * 60 * 1000 // 2 days
  private readonly RECENT_WINDOW = 20 // Track last 20 predictions for performance

  override async init(botLogin: string) {
    super.init(botLogin)

    this.sdk.onMessage((tableId: number, _message: string, login: string) => {
      this.sdk.message(tableId, `Good luck, ${login}! 🎯`)
    })

    // Cleanup expired stats every hour
    setInterval(
      () => {
        this.cleanupExpiredStats()
        this.greetingSent.clear()
      },
      60 * 60 * 1000,
    )
  }

  private cleanupExpiredStats() {
    const now = Date.now()
    let cleaned = 0
    for (const [player, data] of this.playerData.entries()) {
      if (now - data.lastUpdate > this.STATS_EXPIRY_MS) {
        this.playerData.delete(player)
        cleaned++
      }
    }
    if (cleaned > 0) {
      log(`🧹 Cleaned up ${cleaned} expired player records`)
    }
  }

  private sendGreeting(pos: PositionInfo<GamePosition>) {
    if (!this.greetingSent.has(pos.tableId)) {
      this.greetingSent.add(pos.tableId)
      const enemy = pos.players.find(
        (p) => p !== null && p.login !== this.botLogin,
      )
      setTimeout(() => {
        this.sdk.message(pos.tableId, `Hello ${enemy?.login}! Let's play! 🎮`)
      }, 0)
    }
  }

  private getPlayerData(login: string): PlayerData {
    let data = this.playerData.get(login)
    if (!data) {
      data = {
        enemyMoves: [],
        myMoves: [],
        outcomes: [],
        markovChains: new Map(),
        afterOutcome: {
          win: new Map(),
          loss: new Map(),
          draw: new Map(),
        },
        transitions: new Map(),
        patterns: new Map(),
        strategyPerformance: new Map(),
        lastPredictions: new Map(),
        currentGameMoves: [],
        currentGameMyMoves: [],
        lastUpdate: Date.now(),
      }
      // Initialize Markov chains for orders 1-4
      for (let order = 1; order <= 4; order++) {
        data.markovChains.set(order, new Map())
      }
      this.playerData.set(login, data)
    }
    return data
  }

  private updateMarkovChains(data: PlayerData, newMove: RealMove) {
    const history = data.enemyMoves
    for (let order = 1; order <= 4; order++) {
      if (history.length >= order) {
        const context = history.slice(-order).join('')
        const chain = data.markovChains.get(order)!
        if (!chain.has(context)) {
          chain.set(context, new Map())
        }
        const nextMoves = chain.get(context)!
        nextMoves.set(newMove, (nextMoves.get(newMove) || 0) + 1)
      }
    }
  }

  private updatePatterns(data: PlayerData, newMove: RealMove) {
    const history = data.enemyMoves.join('')
    // Store patterns of length 2-6
    for (let len = 2; len <= Math.min(6, history.length); len++) {
      const pattern = history.slice(-len)
      if (!data.patterns.has(pattern)) {
        data.patterns.set(pattern, new Map())
      }
      const nextMoves = data.patterns.get(pattern)!
      nextMoves.set(newMove, (nextMoves.get(newMove) || 0) + 1)
    }
  }

  private updateTransitions(data: PlayerData, newMove: RealMove) {
    if (data.enemyMoves.length > 0) {
      const lastMove = data.enemyMoves[data.enemyMoves.length - 1]!
      if (!data.transitions.has(lastMove)) {
        data.transitions.set(lastMove, new Map())
      }
      const trans = data.transitions.get(lastMove)!
      trans.set(newMove, (trans.get(newMove) || 0) + 1)
    }
  }

  private updateAfterOutcome(
    data: PlayerData,
    newMove: RealMove,
    lastOutcome: 'win' | 'loss' | 'draw',
  ) {
    // Enemy's outcome is opposite of ours
    const enemyOutcome =
      lastOutcome === 'win' ? 'loss' : lastOutcome === 'loss' ? 'win' : 'draw'
    const afterData = data.afterOutcome[enemyOutcome]
    afterData.set(newMove, (afterData.get(newMove) || 0) + 1)
  }

  private updateStrategyPerformance(data: PlayerData, actualMove: RealMove) {
    for (const [strategyName, predictedMove] of data.lastPredictions) {
      let perf = data.strategyPerformance.get(strategyName)
      if (!perf) {
        perf = { correct: 0, total: 0, recentCorrect: [] }
        data.strategyPerformance.set(strategyName, perf)
      }

      const isCorrect = predictedMove === actualMove ? 1 : 0
      perf.total++
      perf.correct += isCorrect
      perf.recentCorrect.push(isCorrect)

      // Keep only last N predictions
      if (perf.recentCorrect.length > this.RECENT_WINDOW) {
        perf.recentCorrect.shift()
      }
    }
    data.lastPredictions.clear()
  }

  private getStrategyWeight(data: PlayerData, strategyName: string): number {
    const perf = data.strategyPerformance.get(strategyName)
    if (!perf || perf.total < 3) {
      return 1.0 // Default weight for new strategies
    }

    // Calculate recent accuracy (more weight on recent performance)
    const recentAccuracy =
      perf.recentCorrect.length > 0
        ? perf.recentCorrect.reduce((a, b) => a + b, 0) /
          perf.recentCorrect.length
        : 0.33

    // Overall accuracy
    const overallAccuracy = perf.correct / perf.total

    // Weighted combination (70% recent, 30% overall)
    const accuracy = 0.7 * recentAccuracy + 0.3 * overallAccuracy

    // Convert accuracy to weight (accuracy above 0.33 is good)
    // Scale: 0.33 -> 1.0, 0.5 -> 2.0, 0.67 -> 3.0
    return Math.max(0.1, (accuracy - 0.33) * 6 + 1)
  }

  private processCompletedRounds(
    pos: PositionInfo<GamePosition>,
    enemyLogin: string,
  ) {
    const data = this.getPlayerData(enemyLogin)
    const botIndex = pos.botIndex!
    const enemyIndex = botIndex === 0 ? 1 : 0

    // Find completed rounds
    const completedRounds = pos.position.rounds.filter(
      (round) =>
        round[0] !== null &&
        round[1] !== null &&
        round[0] !== Move.Hidden &&
        round[1] !== Move.Hidden,
    )

    // Process only new rounds
    const processedCount = data.currentGameMoves.length
    const newRounds = completedRounds.slice(processedCount)

    for (const round of newRounds) {
      const enemyMove = round[enemyIndex] as RealMove
      const myMove = round[botIndex] as RealMove
      const outcome = getOutcome(myMove, enemyMove)

      // Update strategy performance based on predictions
      this.updateStrategyPerformance(data, enemyMove)

      // Update all data structures
      this.updateMarkovChains(data, enemyMove)
      this.updatePatterns(data, enemyMove)
      this.updateTransitions(data, enemyMove)

      if (data.outcomes.length > 0) {
        this.updateAfterOutcome(
          data,
          enemyMove,
          data.outcomes[data.outcomes.length - 1]!,
        )
      }

      // Store the move and outcome
      data.enemyMoves.push(enemyMove)
      data.myMoves.push(myMove)
      data.outcomes.push(outcome)
      data.currentGameMoves.push(enemyMove)
      data.currentGameMyMoves.push(myMove)
      data.lastUpdate = Date.now()

      log(
        `📝 Round ${data.currentGameMoves.length}: Enemy=${enemyMove}, Me=${myMove}, Outcome=${outcome}`,
      )
    }
  }

  private getAllPredictions(data: PlayerData): StrategyPrediction[] {
    return [
      PredictionStrategies.frequency(data),
      PredictionStrategies.markov(data, 1),
      PredictionStrategies.markov(data, 2),
      PredictionStrategies.markov(data, 3),
      PredictionStrategies.markov(data, 4),
      PredictionStrategies.metaStrategy(data),
      PredictionStrategies.transition(data),
      PredictionStrategies.pattern(data),
      PredictionStrategies.antiRepetition(data),
      PredictionStrategies.wsls(data),
      PredictionStrategies.beatLastMove(data),
      PredictionStrategies.gamePattern(data),
      PredictionStrategies.cycleDetection(data),
    ]
  }

  private ensemblePredict(
    data: PlayerData,
    predictions: StrategyPrediction[],
  ): Record<RealMove, number> {
    const combined: Record<RealMove, number> = { r: 0, p: 0, s: 0 }

    log('\n' + '='.repeat(60))
    log('🎯 ENSEMBLE PREDICTION')
    log('='.repeat(60))

    let totalWeight = 0

    for (const pred of predictions) {
      if (pred.confidence === 0) continue

      const baseWeight = this.getStrategyWeight(data, pred.name)
      const weight = baseWeight * pred.confidence

      if (weight > 0.01) {
        log(
          `📊 ${pred.name.padEnd(15)} | ` +
            `R:${(pred.probabilities.r * 100).toFixed(0).padStart(3)}% ` +
            `P:${(pred.probabilities.p * 100).toFixed(0).padStart(3)}% ` +
            `S:${(pred.probabilities.s * 100).toFixed(0).padStart(3)}% | ` +
            `conf:${pred.confidence.toFixed(2)} weight:${weight.toFixed(2)}`,
        )
      }

      for (const move of REAL_MOVES) {
        combined[move] += pred.probabilities[move] * weight
      }
      totalWeight += weight

      // Store prediction for performance tracking
      data.lastPredictions.set(pred.name, maxProbMove(pred.probabilities))
    }

    if (totalWeight === 0) {
      log('⚠️ No confident predictions, using uniform distribution')
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
    // Calculate expected value for each of our moves
    const expectedValue: Record<RealMove, number> = { r: 0, p: 0, s: 0 }

    for (const ourMove of REAL_MOVES) {
      for (const theirMove of REAL_MOVES) {
        const prob = enemyProbs[theirMove]
        if (ourMove === theirMove) {
          expectedValue[ourMove] += prob * 0 // Draw
        } else if (BEATS[ourMove] === theirMove) {
          expectedValue[ourMove] += prob * 1 // Win
        } else {
          expectedValue[ourMove] += prob * -1 // Loss
        }
      }
    }

    log(
      `💰 Expected values: R:${expectedValue.r.toFixed(3)} P:${expectedValue.p.toFixed(3)} S:${expectedValue.s.toFixed(3)}`,
    )

    // Find best move
    let bestMove: RealMove = 'r'
    let bestEV = expectedValue.r

    for (const move of REAL_MOVES) {
      if (expectedValue[move] > bestEV) {
        bestEV = expectedValue[move]
        bestMove = move
      }
    }

    // Add small randomization to avoid being too predictable
    // If EV difference is small, sometimes pick randomly among good options
    const goodMoves = REAL_MOVES.filter((m) => expectedValue[m] > bestEV - 0.1)

    if (goodMoves.length > 1 && Math.random() < 0.15) {
      const randomGood =
        goodMoves[Math.floor(Math.random() * goodMoves.length)]!
      log(`🎲 Anti-exploitation: switching from ${bestMove} to ${randomGood}`)
      return randomGood
    }

    log(`✅ Selected move: ${bestMove} (EV: ${bestEV.toFixed(3)})`)
    return bestMove
  }

  override async getBestMove(pos: PositionInfo<GamePosition>): Promise<Move> {
    this.sendGreeting(pos)

    const enemy = pos.players.find(
      (p) => p !== null && p.login !== this.botLogin,
    )

    if (!enemy || pos.botIndex === null) {
      log('⚠️ No enemy found, playing randomly')
      return REAL_MOVES[Math.floor(Math.random() * 3)]!
    }

    log('\n' + '█'.repeat(60))
    log(`🎮 GAME vs ${enemy.login} | Round ${pos.position.rounds.length + 1}`)
    log('█'.repeat(60))

    // Process any completed rounds
    this.processCompletedRounds(pos, enemy.login)

    const data = this.getPlayerData(enemy.login)

    log(`📈 Total history: ${data.enemyMoves.length} moves`)
    log(`📈 Current game: ${data.currentGameMoves.length} moves`)

    // Get all predictions
    const predictions = this.getAllPredictions(data)

    // Combine predictions with ensemble
    const enemyProbs = this.ensemblePredict(data, predictions)

    // Select best move based on expected value
    const bestMove = this.selectBestMove(enemyProbs)

    log('█'.repeat(60) + '\n')

    return bestMove
  }

  override onGameEnd(tableId: number): void {
    this.greetingSent.delete(tableId)

    // Reset current game data for all players who were in this game
    // We don't know which player was in this game, so we reset based on recent activity
    // This is a simplification - in production you'd track tableId -> player mapping
    for (const [login, data] of this.playerData.entries()) {
      if (data.currentGameMoves.length > 0) {
        log(`🏁 Game ended for ${login}, resetting game-specific data`)
        data.currentGameMoves = []
        data.currentGameMyMoves = []
      }
    }
  }
}
