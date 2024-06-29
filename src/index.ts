import { run, HandlerContext } from "@xmtp/botkit";
import { getRedisClient } from "./lib/redis.js";
import { LearnWeb3Client, Network } from "./lib/learn-web3.js";
import { FIVE_MINUTES } from "./lib/constants.js";
import Mixpanel from "mixpanel";

const mixpanel = Mixpanel.init(process.env.MIX_PANEL as string);

const inMemoryCache = new Map<
  string,
  { step: number; lastInteraction: number }
>();

run(async (context: HandlerContext) => {
  const { message } = context;
  const redisClient = await getRedisClient();
  const { content, senderAddress } = message;

  mixpanel.track("Faucet-Visit", {
    distinct_id: senderAddress,
  });
  const oneHour = 3600000; // Milliseconds in one hour.
  const now = Date.now(); // Current timestamp.
  const cacheEntry = inMemoryCache.get(senderAddress); // Retrieve the current cache entry for the sender.

  let reset = false; // Flag to indicate if the interaction step has been reset.
  const defaultStopWords = ["stop", "unsubscribe", "cancel", "list"];
  if (defaultStopWords.some((word) => content.toLowerCase().includes(word))) {
    // If its a stop word
    reset = true;
  }
  if (!cacheEntry || now - cacheEntry.lastInteraction > oneHour) {
    // If there's no cache entry or the last interaction was more than an hour ago, reset the step.
    reset = true;
  }
  if (reset) {
    inMemoryCache.delete(senderAddress);
  }
  // Update the cache entry with either reset step or existing step, and the current timestamp.
  inMemoryCache.set(senderAddress, {
    step: reset ? 0 : cacheEntry?.step ?? 0,
    lastInteraction: now,
  });

  // Return the updated cache entry and the reset flag.
  const step = inMemoryCache.get(senderAddress)!.step;

  const cachedSupportedNetworksData = await redisClient.get(
    "supported-networks"
  );

  let supportedNetworks: Network[];

  const learnWeb3Client = new LearnWeb3Client();
  if (
    !cachedSupportedNetworksData ||
    Date.now() >
      parseInt(JSON.parse(cachedSupportedNetworksData).lastSyncedAt) +
        FIVE_MINUTES
  ) {
    console.log("Cleared cache");
    const updatedSupportedNetworksData = await learnWeb3Client.getNetworks();
    await redisClient.set(
      "supported-networks",
      JSON.stringify({
        lastSyncedAt: Date.now(),
        supportedNetworks: updatedSupportedNetworksData,
      })
    );
    supportedNetworks = updatedSupportedNetworksData;
  } else {
    supportedNetworks = JSON.parse(
      cachedSupportedNetworksData!
    ).supportedNetworks;
  }

  supportedNetworks = supportedNetworks.filter(
    (n) =>
      !n.networkId.toLowerCase().includes("starknet") &&
      !n.networkId.toLowerCase().includes("fuel") &&
      !n.networkId.toLowerCase().includes("mode")
  );

  if (!step) {
    // send the first message
    await context.reply(
      "Hey! I can assist you in obtaining testnet tokens.\n\n Type the network number you would like to drip tokens from."
    );
    if (process.env.DEBUG === "true") console.log(supportedNetworks);
    // Combine and map all networks with their indices
    const combinedNetworks = supportedNetworks.map((n, index) => ({
      index: index + 1,
      networkId: n.networkId
        .replace(/_/g, " ")
        .replace(/\b\w/g, (l) => l.toUpperCase()),
      balance: n.balance,
      dripAmount: n.dripAmount,
    }));

    const channelsWithBalance = combinedNetworks
      .filter((n) => parseFloat(n.balance) > n.dripAmount)
      .map((n) => `${n.index}. ${n.networkId}`);

    const channelsWithoutBalance = combinedNetworks
      .filter((n) => parseFloat(n.balance) <= n.dripAmount)
      .map((n) => `${n.index}. ${n.networkId}`);

    //Else display list
    await context.reply(
      `Send "list" at any time to show the list again.\n\n✅With Balance:\n${channelsWithBalance.join(
        "\n"
      )}\n\n❌Without Balance:\n${channelsWithoutBalance.join("\n")}`
    );

    inMemoryCache.set(senderAddress, { step: 1, lastInteraction: Date.now() });
  } else if (step === 1) {
    if (content.toLowerCase() === "balances") {
      //Only for admin purposes
      const networkList = supportedNetworks.map((n) => {
        return `- ${n.networkId}: ${n.balance}`;
      });

      await context.reply(
        `Here are the networks you can choose from:\n\n${networkList.join(
          "\n"
        )}\n\nSend "list" at any time to show the list again.`
      );
    }

    const selectedNetworkIndex = parseInt(content) - 1;
    const selectedNetwork = supportedNetworks[selectedNetworkIndex];

    if (!selectedNetwork) {
      await context.reply("Invalid option. Please select a valid option.");
      return;
    }
    await context.reply(
      "Your testnet tokens are being processed. Please wait a moment for the transaction to process."
    );
    const network = selectedNetwork;
    const result = await learnWeb3Client.dripTokens(
      selectedNetwork.networkId,
      senderAddress
    );

    mixpanel.track("Faucet-Request", {
      distinct_id: senderAddress,
      network: network.networkName,
    });
    if (!result.ok) {
      await context.reply(
        `❌ Sorry, there was an error processing your request:\n\n"${result.error!}"`
      );
      return;
    }

    await context.reply("Here's your transaction receipt:");
    await context.reply(
      `${process.env.FRAME_BASE_URL}?txLink=${result.value}&networkLogo=${
        network?.networkLogo
      }&networkName=${network?.networkName.replaceAll(" ", "-")}&tokenName=${
        network?.tokenName
      }&amount=${network?.dripAmount}`
    );
    inMemoryCache.set(senderAddress, { step: 0, lastInteraction: Date.now() });
  }
});
