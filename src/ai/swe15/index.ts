import type { PositionInfo } from '../../sdk/IBotSDK.ts'
import { RpsAI } from '../RpsAI.js'
import { Move, type GamePosition, type Round } from '../types.ts'

const IS_DEBUG = true

interface PlayerStats {
  moveHistory: Move[]
  lastUpdate: number
  moveFrequency: { [key in Move]: number }
  patternFrequency: { [key: string]: number }
}

// Тип для статистики только реальных ходов (без Move.Hidden)
type RealMove = Extract<Move, 'r' | 'p' | 's'>

export default class NormalRpsAI extends RpsAI {
  private playerStats = new Map<string, PlayerStats>()
  private greetingSent = new Set<number>()
  private readonly STATS_EXPIRY_TIME = 2 * 60 * 60 * 1000 // 2 часа в миллисекундах

  override async init(botLogin: string) {
    super.init(botLogin)
    this.sdk.onMessage((tableId: number, _message: string, login: string) => {
      this.sdk.message(
        tableId,
        `Sorry, ${login}, I don't understand your messages...`,
      )
    })

    // Очистка старой статистики и флагов приветствия
    setInterval(
      () => {
        this.cleanupExpiredStats()
        this.greetingSent.clear()
      },
      60 * 60 * 1000,
    ) // Каждый час
  }

  private cleanupExpiredStats() {
    const now = Date.now()
    for (const [player, stats] of this.playerStats.entries()) {
      if (now - stats.lastUpdate > this.STATS_EXPIRY_TIME) {
        this.playerStats.delete(player)
      }
    }
  }

  private sendGreeting(pos: PositionInfo<GamePosition>) {
    if (!this.greetingSent.has(pos.tableId)) {
      this.greetingSent.add(pos.tableId)
      const enemy = pos.players.find(
        (p) => p !== null && p.login !== this.botLogin,
      )

      setTimeout(() => {
        this.sdk.message(
          pos.tableId,
          `Hello ${enemy?.login}! I analyze your patterns to predict your moves.`,
        )
      }, 0)
    }
  }

  private getPlayerStats(playerLogin: string): PlayerStats {
    let stats = this.playerStats.get(playerLogin)
    if (!stats) {
      stats = {
        moveHistory: [],
        lastUpdate: Date.now(),
        moveFrequency: { r: 0, p: 0, s: 0, h: 0 },
        patternFrequency: {},
      }
      this.playerStats.set(playerLogin, stats)
    }
    return stats
  }

  private updatePlayerStats(
    playerLogin: string,
    moves: Round[],
    botIndex: number,
  ) {
    const stats = this.getPlayerStats(playerLogin)
    stats.lastUpdate = Date.now()

    // Находим последний завершенный раунд (где оба хода не null)
    const completedRounds = moves.filter(
      (round) =>
        round[0] !== null &&
        round[1] !== null &&
        round[0] !== Move.Hidden &&
        round[1] !== Move.Hidden,
    )

    if (completedRounds.length === 0) {
      return // Нет завершенных раундов
    }

    // Берем только самый последний завершенный раунд
    const lastRound = completedRounds[completedRounds.length - 1]
    if (!lastRound) {
      return
    }

    // Определяем индекс противника
    const enemyIndex = botIndex === 0 ? 1 : 0
    const enemyMove = lastRound[enemyIndex]

    if (enemyMove && enemyMove !== Move.Hidden) {
      stats.moveHistory.push(enemyMove)
      stats.moveFrequency[enemyMove]++

      if (IS_DEBUG) {
        console.log(
          'Updated stats for',
          playerLogin,
          stats.moveHistory.length,
          stats.moveFrequency,
        )
      }

      // Анализируем паттерн (последние 2 хода)
      const realMoves = stats.moveHistory.filter(
        (m) => m !== Move.Hidden,
      ) as RealMove[]
      if (realMoves.length >= 2) {
        const pattern = `${realMoves[realMoves.length - 2]}${realMoves[realMoves.length - 1]}`
        stats.patternFrequency[pattern] =
          (stats.patternFrequency[pattern] || 0) + 1
      }
    }
  }

