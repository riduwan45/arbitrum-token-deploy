import {
  Hex,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

import { L1GatewayRouterAbi } from "./abis/L1GatewayRouter";

const privateKey = process.env.PRIVATE_KEY as Hex | undefined;
if (!privateKey) {
  console.log("Missing PRIVATE_KEY environment variable");
  process.exit(1);
}

async function main() {
  const l1 = createPublicClient({
    transport: http(mainnet.rpcUrls.default[0]),
  });
  const l2 = createPublicClient({
    transport: http("https://rpc.figarolabs.dev"),
  });

  const l1FeeData = await l1.estimateFeesPerGas();
  const l2FeeData = await l1.estimateFeesPerGas();

  const wallet = createWalletClient({
    account: privateKeyToAccount(privateKey!),
    chain: mainnet,
    transport: http(),
  });

  const l1GasLimit = 80_000n;
  const l2GasLimit = 300_000n;
  const l1GasCost = l1FeeData.maxFeePerGas ?? l1FeeData.gasPrice;
  const l2GasCost = l2FeeData.maxFeePerGas ?? l2FeeData.gasPrice;
  const maxSubmissionCost = l1GasCost * l1GasLimit;

  const value = l2GasCost * l2GasLimit + maxSubmissionCost;
  const extraData = encodeAbiParameters(
    [{ type: "uint256" }, { type: "bytes" }],
    [maxSubmissionCost, "0x"]
  );

  await wallet.writeContract({
    abi: L1GatewayRouterAbi,
    functionName: "outboundTransferCustomRefund",
    args: [
      "0x5a5297A52b1faCa0958084D4D424E774b0EDE7d2", // _l1Token
      wallet.account.address, // _refundTo
      wallet.account.address, // _to
      1n, // _amount
      l2GasLimit, // _maxGas
      l2GasCost, // _gasPriceBid
      extraData, // _data
    ],
    address: "0x4bcD491323Fc8600415EBA0388Dc922180366cFe",
    value,
  });
}
main();
