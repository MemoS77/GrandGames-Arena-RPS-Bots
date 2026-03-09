import dotenv from 'dotenv'
dotenv.config()
export const IS_DEBUG = process.env.DEBUG === 'true'
export const TOKEN = process.env.TOKEN
export const AI = process.env.AI
export const AI_LIST = ['opus', 'codex', 'random', 'swe15']

if (!TOKEN) {
  throw new Error('TOKEN is not defined')
}

if (!AI) {
  throw new Error('AI is not defined')
}

if (!AI_LIST.includes(AI)) {
  throw new Error('AI is not supported')
}