  private predictNextMove(playerLogin: string): { [key in RealMove]: number } {
    const stats = this.getPlayerStats(playerLogin)
    // Начинаем с равных вероятностей
    const predictions: { [key in RealMove]: number } = {
      r: 0.33,
      p: 0.33,
      s: 0.33,
    }

    if (IS_DEBUG) {
      console.log(`\n=== PREDICTION ANALYSIS for ${playerLogin} ===`)
      console.log(
        `Initial predictions: R:${(predictions.r * 100).toFixed(1)}% P:${(predictions.p * 100).toFixed(1)}% S:${(predictions.s * 100).toFixed(1)}%`,
      )
      console.log(`Move history length: ${stats.moveHistory.length}`)
    }

    if (stats.moveHistory.length < 3) {
      if (IS_DEBUG) {
        console.log(
          `❌ Not enough data for analysis (${stats.moveHistory.length} < 3)`,
        )
      }
      return predictions // Недостаточно данных для анализа
    }

    // 1. Анализ частоты ходов (только реальные ходы)
    const realMoves = stats.moveHistory.filter(
      (m) => m !== Move.Hidden,
    ) as RealMove[]
    const totalMoves = realMoves.length

    if (totalMoves > 0) {
      if (IS_DEBUG) {
        console.log(`\n📊 1. FREQUENCY ANALYSIS:`)
        console.log(`Total moves: ${totalMoves}`)
        console.log(
          `Move frequency: R:${stats.moveFrequency.r} P:${stats.moveFrequency.p} S:${stats.moveFrequency.s}`,
        )
      }

      // Добавляем вес на основе частоты ходов
      for (const move of ['r', 'p', 's'] as RealMove[]) {
        const frequency = stats.moveFrequency[move] / totalMoves
        predictions[move] = predictions[move] * 0.5 + frequency * 0.5 // 50% базовая вероятность + 50% частота
      }
      if (IS_DEBUG) {
        console.log(
          `After frequency: R:${(predictions.r * 100).toFixed(1)}% P:${(predictions.p * 100).toFixed(1)}% S:${(predictions.s * 100).toFixed(1)}%`,
        )
      }
    }

    // 2. Анализ паттернов - если последний ход известен, предсказываем следующий
    const lastMove = stats.moveHistory[stats.moveHistory.length - 1]

    if (lastMove && lastMove !== Move.Hidden) {
      if (IS_DEBUG) {
        console.log(`\n🔄 2. PATTERN ANALYSIS:`)
        console.log(`Last move: ${lastMove}`)
        console.log(`Pattern frequency:`, stats.patternFrequency)
      }

      let patternsFound = 0
      for (const [pattern, frequency] of Object.entries(
        stats.patternFrequency,
      )) {
        if (pattern.startsWith(lastMove)) {
          const nextMove = pattern[1] as RealMove
          if (IS_DEBUG) {
            console.log(
              `✅ Found pattern: ${pattern} -> ${nextMove} (frequency: ${frequency})`,
            )
          }
          // Увеличиваем вес для паттернов
          predictions[nextMove] += frequency * 0.5 // Увеличили с 0.2 на 0.5
          patternsFound++
        }
      }

      if (patternsFound === 0 && IS_DEBUG) {
        console.log(`❌ No patterns found starting with ${lastMove}`)
      }
      if (IS_DEBUG) {
        console.log(
          `After patterns: R:${(predictions.r * 100).toFixed(1)}% P:${(predictions.p * 100).toFixed(1)}% S:${(predictions.s * 100).toFixed(1)}%`,
        )
      }
    }

    // 3. Анти-циклический анализ - люди часто меняют стратегию после проигрыша
    if (realMoves.length >= 3) {
      const recentMoves = realMoves.slice(-3)

      if (IS_DEBUG) {
        console.log(`\n🚫 3. ANTI-CYCLIC ANALYSIS:`)
        console.log(`Recent moves: [${recentMoves.join(', ')}]`)
      }

      const hasRepeatingPattern = recentMoves.every(
        (move) => move === recentMoves[0],
      )

      if (hasRepeatingPattern && recentMoves[0]) {
        if (IS_DEBUG) {
          console.log(
            `✅ Detected repeating pattern: ${recentMoves[0]} repeated 3 times`,
          )
        }
        // Если игрок повторяет один ход, вероятно он скоро его изменит
        predictions[recentMoves[0]] *= 0.7
        // Увеличиваем вероятности других ходов
        const otherMoves = ['r', 'p', 's'].filter(
          (m) => m !== recentMoves[0],
        ) as RealMove[]
        otherMoves.forEach((move) => {
          predictions[move] *= 1.15
        })
        if (IS_DEBUG) {
          console.log(
            `After anti-cyclic: R:${(predictions.r * 100).toFixed(1)}% P:${(predictions.p * 100).toFixed(1)}% S:${(predictions.s * 100).toFixed(1)}%`,
          )
        }
      } else if (IS_DEBUG) {
        console.log(`❌ No repeating pattern detected`)
      }
    }

    // 4. Нормализация вероятностей
    const total = Object.values(predictions).reduce(
      (sum, prob) => sum + prob,
      0,
    )
    for (const move of ['r', 'p', 's'] as RealMove[]) {
      predictions[move] = predictions[move] / Math.max(total, 1)
    }

    if (IS_DEBUG) {
      console.log(
        `\n🎯 FINAL PREDICTIONS: R:${(predictions.r * 100).toFixed(1)}% P:${(predictions.p * 100).toFixed(1)}% S:${(predictions.s * 100).toFixed(1)}%`,
      )
      console.log(`=== END ANALYSIS ===\n`)
    }

    return predictions
  }

