# Bots for play in Rock, Paper, Scissors game on platform GrandGames Arena

You can create youown bots for play in this game using SDK. Create new folder in arc/ai with your implemetation of RpsAI.ts. You can send pull request to this repository to add your bot in this repository.

## How to use

1. Create your own ai in src/ai folder with RpsAI interface implementation.
2. In index.ts aiModules add you bot.
3. Change AI_LIST.ts AI_LIST var and add your bot.
4. Create new account ended at Bot on https://arena.grandgames.net
5. Get token from profile page
6. Rename .env.example to .env and fill JWT and AI (your custom name from AI_LIST)
7. Run `npm run dev` for local testing or build `npm run build` and run with `npm start`
8. If you want share your AI, create pull request to this repository.

## Additional info

Existing ai: codex, gpt, opus, swe15 created by AI with same prompt.

You can use docker to create multiple AI and test them in the same time. See docker-compose.yml

SDK Docs: https://github.com/MemoS77/GrandGames-Arena-Bots-SDK
