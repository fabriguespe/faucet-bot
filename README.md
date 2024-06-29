# Faucet Bot

> 💬 **Try it:** Message `faucetbot.eth`

## Development

To kickstart the tutorial, you'll need to clone the repository containing the bot code. Follow these steps:

```bash
git clone https://github.com/fabriguespe/faucet-bot.git
cd faucet-bot
# copy env variables template
cp .env.example .env
```

**Set the variables**

```bash
KEY= # The private key for the bot
XMTP_ENV= # XMTP environment (production or dev)
LEARN_WEB3_API_KEY= # Your LearnWeb3 API key
REDIS_CONNECTION_STRING= # Redis connection string for caching
FRAME_BASE_URL= # Base URL for the frame application
MIX_PANEL= # mix panel key
```

> This bot uses [Mint Frame](https://github.com/fabriguespe/mint-frame/)

```bash
# install dependencies
yarn install

# to run with hot-reload
yarn build:watch
yarn start:watch
```

## Messaging apps 💬

Test the bots in messaging apps

- [Converse](https://getconverse.app/): Own your conversations. Works with Frames (Transactions TBA)
- [Coinbase Wallet](https://www.coinbase.com/wallet): Your key to the world of crypto. (Frame support TBA)

## Documentation 📚

To learn more about Botkit, to go the [docs](https://github.com/xmtp/botkit)