  private getCounterMove(predictedMove: Move): Move {
    // Камень побеждает ножницы, ножницы побеждают бумагу, бумага побеждает камень
    switch (predictedMove) {
      case Move.Rock:
        return Move.Paper // Бумага побеждает камень
      case Move.Paper:
        return Move.Scissors // Ножницы побеждают бумагу
      case Move.Scissors:
        return Move.Rock // Камень побеждает ножницы
      default:
        return Move.Rock
    }
  }

  override async getBestMove(pos: PositionInfo<GamePosition>): Promise<Move> {
    this.sendGreeting(pos)

    //console.log(pos.position.rounds)

    const enemy = pos.players.find(
      (p) => p !== null && p.login !== this.botLogin,
    )

    if (!enemy) {
      // Если противник не найден, играем случайно (не должео быть такогог вообще, сопреник есть всегда)
      const moves = [Move.Rock, Move.Paper, Move.Scissors]
      return moves[Math.floor(Math.random() * 3)] as Move
    }

    // Обновляем статистику на основе завершенных раундов
    if (pos.botIndex !== null) {
      this.updatePlayerStats(enemy.login, pos.position.rounds, pos.botIndex)
    }

    // Предсказываем следующий ход противника
    const predictions = this.predictNextMove(enemy.login)

    if (IS_DEBUG) {
      console.log(`Predictions for ${enemy.login}:`)
      console.log(`Rock: ${(predictions.r * 100).toFixed(1)}%`)
      console.log(`Paper: ${(predictions.p * 100).toFixed(1)}%`)
      console.log(`Scissors: ${(predictions.s * 100).toFixed(1)}%`)
    }

    // Находим наиболее вероятные ходы противника
    let maxProb = 0
    const bestMoves: RealMove[] = []

    for (const move of ['r', 'p', 's'] as RealMove[]) {
      if (predictions[move] > maxProb) {
        maxProb = predictions[move]
        bestMoves.length = 0 // Очищаем массив
        bestMoves.push(move)
      } else if (Math.abs(predictions[move] - maxProb) < 0.05) {
        // Если разница < 5%
        bestMoves.push(move)
      }
    }

    // Выбираем случайный из лучших ходов
    const predictedMove = bestMoves[
      Math.floor(Math.random() * bestMoves.length)
    ] as Move

    // Возвращаем контр-ход
    return this.getCounterMove(predictedMove)
  }

  override onGameEnd(tableId: number): void {
    this.greetingSent.delete(tableId)
  }
}
