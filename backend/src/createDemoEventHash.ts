
import { keccak256, toUtf8Bytes } from "ethers";

const demoEvent = {
  eventType: "delivery_recorded",
  reference: "DEMO-CHAIN-001",
  quantityKg: 25,
  grade: "A",
  cooperative: "MavunoTrail Demo Cooperative"
};

const canonicalData = JSON.stringify(demoEvent);
const eventHash = keccak256(toUtf8Bytes(canonicalData));

console.log("Demo event:", canonicalData);
console.log("Event hash:", eventHash);
