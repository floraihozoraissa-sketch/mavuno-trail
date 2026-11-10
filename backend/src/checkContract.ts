
import { Contract, JsonRpcProvider } from "ethers";

const CONTRACT_ADDRESS =
  "0xa1120e7fd0616afd5160bf00f09a75b9ba36d79d";

const ABI = [
  "function owner() view returns (address)",
  "function verifyEvent(bytes32 eventHash) view returns (bool)"
];

async function main() {
  const provider = new JsonRpcProvider(
    "https://ethereum-sepolia-rpc.publicnode.com"
  );

  const network = await provider.getNetwork();
  console.log("Network chain ID:", network.chainId.toString());

  const code = await provider.getCode(CONTRACT_ADDRESS);

  if (code === "0x") {
    throw new Error("No contract code found at this address.");
  }

  console.log("Contract code found: YES");

  const contract = new Contract(
    CONTRACT_ADDRESS,
    ABI,
    provider
  );

  const owner = await contract.owner();

  console.log("Contract owner:", owner);
  console.log("Expected owner: 0x1e90D33D3B1d380fF73f6D109506AeAe6749d26d");
  console.log("Owner matches:", owner.toLowerCase() ===
    "0x1e90d33d3b1d380ff73f6d109506aeae6749d26d");
}

main().catch((error) => {
  console.error("Contract check failed:", error.message);
  process.exitCode = 1;
});
