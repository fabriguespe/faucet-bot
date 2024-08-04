import { run, HandlerContext } from "@xmtp/message-kit";
import { getRedisClient } from "./lib/redis.js";
import { LearnWeb3Client, Network } from "./lib/learn-web3.js";
import { FIVE_MINUTES } from "./lib/constants.js";
import Mixpanel from "mixpanel";

const mixpanel = Mixpanel.init(process.env.MIX_PANEL as string);

//Tracks conversation steps
const inMemoryCacheStep = new Map<string, number>();

run(async (context: HandlerContext) => {
  const { message } = context;
  const redisClient = await getRedisClient();
  const {
    content: { content: text },
    sender,
  } = message;

  mixpanel.track("Faucet-Visit", {
    distinct_id: sender.address,
  });

  const defaultStopWords = ["stop", "unsubscribe", "cancel", "list"];
  if (defaultStopWords.some((word) => text.toLowerCase().includes(word))) {
    inMemoryCacheStep.set(sender.address, 0);
  }

  const cacheStep = inMemoryCacheStep.get(sender.address) || 0;

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

  if (!cacheStep) {
    // send the first message
    await context.send(
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
    await context.send(
      `Send "list" at any time to show the list again.\n\n✅With Balance:\n${channelsWithBalance.join(
        "\n"
      )}\n\n❌Without Balance:\n${channelsWithoutBalance.join("\n")}`
    );

    inMemoryCacheStep.set(sender.address, 1);
  } else if (cacheStep === 1) {
    if (text.toLowerCase() === "balances") {
      //Only for admin purposes
      const networkList = supportedNetworks.map((n) => {
        return `- ${n.networkId}: ${n.balance}`;
      });

      await context.send(
        `Here are the networks you can choose from:\n\n${networkList.join(
          "\n"
        )}\n\nSend "list" at any time to show the list again.`
      );
    }

    const selectedNetworkIndex = parseInt(text) - 1;
    const selectedNetwork = supportedNetworks[selectedNetworkIndex];

    if (!selectedNetwork) {
      await context.send("Invalid option. Please select a valid option.");
      return;
    }
    await context.send(
      "Your testnet tokens are being processed. Please wait a moment for the transaction to process."
    );
    const network = selectedNetwork;
    const result = await learnWeb3Client.dripTokens(
      selectedNetwork.networkId,
      sender.address
    );

    mixpanel.track("Faucet-Request", {
      distinct_id: sender.address,
      network: network.networkName,
    });
    if (!result.ok) {
      await context.send(
        `❌ Sorry, there was an error processing your request:\n\n"${result.error!}"`
      );
      return;
    }

    await context.send("Here's your transaction receipt:");
    await context.send(
      `${process.env.FRAME_BASE_URL}?txLink=${result.value}&networkLogo=${
        network?.networkLogo
      }&networkName=${network?.networkName.replaceAll(" ", "-")}&tokenName=${
        network?.tokenName
      }&amount=${network?.dripAmount}`
    );
    inMemoryCacheStep.set(sender.address, 0);
  }
});
