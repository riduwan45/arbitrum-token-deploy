import {
  Hex,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  erc20Abi,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import { L1GatewayRouterAbi } from "./abis/L1GatewayRouter";

const privateKey = process.env.PRIVATE_KEY as Hex | undefined;
if (!privateKey) {
  console.log("Missing PRIVATE_KEY environment variable");
  process.exit(1);
}
const token = "0x5a5297A52b1faCa0958084D4D424E774b0EDE7d2";
const router = "0x76B99e93314aC2bDA886a6c9103fe18380B496c7";

async function main() {
  const l1 = createPublicClient({
    chain: sepolia,
    transport: http("https://sepolia.drpc.org"),
  });
  const l2 = createPublicClient({
    transport: http("https://rpc-grubby-red-rodent-a6u9rz8x70.t.conduit.xyz"),
  });

  const l1FeeData = await l1.estimateFeesPerGas();
  const l2FeeData = await l2.estimateFeesPerGas();

  const wallet = createWalletClient({
    chain: sepolia,
    account: privateKeyToAccount(privateKey!),
    transport: http("https://sepolia.drpc.org"),
  });

  const l1GasLimit = 300_000n;
  const l2GasLimit = 500_000n;
  let l1GasCost = l1FeeData.maxFeePerGas ?? l1FeeData.gasPrice;
  let l2GasCost = l2FeeData.maxFeePerGas ?? l2FeeData.gasPrice;
  l1GasCost = l1GasCost + l1GasCost / 10n;
  l2GasCost = l2GasCost + l2GasCost / 10n;
  const maxSubmissionCost = l1GasCost * l1GasLimit;

  const value = l2GasCost * l2GasLimit + maxSubmissionCost;
  const extraData = encodeAbiParameters(
    [{ type: "uint256" }, { type: "bytes" }],
    [maxSubmissionCost, "0x"]
  );

  const [l2TokenAddress, name, symbol, rollupBalance] = await Promise.all([
    l1.readContract({
      abi: L1GatewayRouterAbi,
      functionName: "calculateL2TokenAddress",
      address: router,
      args: [token],
    }),
    l1.readContract({
      abi: erc20Abi,
      functionName: "name",
      address: token,
    }),
    l1.readContract({
      abi: erc20Abi,
      functionName: "symbol",
      address: token,
    }),
    l2.getBalance({ address: wallet.account.address }),
  ]);

  if (rollupBalance === 0n) {
    console.log(
      "Your ETH balance the rollup is 0, any token deployment transaction will fail until you bridge some ETH over"
    );
    process.exit(1);
  }

  const l2Token = await l2
    .readContract({
      abi: erc20Abi,
      functionName: "symbol",
      address: l2TokenAddress,
    })
    .catch(() => null);
  if (l2Token) {
    console.log(name, "already deployed to rollup");
    process.exit(0);
  }

  console.log(
    `Bridging ${symbol} (${token}) to rollup, rollup ${symbol} address will be ${l2TokenAddress}`
  );

  const gateway = await l1.readContract({
    abi: L1GatewayRouterAbi,
    functionName: "getGateway",
    args: [token],
    address: router,
  });
  // console.log(gateway);

  const allowance = await l1.readContract({
    abi: erc20Abi,
    address: token,
    functionName: "allowance",
    args: [wallet.account.address, gateway],
  });
  if (allowance === 0n) {
    console.log("Approving", symbol, "to gateway");
    const hash = await wallet.writeContract({
      abi: erc20Abi,
      functionName: "approve",
      args: [gateway, 1n],
      address: token,
    });
    await l1.waitForTransactionReceipt({ hash });
    console.log("Approved");
  }

  console.log("Submitting bridge operation...");
  const hash = await wallet.writeContract({
    abi: L1GatewayRouterAbi,
    functionName: "outboundTransferCustomRefund",
    args: [
      token, // _l1Token
      wallet.account.address, // _refundTo
      wallet.account.address, // _to
      1n, // _amount
      l2GasLimit, // _maxGas
      l2GasCost, // _gasPriceBid
      extraData, // _data
    ],
    address: router,
    value,
  });
  await l1.waitForTransactionReceipt({ hash });
  console.log("Submission confirmed, bridge operation will take a few minutes");
}
main();
