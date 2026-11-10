
import { BrowserProvider, Contract } from "ethers";

const CONTRACT_ADDRESS =
  "0xa1120e7fd0616afd5160bf00f09a75b9ba36d79d";

const EVENT_HASH =
  "0x027c3cdeac315bfa18adf81c6f8c02a54b7b6222e65f917955279d8ab3ceace5";
const ABI = [
  "function owner() view returns (address)",
  "function anchorEvent(bytes32 eventHash, string eventType)",
  "function verifyEvent(bytes32 eventHash) view returns (bool)"
];

document.querySelector<HTMLDivElement>("#root")!.innerHTML = `
  <main style="font-family: Arial; max-width: 650px; margin: 60px auto; padding: 24px;">
    <h1>MavunoTrail Audit Demo</h1>
    <p>Network: Ethereum Sepolia</p>
    <p>Event: delivery_recorded</p>
    <p style="overflow-wrap:anywhere;">Hash: ${EVENT_HASH}</p>
    <button id="connect">Connect MetaMask</button>
    <button id="anchor" disabled>Anchor Demo Event</button>
    <button id="verify" disabled>Verify Event</button>
    <pre id="status" style="white-space:pre-wrap; margin-top:24px;"></pre>
  </main>
`;

const status = document.querySelector<HTMLPreElement>("#status")!;
const anchorButton = document.querySelector<HTMLButtonElement>("#anchor")!;
const verifyButton = document.querySelector<HTMLButtonElement>("#verify")!;

let contract: Contract | undefined;

document.querySelector("#connect")!.addEventListener("click", async () => {
  try {
    const ethereum = (window as any).ethereum;

    if (!ethereum) throw new Error("MetaMask was not detected.");

    const provider = new BrowserProvider(ethereum);
    await provider.send("eth_requestAccounts", []);

    const network = await provider.getNetwork();

    if (network.chainId !== 11155111n) {
      throw new Error("Please switch MetaMask to Sepolia.");
    }

    const signer = await provider.getSigner();
    const contractInstance = new Contract(
      CONTRACT_ADDRESS,
      ABI,
      signer
    );

    const owner = await contractInstance.owner();

    if (owner.toLowerCase() !== (await signer.getAddress()).toLowerCase()) {
      throw new Error("Connected wallet is not the contract owner.");
    }

    contract = contractInstance;
    anchorButton.disabled = false;
    verifyButton.disabled = false;

    status.textContent = `Connected successfully.\nOwner: ${owner}`;
  } catch (error: any) {
    status.textContent = error.message;
  }
});

anchorButton.addEventListener("click", async () => {
  try {
    if (!contract) throw new Error("Connect MetaMask first.");

    anchorButton.disabled = true;
    status.textContent = "Waiting for MetaMask confirmation...";

    const tx = await contract.anchorEvent(
      EVENT_HASH,
      "delivery_recorded"
    );

    status.textContent = `Transaction submitted:\n${tx.hash}\nWaiting for confirmation...`;

    const receipt = await tx.wait();

    status.textContent =
      `GREEN — Event anchored successfully!\n` +
      `Transaction: ${receipt.hash}\n` +
      `Block: ${receipt.blockNumber}\n` +
      `Explorer: https://sepolia.etherscan.io/tx/${receipt.hash}`;
  } catch (error: any) {
    status.textContent = error.shortMessage || error.message;
  } finally {
    anchorButton.disabled = false;
  }
});

verifyButton.addEventListener("click", async () => {
  try {
    if (!contract) throw new Error("Connect MetaMask first.");

    const exists = await contract.verifyEvent(EVENT_HASH);

    status.textContent = exists
      ? "GREEN — The event is recorded on the blockchain."
      : "RED — The event has not been recorded yet.";
  } catch (error: any) {
    status.textContent = error.message;
  }
});
