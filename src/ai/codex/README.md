# Codex AI

Codex is a championship-grade rock-paper-scissors bot that mixes multiple analytical layers to outplay humans.

## Architecture

- **Player profiles:** Every opponent gets a `PlayerProfile` with move histories, outcomes, and specialized data structures (Markov chains, transition maps, pattern memory, and outcome-aware buckets). Profiles expire after **2 days of inactivity**.
- **Prediction strategies:** Codex runs eleven lightweight predictors (`frequency`, `markov` orders 1-3, `pattern_memory`, `transition`, `after_outcome`, `anti_repetition`, `momentum`, `beat_ours`, `cycle_detection`). Each returns a probability distribution and confidence.
- **Ensemble weighting:** Each strategy tracks accuracy in `strategyPerformance` and receives a dynamic weight (recent accuracy weighted 65%, overall 35%). Combined predictions are normalized to produce enemy move probabilities.
- **Move selection:** Expected values are computed for each move against the ensemble. When candidates are close, a small randomization prevents predictability while still preferring the highest EV move.
- **Persistent intelligence:** Stats are updated after every completed round, including Markov chains, transitions, pattern memory, and post-outcome behavior. Strategy predictions are recorded to adjust weights once the actual opponent move is known.

## Debug logging

Set environment variable `IS_DEBUG=true` before starting the bot to print detailed logs:

- Strategy outputs (probabilities, confidence, weight)
- Combined enemy move distribution
- Expected values per move
- Anti-exploitation switches
- Profile cleanup events

Logs are prefixed with `[codex]` so they stand out in the console.

Example:

```
IS_DEBUG=true node dist/index.js
```

## Runtime notes

1. Codex relies solely on in-memory state, so no disk/database dependencies exist. Profiles are cleaned hourly by a timer.
2. Each match is evaluated on all available rounds, but only completed rounds count toward stats. The `processedRounds` counter prevents double counting.
3. Greeting messages are sent once per table to keep the chat friendly.

Codex aims to embody the meta-strategy of a world-class RPS player by blending frequency, pattern, Markov, and psychological signals, then hedging just enough randomness to stay unpredictable.
